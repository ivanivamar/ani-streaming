import { Component, computed, inject, input, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogStore, type Episode } from '@catalog/application';
import { formatDuration } from '@shared/kernel';

/** Anime detail (functional version: seasons + episodes from Firestore). Designed in Step 4. */
@Component({
  selector: 'app-anime-detail-page',
  imports: [RouterLink],
  template: `
    <section class="page">
      @if (detail.isLoading()) {
        <p class="muted">Loading…</p>
      } @else if (detail.error(); as error) {
        <p class="error" role="alert">Could not load this series: {{ error.message }}</p>
      } @else if (detail.value(); as d) {
        <h1>{{ d.series.title }}</h1>
        @if (d.series.synopsis) {
          <p class="muted synopsis">{{ d.series.synopsis }}</p>
        }
        @for (group of seasons(); track group.season) {
          <h2>Season {{ group.season }}</h2>
          <ol class="episodes">
            @for (ep of group.episodes; track ep.id) {
              <li>
                <a [routerLink]="['/watch', ep.seriesId, ep.id]">
                  <span class="num">{{ ep.number }}</span>
                  <span>{{ ep.title || 'Episode ' + ep.number }}</span>
                  <span class="muted small">{{ duration(ep.durationSec) }}</span>
                </a>
              </li>
            }
          </ol>
        }
      } @else {
        <h1>Not found</h1>
        <p class="muted">There's no series "{{ seriesId() }}" in the catalogue.</p>
      }
    </section>
  `,
  styles: `
    .page {
      padding: 32px;
      max-width: 900px;
    }
    h1 {
      margin: 0 0 8px;
      font-weight: 600;
    }
    h2 {
      font-weight: 500;
      margin: 24px 0 8px;
    }
    .synopsis {
      max-width: 70ch;
      line-height: 1.5;
    }
    .episodes {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 4px;
    }
    a {
      display: grid;
      grid-template-columns: 3ch 1fr auto;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      color: inherit;
      text-decoration: none;
    }
    a:hover {
      background: rgb(255 255 255 / 0.06);
    }
    .num {
      opacity: 0.6;
      text-align: right;
    }
    .muted {
      opacity: 0.6;
    }
    .small {
      font-size: 0.85em;
    }
    .error {
      color: #ff8a80;
    }
  `,
})
export class AnimeDetailPage {
  private readonly catalog = inject(CatalogStore);

  /** `anime/:seriesId` (route input binding) */
  readonly seriesId = input.required<string>();

  protected readonly detail = resource({
    params: () => this.seriesId(),
    loader: ({ params }) => this.catalog.seriesDetail(params),
  });

  protected readonly seasons = computed(() => {
    const groups = new Map<number, Episode[]>();
    for (const ep of this.detail.value()?.episodes ?? []) {
      groups.set(ep.season, [...(groups.get(ep.season) ?? []), ep]);
    }
    return [...groups].map(([season, episodes]) => ({ season, episodes }));
  });

  protected duration(sec: number): string {
    return formatDuration(sec);
  }
}
