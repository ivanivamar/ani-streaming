import type { EpisodeId, SeriesId } from '@shared/kernel';
import type { LibraryStore } from './library.store';

const PERSIST_EVERY_MS = 10_000;

/**
 * Player → progress writes (v3 rule): in memory on every tick, to Firestore every ~10 s while
 * playing and on pause / seek / leave / `visibilitychange` — never every tick.
 */
export class ProgressTracker {
  private lastWrite = 0;
  private last: { position: number; duration: number } | null = null;

  constructor(
    private readonly store: LibraryStore,
    readonly seriesId: SeriesId,
    readonly episodeId: EpisodeId,
    private readonly totalEpisodes: number,
  ) {}

  /** `timeupdate` */
  tick(position: number, duration: number): void {
    if (!(duration > 0) || position < 1) return;
    this.last = { position, duration };
    const now = Date.now();
    const persist = now - this.lastWrite >= PERSIST_EVERY_MS;
    if (persist) this.lastWrite = now;
    this.store.recordProgress(this.seriesId, this.episodeId, position, duration, { persist, totalEpisodes: this.totalEpisodes });
  }

  /** pause, seeked, ended, page hidden, leaving the player */
  flush(position?: number, duration?: number): void {
    if (position !== undefined && duration !== undefined && duration > 0 && position >= 1) this.last = { position, duration };
    if (!this.last) return;
    this.lastWrite = Date.now();
    this.store.recordProgress(this.seriesId, this.episodeId, this.last.position, this.last.duration, {
      persist: true,
      totalEpisodes: this.totalEpisodes,
    });
  }
}
