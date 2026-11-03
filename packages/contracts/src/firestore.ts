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
