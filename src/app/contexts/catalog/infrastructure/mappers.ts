import type { EpisodeDoc, EpisodeId, SeasonDoc, SeasonId, SeriesDoc, SeriesId } from '@ani/contracts';
import type { Episode, Season, Series } from '../domain';

/** Anything with `toMillis()` — Firestore's Timestamp, without importing the SDK here. */
interface TimestampLike {
  toMillis(): number;
}
const isTimestamp = (v: unknown): v is TimestampLike =>
  !!v && typeof v === 'object' && typeof (v as TimestampLike).toMillis === 'function';

/**
 * Firestore data → contract shape: Timestamps become milliseconds (the importer stores
 * `addedAt`/`updatedAt` as Timestamps, see tools/import/src/catalog.ts).
 */
export function fromFirestore<T>(data: unknown): T {
  const conv = (x: unknown): unknown => {
    if (isTimestamp(x)) return x.toMillis();
    if (Array.isArray(x)) return x.map(conv);
    if (x && typeof x === 'object') {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, y]) => [k, conv(y)]));
    }
    return x;
  };
  return conv(data) as T;
}

export const toSeries = (id: string, data: unknown): Series => ({ ...fromFirestore<SeriesDoc>(data), id: id as SeriesId });

export const toSeason = (id: string, data: unknown): Season => ({ ...fromFirestore<SeasonDoc>(data), id: id as SeasonId });

export const toEpisode = (seriesId: string, id: string, data: unknown): Episode => ({
  ...fromFirestore<EpisodeDoc>(data),
  id: id as EpisodeId,
  seriesId: seriesId as SeriesId,
});
