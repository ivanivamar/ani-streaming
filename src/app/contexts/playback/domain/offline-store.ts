import type { DownloadEntry } from './downloads';

/** What the phone has (bytes) and what the download job is doing. */
export interface OfflineState {
  readonly stored: readonly { readonly id: string; readonly size: number }[];
  /** wanted files not stored yet (excluding failed) */
  readonly pending: number;
  readonly failed: readonly { readonly id: string; readonly reason: 'missing' | 'forbidden' }[];
  readonly current: { readonly id: string; readonly title: string | null; readonly bytes: number; readonly total: number } | null;
  readonly running: boolean;
  readonly paused: boolean;
  readonly wifiOnly: boolean;
  readonly network: 'wifi' | 'cellular' | 'none';
  /** the job stopped: no space left, or no Drive token */
  readonly error: 'storage' | 'auth' | null;
  /** bytes used by downloads, free and total on the phone */
  readonly used: number;
  readonly free: number;
  readonly total: number;
}

export const EMPTY_OFFLINE: OfflineState = {
  stored: [],
  pending: 0,
  failed: [],
  current: null,
  running: false,
  paused: false,
  wifiOnly: true,
  network: 'wifi',
  error: null,
  used: 0,
  free: 0,
  total: 0,
};

/**
 * Port: the Android app's download store (WorkManager job + app storage, Step 8). In the browser
 * `available` is false and the Downloads screen / buttons are hidden.
 */
export abstract class OfflineStorePort {
  abstract readonly available: boolean;
  /** Complete list of Drive files to keep: the rest is deleted, missing ones downloaded. */
  abstract sync(items: readonly { id: string; size: number; title: string }[], wifiOnly?: boolean): Promise<OfflineState>;
  abstract state(): Promise<OfflineState>;
  abstract setPaused(paused: boolean): Promise<OfflineState>;
  abstract retryFailed(): Promise<OfflineState>;
  /** Android 13+: ask once for the progress notification. */
  abstract askNotifications(): Promise<void>;
  /** Byte progress of the current file, and "something changed, read state()". Returns an unsubscribe. */
  abstract watch(onProgress: (p: { id: string; bytes: number; total: number }) => void, onChanged: () => void): () => void;
  /** The picked episodes (this device only). */
  abstract readEntries(): DownloadEntry[];
  abstract writeEntries(entries: readonly DownloadEntry[]): void;
}
