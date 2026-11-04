import { Location } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, resource } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CatalogStore, seasonName, STATUS_NAME, type Episode, type SeriesDetail } from '@catalog/application';
import { LibraryStore } from '@library/application';
import { PlaybackStore } from '@playback/application';
import { formatDuration } from '@shared/kernel';
import { ContextMenu, Icon, Motion, Pill, Poster, Stagger, thumbGradient } from '@shared/ui';

interface Tile {
  readonly ep: Episode;
  readonly num: string;
  readonly fraction: number;
  readonly watched: boolean;
  readonly next: boolean;
  readonly thumb: string | null;
  readonly gradient: string;
  readonly duration: string;
  readonly label: string;
}

/**
 * Anime detail (v3): back, hero (poster, title, year • status, genres, synopsis, Play/Resume,
 * favourite), season pills, watched strip (one segment per episode) and the episode grid with
 * real thumbnails and durations from Firestore/Drive. Up next = accent ring + badge.
 */
@Component({
  selector: 'app-anime-detail-page',
  imports: [RouterLink, Icon, Pill, Poster, Stagger],
  templateUrl: './anime-detail.page.html',
  styleUrl: './anime-detail.page.css',
})
export class AnimeDetailPage {
  private readonly catalog = inject(CatalogStore);
  protected readonly library = inject(LibraryStore);
  private readonly playback = inject(PlaybackStore);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly menus = inject(ContextMenu);
  private readonly motion = inject(Motion);

  /** `anime/:seriesId` (route input binding) */
  readonly seriesId = input.required<string>();

  protected readonly detail = resource({
    params: () => this.seriesId(),
    loader: ({ params }) => this.catalog.seriesDetail(params),
  });

  protected readonly statusName = STATUS_NAME;

  protected readonly resume = computed(() => {
    const d = this.detail.value();
    return d ? this.library.resume(d.series.id, d.episodes) : null;
  });

  /** season numbers present (from episodes, so a season without a doc still shows) */
  protected readonly seasons = computed(() => {
    const d = this.detail.value();
    if (!d) return [];
    const nums = [...new Set(d.episodes.map((e) => e.season))].sort((a, b) => a - b);
    return nums.map((n) => ({ number: n, name: seasonName(n, d.seasons.find((s) => s.number === n)?.title) }));
  });

  protected readonly season = linkedSignal(() => this.resume()?.episode.season ?? this.seasons()[0]?.number ?? 1);

  protected readonly tiles = computed<Tile[]>(() => {
    const d = this.detail.value();
    if (!d) return [];
    const next = this.resume();
    return d.episodes
      .filter((e) => e.season === this.season())
      .map((ep) => {
        const fraction = this.library.fractionOf(d.series.id, ep.id);
        return {
          ep,
          num: String(ep.number).padStart(2, '0'),
          fraction,
          watched: this.library.isEpisodeWatched(d.series.id, ep.id),
          next: !!next && !next.finished && next.episode.id === ep.id,
          thumb: this.playback.thumbUrl(ep.thumbDriveFileId),
          gradient: thumbGradient(d.series.id, ep.number),
          duration: ep.durationSec ? formatDuration(ep.durationSec) : '',
          label: ep.title ? `Episode ${ep.number} · ${ep.title}` : `Episode ${ep.number}`,
        };
      });
  });

  protected readonly watchedCount = computed(() => this.tiles().filter((t) => t.watched).length);

  protected readonly playLabel = computed(() => {
    const r = this.resume();
    if (!r) return 'Play';
    if (r.finished) return 'Watch again';
    return r.fresh || r.position === 0 ? `Play E${r.episode.number}` : `Resume E${r.episode.number}`;
  });

  protected back(): void {
    // came from inside the app → go back (keeps the previous page's state); deep link → Home
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) this.location.back();
    else void this.router.navigateByUrl('/');
  }

  protected launch(el: HTMLElement, gradient: string): void {
    this.motion.rememberLaunch(el, gradient);
  }

  protected watchLink(d: SeriesDetail, ep: Episode): string[] {
    return ['/watch', d.series.id, ep.id];
  }

  protected pct(f: number): string {
    return `${Math.round(f * 100)}%`;
  }

  protected segColor(t: Tile): string {
    return t.watched ? 'var(--accent)' : t.fraction > 0 ? 'var(--accent-partial)' : 'rgba(255,255,255,0.1)';
  }

  protected tileMenu(e: MouseEvent, d: SeriesDetail, t: Tile): void {
    const sid = d.series.id;
    this.menus.open(e, `${d.series.title} · E${t.ep.number}`, [
      { label: t.fraction > 0 && !t.watched ? 'Resume' : 'Play', icon: 'play', run: () => this.router.navigate(this.watchLink(d, t.ep)) },
      {
        label: 'Start over',
        icon: 'restart',
        run: () => {
          this.library.resetEpisode(sid, t.ep.id);
          void this.router.navigate(this.watchLink(d, t.ep), { queryParams: { t: 0 } });
        },
      },
      t.watched
        ? { label: 'Mark as unwatched', icon: 'remove', separator: true, run: () => this.library.resetEpisode(sid, t.ep.id) }
        : { label: 'Mark as watched', icon: 'check', separator: true, run: () => this.library.markWatched(sid, [t.ep], d.series.episodeCount) },
      {
        label: 'Mark previous as watched',
        icon: 'check',
        run: () =>
          this.library.markWatched(
            sid,
            d.episodes.filter((x) => x.season < t.ep.season || (x.season === t.ep.season && x.number <= t.ep.number)),
            d.series.episodeCount,
          ),
      },
    ]);
  }
}
