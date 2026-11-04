/**
 * Firestore document shapes (see PLAN.md, "Where data lives").
 *
 * Timestamps are typed as `FirestoreTime` so this package stays free of any Firebase import:
 * the app's mappers and the importer convert to/from their SDK's `Timestamp`.
 */
import type { EpisodeId, SeasonId, SeriesId } from './ids';

/** Milliseconds since epoch on the wire of the mappers; stored as a Firestore Timestamp. */
export type FirestoreTime = number;

export const COLLECTIONS = {
  series: 'series',
  seasons: 'seasons',
  episodes: 'episodes',
  importState: 'importState',
  overrides: 'overrides',
  users: 'users',
  library: 'library',
  favourites: 'favourites',
  progress: 'progress',
  recent: 'recent',
  notify: 'notify',
  config: 'config',
  importAgent: 'importAgent',
  importScan: 'importScan',
  importJobs: 'importJobs',
} as const;

export type SeriesStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';
export type SeriesFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA';

/** `series/{seriesId}` */
export interface SeriesDoc {
  title: string;
  titleRomaji: string | null;
  titleNative: string | null;
  aliases: string[];
  anilistId: number | null;
  synopsis: string | null;
  genres: string[];
  year: number | null;
  status: SeriesStatus | null;
  format: SeriesFormat | null;
  posterUrl: string | null;
  bannerUrl: string | null;
  color: string | null;
  seasonCount: number;
  episodeCount: number;
  addedAt: FirestoreTime;
  updatedAt: FirestoreTime;
  /** Normalized title words + aliases, queried with `array-contains`. */
  searchTokens: string[];
  fontFileIds: string[];
}

/** `series/{seriesId}/seasons/{seasonId}` */
export interface SeasonDoc {
  number: number;
  title: string | null;
  anilistId: number | null;
  year: number | null;
  episodeCount: number;
  posterUrl: string | null;
}

export interface VideoTrack {
  driveFileId: string;
  codec: 'hevc' | 'h264';
  bitDepth: 8 | 10;
  width: number;
  height: number;
  bitrate: number;
}

export interface AudioTrack {
  lang: string;
  codec: 'aac';
  channels: number;
  default: boolean;
}

export type SubtitleKind = 'full' | 'signs' | 'songs';

export interface SubtitleTrack {
  lang: string;
  kind: SubtitleKind;
  driveFileId: string;
}

export type ChapterKind = 'op' | 'ed' | 'other';

export interface Chapter {
  title: string;
  startSec: number;
  endSec: number;
  kind: ChapterKind;
}

export interface SourceInfo {
  width: number;
  height: number;
  codec: string;
  bitDepth: number;
  bitrate: number;
}

export type ImportAction = 'encode' | 'encode+scale' | 'copy';

/** `series/{seriesId}/episodes/{episodeId}` */
export interface EpisodeDoc {
  season: number;
  number: number;
  title: string | null;
  durationSec: number;
  sizeBytes: number;
  addedAt: FirestoreTime;
  video: VideoTrack;
  audio: AudioTrack[];
  subs: SubtitleTrack[];
  chapters: Chapter[];
  thumbDriveFileId: string | null;
  source: SourceInfo;
  action: ImportAction;
}

export type ImportStatus = 'pending' | 'done' | 'failed' | 'skipped';

/** `importState/{sourceHash}` */
export interface ImportStateDoc {
  path: string;
  size: number;
  mtime: FirestoreTime;
  episodeRef: { seriesId: SeriesId; episodeId: EpisodeId } | null;
  status: ImportStatus;
  error?: string;
}

/** `overrides/{seriesId}` — manual AniList match fixes. */
export interface OverrideDoc {
  anilistId: number;
  title?: string;
  seasons?: Partial<Record<SeasonId, { anilistId: number }>>;
}

/** `users/{uid}` */
export interface UserDoc {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  createdAt: FirestoreTime;
  prefs: UserPrefs;
}

export interface UserPrefs {
  autoplayNext?: boolean;
  autoSkipIntro?: boolean;
  subtitles?: 'full' | 'signs' | 'off';
  /** resume where the episode was left (else start over) */
  resume?: boolean;
  /** fraction of an episode after which it counts as watched */
  watchedThreshold?: 0.8 | 0.9 | 0.95;
}

