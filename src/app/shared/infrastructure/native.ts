import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Android app bridge (PLAN.md Step 8). `IS_NATIVE` is true inside the Capacitor APK; there the
 * providers bind the native adapters (Play services sign-in, Media3 player, downloads) instead of
 * the browser ones. In a browser none of the plugins below is ever called.
 *
 * Java side: android/app/src/main/java/com/anistream/*.java (one plugin class each).
 */
export const IS_NATIVE = Capacitor.isNativePlatform();

/** Where the `api` function lives for the APK (its pages are served from https://localhost). */
export const NATIVE_API_BASE = 'https://myanime-streaming.web.app/';

/* ── AniNative: Google sign-in, app info, system UI ─────────────────────────── */

export interface NativeToken {
  readonly accessToken: string;
  /** from Google's tokeninfo; Play services hands out cached tokens with less than an hour left */
  readonly expiresInSec: number;
  /** space-separated granted scopes */
  readonly scope: string;
}

export interface NativeAppInfo {
  readonly versionName: string;
  readonly versionCode: number;
}

export interface AniNativePlugin {
  /**
   * Play services AuthorizationClient for drive.readonly. `interactive: false` never shows UI and
   * rejects with code `needs_consent` when Google needs the user.
   */
  authorize(opts: { interactive: boolean }): Promise<NativeToken>;
  /** Drop a token from Play services' cache (after a 401 or on sign-out). */
  clearToken(opts: { token: string }): Promise<void>;
  /**
   * The web session's token + account for native Drive requests (player, downloads, `/__drive/`
   * proxy). With the email, native can also renew the token by itself while JS sleeps.
   */
  setAuth(opts: { email: string | null; token: string | null; expiresAt: number }): Promise<void>;
  clearAuth(): Promise<void>;
  appInfo(): Promise<NativeAppInfo>;
  /** Open a URL outside the app (browser / downloads), e.g. an update's APK. */
  openUrl(opts: { url: string }): Promise<void>;
  /** Player: hide the status + navigation bars (swipe from the edge shows them briefly). */
  setImmersive(opts: { on: boolean }): Promise<void>;
}

export const AniNative = registerPlugin<AniNativePlugin>('AniNative');

/* ── AniPlayer: Media3 ExoPlayer behind the (transparent) WebView ───────────── */

export interface NativePlayerState {
  readonly positionMs: number;
  readonly durationMs: number;
  readonly bufferedMs: number;
  readonly playing: boolean;
  readonly buffering: boolean;
  readonly ended: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
}

export interface NativePlayerError {
  /** `auth` (Drive 401 twice), `network`, `decoder`, `source` (404/403), `other` */
  readonly code: string;
  readonly message: string;
}

export interface NativeDecoderInfo {
  readonly supported: boolean;
  readonly hardware: boolean;
  readonly decoder: string | null;
}

export interface AniPlayerPlugin {
  /** Play a Drive file (the downloaded copy when there is one). Replaces whatever was playing. */
  open(opts: { fileId: string; sizeBytes: number; startMs: number; play: boolean }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(opts: { positionMs: number }): Promise<void>;
  /** Stop and remove the video surface (leaving the player). */
  close(): Promise<void>;
  getState(): Promise<NativePlayerState>;
  /** MediaCodecList: is there a decoder for this codec / bit depth, and is it hardware? */
  decoderInfo(opts: { codec: 'hevc' | 'h264'; bitDepth: number; width: number; height: number }): Promise<NativeDecoderInfo>;
  addListener(event: 'state', cb: (s: NativePlayerState) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', cb: (e: NativePlayerError) => void): Promise<PluginListenerHandle>;
}

export const AniPlayer = registerPlugin<AniPlayerPlugin>('AniPlayer');

/* ── AniDownloads: WorkManager downloads into the app's storage ─────────────── */

export interface NativeDownloadItem {
  /** Drive file id */
  readonly id: string;
  /** bytes (0 = unknown: subtitles, fonts, thumbnails) */
  readonly size: number;
  /** shown in the download notification */
  readonly title: string;
}

export interface NativeDownloadProgress {
  readonly id: string;
  readonly title: string | null;
  readonly bytes: number;
  readonly total: number;
}

export interface NativeDownloadState {
  /** complete files on the phone */
  readonly stored: readonly { readonly id: string; readonly size: number }[];
  /** wanted files not stored yet (excluding failed) */
  readonly pending: number;
  /** files Drive refused: skipped until retryFailed() */
  readonly failed: readonly { readonly id: string; readonly reason: 'missing' | 'forbidden' }[];
  readonly current: NativeDownloadProgress | null;
  readonly running: boolean;
  readonly paused: boolean;
  readonly wifiOnly: boolean;
  readonly network: 'wifi' | 'cellular' | 'none';
  /** the worker stopped: no space left, or no Drive token */
  readonly error: 'storage' | 'auth' | null;
  /** bytes: the app's files, free and total on the phone's storage */
  readonly used: number;
  readonly free: number;
  readonly total: number;
}

export interface AniDownloadsPlugin {
  /** The complete list of Drive files to keep offline: the rest is deleted, missing ones downloaded. */
  sync(opts: { items: readonly NativeDownloadItem[]; wifiOnly?: boolean }): Promise<NativeDownloadState>;
  state(): Promise<NativeDownloadState>;
  setPaused(opts: { paused: boolean }): Promise<NativeDownloadState>;
  retryFailed(): Promise<NativeDownloadState>;
  /** Android 13+: ask once to show the progress notification. */
  askNotifications(): Promise<void>;
  addListener(event: 'progress', cb: (p: NativeDownloadProgress) => void): Promise<PluginListenerHandle>;
  addListener(event: 'changed', cb: () => void): Promise<PluginListenerHandle>;
}

export const AniDownloads = registerPlugin<AniDownloadsPlugin>('AniDownloads');

/**
 * Same-origin URL of a Drive file inside the APK: `MainActivity`'s WebView client answers
 * `/__drive/<id>` itself, from the downloaded copy or from Drive with the native token (the same
 * URL scheme the web build's service worker uses).
 */
export function nativeDriveUrl(fileId: string, mimeType?: string): string {
  const q = mimeType ? `?${new URLSearchParams({ type: mimeType })}` : '';
  return `/__drive/${encodeURIComponent(fileId)}${q}`;
}
