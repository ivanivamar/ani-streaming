# ani.stream

Private anime streaming app. Ivan's own episodes are encoded with ffmpeg, stored on Google
Drive and streamed with range requests; the catalogue and all app data live in Firestore.
The old allanime / ani-cli backend is gone (see git history before `revive-drive`).

Full plan, decisions and step list: [`PLAN.md`](PLAN.md). Data model: [`data-sources.md`](data-sources.md).

## Architecture

| Piece | Where | Notes |
| --- | --- | --- |
| Web app | `/` (Angular 22) | Standalone, zoneless, signals, lazy route per bounded context |
| Catalogue + user data | Firestore (`myanime-streaming`) | Written by the importer (catalogue) and the app (`users/{uid}`) |
| Episodes, subs, fonts, thumbs | Google Drive `AniStream/` | Ids stored in Firestore; streamed by a service worker |
| Importer | `tools/import` | Encode/copy → verify → resumable Drive upload → Firestore (Steps 1–2) |
| Shared types | `packages/contracts` | Firestore doc types and ids, used by the app and the importer |
| Sign-in helper | `firebase/functions` (`api`) | Keeps the Google refresh token, mints Firebase custom tokens |
| Android | `/android` (Step 8) | Capacitor + Media3 native player, offline downloads |

There is no app server.

## Layout

```
src/app/
  contexts/
    catalog/    series, seasons, episodes, search
    playback/   player, Drive streaming, subtitles, chapters/skip
    library/    library status, favourites, progress, history
    releases/   airing schedule, premieres, notifications
    identity/   Google sign-in, Drive token, profile, prefs, access allowlist
    importing/  Import page ↔ the import agent on the PC (Firestore importAgent/importScan/importJobs)
                (playback also holds the Android player + Downloads, Step 8)
      domain/          pure TS: entities, value objects, rules, ports
      application/     use cases / signal stores — the context's public API (index.ts)
      infrastructure/  Firestore / Drive / AniList adapters implementing the ports
      ui/              pages, components, <context>.routes.ts
  shared/
    ui/              design system
    kernel/          cross-context types and pure utils (ids, Result, formatDuration)
    infrastructure/  Firebase providers, Drive HTTP client, update checks, Android bridge (native.ts)
  shell/           app shell (nav, background, header search)
  app.ts, app.config.ts, app.routes.ts
packages/contracts/  Firestore document types + id helpers
tools/import/        importer (Step 1+)
tools/rules-tests/   firestore.rules tests against the emulator (Step 6)
android/             Capacitor 8 Android project (Step 8): native plugins in app/src/main/java/com/anistream
capacitor.config.ts  app id com.ivan.anistream, web build = dist/ani-stream/browser
```

Path aliases: `@catalog/*`, `@playback/*`, `@library/*`, `@releases/*`, `@identity/*`, `@importing/*`,
`@shared/*`, `@shell/*`, `@ani/contracts`.

### Layer rules (enforced by `npm run lint`)

`eslint-plugin-boundaries` fails the lint when a rule is broken:

- `ui` → any context's `application` (public API), own `ui`, `shared/ui`, `shared/kernel`.
- `application` → own `domain`, any context's `application`, `shared/kernel`.
- `infrastructure` → own `domain` / `application` / `infrastructure`, `shared/kernel`,
  `shared/infrastructure`, `@ani/contracts`.
- `domain` → own `domain`, `shared/kernel`, `@ani/contracts`. **No npm imports** (no Angular, Firebase, RxJS).
- `shared/kernel` and `packages/contracts` → no npm imports either.
- `shell` → `application` of any context, `shared/ui`, `shared/kernel`.
- `app.*` (composition root) → may wire any context's `ui` routes, `application` guards and
  `infrastructure` providers.

## Commands

