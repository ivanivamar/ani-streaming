import { fraction, isWatched, type WatchProgress } from './models';

/** The bits of a catalogue episode the rules need. */
export interface EpisodeLike {
  readonly id: string;
  readonly season: number;
  readonly number: number;
}

export interface ResumeTarget<E extends EpisodeLike> {
  readonly episode: E;
  /** seconds to start at (0 = from the beginning) */
  readonly position: number;
  /** 0–1 */
  readonly fraction: number;
  /** nothing watched in this series yet */
  readonly fresh: boolean;
  /** every episode watched (target is the first one, "Watch again") */
  readonly finished: boolean;
}

/**
 * "Resume" rule (v3): the most recently played episode if unfinished; if it was finished, the
 * next one; when everything is watched, the first episode again. `episodes` in play order.
 */
export function resumeTarget<E extends EpisodeLike>(
  episodes: readonly E[],
  progressOf: (episodeId: string) => WatchProgress | undefined,
  threshold: number,
): ResumeTarget<E> | null {
  if (episodes.length === 0) return null;
  let last: { i: number; p: WatchProgress } | null = null;
  episodes.forEach((e, i) => {
    const p = progressOf(e.id);
    if (p && (!last || p.updatedAt > last.p.updatedAt)) last = { i, p };
  });
  const found = last as { i: number; p: WatchProgress } | null;
  if (!found) return { episode: episodes[0], position: 0, fraction: 0, fresh: true, finished: false };
  if (!isWatched(found.p, threshold)) {
    return { episode: episodes[found.i], position: found.p.position, fraction: fraction(found.p), fresh: false, finished: false };
  }
  // finished: the next unwatched episode after it, else any unwatched one, else start over
  const after = episodes.slice(found.i + 1).find((e) => !isWatched(progressOf(e.id), threshold));
  const any = after ?? episodes.find((e) => !isWatched(progressOf(e.id), threshold));
  if (!any) return { episode: episodes[0], position: 0, fraction: 0, fresh: false, finished: true };
  const p = progressOf(any.id);
  return { episode: any, position: p?.position ?? 0, fraction: fraction(p), fresh: false, finished: false };
}

/** Next episode in play order, or null after the last. */
export function nextEpisode<E extends EpisodeLike>(episodes: readonly E[], currentId: string): E | null {
  const i = episodes.findIndex((e) => e.id === currentId);
  return i >= 0 && i < episodes.length - 1 ? episodes[i + 1] : null;
}
