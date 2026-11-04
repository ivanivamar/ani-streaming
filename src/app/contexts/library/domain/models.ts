import type { EpisodeId, LibraryStatus, SeriesId } from '@ani/contracts';

export type { LibraryStatus } from '@ani/contracts';

/** `users/{uid}/progress/{seriesId}_{episodeId}` with its parsed id. Seconds; ms timestamps. */
export interface WatchProgress {
  readonly seriesId: SeriesId;
  readonly episodeId: EpisodeId;
  readonly position: number;
  readonly duration: number;
  readonly updatedAt: number;
}

/** `users/{uid}/library/{seriesId}` */
export interface LibraryEntry {
  readonly seriesId: SeriesId;
  readonly status: LibraryStatus;
  /** watched episode count, kept up to date by the app */
  readonly watched: number;
  readonly updatedAt: number;
}

export interface Favourite {
  readonly seriesId: SeriesId;
  readonly addedAt: number;
}

export interface RecentSearch {
  readonly id: string;
  readonly term: string;
  readonly at: number;
}

export interface UserData {
  readonly progress: readonly WatchProgress[];
  readonly entries: readonly LibraryEntry[];
  readonly favourites: readonly Favourite[];
  readonly recent: readonly RecentSearch[];
}

/** Tabs / menus in display order (Paused isn't in the v3 tabs; it shows under All). */
export const LIBRARY_STATUSES: readonly LibraryStatus[] = ['watching', 'planned', 'completed', 'dropped'];

export const STATUS_LABEL: Record<LibraryStatus, string> = {
  watching: 'Watching',
  planned: 'Plan to watch',
  completed: 'Completed',
  paused: 'Paused',
  dropped: 'Dropped',
};

/** Played fraction 0–1. */
export function fraction(p: Pick<WatchProgress, 'position' | 'duration'> | null | undefined): number {
  if (!p || !(p.duration > 0)) return 0;
  return Math.min(1, Math.max(0, p.position / p.duration));
}

/** Watched = progress ≥ the user's threshold (prefs: 80/90/95%). */
export function isWatched(p: Pick<WatchProgress, 'position' | 'duration'> | null | undefined, threshold: number): boolean {
  return fraction(p) >= threshold;
}

/** `aoashi_s01e01` → ids (series slugs never contain `_`). */
export function parseProgressId(id: string): { seriesId: SeriesId; episodeId: EpisodeId } | null {
  const i = id.lastIndexOf('_');
  if (i <= 0 || i === id.length - 1) return null;
  return { seriesId: id.slice(0, i) as SeriesId, episodeId: id.slice(i + 1) as EpisodeId };
}