```bash
npm install          # workspaces: root app + packages/contracts + tools/import + tools/rules-tests
npm start            # ng serve on http://localhost:4200 (/api proxied to the deployed site)
npm run build        # production build → dist/ani-stream/browser (+ fills sw.js)
npm test             # Vitest (ng test, single run); npm run test:watch to watch
npm run lint         # ESLint + angular-eslint + layer boundaries
npm run test:rules   # firestore.rules tests in the Firestore emulator (needs Java 21+)
npm run functions:test   # sign-in helper tests (after npm --prefix firebase/functions install)
npm run deploy       # build, then firebase deploy (everything; Functions bundles first)
npm run deploy:hosting   # build, then deploy Hosting only
npm run agent -w @ani/import   # import agent for the app's Import page (leave it running on the PC)
npm run android:sync # build, then copy it into the Android project (npx cap sync android)
npm run android:open # open android/ in Android Studio
npm run android:apk  # sync + signed release APK → android/app/build/outputs/apk/release/
```

## Firestore rules and indexes

`firestore.rules` is the only thing between the app and the database, so every change goes
through `npm run test:rules` (`tools/rules-tests`): it starts the Firestore emulator for the
offline project `demo-ani` (port 8085, nothing real is touched), runs the Vitest suite and stops
it. The first run downloads the emulator jar (~60 MB). Java 21+ is required
(`winget install EclipseAdoptium.Temurin.21.JDK`). With an emulator already running
(`firebase emulators:start --only firestore --project demo-ani`), `npm run test:attached -w
@ani/rules-tests` reuses it.

- Catalogue (`series/**`), `importAgent`, `importScan`, `importJobs`, `overrides`: read by uids in
  `config/access`; the app's writes there are limited to what the Import page needs.
- `users/{uid}/**`: only that uid, only when allowlisted. Every write is checked against the
  `packages/contracts` shapes (keys, types, enums, sizes); unknown sub-collections are denied.
  Change a contract → change the rule and its test.
- `importState` and anything not listed: importer / agent only (Admin SDK bypasses rules).

`firestore.indexes.json`: no composite indexes (the app sorts client-side; the importer only
uses single-field equality). Large nested fields that are never queried (episode tracks and
chapters, synopsis, import candidates/results) are excluded from indexing to save index writes.

Deploy both with `firebase deploy --only firestore` (CI does it on push to `main`).

## Deploying (Step 7)

Pushes to `main` deploy through [`.github/workflows/firebase.yml`](.github/workflows/firebase.yml);
pull requests to `main` run the same checks without deploying; *Actions → Firebase → Run
workflow* runs everything.

| Part | Runs when these change | Checks | Deploys |
| --- | --- | --- | --- |
| web | `src`, `public`, `packages`, `scripts`, Angular/TS/ESLint config, `package*.json` | lint, unit tests, production build | Hosting (the built `dist/`) |
| rules | `firestore.rules`, `firestore.indexes.json`, `tools/rules-tests`, `packages/contracts` | rules tests in the emulator | `firestore:rules,firestore:indexes` |
| functions | `firebase/functions` | typecheck, tests | the `api` function |

`firebase.json` and the workflow itself count for all three. Hosting goes last, after the rules
and the function, so a page never ships before the rule or `/api` route it needs. A failed check
stops its deploy and Hosting.

Hosting no longer builds in `predeploy` (CI deploys the build it tested), so a manual
`firebase deploy --only hosting` needs `npm run build` first; `npm run deploy` /
`npm run deploy:hosting` do both.

**One-time setup: the deploy service account**

1. Google Cloud console (project `myanime-streaming`) → *IAM & Admin → Service accounts →
   Create service account* `github-deploy`, with these roles:
   - Firebase Hosting Admin, Cloud Run Viewer, Cloud Functions Viewer, API Keys Viewer
   - Firebase Rules Admin, Cloud Datastore Index Admin
   - Cloud Functions Admin, Cloud Run Admin, Service Account User, Secret Manager Viewer,
     Artifact Registry Administrator, Service Usage Consumer
2. The account → *Keys → Add key → JSON*. GitHub repo → *Settings → Secrets and variables →
   Actions → New repository secret* `FIREBASE_SERVICE_ACCOUNT` = the whole JSON file. Delete the
   downloaded file afterwards.
