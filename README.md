# Handoff: ani.stream — private anime streaming web app

## Overview

A private, single-user anime streaming web app. Content discovery and playback come from
**ani-cli**-style scraping of allanime; user data (account, favourites, recently searched, watch
progress) lives in **Firebase**. Target stack: **Angular 22** frontend + **Node** backend,
Firebase Hosting + Cloud Run.

Five views: auth, home (favourites), search, anime detail, watch.

## About the design files

`Anime Streaming.dc.html` (+ `support.js`, which is only its runtime) is a **design reference
created in HTML** — a clickable prototype showing intended look and behavior. It is not
production code to copy. Recreate it in Angular using that project's conventions
(standalone components, signals, AngularFire). Open the HTML directly in a browser to click
through it.

The prototype fakes its data with an in-file `CATALOG` constant. Ignore that; the real data
contract is in `data-sources.md` and the API section below.

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii and interaction states are final. Recreate
them precisely. The only intentionally unfinished part is artwork: posters and episode
thumbnails are flat color tiles, standing in for AniList cover images.

---

## Design tokens

### Color

| Token | Value | Use |
| --- | --- | --- |
| bg | `#0b0b0c` | page background |
| surface | `#151517` | cards, inputs, popovers, search bar |
| surface-alt | `#131315` | episode rows |
| surface-hover | `#191a1d` | row/input hover |
| code-bg | `#0e0e10` | monospace code block in the error state |
| border | `rgba(255,255,255,0.06–0.10)` | hairlines; 0.06 rows, 0.07 tiles, 0.08 header, 0.10 inputs |
| border-hover | `rgba(255,255,255,0.14–0.28)` | hover / focus borders |
| text | `#ececee` | primary text |
| text-2 | `#a5a5ad` | body copy, genre chips |
| text-3 | `#8b8b93` | labels, secondary |
| text-4 | `#7a7a82` / `#6c6c74` | card meta, muted |
| text-5 | `#61616a` / `#5c5c64` / `#54545c` | placeholders, CLI hints |
| accent | `oklch(0.84 0.14 155)` (mint) | primary buttons, active pills, progress fill |
| accent-hover | `oklch(0.9 0.13 155)` | |
| accent-border | `oklch(0.5 0.1 155)` | saved-state outline |
| on-accent | `#08110c` | text on mint |
| danger | `#ff7a7a` | error dot |
| danger-border | `rgba(255,140,140,0.22)` | error card border |
| logout-hover | bg `rgba(255,90,90,0.1)`, border `rgba(255,120,120,0.35)`, text `#ff9d9d` | |

Poster tile colors (placeholders for AniList covers): `#3d3a34`, `#3a3128`, `#2e3a3c`,
`#3c2f2f`, `#2b3339`, `#39343f`, `#2f3a35`, `#333540`, `#3e3440`, `#37372c`.
Tile overlay: `linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.35))`.

### Typography

- **Sora** (Google Fonts, weights 300/400/500/600/700) — all UI.
- **JetBrains Mono** (400/500) — CLI hints, episode numbers, counts, timecodes, the error log.

| Role | Size / weight |
| --- | --- |
| page title (Favourites) | `clamp(22px, 3vw, 30px)` / 600, `letter-spacing:-0.025em` |
| anime title | `clamp(26px, 4vw, 40px)` / 600, `-0.03em`, `line-height:1.1` |
| auth heading | 22px / 600, `-0.02em` |
| logo | 20px (22px on auth); "ani" 600, "stream" 300 |
| body / synopsis | 14.5px / 400, `line-height:1.65`, `max-width:64ch` |
| card title | 14px / 500, `line-height:1.35` |
| card meta | 12px, text-4 |
| buttons | 13.5–14px / 500–600 |
| chips, pills | 12–12.5px / 500 |
| field label | 12px, text-3 |
| mono hints | 10.5–12px |
| subtitle overlay | `clamp(16px, 2.2vw, 26px)` / 500, white, `text-shadow: 0 2px 6px rgba(0,0,0,.9), 0 0 2px rgba(0,0,0,.9)` |

### Radius / shadow / motion

