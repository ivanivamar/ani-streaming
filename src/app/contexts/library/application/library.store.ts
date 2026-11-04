import { computed, effect, inject, Service, signal, untracked } from '@angular/core';
import { PrefsStore, SessionStore } from '@identity/application';
import { toProgressId, type EpisodeId, type SeriesId } from '@shared/kernel';
import {
  fraction,
  isWatched,
  resumeTarget,
  UserDataRepository,
  type EpisodeLike,
  type Favourite,
  type LibraryEntry,
  type LibraryStatus,
  type RecentSearch,
  type ResumeTarget,
  type WatchProgress,
} from '../domain';

const RECENT_LIMIT = 6;

/**
 * The user's own data: watch progress, library status, favourites, recent searches. Loaded once
 * per sign-in (the Firestore persistent cache makes that cheap), kept in signals, writes are
 * optimistic and fire-and-forget (failures are logged; the next load corrects the state).
 */
@Service()
export class LibraryStore {
  private readonly session = inject(SessionStore);
  private readonly prefs = inject(PrefsStore);
  private readonly repo = inject(UserDataRepository);

  private readonly _progress = signal<ReadonlyMap<string, WatchProgress>>(new Map());
  private readonly _entries = signal<ReadonlyMap<string, LibraryEntry>>(new Map());
  private readonly _favourites = signal<ReadonlyMap<string, Favourite>>(new Map());
  private readonly _recent = signal<readonly RecentSearch[]>([]);
  private readonly _loaded = signal(false);
  private loadedFor: string | null = null;

  readonly loaded = this._loaded.asReadonly();
  readonly progress = this._progress.asReadonly();
  readonly entries = this._entries.asReadonly();
  readonly favourites = this._favourites.asReadonly();
  readonly recent = this._recent.asReadonly();
  readonly threshold = computed(() => this.prefs.prefs().watchedThreshold);

  /** Every played episode, most recent first. */
  readonly history = computed(() => [...this._progress().values()].sort((a, b) => b.updatedAt - a.updatedAt));

  constructor() {
    effect(() => {
      const uid = this.session.ready() ? this.session.uid() : null;
      untracked(() => (uid ? void this.load(uid) : this.reset()));
    });
  }

  /* ── reads ── */

  progressOf(seriesId: string, episodeId: string): WatchProgress | undefined {
    return this._progress().get(toProgressId(seriesId as SeriesId, episodeId as EpisodeId));
  }

  fractionOf(seriesId: string, episodeId: string): number {
    return fraction(this.progressOf(seriesId, episodeId));
  }

  watched(p: WatchProgress | undefined): boolean {
    return isWatched(p, this.threshold());
  }

  isEpisodeWatched(seriesId: string, episodeId: string): boolean {
    return this.watched(this.progressOf(seriesId, episodeId));
  }

  isFavourite(seriesId: string): boolean {
    return this._favourites().has(seriesId);
  }

  entry(seriesId: string): LibraryEntry | undefined {
    return this._entries().get(seriesId);
  }

  /** Resume target for a series' episodes (play order). */
  resume<E extends EpisodeLike>(seriesId: string, episodes: readonly E[]): ResumeTarget<E> | null {
    return resumeTarget(episodes, (id) => this.progressOf(seriesId, id), this.threshold());
  }

  /** Latest progress per series, most recent first (Home "continue watching" / "recently watched"). */
  readonly latestPerSeries = computed(() => {
    const seen = new Map<string, WatchProgress>();
    for (const p of this.history()) if (!seen.has(p.seriesId)) seen.set(p.seriesId, p);
    return [...seen.values()];
  });

  /* ── progress ── */

  /**
   * Record playback position. `persist` writes to Firestore (the player does that every ~10 s and
   * on pause / seek / leave); otherwise only the in-memory state moves.
   */
  recordProgress(
    seriesId: SeriesId,
    episodeId: EpisodeId,
    position: number,
    duration: number,
    opts: { persist: boolean; totalEpisodes?: number },
  ): void {
    if (!(duration > 0)) return;
    const p: WatchProgress = { seriesId, episodeId, position: Math.round(position * 10) / 10, duration, updatedAt: Date.now() };
    const id = toProgressId(seriesId, episodeId);
    this._progress.update((m) => new Map(m).set(id, p));
    if (!opts.persist) return;
    this.write((uid) => this.repo.saveProgress(uid, p));
    this.syncEntry(seriesId, opts.totalEpisodes);
  }

  /** Context menu "Mark as watched" for one or more episodes. */
  markWatched(seriesId: SeriesId, episodes: readonly { id: string; durationSec: number }[], totalEpisodes?: number): void {
    const now = Date.now();
    const next = new Map(this._progress());
    const written: WatchProgress[] = [];
    episodes.forEach((e, i) => {
      const duration = e.durationSec || 1;
      const p: WatchProgress = { seriesId, episodeId: e.id as EpisodeId, position: duration, duration, updatedAt: now + i };
      next.set(toProgressId(seriesId, p.episodeId), p);
      written.push(p);
    });
    this._progress.set(next);
    this.write((uid) => Promise.all(written.map((p) => this.repo.saveProgress(uid, p))).then(() => undefined));
    this.syncEntry(seriesId, totalEpisodes);
  }

  /** "Start over": forget one episode's position. */
  resetEpisode(seriesId: SeriesId, episodeId: EpisodeId): void {
    this.removeProgress([{ seriesId, episodeId }]);
  }

