/**
 * Offline downloads (Android app, Step 8). The user picks episodes; each one is a fixed list of
 * Drive files (the MP4, its subtitle files, the thumbnail and the series' fonts), snapshotted when
 * it was picked so the Downloads page and offline playback never need the catalogue. The native
 * side gets the complete list of wanted files (`wantedFiles`), deletes everything else and
 * downloads what's missing, in list order.
 */

export type DownloadFileKind = 'video' | 'sub' | 'thumb' | 'font';

export interface DownloadFile {
  /** Drive file id */
  readonly id: string;
  /** bytes; 0 = unknown (subtitles, fonts, thumbnails are small) */
  readonly size: number;
  readonly kind: DownloadFileKind;
}

/** One downloaded (or queued) episode. */
export interface DownloadEntry {
  readonly seriesId: string;
  readonly episodeId: string;
  readonly seriesTitle: string;
  readonly posterUrl: string | null;
  readonly season: number;
  readonly number: number;
  readonly title: string | null;
  readonly durationSec: number;
  /** video first, then subs, thumbnail, fonts */
  readonly files: readonly DownloadFile[];
  /** ms when picked (queue order) */
  readonly at: number;
}

/** The catalogue fields an entry is built from (structurally the catalogue's Series / Episode). */
export interface DownloadSource {
  readonly series: { readonly id: string; readonly title: string; readonly posterUrl: string | null; readonly fontFileIds?: readonly string[] };
  readonly episode: {
    readonly id: string;
    readonly season: number;
    readonly number: number;
    readonly title: string | null;
    readonly durationSec: number;
    readonly sizeBytes: number;
    readonly video: { readonly driveFileId: string };
    readonly subs: readonly { readonly driveFileId: string }[];
    readonly thumbDriveFileId: string | null;
  };
}

export const entryKey = (seriesId: string, episodeId: string) => `${seriesId}/${episodeId}`;

export function toDownloadEntry({ series, episode }: DownloadSource, at: number): DownloadEntry {
  const files: DownloadFile[] = [{ id: episode.video.driveFileId, size: episode.sizeBytes, kind: 'video' }];
  for (const s of episode.subs) files.push({ id: s.driveFileId, size: 0, kind: 'sub' });
  if (episode.thumbDriveFileId) files.push({ id: episode.thumbDriveFileId, size: 0, kind: 'thumb' });
  for (const f of series.fontFileIds ?? []) files.push({ id: f, size: 0, kind: 'font' });
  return {
    seriesId: series.id,
    episodeId: episode.id,
    seriesTitle: series.title,
    posterUrl: series.posterUrl,
    season: episode.season,
    number: episode.number,
    title: episode.title,
    durationSec: episode.durationSec,
    files,
    at,
  };
}

/** Queue order: oldest pick first; inside a series by season and episode. */
export function byQueueOrder(a: DownloadEntry, b: DownloadEntry): number {
  return a.at - b.at || a.season - b.season || a.number - b.number;
}

/**
 * Every Drive file to keep on the phone, once each, in download order. Small files of an episode
 * (subs, thumbnail, fonts) come *before* its video so an episode is watchable with subtitles as
 * soon as the video lands.
 */
export function wantedFiles(entries: readonly DownloadEntry[], titleOf: (e: DownloadEntry) => string): { id: string; size: number; title: string }[] {
  const out: { id: string; size: number; title: string }[] = [];
  const seen = new Set<string>();
  for (const e of [...entries].sort(byQueueOrder)) {
    const small = e.files.filter((f) => f.kind !== 'video');
    const video = e.files.filter((f) => f.kind === 'video');
    for (const f of [...small, ...video]) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ id: f.id, size: f.size, title: titleOf(e) });
    }
  }
  return out;
}

export type DownloadStatus = 'done' | 'downloading' | 'queued' | 'paused' | 'failed';

export interface EntryProgress {
  readonly status: DownloadStatus;
  /** bytes of this episode on the phone (current file's partial bytes included) */
  readonly bytes: number;
  /** expected bytes (the video's size; small files count once stored) */
  readonly total: number;
  readonly fraction: number;
}

export interface StoreSnapshot {
  readonly stored: ReadonlyMap<string, number>;
  readonly failed: ReadonlySet<string>;
  readonly current: { readonly id: string; readonly bytes: number } | null;
  readonly paused: boolean;
}

/** How far one episode is. Done = every file stored; failed = Drive refused one of them. */
export function entryProgress(e: DownloadEntry, s: StoreSnapshot): EntryProgress {
  let bytes = 0;
  let total = 0;
  let missing = 0;
  let failed = false;
  let downloading = false;
  for (const f of e.files) {
    const have = s.stored.get(f.id);
    if (have !== undefined) {
      bytes += have;
      total += have;
      continue;
    }
    missing++;
    total += f.size;
    if (s.failed.has(f.id)) failed = true;
    if (s.current?.id === f.id) {
      downloading = true;
      bytes += s.current.bytes;
    }
  }
  const fraction = total > 0 ? Math.min(1, bytes / total) : missing ? 0 : 1;
  if (!missing) return { status: 'done', bytes, total, fraction: 1 };
  const status: DownloadStatus = failed ? 'failed' : downloading ? 'downloading' : s.paused ? 'paused' : 'queued';
  return { status, bytes, total, fraction };
}

/** "S1 · E03" style label used in the notification and the list. */
export function episodeLabel(e: Pick<DownloadEntry, 'season' | 'number'>): string {
  return `S${e.season} · E${String(e.number).padStart(2, '0')}`;
}
