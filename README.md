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
      domain/          pure TS: entities, value objects, rules, ports
      application/     use cases / signal stores — the context's public API (index.ts)
      infrastructure/  Firestore / Drive / AniList adapters implementing the ports
      ui/              pages, components, <context>.routes.ts
  shared/
    ui/              design system
    kernel/          cross-context types and pure utils (ids, Result, formatDuration)
    infrastructure/  Firebase providers, Drive HTTP client
  shell/           app shell (nav, background, header search)
  app.ts, app.config.ts, app.routes.ts
packages/contracts/  Firestore document types + id helpers
tools/import/        importer (Step 1+)
```

Path aliases: `@catalog/*`, `@playback/*`, `@library/*`, `@releases/*`, `@identity/*`,
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
npm install          # workspaces: root app + packages/contracts + tools/import
npm start            # ng serve on http://localhost:4200 (/api proxied to the deployed site)
npm run build        # production build → dist/ani-stream/browser (+ fills sw.js)
npm test             # Vitest (ng test, single run); npm run test:watch to watch
npm run lint         # ESLint + angular-eslint + layer boundaries
npm run functions:test   # sign-in helper tests (after npm --prefix firebase/functions install)
npm run deploy       # firebase deploy (Hosting builds first, Functions bundles first)
```

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

