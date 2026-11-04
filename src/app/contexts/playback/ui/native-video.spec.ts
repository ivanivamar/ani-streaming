import { Component, ElementRef, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NativePlayerPort, type NativePlaybackError, type NativePlaybackState } from '@playback/application';
import { NativeVideo } from './native-video';

class FakePlayer extends NativePlayerPort {
  readonly available = true;
  onState: ((s: NativePlaybackState) => void) | null = null;
  onError: ((e: NativePlaybackError) => void) | null = null;
  open = vi.fn(async () => undefined);
  play = vi.fn(async () => undefined);
  pause = vi.fn(async () => undefined);
  seek = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  setImmersive = vi.fn();
  subscribe(onState: (s: NativePlaybackState) => void, onError: (e: NativePlaybackError) => void) {
    this.onState = onState;
    this.onError = onError;
    return () => undefined;
  }
}

const state = (p: Partial<NativePlaybackState> = {}): NativePlaybackState => ({
  positionSec: 0,
  durationSec: 1440,
  bufferedSec: 0,
  playing: false,
  buffering: false,
  ended: false,
  videoWidth: 1920,
  videoHeight: 1080,
  ...p,
});

@Component({
  imports: [NativeVideo],
  template: `<app-native-video #v [src]="src" />`,
})
class Host {
  src = 'ani-native:file1?size=300';
  readonly v = viewChild.required('v', { read: ElementRef });
}

type VideoLike = HTMLVideoElement;

function setup() {
  const player = new FakePlayer();
  TestBed.configureTestingModule({ providers: [{ provide: NativePlayerPort, useValue: player }] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const el = fixture.componentInstance.v().nativeElement as VideoLike;
  const events: string[] = [];
  for (const t of ['loadedmetadata', 'canplay', 'timeupdate', 'play', 'pause', 'waiting', 'playing', 'seeking', 'seeked', 'ended', 'error']) {
    el.addEventListener(t, () => events.push(t));
  }
  return { player, fixture, el, events };
}

describe('NativeVideo', () => {
  it('opens the Drive file in the native player and goes see-through + immersive', () => {
    const { player, fixture } = setup();
    expect(player.open).toHaveBeenCalledWith({ driveFileId: 'file1', sizeBytes: 300, mimeType: 'video/mp4' }, 0, false);
    expect(player.setImmersive).toHaveBeenCalledWith(true);
    expect(document.documentElement.classList.contains('native-video')).toBe(true);
    fixture.destroy();
    expect(player.close).toHaveBeenCalled();
    expect(player.setImmersive).toHaveBeenLastCalledWith(false);
    expect(document.documentElement.classList.contains('native-video')).toBe(false);
  });

  it('acts like a <video>: metadata, play / pause, seeking, ended', () => {
    const { player, el, events } = setup();
    expect(el.paused).toBe(true);
    expect(Number.isNaN(el.duration)).toBe(true);

    player.onState!(state());
    expect(events.slice(0, 3)).toEqual(['loadedmetadata', 'canplay', 'timeupdate']);
    expect(el.duration).toBe(1440);
    expect(el.videoWidth).toBe(1920);

    void el.play();
    expect(player.play).toHaveBeenCalled();
    expect(el.paused).toBe(false);
    expect(events).toContain('play');

    // native confirms: no second "play"
    events.length = 0;
    player.onState!(state({ playing: true, positionSec: 5 }));
    expect(events).not.toContain('play');
    expect(el.currentTime).toBeGreaterThanOrEqual(5);

    el.currentTime = 600;
    expect(player.seek).toHaveBeenCalledWith(600);
    expect(el.currentTime).toBe(600);
    player.onState!(state({ playing: true, positionSec: 600.2, buffering: true }));
    expect(events).toContain('waiting');
    player.onState!(state({ playing: true, positionSec: 600.3 }));
    expect(events).toContain('seeked');
    expect(events).toContain('playing');

    // the app went to the background: native paused by itself
    events.length = 0;
    player.onState!(state({ playing: false, positionSec: 610 }));
    expect(events).toContain('pause');
    expect(el.paused).toBe(true);

    events.length = 0;
    player.onState!(state({ playing: false, positionSec: 1440, ended: true }));
    expect(events).toContain('ended');
    expect(el.ended).toBe(true);
  });

  it('reports errors with MediaError-style codes', () => {
    const { player, el, events } = setup();
    player.onError!({ code: 'network', message: 'gone' });
    expect(events).toContain('error');
    expect(el.error).toEqual({ code: 2, message: 'gone' });
    player.onError!({ code: 'auth', message: 'refused' });
    expect(el.error?.code).toBe(4);
  });
});
