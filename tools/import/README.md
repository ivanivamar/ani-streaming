# tools/import

Importer for ani.stream (see `PLAN.md`). Plain TypeScript run directly by Node (type
stripping), so there is no build step. Needs **Node ≥ 22.18** and a **system ffmpeg with NVENC**.

```cmd
winget install Gyan.FFmpeg
```

`ffmpeg`/`ffprobe` are taken from PATH; set `FFMPEG_PATH` (and optionally `FFPROBE_PATH`) to
use another build.

```cmd
npm install
npm test -w @ani/import
npm run typecheck -w @ani/import
```

## Import agent — the app's Import page

```cmd
npm run agent -w @ani/import
npm run agent -w @ani/import -- --src D:\Anime
npm run agent -w @ani/import -- --encoder x265
```

Runs until **Ctrl+C** (a running episode finishes first; Ctrl+C twice quits at once, the upload
resumes next time). It needs the same `secrets/` as `import` and talks to the app only through
Firestore:

- `importAgent/main` — heartbeat every 20 s: PC name, folder, idle / scanning / importing, upload
  budget. The page shows "agent offline" when it's older than 75 s. The page's **Rescan** sets
  `scanRequestedAt`.
- `importScan/{id}` — one doc per video file in the folder (id = the `importState` id, file name +
  size): parsed name, status (new / imported / pending / failed / duplicate / unparseable), AniList
  match or candidates. No probing, so a scan is quick. Rescanned at start, on request, after each
  job and every 10 minutes; docs for files that are gone are deleted.
- `importJobs/{id}` — created by the page (`status: queued`, list of scan ids). The agent claims
  one at a time, runs each episode exactly like `npm run import` (same probe/decide/encode/
  verify/upload/Firestore code), and writes `current` (stage + %), `results` and the final status.
  **Stop after this one** on the page sets `cancelRequested`.
- Picking an AniList candidate on the page writes `overrides/{seriesId}.anilistId` and asks for a
  rescan.

Files must be in the agent's folder: the browser can't hand file contents to the PC, so dropping
files on the page only selects the scanned files with the same name and size.

The Firestore rules for these collections are in `firestore.rules` (deploy them once:
`firebase deploy --only firestore:rules`).

## Step 2 — `dry-run` / `import`

```cmd
npm run dry-run -w @ani/import
npm run import  -w @ani/import
npm run import  -w @ani/import -- "Attack on Titan" --limit 3
npm run import  -w @ani/import -- --out tmp\import-test
```

Paths are files or folders (searched recursively), relative to `C:\Users\ivani\Videos\Anime`;
no path = that whole folder. **One episode at a time:**

1. **Name** → series, season, episode (rules of `parseVid` in the v3 design):
   `[Group] Title - S01E05 (…) [CRC].mkv`, `Title.S02E01.1080p.WEB.mkv`, `[Group] Title - 05v2 (1080p).mkv`,
   `Title S2 - 05`, `Title Episode 5`. No episode number or title → **unparseable**, reported and
   skipped. No season → season 1 (noted in the report).
2. **Probe + decide**: display size (SAR, rotation), black bars (cropdetect at 20/40/60/80 %),
   interlacing (field order, else idet → `bwdif`), Japanese audio track. **Copy** the video when it
   is H.264 8-bit 4:2:0 or HEVC Main/Main 10 4:2:0, ≤ 1920×1080, square pixels, not interlaced,
   no black bars and ≤ 8 Mb/s; otherwise **encode** with the Step 1 NVENC settings
   (`encode+scale` when the frame is resized: above 1080p or non-square pixels).
   No track tagged Japanese → reported as unsupported (a single untagged track is assumed Japanese).
3. **Write + verify** `e01.mp4` in `tmp/import-work/<hash>/`: one video, one AAC track, size as
   planned, duration within 1 s of the source, `moov` before `mdat`.
4. **Extract**: subtitles (ASS copied, SRT/WebVTT → ASS; PGS/VobSub reported). Sidecars next to
   the episode win: `<episode>.ass`, `<episode>.en.ass`, `<episode>.en.signs.srt`. One track per
   language + kind (`full` / `signs` / `songs`, from the track title or `forced`). Fonts from the
   attachments, chapters (OP/ED by title, else the ~90 s untitled chapter near the start/end),
   thumbnail WebP at 25 %.
5. **Upload** to Drive `AniStream/series/<seriesId>/s01/` (+ `fonts/`), resumable. Files already
   there with the same MD5 are reused, so a re-run uploads nothing twice.
6. **Firestore**: `series`, `seasons`, `episodes`, `importState` (+ counts), AniList metadata.
   Then the work copy is removed. Originals are only read.

**Encode and upload overlap**: while one episode uploads, the next one is probed and encoded
(at most one upload plus one encoded episode waiting, so `tmp/import-work` holds two episodes at
most). Uploads use 256 MiB chunks. Each episode logs its upload speed and the summary shows the
average — that number is your connection's real upload rate to Drive; if it's well below what a
speed test shows, the single connection is the limit and parallel uploads would help (not built yet).

