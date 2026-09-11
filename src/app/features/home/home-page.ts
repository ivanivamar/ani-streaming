import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppShell } from '../../shared/ui/app-shell/app-shell';
import { PosterCard } from '../../shared/ui/poster-card/poster-card';
import { CatalogService } from '../../core/services/catalog.service';
import { AnimeCard } from '../../core/models/anime.model';

/**
 * Home screen — README.md "Screens → 2. Home (`/`)". Shows the favourites
 * grid and recently searched pills.
 */
@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [AppShell, PosterCard],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  private readonly catalog = inject(CatalogService);
  private readonly router = inject(Router);

  readonly favourites = this.catalog.favourites;
  readonly favouriteCount = this.catalog.favouriteCount;
  readonly recentSearches = this.catalog.recentSearches;

  openCard(card: AnimeCard): void {
    this.router.navigate(['/anime', card.entryId]);
  }

  openRecent(term: string): void {
    this.router.navigate(['/search'], { queryParams: { q: term } });
  }
}
