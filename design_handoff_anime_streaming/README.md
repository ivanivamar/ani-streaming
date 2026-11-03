# Handoff: ani.stream v3 — private anime streaming web app

## Overview

A private, dark-mode anime streaming web app. Discovery, playback and downloads come from
**ani-cli**-style scraping of allanime. User data (account, library, favourites, watch progress,
history, preferences, notifications) lives in **Firebase** (Auth + Firestore). Metadata ani-cli
can't provide (covers, synopsis, genres, airing schedule) comes from **AniList**.

Target stack: **Angular** (standalone components, signals, AngularFire) + **Node** backend,
Firebase Hosting + Cloud Run. Repo: `ivanivamar/my-streaming` (currently empty).

Views: Sign in → Welcome, Home, Search, Anime detail, Watch (player), Library, New releases,
Import, Downloads, Settings.

## About the design files

`Anime Streaming v3.dc.html` is a **design reference created in HTML** — a clickable prototype
of the intended look and behavior, not production code. Recreate it in the Angular app using
that project's conventions. Open the file directly in a browser (it needs `support.js` beside it;
`support.js` is only the prototype runtime). Every view is reachable by clicking through:
sign in with Google → Start watching → sidebar.

The prototype fakes data with in-file constants (`CATALOG`, `EP_COUNTS`, `LIB`, `SCHEDULE`,
`PREMIERES`, `DL_JOBS`, …) at the top of the `<script data-dc-script>` block. Use them to
understand shapes, not as data. The real contract is in the Backend and Firestore sections below
and in `data-sources.md`.

Inline styles in the prototype are the source of truth for exact values — when this README and
the file disagree, the file wins.

## Fidelity

**High-fidelity.** Colors, type, spacing, radii, motion and states are final. The only
placeholders are artwork: posters and episode thumbnails are oklch gradients standing in for
AniList cover images, and the player shows a gradient instead of video.

---

## Design tokens

### Color

Accent is a mint green, `oklch(0.84 0.14 155)` ≈ **#5fe0a0**. **No translucency on surfaces**:
cards, popovers, panels and the sidebar are opaque. Alpha is only used for hairline borders,
overlays on artwork, and the player chrome over video.

| Token | Value | Use |
| --- | --- | --- |
| app-bg | `#0a0b0d` | desktop shell behind the inset panel, auth page |
| panel-bg | `#111216` | main inset content panel, body |
| surface | `#16171b` | cards, rows, settings groups, segmented tracks |
| surface-2 | `#1a1b1f` | inputs, popovers, dropdown triggers, search bar |
| surface-hover | `#1c1d22` / `#202126` | card/row hover, trigger hover |
| menu-bg | `#1c1d21` | dropdown + context menu |
| menu-selected | `#24252a` | selected option, disabled button bg |
| chip-dark | `#121316` | opaque pills on posters (episode label, ⋯ button) |
| today-bg | `#141a17` | today column in releases |
| success-bg | `#14201a` / `#16211b` | import done banner, drag-over zone, selected welcome card |
| border | `rgba(255,255,255,0.06–0.10)` | hairlines (0.07 cards, 0.10 posters/menus) |
| border-strong | `rgba(255,255,255,0.12–0.16)` | outline buttons |
| border-hover | `rgba(255,255,255,0.28)` | hover on pills/outline buttons |
| text | `#ececee` | primary |
| text-2 | `#d8d8dc` / `#c9c9cf` | secondary buttons, subheads |
| text-3 | `#a5a5ad` | body copy, inactive pills |
| text-4 | `#8b8b93` | labels, inactive nav, descriptions |
| text-5 | `#7a7a82` | card meta |
| text-6 | `#61616a` / `#5c5c64` / `#54545c` | mono counts, CLI hints |
| accent | `oklch(0.84 0.14 155)` | primary buttons, active pills, progress, active nav icon |
| accent-hover | `oklch(0.9 0.13 155)` | |
| accent-text | `oklch(0.86 0.13 155)` | mint text on dark |
| accent-border | `oklch(0.5 0.1 155)` | saved / active-download outline |
| accent-tint | `oklch(0.84 0.14 155 / 0.14)` | selected chip fill |
| on-accent | `#08110c` | text on mint |
| info | `oklch(0.78 0.11 235)` | "Plan to watch", "Waiting in queue", UPCOMING tag |
| warn | `oklch(0.7 0.12 75)` | import "needs review" outline |
| danger | `#ff9d9d` text, `oklch(0.62 0.17 25)` armed button, `#ff7a7a` dot | |
| dropped | `oklch(0.72 0.14 25)` | Library "Dropped" |
| completed | `#b9b9c0` | Library "Completed" |

