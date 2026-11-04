import { computed, DestroyRef, inject, Service, signal } from '@angular/core';
import {
  byQueueOrder,
  EMPTY_OFFLINE,
  entryKey,
  entryProgress,
  episodeLabel,
  OfflineStorePort,
  toDownloadEntry,
  wantedFiles,
  type DownloadEntry,
  type DownloadSource,
  type EntryProgress,
  type OfflineState,
  type StoreSnapshot,
} from '../domain';

export interface DownloadRow {
  readonly entry: DownloadEntry;
  readonly key: string;
  readonly label: string;
  readonly progress: EntryProgress;
}

export interface DownloadGroup {
  readonly seriesId: string;
  readonly title: string;
  readonly posterUrl: string | null;
  readonly rows: readonly DownloadRow[];
  readonly bytes: number;
}

/**
 * Offline downloads (Android app, Step 8). The picked episodes live on this phone
 * (`OfflineStorePort.readEntries`); every change sends the complete file list to the native job,
 * which deletes what's no longer wanted and fetches what's missing (Wi-Fi only by default), with
 * the app closed too. Playback needs nothing from here: the native player and `/__drive/` use a
 * stored copy by themselves. In the browser `available` is false and everything stays empty.
 */
@Service()
export class DownloadsStore {
  /** absent (tests, other builds) = no downloads */
  private readonly port: OfflineStorePort | null = inject(OfflineStorePort, { optional: true });
  readonly available = !!this.port?.available;

  private readonly _entries = signal<readonly DownloadEntry[]>(this.port?.readEntries() ?? []);
  private readonly _state = signal<OfflineState>(EMPTY_OFFLINE);
  /** byte progress of the file being downloaded (events between two state reads) */
  private readonly _current = signal<{ id: string; bytes: number } | null>(null);
  private readonly _error = signal<string | null>(null);

  readonly entries = this._entries.asReadonly();
  readonly state = this._state.asReadonly();
  /** last failed call (shown on the Downloads page) */
  readonly error = this._error.asReadonly();

  private readonly snapshot = computed<StoreSnapshot>(() => {
    const s = this._state();
    return {
      stored: new Map(s.stored.map((f) => [f.id, f.size])),
      failed: new Set(s.failed.map((f) => f.id)),
      current: this._current() ?? (s.current ? { id: s.current.id, bytes: s.current.bytes } : null),
      paused: s.paused,
    };
  });

  private readonly progressByKey = computed(() => {
    const snap = this.snapshot();
    return new Map(this._entries().map((e) => [entryKey(e.seriesId, e.episodeId), entryProgress(e, snap)]));
  });

  /** By series (most recently picked first), episodes in order. */
  readonly groups = computed<DownloadGroup[]>(() => {
    const progress = this.progressByKey();
    const bySeries = new Map<string, DownloadEntry[]>();
    for (const e of [...this._entries()].sort(byQueueOrder)) {
      const list = bySeries.get(e.seriesId) ?? [];
      list.push(e);
      bySeries.set(e.seriesId, list);
    }
    return [...bySeries.values()]
      .map((list) => {
        const rows = [...list]
          .sort((a, b) => a.season - b.season || a.number - b.number)
          .map((entry) => {
            const key = entryKey(entry.seriesId, entry.episodeId);
            return { entry, key, label: episodeLabel(entry), progress: progress.get(key)! };
          });
        return {
          seriesId: list[0].seriesId,
          title: list[0].seriesTitle,
          posterUrl: list[0].posterUrl,
          rows,
          bytes: rows.reduce((n, r) => n + r.progress.bytes, 0),
          latest: Math.max(...list.map((e) => e.at)),
        };
      })
      .sort((a, b) => b.latest - a.latest)
      .map((g): DownloadGroup => ({ seriesId: g.seriesId, title: g.title, posterUrl: g.posterUrl, rows: g.rows, bytes: g.bytes }));
  });

  readonly count = computed(() => this._entries().length);
  readonly doneCount = computed(() => [...this.progressByKey().values()].filter((p) => p.status === 'done').length);

  constructor() {
    if (!this.port?.available) return;
    const stop = this.port.watch(
      (p) => this._current.set({ id: p.id, bytes: p.bytes }),
      () => void this.refresh(),
    );
    inject(DestroyRef).onDestroy(stop);
    // a launch after an update / a cleared app: make the native list match ours
    void this.sync();
  }

  /** Download status of one episode (null: not picked). */
  progressOf(seriesId: string, episodeId: string): EntryProgress | null {
    return this.progressByKey().get(entryKey(seriesId, episodeId)) ?? null;
  }

  /** Pick episodes for offline (already picked ones are kept as they are). */
  async add(sources: readonly DownloadSource[]): Promise<void> {
    if (!this.available || !sources.length) return;
    const have = new Set(this._entries().map((e) => entryKey(e.seriesId, e.episodeId)));
    const now = Date.now();
    const added = sources
      .filter((s) => !have.has(entryKey(s.series.id, s.episode.id)))
      .map((s, i) => toDownloadEntry(s, now + i));
    if (!added.length) return;
    const first = this._entries().length === 0;
    this.setEntries([...this._entries(), ...added]);
    if (first) void this.port?.askNotifications().catch(() => undefined);
    await this.sync();
  }

  async remove(seriesId: string, episodeId?: string): Promise<void> {
    this.setEntries(this._entries().filter((e) => e.seriesId !== seriesId || (episodeId !== undefined && e.episodeId !== episodeId)));
    await this.sync();
  }

  async removeAll(): Promise<void> {
    this.setEntries([]);
    await this.sync();
  }

  async setWifiOnly(wifiOnly: boolean): Promise<void> {
    await this.sync(wifiOnly);
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.run((p) => p.setPaused(paused));
  }

  async retry(): Promise<void> {
    await this.run((p) => p.retryFailed());
  }

  async refresh(): Promise<void> {
    if (!this.available) return;
    await this.run((p) => p.state());
  }

  private async sync(wifiOnly?: boolean): Promise<void> {
    if (!this.available) return;
    const items = wantedFiles(this._entries(), (e) => `${e.seriesTitle} · ${episodeLabel(e)}`);
    await this.run((p) => p.sync(items, wifiOnly));
  }

  private async run(call: (port: OfflineStorePort) => Promise<OfflineState>): Promise<void> {
    const port = this.port;
    if (!port?.available) return;
    try {
      const s = await call(port);
      this._state.set(s);
      if (!s.current) this._current.set(null);
      this._error.set(null);
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : String(e));
    }
  }

  private setEntries(list: readonly DownloadEntry[]): void {
    this._entries.set(list);
    this.port?.writeEntries(list);
  }
}
