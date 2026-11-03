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
| Sign-in helper | Firebase Function (Step 3) | Keeps the Google refresh token, mints Firebase custom tokens |
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

- `ui` → own `application` and `ui`, `shared/ui`, `shared/kernel`.
- `application` → own `domain`, any context's `application`, `shared/kernel`.
- `infrastructure` → own `domain` / `application` / `infrastructure`, `shared/kernel`,
  `shared/infrastructure`, `@ani/contracts`.
- `domain` → own `domain`, `shared/kernel`. **No npm imports** (no Angular, Firebase, RxJS).
- `shared/kernel` and `packages/contracts` → no npm imports either.
- `shell` → `application` of any context, `shared/ui`, `shared/kernel`.
- `app.*` (composition root) → may wire any context's `ui` routes and `infrastructure` providers.

## Commands

```bash
npm install          # workspaces: root app + packages/contracts + tools/import
npm start            # ng serve on http://localhost:4200
npm run build        # production build → dist/ani-stream
npm test             # Vitest (ng test, single run); npm run test:watch to watch
npm run lint         # ESLint + angular-eslint + layer boundaries
```