3. Function secrets (`GOOGLE_CLIENT_ID/SECRET`) are already set from Step 3; a **new** secret still
   needs one deploy from the PC (the CLI grants the function access, the CI account can't).

**Updates in the app**: each build gets a new service-worker version (`scripts/build-sw.mjs`).
Open tabs check for it every 30 min and when the tab comes back to the front; once it's
installed a "New version · Reload" toast appears (not in the player). Reload switches to the new
build; × hides it until the next deploy (the new build then starts once every tab is closed).

**Installing**: `public/manifest.webmanifest` + `public/icons/*` make the site installable
(Chrome/Edge: install icon in the address bar; Android: *Add to Home screen*; iOS Safari: *Share →
Add to Home Screen*).

## Android app (Step 8)

The APK is the same Angular build inside Capacitor 8 (served from `https://localhost`, so the UI
works offline). Three native plugins do what a WebView can't
(`android/app/src/main/java/com/anistream/`, ported from the music app where they existed):

| Plugin | Does | Web side |
| --- | --- | --- |
| `AniNative` | Google sign-in through Play services (drive.readonly, renews silently), app version, open URL, immersive mode | identity `PlayServicesAuth` |
| `AniPlayer` | Media3 ExoPlayer on a PlayerView **under** the transparent WebView: Drive stream with the OAuth header (or the downloaded copy), MediaCodec decode check | playback `CapacitorNativePlayer` → `<app-native-video>` |
| `AniDownloads` | WorkManager downloads into the app's storage (Wi-Fi only by default, notification, resumes) | playback `CapacitorOfflineStore` → `DownloadsStore` |

`DriveWebViewClient` answers `/__drive/<id>` inside the APK (same URL scheme as the web
service worker) for thumbnails, `.ass` files and fonts: downloaded copy first, else Drive.

The watch page is the web one: same controls, CC menu, skip OP/ED, episodes popup, progress
tracking. Only its `<video>` is swapped for `NativeVideo`, which drives the native player and
offers the same API and events; JASSUB draws the subtitles on its own canvas from the native
playback time. The player is always full screen (system bars hidden).

**Downloads**: anime page → *Download season*, or long-press an episode → *Download*. Each
episode saves its MP4, subtitle files, thumbnail and the series' fonts. *Profile → Downloads*
lists them (progress, remove, pause, Wi-Fi only); *Settings → Downloads* has storage and
*Remove all*. Offline, the app opens from Firestore's cache and plays downloaded episodes.

**Updates**: [`.github/workflows/android.yml`](.github/workflows/android.yml) builds a signed APK on
every push to `main` that touches the app and publishes it as GitHub Release `android-<run>`
(`ani-stream.apk`). The app checks Releases on launch / every 6 h and shows "New app version ·
Install" (Settings → App too). The check uses GitHub's public API, so it only finds releases
while the repo is **public**; with a private repo, download the APK from the Release page.

**One-time setup**

1. Release key (keep it: every update must be signed with it), in `cmd` from the repo root:
   ```
   mkdir secrets
   keytool -genkeypair -v -keystore secrets\ani-release.jks -alias anistream -keyalg RSA -keysize 2048 -validity 10000
   ```
   Use one password for store and key. Then `secrets\android-signing.properties`:
   ```
   storeFile=ani-release.jks
   storePassword=<password>
   keyAlias=anistream
   keyPassword=<password>
   ```
2. Its SHA-1: `keytool -list -v -keystore secrets\ani-release.jks -alias anistream`.
   Google Cloud (`myanime-streaming`) → *APIs & Services → Credentials → Create credentials →
   OAuth client ID → Android*: name "ani.stream Android", package `com.ivan.anistream`, that SHA-1.
   (Same project as the Web client, so `/api/firebase/token` accepts its tokens.)
3. GitHub → *Settings → Secrets and variables → Actions*:
   `ANI_KEYSTORE_BASE64` = `certutil -encodehex -f secrets\ani-release.jks secrets\ani-release.b64 0x40000001`
   then the content of `ani-release.b64` (delete the file after); `ANI_KEYSTORE_PASSWORD` = the password.
4. Push to `main` (or *Actions → Android APK → Run workflow*), open the Release on the phone,
   install the APK (allow installs from the browser once).

**Building on the PC** (Android Studio with JDK 21 and SDK 36): `npm run android:sync` (web build
+ copy into `android/`), then `npm run android:open` → Run, or `cd android && gradlew assembleDebug`.
Debug builds are signed with the release key too (when `secrets/android-signing.properties`
exists), so Google sign-in works on them.

## How sign-in and streaming work

1. **Google** (Identity Services popup, scope `drive.readonly`). When the `api` function is reachable,
   the popup returns a code; `/api/auth/exchange` swaps it (it holds the client secret) and keeps
   the refresh token in an HttpOnly `__session` cookie. The app renews its 1-hour access token
   through `/api/auth/refresh` 5 minutes early, on wake-up and when back online, so you stay signed in.
2. **Firebase**: `/api/firebase/token` turns the Drive token into a Firebase custom token
   (uid `g<Drive permission id>`); Firebase Auth keeps that session itself.
3. **Allowlist**: the app reads `config/access`; rules only let listed uids read it and the catalogue.
4. **Streaming**: `public/sw.js` proxies `<video>` range requests to Drive with the page's token.
   It also caches the app shell (filled in by `scripts/build-sw.mjs`).
5. **Android**: steps 1 and 4 are native instead (Play services token, ExoPlayer); the token is
   handed to the native side on every renewal (`AniNative.setAuth`), which also renews it by itself
   for downloads while the app is closed. Steps 2–3 are the same (the function on Hosting).

## Step 3 setup (once)

All in the `myanime-streaming` project (Google Cloud console = same project as Firebase).

**Google Cloud console**

1. *APIs & Services → Library*: Google Drive API (already on for the importer) and
   **IAM Service Account Credentials API** enabled.
2. *Google Auth Platform → Audience*: **Publish app** (status "In production"). In "Testing" Google
   drops refresh tokens after 7 days. Unverified is fine: you'll click through
   "Google hasn't verified this app" once.
3. *Google Auth Platform → Data access → Add or remove scopes*: add
   `https://www.googleapis.com/auth/drive.readonly`.
4. *Google Auth Platform → Clients → Create client*: type **Web application**, name
   `ani.stream Web`. Authorized JavaScript origins:
   `https://myanime-streaming.web.app`, `https://myanime-streaming.firebaseapp.com`,
   `http://localhost:4200`. No redirect URIs. Keep the client id and secret.
   (The Desktop client from Step 2 stays for the importer; the Android client comes in Step 8.)
5. (Done after the first deploy, see below.) The function signs Firebase tokens as its runtime
   account, the *Default compute service account* `259000610793-compute@developer.gserviceaccount.com`.
   That account only exists once the **Compute Engine API** is enabled, which the first functions
   deploy does (or enable it by hand in *APIs & Services → Library*).

**Firebase console**

6. *Authentication → Get started* (no sign-in provider needs enabling; the app uses custom tokens).
7. *Project settings → General → Your apps → Add app → Web* (`ani.stream`). Copy `apiKey` and
   `appId` into [`src/app/app.env.ts`](src/app/app.env.ts), and the Web client id from step 4
   into `googleClientId`.

**From the repo (cmd.exe)**

```bat
npm install -g firebase-tools
firebase login
npm --prefix firebase/functions install
firebase functions:secrets:set GOOGLE_CLIENT_ID
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
firebase deploy --only functions,firestore,hosting
```

The first functions deploy may ask to enable Cloud Build / Artifact Registry / Secret Manager:
answer yes. A new secret needs one deploy from the PC (the CLI grants the function access to it).

Then, in *IAM & Admin → IAM*, click **Grant access**: principal
`259000610793-compute@developer.gserviceaccount.com`, role **Service Account Token Creator**.
(Without it, sign-in stops at "Could not sign a Firebase token".) If the account still isn't
there, check *IAM & Admin → Service accounts* and that the Compute Engine API is enabled.

**First sign-in**

8. Open https://myanime-streaming.web.app and sign in. The screen says the account isn't on the
   access list and shows its uid (`g…`).
9. `npm run allow -w @ani/import -- g<that uid>`, then **Try again** → Home lists the catalogue.
10. Open an episode: it should start within a second, and seeking shows "last seek … ms".
    `npm start` (localhost:4200) works the same way through the proxy.