Library status dots: Watching = accent, Plan to watch = info, Completed = `#b9b9c0`,
Dropped = `oklch(0.72 0.14 25)`.

Avatar: `linear-gradient(150deg,#2f4a3c,#1b1e1c)`, 1px `rgba(255,255,255,0.14)` border,
initials in `oklch(0.86 0.11 155)` 600. Google badge (white circle with G logo) on bottom-right
in welcome + settings.

Poster placeholder: `linear-gradient(160deg, oklch(0.56 0.11 H), oklch(0.32 0.07 H+25) 60%, oklch(0.2 0.04 H+40))`
with a per-title hue. Overlay on poster cards:
`radial-gradient(120% 70% at 20% 0%, rgba(255,255,255,.16), transparent 55%), linear-gradient(180deg, transparent 55%, rgba(0,0,0,.55))`.

### Typography

- **Sora** (300/400/500/600/700) — all UI.
- **JetBrains Mono** (400/500) — counts, episode numbers, timecodes, CLI lines, kbd hints, section eyebrows.

| Role | Spec |
| --- | --- |
| Page title (h1) | `clamp(22px,3vw,30px)` / 600 / `-0.025em` |
| Section title (h2) | `clamp(18px,2.2vw,22px)` / 600 / `-0.02em` |
| Anime title | `clamp(26px,4vw,40px)` / 600 / `-0.03em` / lh 1.1 |
| Auth heading | `clamp(24px,2.6vw,30px)` / 600 |
| Logo | 20px; "ani" 600 `#ececee`, "." accent, "stream" 300 `#8b8b93` |
| Body / synopsis | 14–14.5px, lh 1.6–1.65, max 62–68ch |
| Card title | 15px / 600 / `-0.01em` / lh 1.35 |
| Card meta | 12px `#7a7a82` |
| Nav item | 14px / 500 |
| Buttons | 13–15px / 500–600 |
| Pills | 12.5–13.5px / 500 |
| Mono eyebrow | 10.5–11px, `letter-spacing:.08em`, uppercase |
| Episode tile number | 34px / 700 / `-0.05em` |

### Radius

8–10px small buttons and inputs · 11–12px menus, primary buttons · 14px rows, popovers ·
16px poster tiles and cards · 18px settings groups and the inset panel · 20px upload zone and
download composer · 22px hero card and player episode popup · 999px pills, chips, search bar ·
50% avatars and round icon buttons.

### Shadow

Popover `0 24px 48px rgba(0,0,0,.55)` · menu `0 20px 44px rgba(0,0,0,.6)` · poster
`0 14px 34px -10px rgba(0,0,0,.6)` · hero `0 24px 50px -16px rgba(0,0,0,.65)` · player popup
`0 30px 80px -10px rgba(0,0,0,.75)` · search focus ring `0 0 0 4px oklch(0.84 0.14 155 / .12)`.

### Spacing

Page gutters `clamp(16px,3vw,40px)`; header top `clamp(18px,2.6vw,30px)`; main top
`clamp(24px,3vw,36px)`, bottom 64px desktop / 112px mobile (clears bottom nav). Section gap on
home `clamp(40px,5vw,60px)`. Poster grid `repeat(auto-fill, minmax(196px,1fr))` (Compact density:
150px), gap `clamp(16px,2.2vw,28px)`.

---

## App shell

**Desktop (≥760px): collapsible inset sidebar.**
- Shell bg `#0a0b0d`, `height:100vh`. Sidebar is transparent, sticky, 236px (railed: 72px),
  `transition: width .2s ease`, padding `20px 12px 14px`.
- Sidebar head: logo + collapse button (32px, panel icon). Railed: logo hidden, button centered.
- Nav: Home, Library, New releases, Import, Download. Items 42px tall, radius 10, gap 12.
  Active: bg `rgba(255,255,255,.07)`, text `#ececee`, icon accent. Inactive: `#8b8b93`, icon
  `#7a7a82`. Railed: icon only, `title` tooltip.
