import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, from, map, merge, switchMap, tap } from 'rxjs';

import { CatalogService } from '../../core/services/catalog.service';

type LoadState = 'loading' | 'ready' | 'error';

/** mm:ss (episodes are well under an hour — see the fake DURATION_SECONDS below). */
function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Watch screen — README.md "Screens → 5. Watch (`/watch/:entryId/:ep`)".
 * Full-viewport, no topbar (own layout, not AppShell). There is no real
 * stream yet (README.md "Assets": posters/thumbnails are placeholders, and
 * the backend contract for `/api/sources` + `/api/proxy` isn't wired to the
 * frontend in this pass) — playback is a timed simulation over a fake fixed
 * duration so the scrub bar, timecode and progress-write rules are all
 * exercisable now, with a clear seam (`_t`/`_playing`) to swap in a real
 * <video> + hls.js later.
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

  private readonly entryId$ = toObservable(this.entryId);
  private readonly retry$ = new Subject<void>();

  private readonly _loadState = signal<LoadState>('loading');
  readonly loadState = this._loadState.asReadonly();

  private readonly entry = toSignal(
    merge(this.entryId$, this.retry$.pipe(map(() => this.entryId()))).pipe(
      tap(() => this._loadState.set('loading')),
      switchMap((id) => from(this.catalog.getEntry(id))),
      tap((result) => this._loadState.set(result ? 'ready' : 'error')),
    ),
    { initialValue: null },
  );

  readonly series = computed(() => this.entry()?.series ?? null);
  readonly seasonIndex = computed(() => this.entry()?.seasonIndex ?? 0);
  readonly season = computed(() => this.series()?.seasons[this.seasonIndex()] ?? null);

  readonly hasNextEpisode = computed(() => {
    const season = this.season();
    return !!season && this.episode() < season.episodeCount;
  });

  readonly episodeRows = computed(() => {
    const series = this.series();
    const season = this.season();
    if (!series || !season) return [];
    const seasonIndex = this.seasonIndex();
    return Array.from({ length: season.episodeCount }, (_, i) => {
      const episode = i + 1;
      return {
        episode,
        padded: String(episode).padStart(2, '0'),
        current: episode === this.episode(),
      };
    });
  });

  /** Fake fixed runtime — no real stream to read a duration from yet. */
  private readonly DURATION_SECONDS = 24 * 60;
  readonly durationSeconds = this.DURATION_SECONDS;

  private readonly _t = signal(0);
  readonly t = this._t.asReadonly();
  private readonly _playing = signal(false);
  readonly playing = this._playing.asReadonly();
  private readonly _fullscreen = signal(false);
  readonly fullscreen = this._fullscreen.asReadonly();
  private readonly _drawerOpen = signal(false);
  readonly drawerOpen = this._drawerOpen.asReadonly();

  readonly progressPercent = computed(() => (this.t() / this.DURATION_SECONDS) * 100);
  readonly timeLabel = computed(() => `${formatTime(this.t())} / ${formatTime(this.DURATION_SECONDS)}`);

  constructor() {
    // Seek to stored progress whenever the loaded entry or the :ep param
    // changes (README.md "Interactions & behavior": "Episode click opens
    // the watch route seeked to stored progress"). Starts paused every
    // time — matches "Back from the player returns... paused" symmetry
    // and avoids a surprise autoplay on navigation.
    effect(() => {
      const series = this.series();
      const episode = this.episode();
      if (!series) return;
      const fraction = this.catalog.episodeProgress(series.id, this.seasonIndex(), episode);
      this._t.set(Math.round(fraction * this.DURATION_SECONDS));
      this._playing.set(false);
    });

    // Fake playback clock — the seam that becomes a real <video> timeupdate
    // listener once /api/sources + hls.js are wired in.
    effect((onCleanup) => {
      if (!this._playing()) return;
      const id = setInterval(() => {
        const next = this._t() + 1;
        if (next >= this.DURATION_SECONDS) {
          this._t.set(this.DURATION_SECONDS);
          this._playing.set(false);
        } else {
          this._t.set(next);
        }
      }, 1000);
      onCleanup(() => clearInterval(id));
    });

    // Progress rules (README.md "State model"): every ~10s while playing...
    const saveTimer = setInterval(() => {
      if (this._playing()) this.saveProgress();
    }, 10_000);

    // ...plus on route leave...
    this.destroyRef.onDestroy(() => {
      clearInterval(saveTimer);
      this.saveProgress();
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

  togglePlay(): void {
    if (this.loadState() !== 'ready') return;
    const next = !this._playing();
    this._playing.set(next);
    if (!next) this.saveProgress();
  }

  skip(deltaSeconds: number): void {
    this._t.update((t) => Math.min(this.DURATION_SECONDS, Math.max(0, t + deltaSeconds)));
    this.saveProgress();
  }

  seekToFraction(fraction: number): void {
    this._t.set(Math.round(Math.min(1, Math.max(0, fraction)) * this.DURATION_SECONDS));
    this.saveProgress();
  }

  onScrubClick(event: MouseEvent): void {
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    this.seekToFraction((event.clientX - rect.left) / rect.width);
  }

  nextEpisode(): void {
    const season = this.season();
    if (!season || !this.hasNextEpisode()) return;
    this.saveProgress();
    this.router.navigate(['/watch', season.entryId, this.episode() + 1]);
  }

  openEpisode(episode: number): void {
    const season = this.season();
    if (!season) return;
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
    this._playing.set(false);
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
    if (!series) return;
    this.catalog.setEpisodeProgress(series.id, this.seasonIndex(), this.episode(), this.t() / this.DURATION_SECONDS);
  }
}
