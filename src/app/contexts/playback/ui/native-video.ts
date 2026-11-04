import { Component, DestroyRef, DOCUMENT, effect, ElementRef, inject, input, untracked } from '@angular/core';
import {
  interpolatedPosition,
  NativePlayerPort,
  parseNativeSrc,
  type NativePlaybackError,
  type NativePlaybackState,
} from '@playback/application';

/** MediaError codes the watch page checks (the global may be missing in tests). */
const ERR_NETWORK = 2;
const ERR_DECODE = 3;
const ERR_SRC_NOT_SUPPORTED = 4;

const EMPTY: NativePlaybackState = {
  positionSec: 0,
  durationSec: 0,
  bufferedSec: 0,
  playing: false,
  buffering: true,
  ended: false,
  videoWidth: 0,
  videoHeight: 0,
};

/**
 * Android app (Step 8): stands in for the watch page's `<video>`. The picture is Media3's surface
 * *under* the transparent WebView; this element only drives it. Its host element gets the slice
 * of the HTMLVideoElement API the watch page and the subtitle renderer use (`currentTime`,
 * `duration`, `paused`, `ended`, `buffered`, `videoWidth/Height`, `error`, `play()`, `pause()`)
 * and fires the same media events (`loadedmetadata`, `timeupdate`, `play`, `pause`, `waiting`,
 * `playing`, `canplay`, `seeked`, `ended`, `error`), so the page's controls, CC, skip buttons
 * and progress tracking work unchanged.
 */
@Component({
  selector: 'app-native-video',
  template: '',
  styles: `
    :host {
      position: absolute;
      inset: 0;
      display: block;
      overflow: hidden;
      pointer-events: none;
    }
  `,
})
export class NativeVideo {
  private readonly player = inject(NativePlayerPort);
  private readonly doc = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** `nativeSrc(...)` from the video source */
  readonly src = input.required<string>();

  private state: NativePlaybackState = EMPTY;
  private reportedAt = 0;
  /** what we asked for (play / pause), ahead of the native confirmation */
  private wantPlay = false;
  private seekTarget: number | null = null;
  private metaSent = false;
  private waitingSent = false;
  private endedSent = false;
  private error: { code: number; message: string } | null = null;

  constructor() {
    this.installVideoApi();
    this.doc.documentElement.classList.add('native-video');
    this.player.setImmersive(true);

    const unsubscribe = this.player.subscribe(
      (s) => this.onState(s),
      (e) => this.onError(e),
    );

    effect(() => {
      const video = parseNativeSrc(this.src());
      untracked(() => {
        this.reset();
        if (!video) {
          this.onError({ code: 'source', message: 'Not a playable episode.' });
          return;
        }
        this.player.open(video, 0, false).catch((e: unknown) => this.onError({ code: 'other', message: e instanceof Error ? e.message : String(e) }));
      });
    });

    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      void this.player.close().catch(() => undefined);
      this.player.setImmersive(false);
      this.doc.documentElement.classList.remove('native-video');
    });
  }

  /* ── native → events ── */

  private onState(s: NativePlaybackState): void {
    const prev = this.state;
    this.state = s;
    this.reportedAt = performance.now();

    if (!this.metaSent && s.durationSec > 0) {
      this.metaSent = true;
      this.fire('loadedmetadata');
      this.fire('canplay');
    }
    if (!this.metaSent) return;

    // the native player confirmed (or changed by itself, e.g. the app went to the background)
    if (s.playing !== prev.playing && s.playing !== this.wantPlay) {
      this.wantPlay = s.playing;
      this.fire(s.playing ? 'play' : 'pause');
    }
    if (this.wantPlay && s.buffering && !this.waitingSent) {
      this.waitingSent = true;
      this.fire('waiting');
    } else if (!s.buffering && (this.waitingSent || (prev.buffering && this.wantPlay))) {
      this.waitingSent = false;
      this.fire('playing');
    }
    if (this.seekTarget !== null && !s.buffering && Math.abs(s.positionSec - this.seekTarget) < 2) {
      this.seekTarget = null;
      this.fire('seeked');
    }
    this.fire('timeupdate');
    if (s.bufferedSec !== prev.bufferedSec) this.fire('progress');
    if (s.ended && !this.endedSent) {
      this.endedSent = true;
      this.wantPlay = false;
      this.fire('pause');
      this.fire('ended');
    } else if (!s.ended) this.endedSent = false;
  }

  private onError(e: NativePlaybackError): void {
    const code = e.code === 'network' ? ERR_NETWORK : e.code === 'other' ? ERR_DECODE : ERR_SRC_NOT_SUPPORTED;
    this.error = { code, message: e.message };
    this.wantPlay = false;
    this.fire('error');
  }

  private reset(): void {
    this.state = EMPTY;
    this.reportedAt = performance.now();
    this.wantPlay = false;
    this.seekTarget = null;
    this.metaSent = false;
    this.waitingSent = false;
    this.endedSent = false;
    this.error = null;
  }

  private fire(type: string): void {
    this.host.dispatchEvent(new Event(type));
  }

  /* ── the HTMLVideoElement slice, on the host element ── */

  private position(): number {
    if (this.seekTarget !== null) return this.seekTarget;
    return interpolatedPosition(this.state, this.reportedAt, performance.now(), this.state.durationSec);
  }

  private installVideoApi(): void {
    const buffered = { start: () => 0, end: () => this.state.bufferedSec };
    Object.defineProperty(buffered, 'length', { get: () => (this.state.bufferedSec > 0 ? 1 : 0) });
    Object.defineProperties(this.host, {
      currentTime: {
        configurable: true,
        get: () => this.position(),
        set: (sec: number) => {
          const d = this.state.durationSec;
          const t = Math.max(0, d > 0 ? Math.min(sec, d) : sec);
          this.seekTarget = t;
          this.state = { ...this.state, positionSec: t };
          this.reportedAt = performance.now();
          this.fire('seeking');
          void this.player.seek(t).catch(() => undefined);
        },
      },
      duration: { configurable: true, get: () => (this.state.durationSec > 0 ? this.state.durationSec : NaN) },
      paused: { configurable: true, get: () => !this.wantPlay },
      ended: { configurable: true, get: () => this.state.ended },
      buffered: { configurable: true, get: () => buffered },
      videoWidth: { configurable: true, get: () => this.state.videoWidth },
      videoHeight: { configurable: true, get: () => this.state.videoHeight },
      error: { configurable: true, get: () => this.error },
      play: {
        configurable: true,
        value: (): Promise<void> => {
          if (!this.wantPlay) {
            this.wantPlay = true;
            this.fire('play');
          }
          return this.player.play().catch((e: unknown) => {
            this.wantPlay = false;
            this.fire('pause');
            throw e;
          });
        },
      },
      pause: {
        configurable: true,
        value: (): void => {
          if (this.wantPlay) {
            this.wantPlay = false;
            this.fire('pause');
          }
          void this.player.pause().catch(() => undefined);
        },
      },
    });
  }
}
