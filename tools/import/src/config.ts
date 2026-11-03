import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (D:\my-streaming). */
export const ROOT = path.resolve(here, '../../..');

/** Scratch output, gitignored via `/tmp` in the root .gitignore. */
export const TMP_DIR = path.join(ROOT, 'tmp');

/** Credentials, gitignored via `/secrets`. */
export const SECRETS_DIR = path.join(ROOT, 'secrets');
/** Desktop OAuth client of the `myanime-streaming` Google Cloud project (Drive access). */
export const CLIENT_FILE = path.join(SECRETS_DIR, 'client_desktop.json');
/** Cached refresh token, written on the first sign-in. */
export const TOKEN_FILE = path.join(SECRETS_DIR, 'token.json');
/** Firebase Admin service account (Firestore). `GOOGLE_APPLICATION_CREDENTIALS` overrides it. */
export const SERVICE_ACCOUNT_FILE =
  process.env['GOOGLE_APPLICATION_CREDENTIALS'] || path.join(SECRETS_DIR, 'service-account.json');

/** Full Drive scope, as in the music importer (finds folders created by hand too). */
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

export const FIREBASE_PROJECT_ID = 'myanime-streaming';

export const DEFAULTS = {
  /** Where Ivan keeps the original episodes. */
  animeDir: 'C:\\Users\\ivani\\Videos\\Anime',
  /** Step 1 samples (PLAN.md). Used when `test-encode` gets no file arguments. */
  samples: [
    '[TatakaeSubs] Attack on Titan - S01E01 (BD 1080p HEVC OPUS) [21D9AE40].mkv',
    '[LostYears] Aoashi - S01E01 (WEB 1080p x264 E-AC-3 AAC) [720C6417].mkv',
  ],
  testEncodeDir: path.join(TMP_DIR, 'test-encodes'),
  /** Per-episode work copies of the importer; each is removed once its episode is done. */
  workDir: path.join(TMP_DIR, 'import-work'),
  /** Run reports of the importer (`import-<time>.log` + `.json`). */
  logDir: path.join(TMP_DIR, 'import-logs'),
  /** Bytes uploaded in the last 24 h, so a run can stop before Drive's daily limit. */
  uploadBudgetFile: path.join(TMP_DIR, 'import-upload-budget.json'),
  /** Drive root folder (same Google account as the music library). */
  driveRoot: 'AniStream',
  audioBitrate: '192k',
  /** Keyframe interval in frames (~10 s at 23.976). Keeps seeks over Drive range requests short. */
  gop: 240,
};

/** Step 1 result (PLAN.md): the encode every importer run uses. */
export const ENCODE = {
  cq: 26,
  maxrate: '8M',
  bufsize: '16M',
  /** Largest output frame; bigger sources are scaled down to fit. */
  maxWidth: 1920,
  maxHeight: 1080,
  /** Copy rule: average video bitrate at or below this is copied (when the codec qualifies). */
  copyMaxVideoBitrate: 8_000_000,
};

/** Drive limits uploads to 750 GB per rolling 24 h; stay a little below it. */
export const DAILY_UPLOAD_LIMIT = 740 * 1000 ** 3;

/** Video files the importer picks up. */
export const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.m4v', '.webm', '.avi', '.m2ts', '.ts', '.mov']);
/** Sidecar subtitles next to an episode (`<episode>.ass`, `<episode>.en.ass`, `<episode>.en.signs.srt`, …). */
export const SIDECAR_EXTENSIONS = new Set(['.ass', '.ssa', '.srt']);
