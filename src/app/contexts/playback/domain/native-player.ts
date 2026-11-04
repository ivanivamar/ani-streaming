import type { DriveVideo } from './video-source';

/** What the native player reports (seconds). */
export interface NativePlaybackState {
  readonly positionSec: number;
  readonly durationSec: number;
  readonly bufferedSec: number;
  readonly playing: boolean;
  readonly buffering: boolean;
  readonly ended: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
}

export interface NativePlaybackError {
  /** `auth` (Drive refused the token twice), `network`, `decoder`, `source` (404/403), `other` */
  readonly code: 'auth' | 'network' | 'decoder' | 'source' | 'other';
  readonly message: string;
}

/**
 * Port: the Android app's Media3 player (Step 8). The video surface sits under the transparent
 * WebView, so the web player's own controls, CC, skip buttons and progress tracking stay as they
 * are; only the `<video>` element is swapped for one driven by this port. `available` is false
 * in the browser.
 */
export abstract class NativePlayerPort {
  abstract readonly available: boolean;
  abstract open(video: DriveVideo, startSec: number, play: boolean): Promise<void>;
  abstract play(): Promise<void>;
  abstract pause(): Promise<void>;
  abstract seek(sec: number): Promise<void>;
  /** Stop and remove the surface. */
  abstract close(): Promise<void>;
  /** Full-screen system UI (status + navigation bars hidden) while the player is open. */
  abstract setImmersive(on: boolean): void;
  /** Live state (several times a second while playing) and errors. Returns an unsubscribe. */
  abstract subscribe(onState: (s: NativePlaybackState) => void, onError: (e: NativePlaybackError) => void): () => void;
}

/**
 * The "URL" `VideoSourcePort.streamUrl()` returns in the Android app: not loadable by a
 * `<video>`, it tells the watch page to use the native player for this Drive file.
 */
export const NATIVE_SRC_PREFIX = 'ani-native:';

export function nativeSrc(video: DriveVideo): string {
  return `${NATIVE_SRC_PREFIX}${encodeURIComponent(video.driveFileId)}?size=${video.sizeBytes || 0}`;
}

export function parseNativeSrc(src: string): DriveVideo | null {
  if (!src.startsWith(NATIVE_SRC_PREFIX)) return null;
  const m = /^([^?]+)(?:\?size=(\d+))?$/.exec(src.slice(NATIVE_SRC_PREFIX.length));
  if (!m) return null;
  return { driveFileId: decodeURIComponent(m[1]), sizeBytes: Number(m[2] ?? 0), mimeType: 'video/mp4' };
}

/**
 * Where playback is now, between two native reports (they come every ~250 ms): the last
 * reported position plus the time since, while playing. Subtitles are drawn from this every frame.
 */
export function interpolatedPosition(s: NativePlaybackState, reportedAtMs: number, nowMs: number, durationSec: number): number {
  if (!s.playing || s.buffering) return s.positionSec;
  const t = s.positionSec + Math.max(0, nowMs - reportedAtMs) / 1000;
  // never run more than one report interval ahead (a stall the next report will show)
  const capped = Math.min(t, s.positionSec + 0.5);
  return durationSec > 0 ? Math.min(capped, durationSec) : capped;
}
