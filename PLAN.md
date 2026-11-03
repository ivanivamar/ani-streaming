# ani.stream — revival plan (rev. 3, Nov 3, 2026)

**Status: Step 0 done (Nov 3, 2026); next is Step 1 (test encodes).** Replaces the allanime / ani-cli approach (blocked by
purpose-built anti-scraping, see `claude/known-issue-api-sources-cloudflare.md`) with a library
Ivan owns: his own episodes, compressed with ffmpeg, stored on Google Drive, streamed with range
requests. Same model as the music app (Material Music).

**Rev. 2 changes:** all catalogue and app data lives in **Firestore** (Drive holds only binary
files that can't go there), and the Angular app follows **Angular 22 practices** with a
**DDD folder structure** (see "Architecture rules" and Step 0).

**Rev. 3 changes:** the music app (`D:\material-music`, "Pelagic" / Material Music) was read.
It already solves Drive import, Drive streaming, Google sign-in that stays signed in, Firestore
sign-in, Capacitor Android with Media3, offline downloads and both CI workflows. Those parts
are ported (see "Reuse from the music app"). GPU is an RTX 3060.

Sources: `anime-step1-encode-plan.md` (encode pipeline), the v3 handoff in
`design_handoff_anime_streaming/` (screens), and the current repo `D:\my-streaming`.

## What's in the repo today

- **Frontend** — Angular 22, standalone + signals, Firebase Auth (email/password), hls.js player,
  `zone.js` still installed. Flat `core / features / shared` folders. Screens: auth, home,
  search, anime detail, watch, all backed by `/api/*` calls in `catalog.service.ts`.
- **Server** — Express on Cloud Run: allanime client + crypto, Playwright, media proxy,
  firebase-admin guard. Search/episodes worked; playback never did.
- **Design v3** — 11 screens, still written around ani-cli; some need adapting (Step 4).
- Music app (`D:\material-music`): React + Vite + Capacitor 8, read for reuse (next section).

## Architecture change

| | Before | After |
| --- | --- | --- |
| Content | allanime scraping | Ivan's own encodes on Google Drive |
| Catalogue | `/api/search` live | **Firestore** `series` / `episodes`, written by the importer |
| Metadata | AniList at runtime (planned) | AniList fetched by the importer, stored in Firestore |
| Playback | HLS via `/api/proxy` | Progressive MP4 (HEVC 10-bit / AAC) with Drive range requests |
| Subtitles | burned in | soft `.ass` + fonts on Drive, JASSUB on web, ExoPlayer on Android |
| Auth | email/password | **Google sign-in** (matches v3) + Drive read-only scope, kept alive by a sign-in helper function |
| Backend | Express on Cloud Run | **No app server.** Firebase Hosting + Firestore + one small Cloud Function (sign-in helper, as in the music app) |
| Android | — | Capacitor wrapper, APK built by a GitHub Action |

The Node server, Playwright, allanime client and hls.js get removed (kept in git history).

## Reuse from the music app

| Music app piece | What it does | Use here |
| --- | --- | --- |
| `tools/import/src/auth.js` | Desktop OAuth client, refresh token cached in `secrets/token.json` | Port as-is (TS) for the importer's Drive access |
| `tools/import/src/stores.js` | Drive folder find/create, upload with retry + backoff | Port; **add resumable uploads with offset resume** (music files are small, episodes aren't) |
| `tools/import/src/encode.js` | ffmpeg runner (`ffmpeg-static` or `FFMPEG_PATH`) | Port the runner; use a **system ffmpeg with NVENC** (`FFMPEG_PATH`), checked at start with `ffmpeg -encoders` |
| `tools/import/src/import.js` | scan → skip unchanged → encode → upload → catalogue, `dry-run`, `--limit`, `--out` | Same command shape; catalogue goes to Firestore instead of `library.json` |
| `app/public/sw.js` + `lib/driveStream.ts` | Service worker proxies `<audio>` range requests to Drive with the page's token (asked per request over `MessageChannel`), handles 401/416 | Port for `<video>`: same `__drive/<fileId>?size=&type=` URL scheme |
| `lib/drive.ts`, `state/session.ts` | Google Identity Services token, expiry, re-auth | Port into `identity/infrastructure` |
| `firebase/functions` (`/api/auth/*`, `/api/sync/token`) | Keeps the refresh token in a `__session` cookie so the PWA stays signed in; swaps the Drive token for a Firebase custom token | Port only these two routes (no Deezer/TTS/concerts). Needs the **Blaze plan** on `myanime-streaming` |
| `sync/firebase.ts` | Firestore init, custom-token sign-in, `users/{uid}` rules | Port into `shared/infrastructure` + `identity` |
| `firebase.json` | Hosting headers (no-cache for html/sw, immutable assets), `/api/**` → function | Copy, adjust paths |
| Android: `DriveAuth`, `KnownLengthDataSource`, `PelagicPlayerPlugin`, `DownloadWorker`, `Offline` | Native Google sign-in, Media3 Drive DataSource with OAuth header, background downloads | Port to a video player plugin + downloads plugin (Step 8). These files are nested too deep to read from here; read them at Step 8 |
| `.github/workflows/android.yml`, `firebase.yml` | Signed APK → GitHub Release; Hosting + Functions deploy | Copy, rename secrets (`ANI_KEYSTORE_*`, `FIREBASE_SERVICE_ACCOUNT`) |
| `native/updates.ts` | In-app "new APK available" from GitHub Releases | Port |

Not reused: the React UI, the DJ, concerts, Deezer, Drive JSON stores (here they are Firestore
from the start).

## Where data lives

**Firestore** — everything that is structured data:

```
series/{seriesId}
  { title, titleRomaji, titleNative, aliases[], anilistId, synopsis, genres[], year, status,
    format, posterUrl, bannerUrl, color, seasonCount, episodeCount, addedAt, updatedAt,
    searchTokens[], fontFileIds[] }
series/{seriesId}/seasons/{sNN}
  { number, title, anilistId, year, episodeCount, posterUrl }
series/{seriesId}/episodes/{sNNeNN}
  { season, number, title?, durationSec, sizeBytes, addedAt,
    video   { driveFileId, codec, bitDepth, width, height, bitrate },
    audio   [{ lang, codec, channels, default }],
    subs    [{ lang, kind: full|signs|songs, driveFileId }],
    chapters[{ title, startSec, endSec, kind: op|ed|other }],
    thumbDriveFileId,
    source  { width, height, codec, bitDepth, bitrate }, action: encode|encode+scale|copy }
importState/{sourceHash}  { path, size, mtime, episodeRef, status, error? }   // re-run tracking
overrides/{seriesId}      { anilistId, title?, … }                           // manual match fixes
users/{uid}               { displayName, email, photoURL, createdAt, prefs{…} }
users/{uid}/library/{seriesId}            { status, watched, updatedAt }
users/{uid}/favourites/{seriesId}         { addedAt }
users/{uid}/progress/{seriesId}_{sNNeNN}  { position, duration, updatedAt }
users/{uid}/recent/{id}                   { term, at }   // cap 6
users/{uid}/notify/{key}                  { title, ep?, at }
config/access             { allowedUids[] }
```

- Chapters, audio/subtitle track lists, override file and importer state all moved from JSON
  files into Firestore.
- Posters/banners use the **AniList CDN URLs** directly (no copy needed).
- Search: `searchTokens` (normalized title words + aliases) with `array-contains`; the whole
  `series` collection is small enough (hundreds of docs) to also filter client-side.
- Reads stay cheap: persistent local cache (`persistentLocalCache`), home/search read only
  `series`; `episodes` are read per series when its page opens.
- Rules: catalogue readable only by uids in `config/access`, written only by the importer
  (Admin SDK bypasses rules); `users/{uid}/**` only by that uid.

**Google Drive** — only binary or large files Firestore can't hold (1 MiB doc limit):
`e01.mp4` (video), `e01.en.ass` (styled subs can exceed 1 MiB), `fonts/*`, `e01.thumb.webp`.
Firestore stores their Drive file ids.

```
<root>/series/<seriesId>/fonts/*.ttf|otf
<root>/series/<seriesId>/s01/e01.mp4, e01.en.ass, e01.thumb.webp
```

## Architecture rules (Angular 22 + DDD)

**Angular 22 practices**
- Standalone everything, no NgModules. OnPush is the v22 default; no `Eager` components.
- **Zoneless** (`provideZonelessChangeDetection()`), remove `zone.js`.
- Signals for state: `signal` / `computed` / `linkedSignal`; `resource()` / `rxResource()`
  (stable in v22) for async loads such as Firestore and Drive reads; `toSignal` at RxJS edges.
- `input()` / `output()` / `model()`, `viewChild()`; `host: {}` instead of `@HostBinding`.
- `inject()` only; `@Service()` for root services (v22 shorthand).
- Built-in control flow (`@if`, `@for` with `track`, `@switch`), `@defer` for heavy parts
  (player, JASSUB, releases grid).
- **Signal Forms** (stable in v22) for settings and the welcome screen.
- Lazy routes per bounded context (`loadChildren` → `*.routes.ts`), functional guards,
  `withComponentInputBinding()` for route params as inputs, `withViewTransitions()` where it
  fits the motion spec.
- `NgOptimizedImage` for posters; strict TS 6, `strictTemplates` (v22 default).
- Firebase JS SDK wrapped behind DI tokens/providers (no AngularFire, which tends to lag new
  Angular majors).
- Tests with **Vitest**; ESLint with `angular-eslint` + `eslint-plugin-boundaries` to enforce
  the layer rules below.

**DDD folder structure** — one folder per bounded context, each with four layers:

```
src/app/
  contexts/
    catalog/          series, seasons, episodes, search
      domain/           entities + value objects (Series, Episode, EpisodeRef), pure rules
      application/      use cases / signal stores (CatalogStore, SearchSeries)
      infrastructure/   Firestore repositories, mappers (doc ⇄ entity)
      ui/               pages + components (home, search, anime-detail), catalog.routes.ts
    playback/         player, streaming, subtitles, chapters/skip
      domain/           PlaybackSession, skip rules, track selection
      application/      PlayerStore, ResumeEpisode
      infrastructure/   DriveStreamAdapter, JassubRenderer, service-worker bridge
      ui/               watch page, controls, episodes popup
    library/          library status, favourites, progress, history
      domain/           WatchProgress (watched ≥ threshold), LibraryEntry, resume rule
      application/      LibraryStore, ProgressTracker (10 s / pause / leave writes)
      infrastructure/   Firestore repositories under users/{uid}
      ui/               library page, continue-watching components
    releases/         airing schedule, premieres, notifications
      domain/ application/ infrastructure/ (AniList GraphQL) ui/
    identity/         Google sign-in, Drive token, profile, prefs, access allowlist
      domain/ application/ infrastructure/ (Firebase Auth, Google OAuth) ui/ (auth, welcome, settings)
  shared/
    ui/               design system: pill, segmented, dropdown, context menu, poster card, icons
    kernel/           cross-context types (SeriesId, EpisodeRef, Result), time/format utils
    infrastructure/   Firebase providers/tokens, Drive HTTP client
  shell/              app shell, sidebar, bottom nav, header search, background, page motion
  app.config.ts, app.routes.ts
```

Layer rules (enforced by lint): `ui → application → domain`; `infrastructure` implements
interfaces (ports) declared in `domain`/`application` and is wired in each context's
providers; `domain` has no Angular or Firebase imports. Contexts talk to each other only
through their `application` public API (`index.ts`), never through another context's
infrastructure.

**Shared contract package** — `packages/contracts`: Firestore document types and ids
(`seriesId`, `sNNeNN`) used by both the app's infrastructure mappers and the importer, so the
schema is defined once.

---

## Step 0 — Repo baseline
- Branch `revive-drive`. Remove `server/`, allanime code, `hls.js`, `playwright`, `zone.js`.
- Workspace layout: `/` Angular app, `/packages/contracts`, `/tools/import`, `/android` (Step 8).
- Create the DDD skeleton above, zoneless config, ESLint boundaries, Vitest, path aliases
  (`@catalog/*`, `@playback/*`, `@shared/*`, …).
- Replace the old README/`data-sources.md` with this plan's architecture.
- **Check:** `ng build`, `ng lint`, `ng test` pass on the empty skeleton.

**Done (Nov 3):** DDD skeleton with 5 contexts × 4 layers, `shared/{ui,kernel,infrastructure}`,
`shell`; zoneless; lazy route per context with placeholder pages; `packages/contracts`
(Firestore doc types + id helpers); `tools/import` placeholder; npm workspaces; Vitest via
`@angular/build:unit-test`; ESLint (angular-eslint + `eslint-plugin-boundaries` with
`checkAllOrigins`, so `domain`/`kernel`/`contracts` can't import npm packages); path aliases.
Build, lint and 15 tests pass. Deviations: context routes live in `ui/<context>.routes.ts`
(identity exports `identityPublicRoutes` outside the shell and `identityShellRoutes` for
settings); `src/main.ts` is ignored by the boundaries rule; TS 6 has no `baseUrl`, so aliases
are `./`-relative `paths`.

## Step 1 — Test encodes (encode plan, Phase 1a)
- `tools/import` command `test-encode`: 2–3 sample episodes (dark / fast action / gradients).
  Samples so far: Attack on Titan S01E01 (BD HEVC) and Aoashi S01E01 (WEB x264).
- Variants for the **RTX 3060** (Ampere NVENC: HEVC 10-bit with B-frames, **no AV1 encode**):
  - `hevc_nvenc -preset p7 -tune hq -rc vbr -cq 22 / 24 / 26 -b_ref_mode middle -spatial_aq 1
    -temporal_aq 1 -pix_fmt p010le` (three quality levels)
  - `libx265 -preset slow -crf 20 -tune animation -pix_fmt yuv420p10le` (quality reference)
  - AV1 dropped: software-only on this GPU and needs AV1 decode on the phone.
- All: `-tag:v hvc1`, `+faststart`, AAC stereo 192k. Prints size, encode time, average bitrate,
  and for Aoashi also the `copy` result (remux only) to compare.
- Ivan watches on PC (Chrome/Edge) and phone; picks codec, settings and bitrate ceiling.
- **Output:** chosen settings written back into this plan.

## Step 2 — Importer (Phases 1a+, 1b, 1c)
Node + TS script in `tools/import`, modelled on the music importer, using `firebase-admin`
(service account) for Firestore and `googleapis` for Drive.
1. **Probe + decide** per file: display size (SAR, rotation, cropped widescreen), scale only above
   1920×1080, `copy` vs `encode` vs `encode+scale`, interlace → `bwdif`. `--force-encode`.
2. **Extract**: Japanese audio → AAC stereo (only track kept), subtitles (ASS as-is, SRT → ASS,
   PGS/VobSub → report; sidecar `.ass/.srt` wins), fonts (deduped per series), chapters (→
   Firestore, OP/ED tagged by name/length), thumbnail WebP at 25%.
3. **Name parsing**: release-group and `SxxExx` styles (same rules as `parseVid` in v3);
   unparseable → report, never guessed.
4. **Verify** (ffprobe, duration ±1 s, streams present), **resumable upload** to Drive, clean
   work copy. One episode at a time. Never deletes or modifies originals.
5. **Write Firestore**: `importState` per source (re-runnable, survives machine changes),
   `series` / `seasons` / `episodes` docs with Drive ids, AniList metadata (respecting
   `overrides`). Run report printed in the terminal and saved as a local log file.
6. Stops cleanly on Drive's 750 GB/day limit; resumes next run. `dry-run` and `import`.
- **Check:** dry-run on the real folder, then import one full season and inspect Drive + Firestore.

## Step 3 — Identity, Drive access, streaming
- `identity`: Google Identity Services sign-in with Drive read-only scope (ported from the music
  app's `session.ts`/`drive.ts`); the sign-in helper function keeps the refresh token in a
  `__session` cookie and swaps the Drive token for a Firebase custom token, so Firestore
  and Drive share one sign-in. Allowlist check against `config/access`.
- Google Cloud: new OAuth clients in the `myanime-streaming` project (Desktop for the importer,
  Web for Hosting + localhost, Android for the APK SHA-1); Drive API enabled; consent screen
  published (unverified is fine for personal use).
- `shared/infrastructure`: Firebase providers (Auth, Firestore with persistent cache), Drive client.
- `playback/infrastructure`: service worker ported from the music app's `sw.js` + `driveStream.ts`
  so `<video src>` streams and seeks Drive files. Angular's own `@angular/service-worker` is not
  used (it can't proxy range requests); this custom worker also caches the app shell.
- `catalog/infrastructure`: Firestore repositories for series/seasons/episodes.
- **Check:** a Drive video plays and seeks instantly; catalogue loads from Firestore.

## Step 4 — Rebuild the UI to design v3 (adapted)
`shared/ui` design system (tokens, pill, segmented, dropdown, context menu, poster card), then
`shell` (inset sidebar / bottom nav, Waves background, header search, page motion), then screens:

| Screen | Context | Change vs v3 design |
| --- | --- | --- |
| Sign in / Welcome | identity | As designed (Google only). Audio and Quality choices removed (Japanese only, single 1080p copy). |
| Home | catalog + library | As designed: continue watching, recently added (`addedAt`), recently watched. |
| Search | catalog | Searches Firestore catalogue. Drop Sub/Dub, quality, CLI line, "Source unavailable"; genre/status filters instead. |
| Anime detail | catalog | As designed; seasons/episodes from Firestore, real thumbs and durations. |
| Watch | playback | MP4 player. **Add CC button** (full / signs / off), skip OP/ED from chapters. |
| Library | library | As designed. |
| New releases | releases | AniList schedule; "not on allanime" → "not in your library". |
| Import | — | **Dropped.** Importing happens only through the importer script. |
| Downloads | playback | Android offline downloads only (Step 8); hidden on web. |
| Settings | identity | Signal Forms. Playback prefs, Data; Downloads section only on Android. |

Still to design: loading skeletons, player error, empty home.

## Step 5 — Player (web)
- `<video>` with Drive stream, JASSUB (deferred) with the series' fonts, chapter-based skip
  buttons (AniSkip fallback), autoplay next, keyboard shortcuts.
- `ProgressTracker` writes every ~10 s and on pause / seek / leave / `visibilitychange`.
- **Check:** HEVC hardware decode in Chrome/Edge on Windows; styled fansub renders correctly.

## Step 6 — Firestore user data + rules
- `library` context repositories for `users/{uid}/…`, export JSON / clear history / delete account.
- `firestore.rules` + `firestore.indexes.json` in the repo; rules tested with the emulator.

## Step 7 — Firebase Hosting + CI
- `firebase.json` copied from the music app (cache headers, `/api/**` → function) + SPA rewrite;
  PWA manifest; in-app "new version · Reload" prompt.
- `firebase.yml` workflow ported: on push to `main` → lint, test, build → deploy Hosting, rules
  and the function when it changed. Secret `FIREBASE_SERVICE_ACCOUNT`.

## Step 8 — Android app + GitHub Action
- Capacitor 8 wraps the Angular build (app id e.g. `com.ivan.anistream`).
- Ported from the music app: `DriveAuth` (native Google sign-in), `KnownLengthDataSource`
  (Media3 + OAuth header), `DownloadWorker` / `Offline` (background downloads), `updates.ts`.
- New: a **fullscreen native video player** (Media3 `PlayerView` in its own Activity) with
  controls matching the v3 Watch screen; ASS subtitles through libass for Media3 (Media3's own
  SSA support drops most styling); chapter skip; progress reported back to the web layer.
  Exposed to Angular as a `playback` adapter, chosen per platform.
- Downloads screen (Android only): MP4 + subs + fonts saved for offline play.
- `android.yml` workflow ported: build web → `cap sync android` → signed `assembleRelease` →
  GitHub Release with the APK; app checks Releases for updates. New keystore, secrets
  `ANI_KEYSTORE_BASE64` / `ANI_KEYSTORE_PASSWORD`.
- **Check:** install APK, sign in, stream, seek, subs, progress syncs with web.

## Order and dependencies
Step 0 → **1 (needs Ivan's viewing decision)** → 2 → 3 → 4/5/6 in parallel → 7 → 8.
Steps 3–4 can start with a few hand-written Firestore docs and one test MP4 while Step 1 is judged.

## Decisions (Nov 3)
- **Japanese audio only.** No dub tracks, no audio switch in the player, no Sub/Dub choice on Welcome/Settings.
- **Music app** at `D:\material-music` (already has a Capacitor 8 Android app with Media3).
  Android here uses **Capacitor**, porting its native Drive/auth/download code (Step 8).
- **Node server and Cloud Run dropped.**
- **Downloads = Android only**, for offline viewing.
- **Firebase project: `myanime-streaming`** (new project, not `my-streaming-969f8`).
- **GPU: RTX 3060 → `hevc_nvenc`** (10-bit, B-frames). No AV1 encode on this card.
  ffmpeg on Windows: a full build with NVENC (`winget install Gyan.FFmpeg`).
- **No import status page**; the Import screen is dropped.
- **Originals**: no folder structure yet. Samples in `C:\Users\ivani\Videos\Anime`:
  - `[LostYears] Aoashi - S01E01 (WEB 1080p x264 E-AC-3 AAC) [720C6417].mkv` — 724 MB, WEB, H.264.
    If 8-bit and ≤ ceiling bitrate it's a **copy** candidate (video remuxed, audio → AAC).
  - `[TatakaeSubs] Attack on Titan - S01E01 (BD 1080p HEVC OPUS) [21D9AE40].mkv` — 2.36 GB, BD,
    HEVC, Opus audio. Too high a bitrate → **encode**; Opus → AAC.
  - Both use `[Group] Title - SxxEyy (tags) [CRC].mkv`, the first pattern the name parser supports.
  - Sources vary a lot (0.7–5 GB), so the copy-vs-encode decision (Phase 1a+) matters more than planned.
  - Proposed layout (optional, the importer reads names, not folders):
    `C:\Users\ivani\Videos\Anime\<Series>\<files>`.

## Still open
1. **Blaze plan** on `myanime-streaming` for the sign-in helper function (pay-as-you-go; this use
   stays inside the free allowance, as in the music app). Without it, the web app asks Google
   to sign in again every hour.
2. Drive folder name for the anime files (proposal: `AniStream/`), same Google account as the music.
