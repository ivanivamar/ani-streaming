# Data sources

Replaces the old allanime / AniList-at-runtime contract. The app has **no API server**: it reads
Firestore directly and streams files from Google Drive. Types live in
[`packages/contracts`](packages/contracts/src/firestore.ts).

## Firestore (`myanime-streaming`)

```
series/{seriesId}                         catalogue entry + AniList metadata, searchTokens[]
series/{seriesId}/seasons/{sNN}           season metadata
series/{seriesId}/episodes/{sNNeNN}       video/audio/subs/chapters + Drive file ids
importState/{sourceHash}                  importer re-run tracking
overrides/{seriesId}                      manual AniList match fixes
users/{uid}                               profile + prefs
users/{uid}/library/{seriesId}            status, watched
users/{uid}/favourites/{seriesId}
users/{uid}/progress/{seriesId}_{sNNeNN}  position, duration
users/{uid}/recent/{id}                   last 6 searches
users/{uid}/notify/{key}                  release notifications
config/access                             allowedUids[]
```

- Catalogue (`series`, `seasons`, `episodes`, `importState`, `overrides`) is written only by
  `tools/import` with the Admin SDK and readable only by uids in `config/access`.
- `users/{uid}/**` is readable and writable only by that uid.
- Ids: `seriesId` is a title slug (`attack-on-titan`), seasons `s01`, episodes `s01e01`
  (`toSeriesId`, `toSeasonId`, `toEpisodeId` in `@ani/contracts`).

## Google Drive (`AniStream/`)

Only binary or large files Firestore can't hold:

```
AniStream/series/<seriesId>/fonts/*.ttf|otf
AniStream/series/<seriesId>/s01/e01.mp4          HEVC 10-bit / AAC, faststart
AniStream/series/<seriesId>/s01/e01.en.ass       soft subtitles
AniStream/series/<seriesId>/s01/e01.thumb.webp
```

The app streams `e01.mp4` through its service worker with the signed-in user's Drive
read-only token (range requests, so seeking is instant).

## AniList

Fetched by the importer (metadata stored in `series` / `seasons`) and by the `releases`
context at runtime (airing schedule). Posters and banners use AniList CDN URLs directly.
