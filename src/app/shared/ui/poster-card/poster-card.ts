import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AnimeCard } from '../../../core/models/anime.model';

/**
 * A single poster tile in the favourites/search grids (README.md "Home"
 * and "Search" screens share this exact card). Purely presentational —
 * the parent screen decides what "open" means (anime detail once it
 * exists).
 */
@Component({
  selector: 'app-poster-card',
  standalone: true,
  templateUrl: './poster-card.html',
  styleUrl: './poster-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PosterCard {
  readonly card = input.required<AnimeCard>();
  readonly opened = output<AnimeCard>();
}
