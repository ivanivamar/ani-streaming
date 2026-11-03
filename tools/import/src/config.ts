import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (D:\my-streaming). */
export const ROOT = path.resolve(here, '../../..');

/** Scratch output, gitignored via `/tmp` in the root .gitignore. */
export const TMP_DIR = path.join(ROOT, 'tmp');

export const DEFAULTS = {
  /** Where Ivan keeps the original episodes. */
  animeDir: 'C:\\Users\\ivani\\Videos\\Anime',
  /** Step 1 samples (PLAN.md). Used when `test-encode` gets no file arguments. */
  samples: [
    '[TatakaeSubs] Attack on Titan - S01E01 (BD 1080p HEVC OPUS) [21D9AE40].mkv',
    '[LostYears] Aoashi - S01E01 (WEB 1080p x264 E-AC-3 AAC) [720C6417].mkv',
  ],
  testEncodeDir: path.join(TMP_DIR, 'test-encodes'),
  audioBitrate: '192k',
  /** Keyframe interval in frames (~10 s at 23.976). Keeps seeks over Drive range requests short. */
  gop: 240,
};