- Radius: 6–8px small tiles, 9–10px buttons and inputs, 11–12px cards and rows, 14px hero
  poster and error card, `999px` pills and chips, 50% avatar.
- Shadows: popovers `0 24px 48px rgba(0,0,0,0.55)`; drawer/menus over video `0 20px 44px rgba(0,0,0,0.6)`.
- Animations: `fade` 0.2s ease-out on route change; `pop` 0.14–0.16s ease-out for popovers
  (opacity + `translateY(-8px) scale(.98)`); `slidein` 0.2s ease-out for the episode drawer
  (`translateX(100%)` → 0).
- Page gutters: `clamp(16px, 4vw, 40px)`; main content `max-width:1360px`, centered, top padding
  `clamp(24px, 4vw, 44px)`, bottom 80px.

### Responsive

No media queries — the layout is fluid by construction. Poster grids are
`repeat(auto-fill, minmax(152px, 1fr))` (Compact tweak: 118px) with `gap: clamp(14px, 2vw, 22px)`.
Episode grid is `repeat(auto-fill, minmax(180px, 1fr))`. The anime hero is a wrapping flex row
(poster `clamp(150px, 26vw, 216px)`, text column `min-width:260px`). Player controls wrap.
Keep this approach in Angular; verify at 390px width.

---

## Screens

### 1. Auth — `/auth`

Single centered column, `max-width:380px`, vertically centered in the viewport.

Centered logo (22px) → heading (`Sign in` / `Create your account`) → subline
"Private instance · Firebase Authentication" (13.5px, `#7a7a82`) → fields stacked with `gap:12px`
→ mint submit button (full width, 12px padding) → text button toggling mode.

Fields: **Display name** (register only, placeholder "Ivan"), **Email** (`type=email`,
"you@example.com"), **Password** (`type=password`, "••••••••"). Each is a label column with a
12px `#8b8b93` caption above an input: `padding:11px 13px`, surface bg, 1px `rgba(255,255,255,.1)`
border, radius 10px, 14px text, no outline.

Mode toggle copy: "No account yet? Create one" ⇄ "Already have an account? Sign in".

No topbar on this route. No password reset, no social providers.

### 2. Home — `/`

Topbar (see below), then:

- Heading row: "Favourites" + mono "`N` saved".
- Poster grid. Each card: 2:3 tile (radius 12, 1px `rgba(255,255,255,.07)`, gradient overlay),
  mono episode/season label bottom-left at 11px `rgba(255,255,255,.68)`, and — when the entry has
  unfinished progress — a 3px bar pinned to the tile bottom (`rgba(0,0,0,.45)` track, mint fill).
  Below the tile: title (14px/500) and meta (`2013 · sub`) at 12px.
  Whole card is a button; hover `opacity:.86`.
- "Recently searched": uppercase 14px/500 `#8b8b93` label, then pill buttons
  (`padding:8px 14px`, radius 999, surface bg) each prefixed with a mono `›`. Clicking runs
  that search.

### 3. Search — `/search`

The topbar search field **becomes the input** on this route (autofocused, brighter border, a
clear `×`). There is no second search bar in the page body.

- Filter row (wraps, `gap:22px 32px`, bottom hairline). Two groups, each a mono uppercase
  10.5px label over a row of pills: **Audio** = Sub / Dub; **Quality** = best / 1080 / 720 / 480 /
  360 / worst. Active pill: mint bg, `#08110c` text. Inactive: transparent bg,
  `rgba(255,255,255,.14)` border, `#a5a5ad` text.
- CLI hint line (mono 11.5px `#54545c`): `$ ani-cli "<query>" [--dub] -q <quality>`. Reflects the
  filters live. Can be hidden.
- "Results" + mono count of **entries** (not titles — see season note).
- Same poster grid as home.
- Empty state: centered "No titles matched." + mono "try a shorter query".
- **Error state** (replaces results): card `max-width:560px`, surface bg, danger border,
  radius 14. Red dot + "Source unavailable"; paragraph explaining this is an upstream problem,
  not a bad query; a mono code block on `#0e0e10` showing
  `exit 1 · allanime: no results returned` / `hint: ani-cli -U to update the scraper`;
  then **Retry** (mint) and **Back to favourites** (outline).