- Bottom: account button (`#16171b`, radius 12, 34px avatar + name + email + up/down chevron)
  opens the profile popover (248px, `left:14px; bottom:78px`): avatar, name, email, divider,
  **Settings**, **Log out** (red hover `rgba(255,90,90,.1)` / `#ff9d9d`).
- Content is an **inset panel**: `margin:10px 10px 10px 0`, radius 18, 1px
  `rgba(255,255,255,.07)` border, bg `#111216`, own scroll container. Background layer sits inside it.

**Mobile (<760px): bottom nav.** No sidebar, no inset panel; page scrolls normally. Logo appears
left of the search bar. Fixed bottom nav, **4 equal columns: Home, Library, Releases, Profile**
(avatar), `#0e0f12`, top hairline, 54px min targets, 10.5px labels, safe-area padding.
- **Downloads** moves into the profile popover on mobile (first item, with mono "N active" count),
  above Settings and Log out.
- **Import is desktop-only.** It is not reachable on phones; a direct `/import` visit on mobile
  redirects to Home.
- Profile popover anchors `right:10px; bottom: calc(76px + env(safe-area-inset-bottom))`.

**Landscape phone (height <500px and width > height).** Only the Watch screen is designed for it
(full-screen playback). See screen 6 for the compact values.

**Header (all chrome pages):** pill search bar, max 620px, 48px, radius 999, `#1a1b1f`.
Focus: bg `#1f2025`, border `oklch(0.84 0.14 155 / .55)`, focus ring, icon goes mint. Right side
shows a `/` kbd badge when empty, a round clear `×` when filled. Pressing `/` anywhere focuses it.
- Focus + empty → dropdown "Recent searches" (clock icon, term, per-row × remove).
- Typing → up to 5 suggestions (32×46 poster, title, `N episodes · year`), divider, then
  "See all results for "q"" with an `Enter` kbd. Enter → Search page, term pushed to recent (max 6).
- Esc blurs. Click-outside closes.

**Background ("Waves", default).** Fixed, `pointer-events:none`, behind content. Two radial
glows (green top-right `oklch(0.42 0.09 160 / .2)`, violet bottom-left `oklch(0.38 0.07 265 / .17)`)
plus two SVG bands of flowing sine lines: band A 16 lines, green `oklch(0.84 0.14 155 / .26)`,
drifting left over 140s; band B 14 lines, violet `oklch(0.78 0.11 265 / .22)`, drifting the
opposite way over 180s. 1.2px non-scaling strokes, center lines most opaque. SVG is 200% wide and
translates −50% for a seamless loop. See `bg('Waves')` in the file for the exact path math.
Alternates kept as tweaks: Poster drift, Dot grid, Halftone.

---

## Screens

### 1. Sign in — `/auth`
Two-column wrapping flex on `#0a0b0d`. Left (flex 1 1 480px, sticky full height; 300px tall on
mobile): **poster drift mosaic** — 5 columns (4 mobile) of poster tiles, rotated −6°, scaled
1.12, alternating columns scrolling up/down (70s + 9s per column), with a dark gradient overlay
and the large logo + "Stream, track and download anime from one library. Powered by ani-cli."
bottom-left.

Right: 360px column. "Sign in", one line of copy, then a single white **Continue with Google**
button (52px, radius 12, `#1f1f1f` text, G logo). While waiting: spinner + "Waiting for Google…"
and a Cancel link. Cancel/popup closed → red notice "The Google window was closed before sign-in
finished." Footer notes about shared data and approved accounts. **Google is the only provider.**

### 2. Welcome (first sign-in)
Same layout. Account chip (52px avatar + Google badge, name, email), "Welcome, Ivan", then
defaults: **Audio** as two cards (Sub — "Japanese audio, subtitles" / Dub — "English audio";
selected = accent border, `#16211b`), **Quality** segmented (Best/1080p/720p/480p). **Start
watching** (mint, 50px) → Home. "Not you? Use another account" restarts Google flow. Shell enters
with `opacity 0, scale .985 → 1`, 520ms.

