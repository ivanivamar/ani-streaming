# ani.stream — revival plan (rev. 3, Nov 3, 2026)

**Status: Steps 0–3 done, Step 4 written (Nov 3, 2026; to check on Ivan's PC); next Steps 5/6.** Replaces the allanime / ani-cli approach (blocked by
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

### Result (Nov 3, 2026) — done

`npm run test-encode -w @ani/import` (5-min clips, first 5:00 of each episode):

| Variant | AoT S01E01 (BD HEVC 10-bit, 12.1 Mb/s avg) | Aoashi S01E01 (WEB **H.264 10-bit**, 3.6 Mb/s) |
| --- | --- | --- |
| `nvenc-cq22` | 7.53 Mb/s · 61% | 3.67 Mb/s · 93% |
| `nvenc-cq24` | 6.32 Mb/s · 52% | 2.85 Mb/s · 72% |
| `nvenc-cq26` | 4.95 Mb/s · 40% | 2.19 Mb/s · 56% |
| `x265-crf20` | 4.76 Mb/s · 39% (0.25× realtime) | 1.68 Mb/s · 43% (0.61× realtime) |
| `copy` | 19.2 Mb/s (OP section; avg 12.1) | n/a (H.264 10-bit) |

NVENC runs at ~6× realtime for every CQ (limited by CPU decode of the source, not the GPU),
so a 24-min episode encodes in ~4 min. Ivan saw no difference between any of the variants on
PC or phone, so the choice is driven by size, speed and streaming:

**Chosen encode settings**
```
-c:v hevc_nvenc -preset p7 -tune hq -rc vbr -cq 26 -b:v 0 -maxrate 8M -bufsize 16M
-b_ref_mode middle -spatial-aq 1 -temporal-aq 1 -rc-lookahead 32
-pix_fmt p010le -profile:v main10 -g 48 -tag:v hvc1
-c:a aac -b:a 192k -ac 2          (Japanese track only; stream copy if already AAC ≤ 2 ch)
-movflags +faststart
```
- **CQ 26:** smallest NVENC level, about the size of the x265 reference on AoT, no visible loss.
  ~2–5 Mb/s → roughly 400–900 MB per 24-min episode.
- **Ceiling 8 Mb/s** (`-maxrate 8M -bufsize 16M`): CQ 26 averages well under it, so it only
  trims rare spikes (the AoT OP); keeps phone streaming on mobile data and Drive seeks predictable.
- **GOP 48** (~2 s keyframes) for quick seeks over Drive range requests. Was 240 (~10 s) until
  Nov 3: Step 3 measured 400–1722 ms seeks on real Drive (decoding up to 10 s from the previous
  keyframe). Applies to new imports only; existing episodes keep 240 unless re-imported with `--force`.
- Note: current ffmpeg builds only accept `-spatial-aq` / `-temporal-aq` (hyphen), not underscores.

**Copy rule for Step 2** (instead of re-encoding): copy the video only if it is H.264 8-bit
4:2:0 or HEVC Main/Main 10 4:2:0, ≤ 1920×1080, **and** its average video bitrate ≤ 8 Mb/s.
Everything else is encoded. Aoashi showed WEB releases can be **H.264 10-bit**, which browsers
and phones can't hardware-decode, so bit depth must be checked, not just the codec.

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

**Done (Nov 3):** `npm run dry-run|import -w @ani/import` — see `tools/import/README.md`.
Checked on Ivan's PC: dry-run of the real folder (both samples matched AniList exactly: Aoashi
134732, Attack on Titan 16498), Aoashi S01E01 imported to Drive `AniStream/` + Firestore (NVENC
724 MB → 298 MB in 3:56), re-import with `--force` uploaded 0 bytes (same MD5). Only single
sample episodes exist so far, so the "one full season" check happens with the first real season.
Chapters: at most one OP (first half) and one ED (second half), song length 45–150 s, "Opening"/
"Ending" beat "Intro"/"Credits" (AoT's 2:02 cold open is "Intro"; Aoashi E01 labels its closing
song "OP" at 22:36, which stays untagged).
- `importState` id = SHA-1 of file name + size (survives moves and another PC; mtime is stored but
  not part of the key). A second file for an episode that is already imported is reported as
  `duplicate` (`--replace` overwrites).
- `seriesId` = slug of the title parsed from the file name. AniList season 1 needs an **exact**
  title match (case/spaces/punctuation ignored, English/romaji/native/synonyms); seasons ≥ 2 follow
  `SEQUEL` relations (TV/ONA). No confident match → series written without AniList data and
  reported; `overrides/{seriesId} { anilistId, title?, seasons.sNN.anilistId }` fixes it.
- Fonts on Drive are named `<name>.<md5-8>.<ext>` so two different fonts with one file name
  never overwrite each other; same content is uploaded once per series.
- Drive layout: `AniStream/series/<seriesId>/s01/e01.mp4|e01.en.ass|e01.en.signs.ass|e01.thumb.webp`,
  `AniStream/series/<seriesId>/fonts/*`.
- Upload sessions are saved in the work folder; Drive's daily limit (403 limit reasons, or repeated
  `userRateLimitExceeded`), a local 740 GB/24 h budget, or Ctrl+C stop the run and keep the
  work copy, so the next run resumes the upload at the last byte.
- `--out <dir>` writes to a local `drive/` + `firestore/` JSON mirror (used to test everything
  except the Google APIs; tested on synthetic files in the cloud session).

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