### 4. Anime detail — `/anime/:entryId`

- Back button (mono `←` + "Back").
- Hero, wrapping flex: poster tile left; right column with title, `year · status` line,
  genre chips (5px 11px, radius 999, `rgba(255,255,255,.1)` border), synopsis, then two buttons:
  mint **Play E1** / **Resume E7** (resumes the most recent unfinished episode of the *current
  season*), and an outline **+ Add to favourites** which becomes **Saved ✓** with mint text and
  `oklch(0.5 0.1 155)` border.
- **Season tabs as pills** (same pill styling as the filters), wrapping row.
- Under the tabs, a mono note: `N episodes · each season is a separate ani-cli entry`.
- Episode grid, `minmax(180px,1fr)`: each row is a card (surface-alt, 1px border, radius 11)
  with a 38px colored rounded square holding the mono zero-padded number, then "Episode N".
  If the episode has progress, a 3px mint bar sits under the label. Watched (≥98%) dims the
  number to `rgba(255,255,255,.45)`.

There are no episode titles, thumbnails or durations — ani-cli does not provide them.

### 5. Watch — `/watch/:entryId/:ep`

Full-viewport, black, **no topbar**. Layered:

1. Video fills the frame. (Prototype uses `radial-gradient(120% 90% at 50% 40%, <tileColor>, #000)`
   with a mono "VIDEO STREAM" label.)
2. Click anywhere on the video toggles play/pause.
3. Hardsub line sits `bottom:132px`, centered, `padding: 0 8vw`, `pointer-events:none`. This is
   **not** a subtitle track — subs are burned into the stream. In production this layer only
   exists if you add your own subtitles; otherwise drop it.
4. Top bar over a `rgba(0,0,0,.75)` → transparent gradient: 34px back button (mono `←`, radius 9,
   `rgba(255,255,255,.16)` border) + anime title (14.5px) and `Season 1 · Episode 7` (12px,
   `rgba(255,255,255,.55)`).
5. Bottom controls over a bottom-up black gradient, `padding: 52px clamp(16px,3vw,28px) 22px`:
   - Scrub bar: 4px track `rgba(255,255,255,.2)`, mint fill, 12px white knob; click to seek
     (16px tall hit area).
   - Control row (wraps, `gap:10px`): 40px white play/pause square (black glyph); 38px icon
     buttons for **−10s**, **+10s** (circular-arrow with "10"); mono timecode `6:52 / 23:40`;
     spacer; then **next episode**, **episode drawer**, **fullscreen** icon buttons.
     Icon buttons: `rgba(255,255,255,.06)` bg, `rgba(255,255,255,.16)` border, radius 9,
     hover `rgba(255,255,255,.16)`. All icons are inline SVG; fullscreen swaps between
     expand and contract paths.
   - **No CC button.** Removed deliberately: ani-cli has no subtitle tracks.
   - Episode drawer: right panel `min(360px, 86vw)`, `rgba(14,14,16,.97)`, left hairline,
     header with season name + `×`, scrollable list of compact episode rows (34px number tile);
     current episode row is `rgba(255,255,255,.1)`.

### Topbar (home, search, anime)

Sticky, `z-index:40`, `rgba(11,11,12,.82)` + `backdrop-filter: blur(14px)`, bottom hairline,
`padding: 14px clamp(16px,4vw,40px)`.

Left: wordmark **ani.stream** — "ani" `#ececee` 600, "." mint, "stream" 300 `#8b8b93`; navigates home.
Center: search field, `max-width:460px` (520px when active), magnifier SVG on the left,
mono `/` badge on the right as a keyboard hint (wire it up: pressing `/` focuses search).
Right: 36px circular avatar with initials, mint text on `linear-gradient(150deg,#2c3a33,#1a1c1b)`.

Avatar opens a 248px popover (`top:46px; right:0`, radius 14, `pop` animation): 40px avatar +
`displayName` (14px) and email (12px, truncated), a full-bleed divider, then a full-width
**Log out** button with the red hover treatment.

---

## Interactions & behavior

