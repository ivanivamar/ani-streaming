/** Sub or dub — mirrors the ani-cli `--dub` flag (see data-sources.md). */
export type AudioMode = 'Sub' | 'Dub';

/**
 * One allanime search entry. ani-cli/allanime lists every season of a show
 * as its own independent entry (data-sources.md → "Seasons as a grouping"),
 * so a "season" here IS a distinct `entryId`, not a sub-resource.
 *
 * `episodes` is the actual list of episode numbers from `GET /api/episodes`
 * — ascending, but not necessarily consecutive integers (allanime encodes
 * specials as decimals like 12.5), so it's a list rather than a count.
 */
export interface AnimeSeason {
  entryId: string;
  seasonLabel: string;
  episodes: number[];
}

/**
 * A franchise grouped client-side from sibling allanime entries (via
 * AniList `relations` in production — see README.md "Metadata"). Cover
 * color stands in for the AniList cover image until that's wired up.
 */
export interface AnimeSeries {
  id: string;
  title: string;
  color: string;
  year: string;
  status: string;
  genres: string[];
  synopsis: string;
  seasons: AnimeSeason[];
}

/** View model for a poster tile (home favourites grid, search results). */
export interface AnimeCard {
  seriesId: string;
  seasonIndex: number;
  entryId: string;
  title: string;
  color: string;
  meta: string;
  episodesLabel: string;
  hasProgress: boolean;
  progressPercent: number;
}

/** A recently-run search, rendered as a pill on the home screen. */
export interface RecentSearch {
  term: string;
}

/** Watch progress, keyed `${seriesId}|${seasonIndex}|${episode}` → 0..1. */
export type ProgressMap = Record<string, number>;

/** An episode counts as watched once progress reaches this fraction. */
export const WATCHED_THRESHOLD = 0.98;
