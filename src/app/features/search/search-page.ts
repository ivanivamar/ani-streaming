import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, catchError, debounceTime, distinctUntilChanged, from, map, merge, of, switchMap, tap } from 'rxjs';

import { AppShell } from '../../shared/ui/app-shell/app-shell';
import { PosterCard } from '../../shared/ui/poster-card/poster-card';
import { CatalogService } from '../../core/services/catalog.service';
import { AnimeCard, AudioMode } from '../../core/models/anime.model';

const QUALITY_OPTIONS = ['best', '1080', '720', '480', '360', 'worst'] as const;
type Quality = (typeof QUALITY_OPTIONS)[number];
const AUDIO_OPTIONS: AudioMode[] = ['Sub', 'Dub'];

interface SearchState {
  results: AnimeCard[];
  error: boolean;
}

/**
 * Search screen — README.md "Screens → 3. Search (`/search`)". The topbar
 * search field becomes the live input here (AppShell/Topbar `searchActive`).
 * Query/audio/quality all live in the URL so the screen stays shareable and
 * back-button friendly (README.md "State model").
 */
@Component({
  selector: 'app-search-page',
  standalone: true,
  imports: [AppShell, PosterCard],
  templateUrl: './search-page.html',
  styleUrl: './search-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);

  readonly qualityOptions = QUALITY_OPTIONS;
  readonly audioOptions = AUDIO_OPTIONS;

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly query = computed(() => this.queryParams().get('q') ?? '');
  readonly audio = computed<AudioMode>(() => (this.queryParams().get('audio') === 'Dub' ? 'Dub' : 'Sub'));
  readonly quality = computed<Quality>(() => {
    const q = this.queryParams().get('quality');
    return (QUALITY_OPTIONS as readonly string[]).includes(q ?? '') ? (q as Quality) : 'best';
  });

  readonly cliLine = computed(
    () => `$ ani-cli "${this.query()}"${this.audio() === 'Dub' ? ' --dub' : ''} -q ${this.quality()}`,
  );

  private readonly query$ = toObservable(this.query);
  /** Re-runs the current query without changing it (the "Retry" button). */
  private readonly retry$ = new Subject<void>();

  private readonly _loading = signal(true);
  readonly loading = this._loading.asReadonly();

  private readonly searchState = toSignal(
    merge(this.query$.pipe(distinctUntilChanged()), this.retry$.pipe(map(() => this.query()))).pipe(
      tap(() => this._loading.set(true)),
      debounceTime(150),
      switchMap((q) =>
        from(this.catalog.search(q)).pipe(
          map((results): SearchState => ({ results, error: false })),
          catchError(() => of<SearchState>({ results: [], error: true })),
        ),
      ),
      tap(() => this._loading.set(false)),
    ),
    { initialValue: { results: [], error: false } },
  );

  readonly results = computed(() => this.searchState().results);
  readonly hasError = computed(() => this.searchState().error);
  readonly noResults = computed(() => !this.loading() && !this.hasError() && this.results().length === 0);
  readonly resultCountLabel = computed(() => (this.hasError() ? '—' : `${this.results().length} entries`));

  constructor() {
    // Keep the shared audio preference (also read by Home's cards) in sync
    // with this screen's filter pills.
    effect(() => this.catalog.setAudioMode(this.audio()));
  }

  setQuery(value: string): void {
    this.updateParams({ q: value || null });
  }

  setAudio(mode: AudioMode): void {
    this.updateParams({ audio: mode === 'Sub' ? null : mode });
  }

  setQuality(value: Quality): void {
    this.updateParams({ quality: value === 'best' ? null : value });
  }

  retry(): void {
    this.retry$.next();
  }

  openCard(card: AnimeCard): void {
    this.router.navigate(['/anime', card.entryId]);
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  private updateParams(partial: Record<string, string | null>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: partial,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
