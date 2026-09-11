import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { from, switchMap, tap } from 'rxjs';

import { AppShell } from '../../shared/ui/app-shell/app-shell';
import { CatalogService } from '../../core/services/catalog.service';
import { WATCHED_THRESHOLD } from '../../core/models/anime.model';

interface EpisodeRow {
  episode: number;
  padded: string;
  percent: number;
  hasProgress: boolean;
  watched: boolean;
}

/**
 * Anime detail screen — README.md "Screens → 4. Anime detail (`/anime/:entryId`)".
 * The route's entryId is one season's allanime entry (what a search result
 * or a home favourite card links to); this screen loads the whole series
 * (via AniList `relations` in production — README.md "Metadata") and lets
 * you switch seasons with pills *without* leaving the page or changing the
 * route (README.md "Interactions & behavior").
 */
@Component({
  selector: 'app-anime-detail-page',
  standalone: true,
  imports: [AppShell],
  templateUrl: './anime-detail-page.html',
  styleUrl: './anime-detail-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnimeDetailPage {
  private readonly catalog = inject(CatalogService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Bound from the `:entryId` route param (app.config.ts `withComponentInputBinding`). */
  readonly entryId = input.required<string>();

  private readonly entryId$ = toObservable(this.entryId);

  private readonly _loading = signal(true);
  readonly loading = this._loading.asReadonly();

  /** `null` while loading, or once loaded, if entryId matches nothing in the catalog. */
  private readonly entry = toSignal(
    this.entryId$.pipe(
      tap(() => this._loading.set(true)),
      switchMap((id) => from(this.catalog.getEntry(id))),
      tap(() => this._loading.set(false)),
    ),
    { initialValue: null },
  );

  readonly series = computed(() => this.entry()?.series ?? null);
  readonly notFound = computed(() => !this.loading() && !this.series());

  private readonly _selectedSeasonIndex = signal(0);
  readonly selectedSeasonIndex = this._selectedSeasonIndex.asReadonly();

  readonly season = computed(() => this.series()?.seasons[this.selectedSeasonIndex()] ?? null);

  readonly isFavourite = computed(() => {
    const series = this.series();
    return !!series && this.catalog.favouriteIds().includes(series.id);
  });

  readonly resumeEpisode = computed(() => {
    const series = this.series();
    return series ? this.catalog.resumeEpisode(series.id, this.selectedSeasonIndex()) : null;
  });

  readonly playLabel = computed(() => (this.resumeEpisode() ? `Resume E${this.resumeEpisode()}` : 'Play E1'));

  readonly episodeRows = computed<EpisodeRow[]>(() => {
    const series = this.series();
    const season = this.season();
    if (!series || !season) return [];
    const seasonIndex = this.selectedSeasonIndex();
    return Array.from({ length: season.episodeCount }, (_, i) => {
      const episode = i + 1;
      const fraction = this.catalog.episodeProgress(series.id, seasonIndex, episode);
      return {
        episode,
        padded: String(episode).padStart(2, '0'),
        percent: Math.round(fraction * 100),
        hasProgress: fraction > 0 && fraction < WATCHED_THRESHOLD,
        watched: fraction >= WATCHED_THRESHOLD,
      };
    });
  });

  constructor() {
    // Re-sync the selected season tab whenever the *route* entry changes
    // (e.g. a different search result) — but not on local tab clicks,
    // which only touch `_selectedSeasonIndex` directly and never re-run
    // this pipeline (README.md: season pills "switch... without leaving
    // the page").
    effect(() => {
      const loaded = this.entry();
      if (loaded) this._selectedSeasonIndex.set(loaded.seasonIndex);
    });
  }

  selectSeason(index: number): void {
    this._selectedSeasonIndex.set(index);
  }

  toggleFavourite(): void {
    const series = this.series();
    if (series) this.catalog.toggleFavourite(series.id);
  }

  play(): void {
    const season = this.season();
    if (!season) return;
    this.router.navigate(['/watch', season.entryId, this.resumeEpisode() ?? 1]);
  }

  openEpisode(episode: number): void {
    const season = this.season();
    if (!season) return;
    this.router.navigate(['/watch', season.entryId, episode]);
  }

  goBack(): void {
    this.location.back();
  }
}
