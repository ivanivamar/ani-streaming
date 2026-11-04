import type { EpisodeDoc, EpisodeId, SeasonDoc, SeasonId, SeriesDoc, SeriesId } from '@ani/contracts';

/**
 * Catalogue entities: the Firestore document shapes from `@ani/contracts` plus their ids.
 * Timestamps are milliseconds (the infrastructure mappers convert Firestore Timestamps).
 */
export type Series = SeriesDoc & { readonly id: SeriesId };
export type Season = SeasonDoc & { readonly id: SeasonId };
export type Episode = EpisodeDoc & { readonly id: EpisodeId; readonly seriesId: SeriesId };

export interface SeriesDetail {
  readonly series: Series;
  readonly seasons: readonly Season[];
  readonly episodes: readonly Episode[];
}

/** Episode order: season, then number (ids are zero-padded, but numbers are the truth). */
export const byEpisodeOrder = (a: Pick<Episode, 'season' | 'number'>, b: Pick<Episode, 'season' | 'number'>) =>
  a.season - b.season || a.number - b.number;

/** Home order: most recently added first. */
export const byRecentlyAdded = (a: Pick<Series, 'addedAt'>, b: Pick<Series, 'addedAt'>) => b.addedAt - a.addedAt;