### 3. Home — `/`
- **Continue watching**: title + mono "N in progress" + round prev/next carousel buttons. Row:
  hero card (side-by-side `min(540px,48%)`, stacked on mobile) with large poster backdrop,
  inner 132px poster, eyebrow "LAST WATCHED · 2h ago", title, "Season · Episode · N min left",
  4px progress bar, mint Resume. Beside it a snap-scrolling carousel of 164px poster cards with
  episode pill, ⋯ button and 3px progress bar.
- **Recently added** (grid): NEW mint pill + `S1 · E24` pill, "Added 3h ago".
- **Recently watched** (grid): progress bar if unfinished, "Finished · ago" otherwise.
- Every card: hover `translateY(-4px)`; right-click or ⋯ opens the context menu (Resume/Watch
  again, Start over, Go to anime, Mark as watched, Remove from history).

### 4. Search — `/search`
Uses the header search bar as input. Filter groups **Audio** (Sub/Dub) and **Quality**
(best/1080/720/480/360/worst) as pills. Mono CLI line `$ ani-cli "q" [--dub] -q quality`
(toggleable). "Results" + entry count. Poster grid with episode-count pill and a heart toggle
(filled mint when favourited). Empty: "No titles matched." / "try a shorter query". **Source
error** card (red dot, "Source unavailable", explanation, mono log, Retry + Back) replaces
results when the backend reports an upstream failure.

### 5. Anime detail — `/anime/:entryId`
Back button (36px pill, `#16171b`, 1px `rgba(255,255,255,.1)` border, rounded chevron +
"Back", 13px/500 `#c9c9cf`, hover `#202126`), hero (216px poster, title, year • status, genre chips, synopsis, mint **Play E1 /
Resume E7**, outline **+ Add to favourites ⇄ Saved ✓**). Season pills. Mono row:
"N episodes · each season is a separate ani-cli entry" + "X / N watched". A 6px segmented
progress strip (one clickable segment per episode: watched accent, partial `oklch(0.6 0.1 155)`,
unwatched `rgba(255,255,255,.1)`).

**Episode grid** `repeat(auto-fill,minmax(158px,1fr))`, gap 14: 16:10 tiles with per-episode
gradient thumb, faint dot texture, "EP" + big number bottom-left. States: **up next** = accent
border + glow ring + "▶ UP NEXT" or "▶ 42%" badge; **watched** = dimmed overlay + "✓" badge;
partial = 3px progress bar. ani-cli provides no episode titles or durations.

### 6. Watch — `/watch/:entryId/:ep`
Full viewport, black, no chrome. Click video to play/pause. Top gradient bar: **40px round back
button** (`rgba(0,0,0,.45)`, 1px `rgba(255,255,255,.12)` ring, rounded chevron icon `M15 5l-7 7 7 7`,
stroke 2), title, "Season · Episode". Hardsub sample line at `bottom:112px` (84px landscape; subs
are burned in, drop this layer in production). Bottom gradient controls, padding
`52px clamp(16px,3vw,28px) 22px`:
- Scrub bar: 4px track, mint fill, 12px white knob, 16px hit area, click to seek.
- **Desktop footer row**, left → right: **play/pause** 44px mint circle (`#06140c` glyph, glow
  `0 6px 20px accent/.3`), **rewind 10**, **forward 10** (40px transparent round, circular arrow
  with "10" inside — counter-clockwise back, clockwise forward), mono timecode `6:52 / 23:40`
  (12px, `rgba(255,255,255,.78)`), spacer, **next episode**, **episodes**, **fullscreen**
  (always far right). Right-side buttons 40px round, transparent, hover `rgba(255,255,255,.14)`,
  active `scale(.92)`. Episodes button bg `rgba(255,255,255,.2)` while the popup is open.
- **Touch layout (phone portrait and landscape)**: rewind / play / forward move to the **centre of
  the video** (absolute, centred, gap `clamp(22px,6vw,48px)`). Skip buttons 52px,
  `rgba(0,0,0,.45)` + 1px `rgba(255,255,255,.12)` ring; play 68px (60px landscape) mint circle with
  `0 8px 28px accent/.35` glow. The footer keeps only timecode left and next / episodes /
  fullscreen right.
- Play/pause glyphs are SVG: pause = two rounded rects (rx 1.6), play = rounded triangle.
- **Landscape compact values**: top bar padding `14px 56px`, controls padding `36px 56px 14px`
  (56px side inset clears the camera cutout); status bar hidden.
