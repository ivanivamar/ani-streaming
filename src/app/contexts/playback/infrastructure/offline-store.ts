import { DOCUMENT, inject, Injectable } from '@angular/core';
import { AniDownloads, type NativeDownloadState } from '@shared/infrastructure';
import { EMPTY_OFFLINE, OfflineStorePort, type DownloadEntry, type OfflineState } from '../domain';

/** localStorage key of the picked episodes (per device: the files are on this phone). */
export const DOWNLOADS_KEY = 'ani.downloads.v1';

/** Browser build: no downloads. */
@Injectable()
export class NoOfflineStore extends OfflineStorePort {
  readonly available = false;
  sync = () => Promise.resolve(EMPTY_OFFLINE);
  state = () => Promise.resolve(EMPTY_OFFLINE);
  setPaused = () => Promise.resolve(EMPTY_OFFLINE);
  retryFailed = () => Promise.resolve(EMPTY_OFFLINE);
  askNotifications = () => Promise.resolve();
  watch(): () => void {
    return () => undefined;
  }
  readEntries(): DownloadEntry[] {
    return [];
  }
  writeEntries(): void {
    /* browser */
  }
}

const toState = (s: NativeDownloadState): OfflineState => ({ ...EMPTY_OFFLINE, ...s });

/**
 * Android app: `AniDownloads` plugin (ported from the music app's PelagicDownloads: Offline.java +
 * DownloadWorker.java). Files are stored by Drive id in the app's private storage; the native
 * player and the `/__drive/` proxy use a stored copy whenever there is one.
 */
@Injectable()
export class CapacitorOfflineStore extends OfflineStorePort {
  readonly available = true;
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage ?? null;

  async sync(items: readonly { id: string; size: number; title: string }[], wifiOnly?: boolean): Promise<OfflineState> {
    return toState(await AniDownloads.sync({ items, ...(wifiOnly === undefined ? {} : { wifiOnly }) }));
  }

  async state(): Promise<OfflineState> {
    return toState(await AniDownloads.state());
  }

  async setPaused(paused: boolean): Promise<OfflineState> {
    return toState(await AniDownloads.setPaused({ paused }));
  }

  async retryFailed(): Promise<OfflineState> {
    return toState(await AniDownloads.retryFailed());
  }

  askNotifications(): Promise<void> {
    return AniDownloads.askNotifications();
  }

  watch(onProgress: (p: { id: string; bytes: number; total: number }) => void, onChanged: () => void): () => void {
    const handles = [
      AniDownloads.addListener('progress', (p) => onProgress({ id: p.id, bytes: p.bytes, total: p.total })),
      AniDownloads.addListener('changed', () => onChanged()),
    ];
    return () => {
      for (const h of handles) void h.then((x) => x.remove());
    };
  }

  readEntries(): DownloadEntry[] {
    try {
      const raw = this.storage?.getItem(DOWNLOADS_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? (list as DownloadEntry[]).filter((e) => e && typeof e.episodeId === 'string' && Array.isArray(e.files)) : [];
    } catch {
      return [];
    }
  }

  writeEntries(entries: readonly DownloadEntry[]): void {
    try {
      this.storage?.setItem(DOWNLOADS_KEY, JSON.stringify(entries));
    } catch {
      /* storage full / unavailable: the list lives until the app closes */
    }
  }
}