Re-runs skip sources whose `importState` is `done` (key: file name + size). Drive's 750 GB/day
limit, the local budget (`--daily-limit`, default 740G, tracked in
`tmp/import-upload-budget.json`) or **Ctrl+C** stop after/inside the current episode; the next run
resumes the interrupted upload from the last byte. A second Ctrl+C quits at once (still resumable).

The report is printed and saved as `tmp/import-logs/<command>-<time>.log` + `.json`. Check
**Needs attention** (unparseable, unsupported, duplicate, failed) and **Series** (AniList match).

| Option | Meaning |
| --- | --- |
| `--only <text>` | only series whose title contains the text |
| `--limit <n>` | first n episodes |
| `--out <dir>` | local `drive/` + `firestore/` JSON instead of Drive + Firestore (testing) |
| `--force` | re-import sources already done |
| `--force-encode` | encode even when the video could be copied |
| `--replace` | replace an episode that was imported from another file |
| `--encoder x265` | CPU encode instead of NVENC (slow; PCs without an NVIDIA GPU) |
| `--keep-work` | keep `tmp/import-work/<hash>` |
| `--daily-limit 500G` | upload budget per 24 h |
| `--no-anilist`, `--refresh-meta` | skip AniList / re-match a series that already has an id |
| `--fast` | dry-run without black-bar/interlace detection |

### Fixing an AniList match

The series summary lists every series with its AniList entry or `NO ANILIST MATCH` and the
candidates. Create `overrides/<seriesId>` in the Firestore console:
`{ anilistId: 16498, title: "Attack on Titan", seasons: { s04: { anilistId: 110277 } } }`
(`title` and `seasons` optional), then `npm run import -w @ani/import -- --only <series> --force --refresh-meta`.

### Credentials (`secrets/`, gitignored)

- `secrets/client_desktop.json` — **Desktop** OAuth client from the `myanime-streaming` Google
  Cloud project (APIs & Services → Credentials; Drive API enabled; you as a test user on the
  consent screen). The first `import` opens the browser; the token is cached in `secrets/token.json`.
- `secrets/service-account.json` — Firebase console → Project settings → Service accounts →
  *Generate new private key* (or set `GOOGLE_APPLICATION_CREDENTIALS`). `dry-run` uses it when
  present to show what is already imported.

## Step 1 — `test-encode`

Encodes sample episodes with every variant and reports size, encode time and bitrate, so the
codec, settings and bitrate ceiling can be chosen by watching the results.

```cmd
npm run test-encode -w @ani/import
npm run test-encode -w @ani/import -- "C:\path\to\episode.mkv" --duration 5:00
```

Without file arguments it uses the Step 1 samples in `C:\Users\ivani\Videos\Anime`
(Attack on Titan S01E01 BD HEVC, Aoashi S01E01 WEB x264). File names can be relative to that folder.

| Variant | Settings |
| --- | --- |
| `nvenc-cq22` / `cq24` / `cq26` | `hevc_nvenc -preset p7 -tune hq -rc vbr -cq N -b:v 0 -b_ref_mode middle -spatial-aq 1 -temporal-aq 1 -rc-lookahead 32 -pix_fmt p010le -profile:v main10` |
| `x265-crf20` | `libx265 -preset slow -crf 20 -tune animation -pix_fmt yuv420p10le` (quality reference) |
| `copy` | video stream copied, only when the source is H.264 8-bit or HEVC ≤10-bit, 4:2:0 |

All variants: Japanese audio track only → AAC stereo 192k (copied when it is already AAC
stereo), `-tag:v hvc1`, `-movflags +faststart`, keyframe every 48 frames (~2 s, for quick
seeks over Drive; was 240 before Nov 3), subtitles and font attachments dropped (they become sidecar files in Step 2).
`-b:v 0` makes NVENC purely quality-driven; without it ffmpeg's NVENC wrapper aims at 2 Mb/s.

Options

| Option | Meaning |
| --- | --- |
| `--duration 5:00`, `--start 2:00` | encode only a range (the x265 reference on a whole episode takes a long time) |
| `--only nvenc-cq24,copy` | run some variants only |
| `--cq 20,23,26`, `--crf 18` | other quality levels |
| `--maxrate 6M` | add a bitrate ceiling to every encode, to test a cap |
| `--vmaf` | also score each encode against the source with VMAF (slow; the Gyan full build has libvmaf) |
| `--skip-existing` | reuse outputs from a previous run, e.g. to add `--vmaf` later |

Output (gitignored): `tmp/test-encodes/<episode>/<episode>.<variant>.mp4`, a `results.json`
per episode, and for the run `report.md` (the tables) and `compare.html` (all variants as
`<video>` players; open it in Chrome/Edge — a black player means that browser can't decode it).

### Watching

- **PC:** open `compare.html` in Chrome and Edge. Look at dark scenes (banding/blocking in
  gradients), fast action (smearing) and sky/gradient shots, at full screen.
- **Phone:** copy the MP4s to the phone and play them in Chrome (the web app's `<video>`) and in
  the Files/gallery player (same MediaCodec decoder ExoPlayer will use).
- Pick the lowest CQ (or the copy) where you can't see a difference from `x265-crf20`, and a
  ceiling from the bitrates in `report.md`. The choice goes into `PLAN.md` Step 1.