- **Episodes popup** (not a side drawer): anchored bottom-right above controls
  (`right:clamp(12px,3vw,28px); bottom:86px`), `min(380px, 100%-24px)` wide, max
  `min(540px, 100%-180px)` tall, radius 22, opaque `#17181c`, `transform-origin: bottom right`,
  pop animation .22s. In landscape it becomes a full-height sheet: `top:12px; bottom:12px;
  right:56px`, no max height.
  - Header: "Episodes" + mono subline ("E07 of 25 · 6 watched" for the playing season,
    "N episodes · X watched" for others), round close.
  - **Season tabs** (only when the entry has >1 season): horizontally scrolling pill row
    (`flex:none`, 32px pills, 12.5px/500, gap 6, padding `2px 14px 12px 18px`, hairline below).
    Active tab uses pill colors; the season currently playing carries a 6px dot. Switching tabs
    only changes what the list shows (`dSeason`); playback is unchanged until an episode is
    picked. Picking an episode from another season sets `season` + `ep` and closes the popup.
    Reopening the popup resets the tab to the playing season.
  - Rows: 76px 16:10 thumb with number and progress, "Episode N", status ("Now playing" mint /
    Watched / 42% watched / Not started). Current row `#1d2420` with mint border and a 3-bar
    equalizer glyph. Click outside closes.
- No CC button (no subtitle tracks from ani-cli).

### 7. Library — `/library`
"Library" + count. Status pills with counts (All, Watching, Plan to watch, Completed, Dropped)
in a **single non-wrapping row that scrolls horizontally** (scrollbar hidden). The sort + view
controls sit right-aligned (`margin-left:auto`) and wrap onto their own row on narrow screens. Sort
dropdown (Recently watched / Title A–Z / Progress), grid/list toggle. Grid card: status pill
with dot top-left, ⋯, `watched / total` pill, progress bar in status color. List row:
44px poster, title, year · episodes, status, progress bar + count, "Watched ago", ⋯ (mobile
collapses to poster/title/⋯). Context menu: Continue/Play/Watch again, Go to anime, Move to
<status>, Remove. Empty: "Nothing in <filter> yet."