  /** "Remove from history": forget every played episode of a series. */
  removeFromHistory(seriesId: string): void {
    this.removeProgress([...this._progress().values()].filter((p) => p.seriesId === seriesId));
  }

  /** Settings → Clear watch history. */
  clearHistory(): Promise<void> {
    const all = [...this._progress().values()];
    this._progress.set(new Map());
    return this.write((uid) => this.repo.deleteProgress(uid, all));
  }

  /* ── library status ── */

  setStatus(seriesId: SeriesId, status: LibraryStatus): void {
    const e: LibraryEntry = { seriesId, status, watched: this.watchedCount(seriesId), updatedAt: Date.now() };
    this._entries.update((m) => new Map(m).set(seriesId, e));
    this.write((uid) => this.repo.saveEntry(uid, e));
  }

  removeEntry(seriesId: string): void {
    this._entries.update((m) => {
      const n = new Map(m);
      n.delete(seriesId);
      return n;
    });
    this.write((uid) => this.repo.deleteEntry(uid, seriesId));
  }

  /* ── favourites ── */

  toggleFavourite(seriesId: SeriesId): void {
    if (this.isFavourite(seriesId)) {
      this._favourites.update((m) => {
        const n = new Map(m);
        n.delete(seriesId);
        return n;
      });
      this.write((uid) => this.repo.removeFavourite(uid, seriesId));
    } else {
      const f: Favourite = { seriesId, addedAt: Date.now() };
      this._favourites.update((m) => new Map(m).set(seriesId, f));
      this.write((uid) => this.repo.addFavourite(uid, f));
      // a favourite with no status yet lands in "Plan to watch"
      if (!this.entry(seriesId)) this.setStatus(seriesId, 'planned');
    }
  }

  /* ── recent searches (cap 6) ── */

  addRecent(term: string): void {
    const t = term.trim();
    if (!t) return;
    const key = t.toLowerCase();
    const existing = this._recent().find((r) => r.term.toLowerCase() === key);
    const r: RecentSearch = { id: existing?.id ?? recentId(key), term: t, at: Date.now() };
    const list = [r, ...this._recent().filter((x) => x.id !== r.id)];
    const dropped = list.slice(RECENT_LIMIT).map((x) => x.id);
    this._recent.set(list.slice(0, RECENT_LIMIT));
    this.write(async (uid) => {
      await this.repo.saveRecent(uid, r);
      if (dropped.length) await this.repo.deleteRecent(uid, dropped);
    });
  }

  removeRecent(id: string): void {
    this._recent.update((l) => l.filter((r) => r.id !== id));
    this.write((uid) => this.repo.deleteRecent(uid, [id]));
  }

  /** Settings → Export: everything this context holds, as plain JSON. */
  exportData(): object {
    return {
      exportedAt: new Date().toISOString(),
      progress: this.history(),
      library: [...this._entries().values()],
      favourites: [...this._favourites().values()],
      recentSearches: this._recent(),
    };
  }

  /* ── internals ── */

  private watchedCount(seriesId: string): number {
    let n = 0;
    for (const p of this._progress().values()) if (p.seriesId === seriesId && this.watched(p)) n++;
    return n;
  }

  /** Keep the library entry in step with progress: start → Watching, all watched → Completed. */
  private syncEntry(seriesId: SeriesId, totalEpisodes?: number): void {
    const cur = this.entry(seriesId);
    const watched = this.watchedCount(seriesId);
    let status: LibraryStatus = cur?.status ?? 'watching';
    if (status === 'planned' || status === 'paused') status = 'watching';
    if (totalEpisodes && watched >= totalEpisodes) status = 'completed';
    if (cur && cur.status === status && cur.watched === watched) return;
    const e: LibraryEntry = { seriesId, status, watched, updatedAt: Date.now() };
    this._entries.update((m) => new Map(m).set(seriesId, e));
    this.write((uid) => this.repo.saveEntry(uid, e));
  }

  private removeProgress(list: readonly { seriesId: string; episodeId: string }[]): void {
    if (!list.length) return;
    this._progress.update((m) => {
      const n = new Map(m);
      list.forEach((p) => n.delete(toProgressId(p.seriesId as SeriesId, p.episodeId as EpisodeId)));
      return n;
    });
    this.write((uid) => this.repo.deleteProgress(uid, list));
  }

  private async load(uid: string): Promise<void> {
    if (this.loadedFor === uid) return;
    this.loadedFor = uid;
    try {
      const data = await this.repo.load(uid);
      if (this.session.uid() !== uid) return;
      this._progress.set(new Map(data.progress.map((p) => [toProgressId(p.seriesId, p.episodeId), p])));
      this._entries.set(new Map(data.entries.map((e) => [e.seriesId, e])));
      this._favourites.set(new Map(data.favourites.map((f) => [f.seriesId, f])));
      this._recent.set([...data.recent].sort((a, b) => b.at - a.at).slice(0, RECENT_LIMIT));
      this._loaded.set(true);
    } catch (e) {
      this.loadedFor = null;
      console.error('[library] could not load user data', e);
    }
  }

  private reset(): void {
    this.loadedFor = null;
    this._progress.set(new Map());
    this._entries.set(new Map());
    this._favourites.set(new Map());
    this._recent.set([]);
    this._loaded.set(false);
  }

  private write(op: (uid: string) => Promise<void>): Promise<void> {
    const uid = this.session.uid();
    if (!uid) return Promise.resolve();
    return op(uid).catch((e) => console.error('[library] write failed', e));
  }
}

const recentId = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `r${h.toString(36)}`;
};
