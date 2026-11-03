# tools/import

Importer for ani.stream (see `PLAN.md`). Plain TypeScript run directly by Node (type
stripping), so there is no build step. Needs **Node ≥ 22.18** and a **system ffmpeg with NVENC**.

```cmd
winget install Gyan.FFmpeg
```

`ffmpeg`/`ffprobe` are taken from PATH; set `FFMPEG_PATH` (and optionally `FFPROBE_PATH`) to
use another build. Step 2 adds the full importer (probe → extract → encode/copy → verify →
resumable Drive upload → Firestore).

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
stereo), `-tag:v hvc1`, `-movflags +faststart`, keyframe every 240 frames (~10 s, for quick
seeks over Drive), subtitles and font attachments dropped (they become sidecar files in Step 2).
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