### 8. New releases — `/releases`
Header with summary ("14 episodes this week · 9 out so far") and a segmented scope switch
**Everything / My library**. Week section: title (This week / Last week / Next week / In N weeks),
date range, prev/next. **7-column grid** (min 156px, horizontally scrollable with snap) of day
columns; today highlighted (`#141a17`, mint border, "Today"). Each item: small poster, title (2-line
clamp), `E09 · 14:00`, status (countdown "in 3h 20m", "Out now", "Watched", "Out now · not on
allanime") and a bell toggle on upcoming items. A mint "now" line with current time is inserted
in today's column. Changing week slides the grid in from the direction of travel (36px, .32s).
**New seasons & premieres**: cards with UPCOMING (info) / OUT NOW (accent) tag, kind, date and
a "Notify me ⇄ On" button.

### 9. Import — `/import`
Intro copy, then a dashed drop zone (files or folder; drag-over turns mint). Accepted
MKV/MP4/WEBM/AVI. File names are parsed client-side (`[Group] Title - 05 (1080p).mkv`,
`Title.S02E05.mkv`, `Title Ep 5`) and grouped by series+season, then matched to allanime
entries via aliases. "Review files" with tabs All / Matched / Needs review / Not found and a
select-all row. Each group row: checkbox, source name + meta (files, size, quality, group) →
match (poster, entry title, tag "New to your library" / "Adds to your existing library entry"),
or a "Which season is this?" dropdown (amber border), or "Not found on allanime" + Search.
Episode chips show present (mint) vs missing (dashed) vs out of range (red), with a missing
summary. Expandable file list with per-file remove. Sticky footer bar: summary, size, counts,
**Upload N**. Uploading shows per-row progress; done shows a mint success banner + View library.
See `parseVid` / `groupVids` in the file for the parsing rules.

### 10. Downloads — `/download`
Header + disk usage bar (`~/Videos/ani-cli`, free space). Composer card: anime picker dropdown
(poster, title, "N episodes · X downloaded · Y queued"), Sub/Dub segmented, quality dropdown with
per-episode size estimate. Episode chip grid (42px min): selectable / selected (mint) /
in queue (dashed mint) / downloaded (`#24252a`, disabled), with Select all / Unwatched / Clear and
a legend. Footer shows the generated command (`$ ani-cli -d --dub -q 1080 -e "1-4 7" "Title"`)
and **Download N episodes**. **Queue**: one job per request, one episode at a time; job card has
status line ("Downloading E22 · 46% · 1m 12s left" / Paused / Waiting in queue), pause/resume,
cancel, per-episode chips filling as a gradient, total bar and size. **On this device**: done
entries with episode ranges, size, play offline, delete (red hover).

### 11. Settings — `/settings` (from profile popover)
Single scroll page, max 820px, sections stacked: **Account** (profile card with Google badge,
Switch account, Sign out; Display name; Sign out everywhere), **Playback** (Audio seg, Quality
dropdown, Autoplay next, Skip intros/outros via ani-skip, Resume, Mark watched at 80/90/95%),
**Downloads** (folder → `ANI_CLI_DOWNLOAD_DIR`, download quality, delete after watching),
**Data** (Export JSON, Clear watch history, Delete account). Rows in one `#16171b` radius-18 group
with hairline dividers. Toggle: 44×26 track, mint on, knob `#08110c`. Destructive buttons need
a second click ("Click again to confirm", red fill).

### Shared components
- **Pill**: active mint/`#08110c`; inactive transparent, `rgba(255,255,255,.14)` border, `#a5a5ad`.
- **Segmented**: track `#16171b`/`#111216` radius 10–11, 3px padding; active segment uses pill colors.
- **Dropdown**: trigger 38px radius 9 `#1a1b1f` with chevron (rotates 180° open, border goes mint);
  menu fixed-position `#1c1d21` radius 13, max 340px, optional title eyebrow, options with dot /
  poster / sub-line, check on selected. Flips above the trigger if no room. Closes on scroll.
- **Context menu**: 220px, title line, items with icons, separators, danger items red. Opens at
  cursor, clamped to viewport. Right-click on any poster/row.

---

## Motion

All via Web Animations; skip entirely under `prefers-reduced-motion`.
Easing `cubic-bezier(.2,.7,.2,1)` unless noted.

- **Page enter**: page `opacity 0, translateY(10px) → none`, 350ms. Children of each
  `[data-stag]` group stagger: 350ms, delay `80 + i·28ms` (cap 900ms). On Anime detail:
  260ms, delay `40 + i·10ms` (cap 360ms).
- **Back navigation** reverses direction (`-10px` / `-8px`, drops from above). Depth order:
  auth −1 · top-level pages 0 · search 1 · anime 2 · player 3.
- **Open player**: a clone of the clicked poster/tile grows from its rect to full viewport
  (720ms, `cubic-bezier(.65,0,.15,1)`, radius 14 → 0), fades to black from 45%, then the player
  fades in (260ms) and the clone fades out.
- **Leave player**: black overlay fades + scales to .94 over 380ms.
- **Auth → app**: 520ms scale .985 → 1 fade.
- **Popovers/menus**: `pop` — `opacity 0, translateY(-8px) scale(.98)` → none, 120–160ms ease-out.
- **Releases week change**: grid slides in 36px from travel direction, 320ms.
- Hover lifts: cards `translateY(-3/-4px)` 180ms; Google button `-1px`.
- Background drifts are continuous linear loops (see App shell).

---

## State & data

| Prototype state | Production |
| --- | --- |
| `route`, `animeId`, `season`, `ep` | router params |
| `query`, `audio`, `quality` | search query params; audio/quality defaults from prefs |
| `authStep`, `authBusy`, `authErr` | AngularFire `signInWithPopup(GoogleAuthProvider)` |
| `progress {"anime|season|ep": 0..1}`, `history` | `users/{uid}/progress` ordered by `updatedAt` |
| `lib [{id, s, status, watched, ago}]` | `users/{uid}/library/{entryId}` |
| `favs`, `recent` | `users/{uid}/favourites`, `users/{uid}/recent` (cap 6) |
| `prefs` | `users/{uid}` doc `prefs` field |
| `notify` | `users/{uid}/notify/{key}` |
| `impGroups` | client state; upload to Storage, then `users/{uid}/localEpisodes` |
| `dlJobs`, `dlDone` | backend job queue (server state), streamed via SSE/websocket |
| `railed` | localStorage |
| `t`, `playing`, `fs`, `drawerOpen` | player component signals |

Rules: watched = progress ≥ 0.98 (or the user's threshold pref). "Resume" targets the most recent
unfinished episode of the current season. Write progress every ~10s while playing and on pause,
seek, route leave and `visibilitychange` — not every tick as the prototype does. First sign-in
(no `users/{uid}` doc) routes to Welcome; later sign-ins go straight Home.

## Backend contract (Node)

Port allanime scraping to Node rather than shelling out to the interactive ani-cli script.

| Endpoint | Returns |
| --- | --- |
| `GET /api/search?q=&dub=` | `[{ entryId, title, episodes }]` — one row per season entry |
| `GET /api/episodes?entryId=&dub=` | `[episodeNumber]` |
| `GET /api/sources?entryId=&ep=&dub=&q=` | `{ url, headers }` |
| `GET /api/proxy?url=` | m3u8 + segments with Referer/Origin re-added |
| `POST /api/downloads` `{ entryId, eps[], dub, q }` | job id |
| `GET /api/downloads` (SSE) | job + per-episode progress |
| `PATCH/DELETE /api/downloads/:id` | pause/resume/cancel |
| `GET /api/files`, `DELETE /api/files/:entryId` | on-device downloads, disk usage |
| `GET /api/schedule?week=` | AniList airing schedule joined to allanime entries |

Guard all routes with a firebase-admin ID-token check and an allowlist of approved uids. Map
upstream failures to a distinct status so the UI shows "Source unavailable", not empty results.
Playback via hls.js. Skip intro/outro via ani-skip (AniSkip API) timestamps.

## Firestore

```
users/{uid}                          { displayName, email, photoURL, createdAt, prefs{audio,quality,autoplay,skip,resume,threshold,dlDir,autoDelete} }
users/{uid}/library/{entryId}        { status, watched, updatedAt }
users/{uid}/favourites/{entryId}     { addedAt }
users/{uid}/progress/{entryId}_{ep}  { position, duration, updatedAt }
users/{uid}/recent/{id}              { term, at }
users/{uid}/notify/{key}             { title, ep?, at }
users/{uid}/localEpisodes/{entryId}_{ep} { storagePath, size, fileName }
meta/{entryId}                       { anilistId, title, cover, synopsis, genres, year, status, seasons[] }
```

`users/{uid}/**` readable/writable only by that uid; `meta` readable by signed-in users,
written by the backend only.

## Prototype tweaks (not product features)

`background` (Waves / Poster drift / Dot grid / Halftone), `heroLayout` (Side by side / Stacked),
`sourceState` (Online / Source error — previews the error card), `showCliHints`, `density`
(Comfortable / Compact). Ship Waves, side-by-side, CLI hints on, Comfortable.

## States still to design

Loading skeletons (same grid geometry), playback error in the player, empty home for a new user.

## Assets

No image assets. Fonts: Google Fonts (Sora, JetBrains Mono). Icons are inline SVG paths in the
file (nav icons in `NAV`, menu icons in `IC`, player controls inline). **All icons are rounded**:
every stroked icon uses `stroke-linecap="round"` and `stroke-linejoin="round"` (1.7–2.2 stroke),
rectangular shapes have rounded corners, and filled glyphs (play, next, pause) use rounded
triangles/rects. Text glyphs (▶ ❚❚ ✓ ←) are not used. If swapping for an icon set, use a rounded
one (e.g. Lucide). Google "G" logo is the official
4-color mark. Posters/thumbnails are placeholders for AniList covers.

## Files

- `Anime Streaming v3.dc.html` — the prototype (all screens, desktop + mobile). Open in a browser.
  Accepts `?screen=signin|welcome|home|search|library|releases|anime|player|download|import|settings`
  to open a screen directly, and `&drawer=1` to open the episodes popup on the player.
- `Anime Streaming Phone.dc.html` — phone board: every screen live at 390×844, plus the
  landscape player (844×390, playing + episodes sheet). Embeds the v3 file, so keep both together.
- `support.js` — prototype runtime only; required to open the file, not part of the deliverable.
- `data-sources.md` — what ani-cli can and cannot provide and why AniList is needed.
