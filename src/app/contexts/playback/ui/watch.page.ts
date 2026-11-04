import { Location, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { seasonName, type Episode } from '@catalog/application';
import { PrefsStore } from '@identity/application';
import { LibraryStore, nextEpisode, ProgressTracker } from '@library/application';
import {
  BROWSER_NAME,
  CAPTION_LABEL,
  captionModes,
  captionTrack,
  chapterSkips,
  initialCaption,
  PlaybackStore,
  skippableChapter,
  SubtitleRendererPort,
  type CaptionMode,
  type SubtitleSession,
} from '@playback/application';
import { formatDuration } from '@shared/kernel';
import { Icon, Motion, thumbGradient, Viewport } from '@shared/ui';
import { NativeVideo } from './native-video';

const HIDE_AFTER_MS = 3000;
const SKIP_SEC = 10;

interface PopupRow {
  readonly ep: Episode;
  readonly num: string;
  readonly fraction: number;
  readonly watched: boolean;
  readonly current: boolean;
  readonly thumb: string | null;
  readonly gradient: string;
  readonly sub: string;
}

/**
 * Watch (v3, adapted): full-viewport `<video>` streaming the MP4 from Drive through the service
 * worker, v3 chrome (scrub bar, play / ±10 s, timecode, next, episodes popup with season tabs,
 * fullscreen; touch layout centres the transport), plus the **CC button** (full / signs / off)
 * and **Skip OP/ED** from the episode's chapters, or AniSkip when the chapters don't mark them.
 * Progress → `ProgressTracker` (10 s / pause / seek / leave). Subtitles are drawn by JASSUB
 * (`SubtitleRendererPort`) with the series' fonts. Before playing, the browser is asked whether
 * it decodes the episode's codec (HEVC 10-bit) on the GPU; if it can't at all, a card explains
 * what to install / switch on (Edge: HEVC Video Extensions) with a "Try anyway".
 *
 * Android app (Step 8): `<app-native-video>` replaces the `<video>`: Media3 plays under the
 * transparent WebView, everything on this page stays the same. Always full screen there.
 */
@Component({
  selector: 'app-watch-page',
  imports: [Icon, NgTemplateOutlet, NativeVideo],
  templateUrl: './watch.page.html',
  styleUrl: './watch.page.css',
  host: {
    '[class.touch]': 'touchLayout()',
    '[class.landscape]': 'vp.landscapePhone()',
    '[class.idle]': 'idle()',
    // Android app: the picture is Media3's surface under the WebView (inline: the CSS budget is full)
    '[style.background]': "native ? 'transparent' : null",
    '(document:keydown)': 'onKey($event)',
    '(document:visibilitychange)': 'flush()',
    '(document:fullscreenchange)': 'fs.set(!!doc.fullscreenElement)',
    '(pointermove)': 'wake()',
  },
})
export class WatchPage {
  private readonly playback = inject(PlaybackStore);
  private readonly subtitles = inject(SubtitleRendererPort);
  private readonly library = inject(LibraryStore);
  private readonly prefs = inject(PrefsStore);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  /**
   * Opened from another page of the app (not a reload / bookmark). Decided once: switching
   * episodes reuses this component and replaces the URL, so the entry before us stays the same.
   */
  private readonly openedFromApp = !!(this.router.currentNavigation() ?? this.router.lastSuccessfulNavigation())?.previousNavigation;
  private readonly motion = inject(Motion);
  protected readonly vp = inject(Viewport);
  protected readonly doc = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** `watch/:seriesId/:episodeId` (route input binding), `?t=` start second */
  readonly seriesId = input.required<string>();
  readonly episodeId = input.required<string>();
  readonly t = input<string | undefined>();

  /** `<video>`, or the NativeVideo element (same API) in the Android app */
  private readonly videoRef = viewChild<string, ElementRef<HTMLVideoElement>>('video', { read: ElementRef });
  private get video(): HTMLVideoElement | undefined {
    return this.videoRef()?.nativeElement;
  }

  protected readonly playable = resource({
    params: () => ({ seriesId: this.seriesId(), episodeId: this.episodeId() }),
    loader: ({ params }) => this.playback.open(params.seriesId, params.episodeId),
  });

  protected readonly time = signal(0);
  protected readonly duration = signal(0);
  protected readonly buffered = signal(0);
  protected readonly playing = signal(false);
  protected readonly waiting = signal(true);
  protected readonly fs = signal(false);
  protected readonly popupOpen = signal(false);
  protected readonly ccOpen = signal(false);
  protected readonly idle = signal(false);
  protected readonly videoError = signal<string | null>(null);
  /** user dismissed the "can't decode" card */
  protected readonly tryAnyway = signal(false);
  protected readonly decodeNoticeHidden = signal(false);
  private scrubbing = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private tracker: ProgressTracker | null = null;
  private autoSkipped = new Set<string>();

  /** Android app: native player, no fullscreen button (the player is always full screen) */
  protected readonly native = this.playback.native;
  protected readonly touchLayout = computed(() => this.vp.touch() || this.vp.mobile());
  protected readonly ep = computed(() => this.playable.value()?.episode ?? null);
  protected readonly series = computed(() => this.playable.value()?.series ?? null);
  protected readonly episodes = computed(() => this.playable.value()?.detail?.episodes ?? []);
  protected readonly next = computed(() => {
    const ep = this.ep();
    return ep ? nextEpisode(this.episodes(), ep.id) : null;
  });

  protected readonly pct = computed(() => (this.duration() > 0 ? (this.time() / this.duration()) * 100 : 0));
  protected readonly timeLabel = computed(() => `${formatDuration(this.time())} / ${formatDuration(this.duration() || this.ep()?.durationSec || 0)}`);

  protected readonly subLine = computed(() => {
    const ep = this.ep();
    const s = this.playable.value()?.detail?.seasons.find((x) => x.number === ep?.season);
    if (!ep) return '';
    const parts = [seasonName(ep.season, s?.title), `Episode ${ep.number}`];
    if (ep.title) parts.push(ep.title);
    return parts.join(' · ');
  });

  /** GPU decode check for this episode's video track (cached per codec + size). */
  protected readonly decode = resource({
    params: () => {
      const v = this.ep()?.video;
      return v ? { codec: v.codec, bitDepth: v.bitDepth, width: v.width, height: v.height, bitrate: v.bitrate } : undefined;
    },
    loader: ({ params }) => this.playback.decodeSupport(params),
  });
  protected readonly decodeReport = computed(() => (this.decode.hasValue() ? this.decode.value() : null));
  /** Don't start the video while the check runs, nor when it says "can't" (until Try anyway). */
  protected readonly decodeBlocked = computed(() => {
    if (this.tryAnyway() || this.decode.error()) return false;
    if (this.decode.isLoading()) return true;
    return this.decodeReport()?.support === 'unsupported';
  });
  protected readonly canDecode = computed(() => this.decodeReport()?.support !== 'unsupported');

  /* captions (rendered in Step 5) */
  protected readonly ccModes = computed(() => captionModes(this.ep()?.subs ?? []));
  protected readonly cc = linkedSignal<CaptionMode>(() => initialCaption(this.ep()?.subs ?? [], this.prefs.prefs().subtitles));
  protected readonly ccLabel = CAPTION_LABEL;
  protected readonly browserName = BROWSER_NAME;
  protected readonly subError = signal<string | null>(null);
  private readonly subSession = signal<SubtitleSession | null>(null);

  /* skip OP/ED: chapters right away, then chapters + AniSkip once the lookup answers */
  protected readonly skips = resource({
    params: () => this.playable.value() ?? undefined,
    loader: ({ params }) => this.playback.skips(params),
  });
  protected readonly skipRanges = computed(() =>
    this.skips.hasValue() ? this.skips.value() : chapterSkips(this.ep()?.chapters ?? []),
  );
  protected readonly skipChapter = computed(() => skippableChapter(this.skipRanges(), this.time()));

  /* episodes popup */
  protected readonly popupSeason = linkedSignal(() => this.ep()?.season ?? 1);
  protected readonly popupSeasons = computed(() => {
    const d = this.playable.value()?.detail;
    const nums = [...new Set(this.episodes().map((e) => e.season))].sort((a, b) => a - b);
    return nums.map((n) => ({ number: n, name: seasonName(n, d?.seasons.find((s) => s.number === n)?.title) }));
  });
  protected readonly popupRows = computed<PopupRow[]>(() => {
    const sid = this.seriesId();
    const cur = this.ep();
    return this.episodes()
      .filter((e) => e.season === this.popupSeason())
      .map((ep) => {
        const fraction = this.library.fractionOf(sid, ep.id);
        const watched = this.library.isEpisodeWatched(sid, ep.id);
        const current = ep.id === cur?.id;
        return {
          ep,
          num: String(ep.number).padStart(2, '0'),
          fraction,
          watched,
          current,
          thumb: this.playback.thumbUrl(ep.thumbDriveFileId),
          gradient: thumbGradient(sid, ep.number),
          sub: current ? 'Now playing' : watched ? 'Watched' : fraction > 0 ? `${Math.round(fraction * 100)}% watched` : 'Not started',
        };
      });
  });
  protected readonly popupSub = computed(() => {
    const rows = this.popupRows();
    const watched = rows.filter((r) => r.watched).length;
    const cur = this.ep();
    return this.popupSeason() === cur?.season
      ? `E${String(cur.number).padStart(2, '0')} of ${rows.length} · ${watched} watched`
      : `${rows.length} episodes · ${watched} watched`;
  });

  constructor() {
    afterNextRender(() => this.motion.playerEnter(this.host));
    // a new episode (next / popup pick) → new tracker, flush the old one
    effect(() => {
      const ep = this.ep();
      const s = this.series();
      untracked(() => {
        this.flush();
        this.tracker = ep && s ? new ProgressTracker(this.library, s.id, ep.id, s.episodeCount) : null;
        this.time.set(0);
        this.duration.set(ep?.durationSec ?? 0);
        this.videoError.set(null);
        this.waiting.set(true);
        this.autoSkipped.clear();
        this.decodeNoticeHidden.set(false);
      });
    });
    // styled subtitles (JASSUB): one renderer per <video> element, the track follows the CC choice
    effect((onCleanup) => {
      const video = this.videoRef()?.nativeElement;
      const series = this.series();
      if (!video || !series) return;
      const session = untracked(() => this.subtitles.open(video, series.fontFileIds ?? []));
      this.subSession.set(session);
      onCleanup(() => {
        session.destroy();
        this.subSession.set(null);
      });
    });
    effect(() => {
      const session = this.subSession();
      const track = captionTrack(this.ep()?.subs ?? [], this.cc());
      if (!session) return;
      untracked(() => this.subError.set(null));
      session.show(track).catch((e: unknown) => {
        console.warn('[subs]', e);
        this.subError.set("Subtitles couldn't be loaded for this episode.");
      });
    });
    // auto-skip the opening once per episode when the pref is on
    effect(() => {
      const ch = this.skipChapter();
      if (!ch || ch.kind !== 'op' || !this.prefs.prefs().autoSkipIntro) return;
      untracked(() => {
        const key = `${this.episodeId()}:${ch.startSec}`;
        if (this.autoSkipped.has(key)) return;
        this.autoSkipped.add(key);
        this.seekTo(ch.endSec);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.flush();
      clearTimeout(this.hideTimer);
      if (this.doc.fullscreenElement) void this.doc.exitFullscreen().catch(() => undefined);
    });
  }

  /* ── video events ── */

  protected onLoaded(): void {
    const v = this.video;
    const ep = this.ep();
    if (!v || !ep) return;
    this.duration.set(v.duration || ep.durationSec);
    const t = this.t();
    let start = t !== undefined && t !== '' ? Number(t) : NaN;
    if (!Number.isFinite(start)) {
      const p = this.library.progressOf(this.seriesId(), ep.id);
      start = p && this.prefs.prefs().resume && !this.library.watched(p) ? p.position : 0;
    }
    if (start > 0 && start < v.duration - 5) v.currentTime = start;
    void v.play().catch(() => this.playing.set(false));
  }

  protected onTime(): void {
    const v = this.video;
    if (!v || this.scrubbing) return;
    this.time.set(v.currentTime);
    if (v.buffered.length) this.buffered.set(v.buffered.end(v.buffered.length - 1));
    if (!v.paused) this.tracker?.tick(v.currentTime, v.duration);
  }

  protected onPlay(): void {
    this.playing.set(true);
    this.wake();
  }

  protected onPause(): void {
    this.playing.set(false);
    this.idle.set(false);
    this.flush();
  }

  protected onEnded(): void {
    this.flush();
    const next = this.next();
    if (next && this.prefs.prefs().autoplayNext) this.goEpisode(next);
  }

  protected onError(): void {
    const err = this.video?.error;
    this.videoError.set(
      err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? this.canDecode()
          ? "Drive refused the stream, or the file isn't reachable. Signing in again usually fixes it."
          : (this.decodeReport()?.advice ?? "This browser can't decode HEVC 10-bit. Use Chrome or Edge on Windows, or the Android app.")
        : err?.code === MediaError.MEDIA_ERR_NETWORK
          ? 'The connection dropped while streaming from Drive.'
          : err?.message || 'Playback failed.',
    );
  }

  /* ── controls ── */

  protected togglePlay(): void {
    const v = this.video;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }

  protected skip(delta: number): void {
    const v = this.video;
    if (v) this.seekTo(v.currentTime + delta);
  }

  protected seekTo(sec: number): void {
    const v = this.video;
    if (!v) return;
    const d = v.duration || this.duration();
    v.currentTime = Math.max(0, Math.min(sec, d - 0.5));
    this.time.set(v.currentTime);
    this.tracker?.flush(v.currentTime, d);
    this.wake();
  }

  protected scrubStart(e: PointerEvent): void {
    const bar = e.currentTarget as HTMLElement;
    bar.setPointerCapture(e.pointerId);
    this.scrubbing = true;
    this.scrubMove(e);
  }

  protected scrubMove(e: PointerEvent): void {
    if (!this.scrubbing) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    this.time.set(f * (this.duration() || 0));
  }

  protected scrubEnd(): void {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    this.seekTo(this.time());
  }

  protected scrubKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      this.skip(e.key === 'ArrowLeft' ? -5 : 5);
    }
  }

  protected toggleFs(): void {
    if (this.native) return;
    if (this.doc.fullscreenElement) void this.doc.exitFullscreen();
    else void this.host.requestFullscreen?.().catch(() => undefined);
  }

  protected togglePopup(): void {
    this.ccOpen.set(false);
    this.popupOpen.update((v) => !v);
    if (this.popupOpen()) this.popupSeason.set(this.ep()?.season ?? 1);
  }

  protected setCc(mode: CaptionMode): void {
    this.cc.set(mode);
    this.ccOpen.set(false);
    // remember the choice as the default for the next episodes
    if (mode !== this.prefs.prefs().subtitles) void this.prefs.update({ subtitles: mode }).catch(() => undefined);
  }

  protected skipNow(): void {
    const ch = this.skipChapter();
    if (ch) this.seekTo(ch.endSec);
  }

  protected goEpisode(ep: Episode): void {
    this.popupOpen.set(false);
    this.flush();
    void this.router.navigate(['/watch', this.seriesId(), ep.id], { replaceUrl: true });
  }

  protected leave(): void {
    this.flush();
    this.motion.playerLeave();
    // Back = browser back to wherever the player was opened from (anime page, Home, Library…), so
    // the player doesn't stay in the history. Opened directly (bookmark, reload): replace it with
    // the series page instead of pushing one more entry.
    if (this.openedFromApp) this.location.back();
    else void this.router.navigate(['/anime', this.seriesId()], { replaceUrl: true });
  }

  protected wake(): void {
    this.idle.set(false);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.playing() && !this.popupOpen() && !this.ccOpen()) this.idle.set(true);
    }, HIDE_AFTER_MS);
  }

  protected flush(): void {
    const v = this.video;
    if (v && v.duration) this.tracker?.flush(v.currentTime, v.duration);
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
    const k = e.key.toLowerCase();
    const handled = (() => {
      switch (k) {
        case ' ':
        case 'k':
          if (t?.tagName === 'BUTTON' && k === ' ') return false;
          this.togglePlay();
          return true;
        case 'arrowleft':
        case 'j':
          this.skip(-SKIP_SEC);
          return true;
        case 'arrowright':
        case 'l':
          this.skip(SKIP_SEC);
          return true;
        case 'f':
          this.toggleFs();
          return true;
        case 'n': {
          const n = this.next();
          if (n) this.goEpisode(n);
          return !!n;
        }
        case 'c': {
          const modes = this.ccModes();
          this.setCc(modes[(modes.indexOf(this.cc()) + 1) % modes.length]);
          return true;
        }
        case 's':
          this.skipNow();
          return !!this.skipChapter();
        case 'escape':
          if (this.popupOpen() || this.ccOpen()) {
            this.popupOpen.set(false);
            this.ccOpen.set(false);
            return true;
          }
          return false;
        default:
          return false;
      }
    })();
    if (handled) {
      e.preventDefault();
      this.wake();
    }
  }
}
