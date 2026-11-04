import { Component, computed, ElementRef, inject, resource, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CatalogStore, type Episode, type Series, type SeriesDetail } from '@catalog/application';
import { LibraryStore } from '@library/application';
import { formatAgo, formatMinutesLeft } from '@shared/kernel';
import { ContextMenu, Icon, Motion, Poster, PosterCard, posterBackground, posterGradient, Stagger, Viewport, type MenuItem } from '@shared/ui';

const ADDED_LIMIT = 12;
const HISTORY_LIMIT = 12;
const NEW_FOR_MS = 7 * 86_400_000;

interface ProgressCard {
  readonly series: Series;
  readonly episode: Episode;
  readonly label: string;
  readonly fraction: number;
  readonly sub: string;
  readonly ago: string;
  readonly finished: boolean;
  readonly detail: SeriesDetail;
}

interface AddedCard {
  readonly series: Series;
  readonly episode: Episode;
  readonly label: string;
  readonly isNew: boolean;
  readonly meta: string;
}

const epTag = (s: Series, e: Pick<Episode, 'season' | 'number'>) => `S${e.season} · E${e.number}`;

/**
 * Home (v3): Continue watching (hero + carousel), Recently added (newest episode per series,
 * by `addedAt`), Recently watched. Cards open the player or the series; right-click / ⋯ opens
 * the context menu.
 */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink, Icon, Poster, PosterCard, Stagger],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
})
export class HomePage {
  private readonly catalog = inject(CatalogStore);
  protected readonly library = inject(LibraryStore);
  private readonly menus = inject(ContextMenu);
  private readonly router = inject(Router);
  private readonly motion = inject(Motion);
  protected readonly vp = inject(Viewport);

  private readonly carousel = viewChild<ElementRef<HTMLElement>>('carousel');

  protected readonly series = resource({ loader: () => this.catalog.allSeries() });

  /** Series whose details Home needs: recently played + most recently updated. */
  private readonly neededIds = computed(() => {
    const list = this.series.value() ?? [];
    const played = this.library.latestPerSeries().map((p) => p.seriesId as string);
    const fresh = [...list]
      .sort((a, b) => Math.max(b.addedAt, b.updatedAt) - Math.max(a.addedAt, a.updatedAt))
      .slice(0, ADDED_LIMIT)
      .map((s) => s.id as string);
    return [...new Set([...played, ...fresh])].sort();
  });

  protected readonly details = resource({
    params: () => ({ ids: this.neededIds(), ready: this.series.hasValue() }),
    loader: ({ params }) => (params.ready ? this.catalog.detailsOf(params.ids) : Promise.resolve(new Map<string, SeriesDetail>())),
  });

  protected readonly loading = computed(() => this.series.isLoading() || (this.details.isLoading() && !this.details.hasValue()));

  private readonly played = computed<ProgressCard[]>(() => {
    const details = this.details.value();
    if (!details) return [];
    const now = Date.now();
    const out: ProgressCard[] = [];
    for (const last of this.library.latestPerSeries()) {
      const d = details.get(last.seriesId);
      if (!d) continue;
      const target = this.library.resume(d.series.id, d.episodes);
      if (!target) continue;
      const lastEp = d.episodes.find((e) => e.id === last.episodeId);
      const ep = target.finished ? (lastEp ?? target.episode) : target.episode;
      const duration = this.library.progressOf(d.series.id, ep.id)?.duration ?? ep.durationSec;
      out.push({
        series: d.series,
        episode: ep,
        label: epTag(d.series, ep),
        fraction: target.fraction,
        sub: target.finished
          ? 'Finished'
          : `Season ${ep.season} · Episode ${ep.number} · ${target.position > 0 ? formatMinutesLeft(target.position, duration) : 'up next'}`,
        ago: formatAgo(last.updatedAt, now),
        finished: target.finished,
        detail: d,
      });
    }
    return out;
  });

  protected readonly inProgress = computed(() => this.played().filter((c) => !c.finished));
  protected readonly hero = computed(() => this.inProgress()[0] ?? null);
  protected readonly carouselItems = computed(() => this.inProgress().slice(1));
  protected readonly history = computed(() => this.played().slice(0, HISTORY_LIMIT));

  protected readonly added = computed<AddedCard[]>(() => {
    const details = this.details.value();
    if (!details) return [];
    const now = Date.now();
    const out: AddedCard[] = [];
    for (const d of details.values()) {
      const latest = d.episodes.reduce<Episode | null>((a, e) => (!a || e.addedAt > a.addedAt ? e : a), null);
      if (latest) {
        out.push({ series: d.series, episode: latest, label: epTag(d.series, latest), isNew: now - latest.addedAt < NEW_FOR_MS, meta: `Added ${formatAgo(latest.addedAt, now)}` });
      }
    }
    return out.sort((a, b) => b.episode.addedAt - a.episode.addedAt).slice(0, ADDED_LIMIT);
  });

  protected watchLink(c: { series: Series; episode: Episode }): string[] {
    return ['/watch', c.series.id, c.episode.id];
  }

  protected heroBg(c: ProgressCard): string {
    return posterBackground(c.series.bannerUrl ?? c.series.posterUrl, c.series.id);
  }

  protected launchHero(el: HTMLElement, c: ProgressCard): void {
    this.motion.rememberLaunch(el, posterGradient(c.series.id));
  }

  protected scrollCarousel(dir: 1 | -1): void {
    const el = this.carousel()?.nativeElement;
    el?.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.8), behavior: 'smooth' });
  }

  protected progressMenu(e: MouseEvent, c: ProgressCard): void {
    const sid = c.series.id;
    const items: MenuItem[] = [
      { label: c.finished ? 'Watch again' : 'Resume', icon: 'play', run: () => this.router.navigate(this.watchLink(c)) },
      { label: 'Start over', icon: 'restart', run: () => this.startOver(c) },
      { label: 'Go to anime', icon: 'go', run: () => this.router.navigate(['/anime', sid]) },
      {
        label: 'Mark as watched',
        icon: 'check',
        separator: true,
        run: () => this.library.markWatched(sid, [c.episode], c.series.episodeCount),
      },
      { label: 'Remove from history', icon: 'remove', danger: true, run: () => this.library.removeFromHistory(sid) },
    ];
    this.menus.open(e, `${c.series.title} · E${c.episode.number}`, items);
  }

  protected addedMenu(e: MouseEvent, c: AddedCard): void {
    this.menus.open(e, `${c.series.title} · E${c.episode.number}`, [
      { label: 'Play', icon: 'play', run: () => this.router.navigate(this.watchLink(c)) },
      { label: 'Go to anime', icon: 'go', run: () => this.router.navigate(['/anime', c.series.id]) },
      { label: 'Mark as watched', icon: 'check', separator: true, run: () => this.library.markWatched(c.series.id, [c.episode], c.series.episodeCount) },
    ]);
  }

  private startOver(c: ProgressCard): void {
    this.library.resetEpisode(c.series.id, c.episode.id);
    void this.router.navigate(this.watchLink(c), { queryParams: { t: 0 } });
  }
}