**Done (Nov 3)** — deployed to myanime-streaming; sign-in, catalogue and Drive playback checked on the PC. Setup steps in README "Step 3 setup".
- `firebase/functions` (`api`, europe-west1): `/api/auth/{exchange,refresh,logout,status}` (refresh
  token in an HttpOnly `__session` cookie) and `/api/firebase/token` (Drive token → Firebase custom
  token, uid = `g` + Drive permission id). Only these two handlers of the music app were ported.
  Header `X-Ani: 1`. 5 handler tests (`npm run functions:test`).
- `firebase.json` (Hosting `dist/ani-stream/browser`, `/api/**` → function, SPA rewrite, cache
  headers), `.firebaserc` (myanime-streaming), `firestore.rules` (catalogue readable only by uids in
  `config/access`; `config/access` readable only by listed uids; `users/{uid}/**` owner + allowlisted),
  `firestore.indexes.json` (empty).
- `identity`: domain (session status, token rules, allowlist), application (`SessionStore` with
  signals, ports, `requireAccess` guard on the shell route), infrastructure (GIS popup, helper
  client, Drive `about` profile, localStorage, custom-token Firebase sign-in, `config/access` check),
  ui (functional sign-in page: sign in, expired, no-access with the uid to allow, errors).
  Scope **drive.readonly**. Without the helper (plain `ng serve` without the proxy) it falls back
  to the hourly token model, as in the music app.
- `shared/infrastructure`: `APP_ENV` (filled in `src/app/app.env.ts`), Firebase providers
  (Auth with IndexedDB persistence, Firestore with persistent multi-tab cache), `AccessTokenSource`,
  `DriveClient`.
- `playback`: `public/sw.js` (Drive range proxy at `/__drive/<fileId>?size=&type=` + app-shell
  cache), `scripts/build-sw.mjs` fills its BUILD/PRECACHE/ASSETS after `ng build`, `DriveStreamBridge`
  (registers the worker at boot, answers token requests with a renewed token), `PlaybackStore`,
  a plain `<video>` watch page with a seek timer. Real player is Step 5.
- `catalog`: Firestore repository + Timestamp mappers, `CatalogStore`, functional Home (series grid)
  and Anime detail (episodes per season). Designed screens are Step 4.
- `tools/import`: `npm run allow -w @ani/import -- <uid>` edits `config/access`.
- `npm start` proxies `/api` to the deployed Hosting site (`proxy.conf.json`), so localhost uses
  the real sign-in function.
- Initial bundle budget raised to 1 MB warning / 1.5 MB error: the Firebase SDK is in the main
  bundle (~906 kB raw, ~236 kB transferred).
- Tested in the cloud: 38 app tests, lint (boundaries) clean, prod build; the worker was run in
  Chromium against a fake Drive (metadata 112 ms, seeks 9–84 ms, 416 past the end, 401 → page told)
  and the shell cache was checked offline.

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

### Result (Nov 3, 2026 — written, not yet checked on the PC)

- **shared/ui**: `design-system.css` (all v3 tokens + utility classes: buttons, pill, chip, genre,
  skeleton, error card), `Icon` (v3 rounded paths), `Pill`, `Segmented` and `Toggle` (Signal Forms
  controls), `Dropdown` (fixed menu, flips, closes on scroll/Esc), `ContextMenu` service + host,
  `Poster` (AniList cover via `NgOptimizedImage`, gradient placeholder), `PosterCard`, `Avatar`,
  `Logo`, `GoogleG`, `Motion` + `[appStagger]` (page enter, stagger, back direction, poster →
  player grow, leave player, auth → app), `Viewport` signals (760px, landscape phone, touch).
- **shell**: lazy-loaded; inset sidebar (236/72px, railed state in localStorage), inset panel with
  Waves background, header search (`/`, recent searches, 5 suggestions, live query on /search),
  mobile bottom nav + profile popover. Route `data.depth` drives motion direction (App root).
- **Screens**: Sign in, Welcome (Subtitles + Autoplay replace Audio/Quality), Home, Search
  (Status + Genre pills), Anime detail (seasons, watched strip, episode tiles with Drive thumbs
  through the worker and durations), Watch (full-screen, outside the shell: custom chrome, touch
  layout, landscape compact, episodes popup with season tabs, **CC menu**, **Skip opening/ending**
  from chapters + optional auto-skip, keys space/k j l ←→ f n c s, autoplay next, error cards),
  Library (tabs, sort, grid/list), New releases (AniList week grid, now line, scope, premieres,
  notify), Settings (Signal Forms prefs, export JSON, clear history, delete account data).
  Loading skeletons, empty home and the player error are designed in the same language.
- **Data pulled forward from Steps 5/6** (the screens need it): `library` context
  (`LibraryStore`, `ProgressTracker` with the 10 s / pause / seek / leave rule, Firestore
  repository for progress, library, favourites, recent searches), `identity` `PrefsStore` +
  `users/{uid}` profile (first sign-in → Welcome via `requireProfile`), `releases` context (AniList
  GraphQL schedule + premieres, `users/{uid}/notify`). Still Step 5: JASSUB subtitle rendering (the
  CC choice is stored and passed on), AniSkip fallback. Still Step 6: rules tests in the emulator.
- Lint change: `ui` may import **any** context's `application` public API (Home shows catalogue +
  library, the player reads progress); `ui` → other contexts' `ui` is still blocked.
- Contracts: `UserPrefs` gains `resume` and `watchedThreshold`.
- Budgets: component styles warn at 8 kB (watch page CSS is ~7 kB). Initial bundle 990 kB.
- `withViewTransitions()` removed: page motion is Web Animations (the spec's exact timings).

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
