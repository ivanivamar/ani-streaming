import { Component, computed, inject, input, resource } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CatalogStore, genresOf, searchSeries, STATUS_NAME, type Series } from '@catalog/application';
import { LibraryStore } from '@library/application';
import type { SeriesId } from '@shared/kernel';
import { ContextMenu, Icon, Pill, PosterCard, Stagger } from '@shared/ui';

type StatusKey = keyof typeof STATUS_NAME;

/**
 * Search (adapted v3): the header bar is the input (`?q=`), filters are Genre and Status pills
 * (`?genre=`, `?status=`) over the Firestore catalogue — no Sub/Dub, quality or CLI line.
 * Empty query lists the whole catalogue. Heart toggles a favourite.
 */
@Component({
  selector: 'app-search-page',
  imports: [RouterLink, Icon, Pill, PosterCard, Stagger],
  template: `
    <div class="filters">
      <div class="group">
        <div class="eyebrow">Status</div>
        <div class="pills">
          <button type="button" appPill [on]="!status()" (click)="setFilter('status', null)">Any</button>
          @for (s of statuses(); track s) {
            <button type="button" appPill [on]="status() === s" (click)="setFilter('status', s)">{{ statusName[s] }}</button>
          }
        </div>
      </div>
      @if (genres().length) {
        <div class="group">
          <div class="eyebrow">Genre</div>
          <div class="pills">
            <button type="button" appPill [on]="!genre()" (click)="setFilter('genre', null)">Any</button>
            @for (g of genres(); track g) {
              <button type="button" appPill [on]="genre() === g" (click)="setFilter('genre', g)">{{ g }}</button>
            }
          </div>
        </div>
      }
    </div>

    <div class="res-head">
      <h1 class="res-title">{{ q() ? 'Results' : 'All titles' }}</h1>
      <span class="count">{{ results().length }} {{ results().length === 1 ? 'entry' : 'entries' }}</span>
    </div>

    @if (all.error(); as error) {
      <div class="error-card" role="alert">
        <h3>Catalogue unavailable</h3>
        <p>The catalogue couldn't be read from Firestore. Check your connection; if it keeps failing, sign out and in again.</p>
        <div class="mono log">{{ error.message }}</div>
        <div class="row">
          <button type="button" class="btn btn-primary btn-sm" (click)="all.reload()">Retry</button>
          <a class="btn btn-outline btn-sm" routerLink="/">Back to home</a>
        </div>
      </div>
    } @else if (all.isLoading()) {
      <div class="poster-grid">
        @for (i of [1, 2, 3, 4, 5, 6, 7, 8]; track i) {
          <div class="skeleton sk"></div>
        }
      </div>
    } @else if (results().length) {
      <div class="poster-grid" appStagger>
        @for (s of results(); track s.id) {
          <app-poster-card
            [title]="s.title"
            [meta]="meta(s)"
            [src]="s.posterUrl"
            [seed]="s.id"
            [link]="['/anime', s.id]"
            [progress]="progress(s)"
            (contextmenu)="menu($event, s)"
          >
            <span cardBottom class="chip">{{ s.episodeCount }} ep</span>
            <button
              cardTopRight
              type="button"
              class="fav"
              [class.on]="library.isFavourite(s.id)"
              [attr.aria-pressed]="library.isFavourite(s.id)"
              title="Favourite"
              aria-label="Favourite"
              (click)="toggleFav($event, s.id)"
            >
              <app-icon name="heart" [size]="15" [stroke]="2" [filled]="library.isFavourite(s.id)" />
            </button>
          </app-poster-card>
        }
      </div>
    } @else {
      <div class="empty">
        No titles matched.
        <div class="hint">{{ genre() || status() ? 'try fewer filters' : 'try a shorter query' }}</div>
      </div>
    }
  `,
  styles: `
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 22px 32px;
      padding-bottom: 20px;
      margin-bottom: 30px;
      border-bottom: 1px solid var(--line-2);
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: 9px;
      min-width: 0;
    }
    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .res-head {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 18px;
    }
    .res-title {
      margin: 0;
      font-size: 15px;
      font-weight: 500;
      color: var(--text-2b);
    }
    .sk {
      aspect-ratio: 2 / 3;
    }
    .fav {
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: var(--chip-dark);
      color: #fff;
    }
    .fav:hover {
      background: var(--menu-selected);
    }
    .fav.on {
      color: var(--accent);
    }
    .log {
      font-size: 11.5px;
      color: #6c6c74;
      background: var(--code-bg);
      border: 1px solid var(--line-2);
      border-radius: 9px;
      padding: 11px 13px;
      margin-bottom: 18px;
      overflow-x: auto;
      white-space: pre;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
  `,
})
export class SearchPage {
  private readonly catalog = inject(CatalogStore);
  protected readonly library = inject(LibraryStore);
  private readonly router = inject(Router);
  private readonly menus = inject(ContextMenu);

  /** query params (route input binding) */
  readonly q = input<string | undefined>();
  readonly genre = input<string | undefined>();
  readonly status = input<StatusKey | undefined>();

  protected readonly statusName = STATUS_NAME;
  protected readonly all = resource({ loader: () => this.catalog.allSeries() });
  protected readonly genres = computed(() => genresOf(this.all.value() ?? []));
  protected readonly statuses = computed(() => {
    const present = new Set((this.all.value() ?? []).map((s) => s.status).filter((s): s is StatusKey => !!s));
    return (Object.keys(STATUS_NAME) as StatusKey[]).filter((s) => present.has(s));
  });

  protected readonly results = computed(() =>
    searchSeries(this.all.value() ?? [], this.q() ?? '', { genre: this.genre() ?? null, status: this.status() ?? null }),
  );

  protected meta(s: Series): string {
    return [s.year, s.status ? STATUS_NAME[s.status] : null].filter(Boolean).join(' · ');
  }

  /** played fraction of the most recent episode (bar only while unfinished) */
  protected progress(s: Series): number | null {
    const last = this.library.latestPerSeries().find((p) => p.seriesId === s.id);
    if (!last || this.library.watched(last)) return null;
    return this.library.fractionOf(s.id, last.episodeId) || null;
  }

  protected setFilter(key: 'genre' | 'status', value: string | null): void {
    void this.router.navigate([], { queryParams: { [key]: value }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected toggleFav(e: MouseEvent, id: SeriesId): void {
    e.preventDefault();
    e.stopPropagation();
    this.library.toggleFavourite(id);
  }

  protected menu(e: MouseEvent, s: Series): void {
    const fav = this.library.isFavourite(s.id);
    this.menus.open(e, s.title, [
      { label: 'Open', icon: 'go', run: () => this.router.navigate(['/anime', s.id]) },
      { label: fav ? 'Remove from favourites' : 'Add to favourites', icon: 'heart', run: () => this.library.toggleFavourite(s.id) },
    ]);
  }
}