export type LibraryStatus = 'watching' | 'planned' | 'completed' | 'paused' | 'dropped';

/** `users/{uid}/library/{seriesId}` */
export interface LibraryEntryDoc {
  status: LibraryStatus;
  watched: number;
  updatedAt: FirestoreTime;
}

/** `users/{uid}/favourites/{seriesId}` */
export interface FavouriteDoc {
  addedAt: FirestoreTime;
}

/** `users/{uid}/progress/{seriesId}_{episodeId}` */
export interface ProgressDoc {
  position: number;
  duration: number;
  updatedAt: FirestoreTime;
}

/** `users/{uid}/recent/{id}` — capped at 6 entries. */
export interface RecentSearchDoc {
  term: string;
  at: FirestoreTime;
}

export const RECENT_SEARCH_LIMIT = 6;

/** `users/{uid}/notify/{key}` */
export interface NotifyDoc {
  title: string;
  ep?: number;
  at: FirestoreTime;
}

/** `config/access` */
export interface AccessConfigDoc {
  allowedUids: string[];
}

// ---------------------------------------------------------------------------------------------
// In-app import (the app's Import page drives `npm run agent -w @ani/import` on the PC)
// ---------------------------------------------------------------------------------------------

/** The one agent document: `importAgent/main`. */
export const IMPORT_AGENT_ID = 'main';

/** An agent counts as online while its heartbeat is younger than this. */
export const IMPORT_AGENT_STALE_MS = 75_000;

/** `importAgent/main` — written by the agent (heartbeat); the app may only set `scanRequestedAt`. */
export interface ImportAgentDoc {
  host: string;
  /** folder the agent scans, e.g. C:\Users\ivani\Videos\Anime */
  sourceDir: string;
  state: 'idle' | 'scanning' | 'importing' | 'stopped';
  encoder: string;
  lastSeen: FirestoreTime;
  startedAt: FirestoreTime;
  lastScanAt: FirestoreTime | null;
  /** set by the app: "scan again" */
  scanRequestedAt: FirestoreTime | null;
  /** bytes uploaded to Drive in the last 24 h / the budget */
  uploadedToday: number;
  dailyLimit: number;
  error: string | null;
}

export interface AniListPick {
  anilistId: number;
  title: string;
  posterUrl: string | null;
  year: number | null;
  format: string | null;
}

export type ImportScanStatus = 'new' | 'imported' | 'pending' | 'failed' | 'duplicate' | 'unparseable';

/** `importScan/{sourceHash}` — one per video file in the agent's folder, written by the agent. */
export interface ImportScanDoc {
  fileName: string;
  /** path relative to the source folder */
  relPath: string;
  size: number;
  mtime: FirestoreTime;
  parsed: { title: string; season: number; episode: number; group: string; quality: string; seasonAssumed: boolean } | null;
  parseError: string | null;
  seriesId: SeriesId | null;
  episodeId: EpisodeId | null;
  status: ImportScanStatus;
  /** last error (failed) or why it's a duplicate */
  error: string | null;
  /** the series already exists in the catalogue */
  inLibrary: boolean;
  match: AniListPick | null;
  matchProblem: string | null;
  candidates: AniListPick[];
  scannedAt: FirestoreTime;
}

export type ImportJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type ImportJobStage = 'waiting' | 'probe' | 'encode' | 'extract' | 'upload' | 'firestore';

/** `importJobs/{id}` — created by the app (status `queued`), run and updated by the agent. */
export interface ImportJobDoc {
  /** `importScan` ids, in order */
  sources: string[];
  /** display names, same order */
  labels: string[];
  createdAt: FirestoreTime;
  createdBy: string;
  status: ImportJobStatus;
  forceEncode: boolean;
  replace: boolean;
  /** set by the app; the agent stops after the current episode */
  cancelRequested: boolean;
  /** the episode being probed / encoded */
  current: { source: string; label: string; stage: ImportJobStage; fraction: number } | null;
  /** the episode being uploaded meanwhile (encode and upload overlap) */
  uploading?: { source: string; label: string; stage: ImportJobStage; fraction: number; bytesPerSec: number } | null;
  results: Record<string, { outcome: string; detail: string | null }>;
  startedAt: FirestoreTime | null;
  finishedAt: FirestoreTime | null;
  error: string | null;
}
