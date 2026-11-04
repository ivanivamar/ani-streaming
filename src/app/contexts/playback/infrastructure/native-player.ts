import { Injectable } from '@angular/core';
import { AniNative, AniPlayer, type NativePlayerState } from '@shared/infrastructure';
import { NativePlayerPort, type DriveVideo, type NativePlaybackError, type NativePlaybackState } from '../domain';

const toState = (s: NativePlayerState): NativePlaybackState => ({
  positionSec: s.positionMs / 1000,
  durationSec: s.durationMs > 0 ? s.durationMs / 1000 : 0,
  bufferedSec: s.bufferedMs / 1000,
  playing: s.playing,
  buffering: s.buffering,
  ended: s.ended,
  videoWidth: s.videoWidth,
  videoHeight: s.videoHeight,
});

const CODES = new Set<NativePlaybackError['code']>(['auth', 'network', 'decoder', 'source', 'other']);

/** Browser build: there is no native player. */
@Injectable()
export class NoNativePlayer extends NativePlayerPort {
  readonly available = false;
  open(): Promise<void> {
    return Promise.reject(new Error('The native player is only in the Android app.'));
  }
  play = () => Promise.resolve();
  pause = () => Promise.resolve();
  seek = () => Promise.resolve();
  close = () => Promise.resolve();
  setImmersive(): void {
    /* browser */
  }
  subscribe(): () => void {
    return () => undefined;
  }
}

/**
 * Android app: `AniPlayer` plugin (android/…/AniPlayerPlugin.java). Media3 ExoPlayer streams the
 * Drive file with the session's token (KnownLengthDataSource, so seeks are instant range
 * requests) or plays the downloaded copy, on a PlayerView placed under the WebView.
 */
@Injectable()
export class CapacitorNativePlayer extends NativePlayerPort {
  readonly available = true;

  open(video: DriveVideo, startSec: number, play: boolean): Promise<void> {
    return AniPlayer.open({ fileId: video.driveFileId, sizeBytes: video.sizeBytes, startMs: Math.round(startSec * 1000), play });
  }

  play(): Promise<void> {
    return AniPlayer.play();
  }

  pause(): Promise<void> {
    return AniPlayer.pause();
  }

  seek(sec: number): Promise<void> {
    return AniPlayer.seek({ positionMs: Math.max(0, Math.round(sec * 1000)) });
  }

  close(): Promise<void> {
    return AniPlayer.close();
  }

  setImmersive(on: boolean): void {
    void AniNative.setImmersive({ on }).catch(() => undefined);
  }

  subscribe(onState: (s: NativePlaybackState) => void, onError: (e: NativePlaybackError) => void): () => void {
    let closed = false;
    const handles = [
      AniPlayer.addListener('state', (s) => onState(toState(s))),
      AniPlayer.addListener('error', (e) =>
        onError({ code: CODES.has(e.code as NativePlaybackError['code']) ? (e.code as NativePlaybackError['code']) : 'other', message: e.message }),
      ),
    ];
    // the current state right away (e.g. after the page re-subscribes)
    void AniPlayer.getState()
      .then((s) => closed || onState(toState(s)))
      .catch(() => undefined);
    return () => {
      closed = true;
      for (const h of handles) void h.then((x) => x.remove());
    };
  }
}