- Clicking the topbar search field navigates to `/search` and focuses the input.
- A search result navigates to `/anime/:entryId` with that season's tab preselected.
- Season pill switches the episode list and the resume button, without leaving the page.
- Episode click opens the watch route seeked to stored progress.
- Back from the player returns to the anime detail page, paused.
- Next episode advances `ep` and resets position.
- Fullscreen uses the Fullscreen API on the document element and swaps the icon.
- Log out returns to `/auth` in sign-in mode and clears the password field.

### States to implement

| State | Where | Treatment |
| --- | --- | --- |
| Loading | search, detail | skeleton tiles/rows at the same grid geometry (not in the prototype — add) |
| Empty results | search | "No titles matched." |
| Source error | search | the error card described above |
| Playback error | watch | not yet designed; reuse the error card centered over black |
| No favourites | home | not yet designed; ask before inventing one |

---

## State model

Prototype state, and what it maps to in production:

| Prototype | Production |
| --- | --- |
| `route`, `animeId`, `season`, `ep` | Angular router params |
| `query`, `audio`, `quality` | search route query params (shareable, back-button friendly) |
| `favs: string[]` | Firestore `users/{uid}/favourites` |
| `recent: string[]` | Firestore, capped at ~8, most recent first |
| `progress: {"animeId\|season\|ep": 0..1}` | Firestore `users/{uid}/progress/{entryId}_{ep}` |
| `t`, `playing`, `fs`, `drawerOpen` | player component signals only |
| `email`, `pass`, `name`, `authMode` | reactive form + AngularFire |

Progress rules: write every ~10s while playing plus on pause, seek, route leave and
`visibilitychange` — **not** every tick as the prototype does. An episode counts as watched at
`≥ 0.98`. "Resume" targets the most recent entry below that threshold **within the current
season**.

---

## Backend contract (Node)

Prefer porting allanime scraping into Node over shelling out to the ani-cli script — the script
is interactive (fzf/mpv) and awkward to drive as a subprocess. Behavior to match:

| Endpoint | Returns |
| --- | --- |
| `GET /api/search?q=&dub=` | `[{ entryId, title, episodes }]` — one row per season entry |
| `GET /api/episodes?entryId=&dub=` | `[episodeNumber]` |
| `GET /api/sources?entryId=&ep=&dub=&q=` | `{ url, headers }` for the chosen quality |
| `GET /api/proxy?url=` | streams m3u8 + segments with Referer/Origin re-added |

Guard every route with a firebase-admin ID-token check; the instance is single-user, so reject
any uid but yours. Surface upstream failures as a distinct status the UI maps to the
"Source unavailable" state rather than to an empty result.

Frontend playback: hls.js (native HLS is Safari-only).

## Metadata

ani-cli returns titles and episode counts only. Cover art, synopsis, genres, year and status must
come from **AniList** (or Jikan) and be cached in Firestore, keyed by ani-cli entry id, so the
fuzzy title match runs once. AniList `relations` (PREQUEL/SEQUEL) is also the cleanest way to
group separate season entries under one detail page for the tabs. Full notes in
`data-sources.md`.

## Firestore

```
users/{uid}                        { displayName, email, createdAt }
users/{uid}/favourites/{entryId}   { title, addedAt }
users/{uid}/recent/{id}            { term, at }
users/{uid}/progress/{entryId}_{ep} { position, duration, updatedAt }
meta/{entryId}                     { anilistId, title, cover, synopsis, genres, year, status, seasons[] }
```

Rules: `match /users/{uid}/{doc=**} { allow read, write: if request.auth.uid == uid; }`,
`meta` readable by any signed-in user, writable only by the backend. Disable sign-up in the
Firebase console once your account exists.

## Assets

None to copy. Fonts are Google Fonts (Sora, JetBrains Mono). All icons are inline SVG in the
prototype (magnifier, play, pause, skip ±10, next, list, fullscreen enter/exit) — replace with
your icon library if the Angular app has one. Poster and episode tiles are flat colors standing
in for AniList cover images.

## Files

- `Anime Streaming.dc.html` — the prototype. Open in a browser; it needs `support.js` beside it.
- `support.js` — prototype runtime only. Not part of the deliverable.
- `data-sources.md` — what ani-cli can and cannot provide, and why the metadata API is required.
