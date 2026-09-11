import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import Hls from 'hls.js';
import { Subject, combineLatest, from, map, merge, switchMap, tap } from 'rxjs';

import { CatalogService } from '../../core/services/catalog.service';
import { AnimeSeries } from '../../core/models/anime.model';

type LoadState = 'loading' | 'ready' | 'error';

interface LoadResult {
  series: AnimeSeries;
  seasonIndex: number;
  playbackUrl: string;
}

/** mm:ss. */
function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** "01".."99", but leaves decimals (allanime specials like 12.5) alone rather than mangling them. */
function padEpisode(episode: number): string {
  return episode < 10 ? `0${episode}` : String(episode);
}

/**
 * Watch screen — README.md "Screens → 5. Watch (`/watch/:entryId/:ep`)".
 * Full-viewport, no topbar (own layout, not AppShell). Real playback:
 * `/api/sources` resolves a URL, which is only reachable through
 * `/api/proxy` (Referer/Origin re-added — see CatalogService), fed into
 * hls.js for `.m3u8` sources or set directly as `<video src>` otherwise
 * (README.md "Frontend playback: hls.js (native HLS is Safari-only)").
 */
@Component({
  selector: 'app-watch-page',
  standalone: true,
  templateUrl: './watch-page.html',
  styleUrl: './watch-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WatchPage {
  private readonly catalog = inject(CatalogService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Bound from route params (app.config.ts `withComponentInputBinding`). */
  readonly entryId = input.required<string>();
  readonly ep = input.required<string>();

  readonly episode = computed(() => Number(this.ep()) || 1);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');
  private hls: Hls | null = null;

  private readonly entryId$ = toObservable(this.entryId);
  private readonly episode$ = toObservable(this.episode);
  private readonly retry$ = new Subject<void>();

  private readonly _loadState = signal<LoadState>('loading');
  readonly loadState = this._loadState.asReadonly();

  private readonly result = toSignal(
    merge(
      combineLatest([this.entryId$, this.episode$]),
      this.retry$.pipe(map((): [string, number] => [this.entryId(), this.episode()])),
    ).pipe(
      tap(() => this._loadState.set('loading')),
      switchMap(([entryId, episode]) => from(this.load(entryId, episode))),
      tap((result) => this._loadState.set(result ? 'ready' : 'error')),
    ),
    { initialValue: null },
  );

  readonly series = computed(() => this.result()?.series ?? null);
  readonly seasonIndex = computed(() => this.result()?.seasonIndex ?? 0);
  readonly season = computed(() => this.series()?.seasons[this.seasonIndex()] ?? null);
  private readonly playbackUrl = computed(() => this.result()?.playbackUrl ?? null);

  private readonly nextEpisodeNumber = computed<number | null>(() => {
    const season = this.season();
    if (!season) return null;
    const index = season.episodes.indexOf(this.episode());
    return index !== -1 && index < season.episodes.length - 1 ? season.episodes[index + 1] : null;
  });
  readonly hasNextEpisode = computed(() => this.nextEpisodeNumber() !== null);

  readonly episodeRows = computed(() => {
    const season = this.season();
    if (!season) return [];
    return season.episodes.map((episode) => ({
      episode,
      padded: padEpisode(episode),
      current: episode === this.episode(),
    }));
  });

  private readonly _t = signal(0);
  readonly t = this._t.asReadonly();
  private readonly _duration = signal(0);
  readonly durationSeconds = this._duration.asReadonly();
  private readonly _playing = signal(false);
  readonly playing = this._playing.asReadonly();
  private readonly _fullscreen = signal(false);
  readonly fullscreen = this._fullscreen.asReadonly();
  private readonly _drawerOpen = signal(false);
  readonly drawerOpen = this._drawerOpen.asReadonly();

  readonly progressPercent = computed(() => (this.durationSeconds() ? (this.t() / this.durationSeconds()) * 100 : 0));
  readonly timeLabel = computed(() => `${formatTime(this.t())} / ${formatTime(this.durationSeconds())}`);

  constructor() {
    // Attach (or re-attach, on a new episode/entry) the resolved source to
    // the <video> element whenever either becomes available.
    effect(() => {
      const url = this.playbackUrl();
      const video = this.videoRef()?.nativeElement;
      if (!url || !video) return;
      this.attachSource(video, url);
    });

    // Progress rules (README.md "State model"): every ~10s while playing...
    const saveTimer = setInterval(() => {
      if (this._playing()) this.saveProgress();
    }, 10_000);

    // ...plus on route leave...
    this.destroyRef.onDestroy(() => {
      clearInterval(saveTimer);
      this.saveProgress();
      this.hls?.destroy();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    });

    // ...and on visibilitychange.
    const onVisibilityChange = () => {
      if (document.hidden) this.saveProgress();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Fullscreen API is the source of truth (it can also be exited via Esc,
    // not just our button) — README.md: "swaps the icon."
    const onFullscreenChange = () => this._fullscreen.set(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFullscreenChange);
  }

  private async load(entryId: string, episode: number): Promise<LoadResult | null> {
    const entry = await this.catalog.getEntry(entryId);
    if (!entry) return null;
    try {
      const playbackUrl = await this.catalog.resolvePlaybackUrl(entryId, episode);
      return { ...entry, playbackUrl };
    } catch {
      return null;
    }
  }

  private attachSource(video: HTMLVideoElement, url: string): void {
    this.hls?.destroy();
    this.hls = null;

    if (url.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls();
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) this._loadState.set('error');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      this.hls = hls;
    } else {
      video.src = url;
    }
  }

  onVideoPlay(): void {
    this._playing.set(true);
  }

  onVideoPause(): void {
    this._playing.set(false);
    this.saveProgress();
  }

  onVideoTimeUpdate(video: HTMLVideoElement): void {
    this._t.set(video.currentTime);
  }

  onVideoLoadedMetadata(video: HTMLVideoElement): void {
    this._duration.set(video.duration || 0);
    const series = this.series();
    if (series && video.duration) {
      const fraction = this.catalog.episodeProgress(series.id, this.seasonIndex(), this.episode());
      video.currentTime = fraction * video.duration;
    }
  }

  onVideoSeeked(): void {
    this.saveProgress();
  }

  onVideoError(): void {
    this._loadState.set('error');
  }

  togglePlay(): void {
    const video = this.videoRef()?.nativeElement;
    if (!video || this.loadState() !== 'ready') return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  skip(deltaSeconds: number): void {
    const video = this.videoRef()?.nativeElement;
    if (!video || !video.duration) return;
    video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + deltaSeconds));
    this.saveProgress();
  }

  onScrubClick(event: MouseEvent): void {
    const video = this.videoRef()?.nativeElement;
    if (!video || !video.duration) return;
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    video.currentTime = fraction * video.duration;
    this.saveProgress();
  }

  nextEpisode(): void {
    const season = this.season();
    const next = this.nextEpisodeNumber();
    if (!season || next === null) return;
    this.videoRef()?.nativeElement.pause();
    this.saveProgress();
    this.router.navigate(['/watch', season.entryId, next]);
  }

  openEpisode(episode: number): void {
    const season = this.season();
    if (!season) return;
    this.videoRef()?.nativeElement.pause();
    this.saveProgress();
    this._drawerOpen.set(false);
    this.router.navigate(['/watch', season.entryId, episode]);
  }

  toggleDrawer(): void {
    this._drawerOpen.update((open) => !open);
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  }

  retry(): void {
    this.retry$.next();
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  goBack(): void {
    this.videoRef()?.nativeElement.pause();
    this.saveProgress();
    const season = this.season();
    if (season) {
      this.router.navigate(['/anime', season.entryId]);
    } else {
      this.router.navigate(['/']);
    }
  }

  private saveProgress(): void {
    const series = this.series();
    const video = this.videoRef()?.nativeElement;
    if (!series || !video || !video.duration) return;
    this.catalog.setEpisodeProgress(series.id, this.seasonIndex(), this.episode(), video.currentTime / video.duration);
  }
}
