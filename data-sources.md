# Data sources

## ani-cli (pystardust/ani-cli, scrapes allanime)

Everything the app can get from ani-cli:

| Data | Available | Notes |
| --- | --- | --- |
| Search by query | yes | returns entry titles + ids |
| Episode count per entry | yes | numbers only |
| Sub / dub | yes | `--dub` flag; without it always subbed. Dub language is not selectable. |
| Quality | yes | `-q best\|worst\|360\|480\|720\|1080` |
| Specific episode / range | yes | `-e`, `-r` |
| Continue from history | yes | `-c`; history file on disk |
| Download | yes | `-d`, dir via `ANI_CLI_DOWNLOAD_DIR` |

Not available — do not design around these:

- **Provider selection.** Removed from ani-cli (`-r` was reused for episode ranges). It scrapes allanime only.
- **Subtitle tracks.** Subs are burned into the video (hardsub). No language list, no CC on/off, no size/offset control.
- **Metadata**: cover art, synopsis, genres, year, status, episode titles, thumbnails, durations.
- **Seasons as a grouping.** allanime lists each season as its own search entry ("Attack on Titan", "Attack on Titan Season 2"). The season tabs in the design are a client-side grouping over sibling entries.

## AniList / Jikan — required for metadata

The design shows cover art, synopsis, genres, year and status. None of that comes from ani-cli, so a metadata API is needed:

- **AniList GraphQL** (`https://graphql.anilist.co`) — no key, generous rate limit, `Media(search:, type: ANIME)` gives `coverImage`, `bannerImage`, `description`, `genres`, `seasonYear`, `status`, `relations` (useful for grouping seasons into the tabs).
- **Jikan** (`https://api.jikan.moe/v4`, MyAnimeList) — no key, rate-limited; `/anime?q=` gives equivalent fields plus `/anime/{id}/episodes` for episode titles.

Suggested flow: ani-cli entry title → fuzzy match against AniList → cache the metadata document in Firestore keyed by the ani-cli entry id, so matching runs once per title.

Season tabs: use AniList `relations` (PREQUEL / SEQUEL edges) to link ani-cli entries of the same franchise, or fall back to string matching on the base title.

## Firestore (project `my-streaming-969f8`)

Owned entirely by the app, not ani-cli: user profile, favourites, recently searched, watch progress per episode.

Progress is keyed `animeId|season|episode → 0..1` (mirrored in the prototype's `state.progress`).
Suggested doc: `users/{uid}/progress/{entryId_episode}` with `{ position, duration, updatedAt }`.
An episode counts as watched at ≥ 0.98; the anime page's primary button resumes the most recent
unfinished episode.

## Auth (Firebase Authentication)

Private single-user instance: email + password only, plus `displayName` set via
`updateProfile()` right after `createUserWithEmailAndPassword`. No providers, no reset flow in
the design. Lock Firestore rules to the single uid, and consider disabling sign-up in the Firebase
console once the account exists.

## Error state

The search screen has a dedicated "Source unavailable" state, distinct from "no results" —
ani-cli failing to reach allanime is an upstream problem, not a bad query. Toggle it in the
prototype via the `sourceState` tweak.
