import { Component, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogStore } from '@catalog/application';

/**
 * Home (functional version for the Step 3 check: the catalogue loads from Firestore). The v3
 * layout with continue watching / recently added / recently watched comes in Step 4.
 */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  template: `
    <section class="page">
      <h1>Home</h1>
      @if (series.isLoading()) {
        <p class="muted">Loading the catalogue…</p>
      } @else if (series.error(); as error) {
        <p class="error" role="alert">Could not load the catalogue: {{ error.message }}</p>
      } @else {
        @let list = series.value() ?? [];
        @if (list.length === 0) {
          <p class="muted">Nothing imported yet. Run the importer on the PC.</p>
        }
        <ul class="grid">
          @for (s of list; track s.id) {
            <li>
              <a [routerLink]="['/anime', s.id]">
                @if (s.posterUrl) {
                  <img [src]="s.posterUrl" alt="" loading="lazy" width="230" height="345" />
                }
                <span class="title">{{ s.title }}</span>
                <span class="muted small">{{ s.episodeCount }} episode{{ s.episodeCount === 1 ? '' : 's' }}</span>
              </a>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .page {
      padding: 32px;
    }
    h1 {
      margin: 0 0 16px;
      font-weight: 600;
    }
    .grid {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 20px;
    }
    a {
      display: grid;
      gap: 6px;
      color: inherit;
      text-decoration: none;
    }
    img {
      width: 100%;
      height: auto;
      aspect-ratio: 2 / 3;
      object-fit: cover;
      border-radius: 12px;
    }
    .title {
      font-weight: 500;
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
export class HomePage {
  private readonly catalog = inject(CatalogStore);
  protected readonly series = resource({ loader: () => this.catalog.allSeries() });
}
