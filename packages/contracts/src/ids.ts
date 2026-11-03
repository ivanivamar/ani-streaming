/**
 * Document ids shared by the app and the importer.
 *
 * - `seriesId`: URL-safe slug of the series title, e.g. `attack-on-titan`.
 * - `seasonId`: `s01`, `s02`, …
 * - `episodeId`: `s01e01`, `s01e12`, … (zero-padded to two digits, more if needed).
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type SeriesId = Brand<string, 'SeriesId'>;
export type SeasonId = Brand<string, 'SeasonId'>;
export type EpisodeId = Brand<string, 'EpisodeId'>;

export interface EpisodeRef {
  readonly season: number;
  readonly episode: number;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}`);
  }
}

/** Slug used as `series/{seriesId}`: lowercase ASCII words joined by `-`. */
export function toSeriesId(title: string): SeriesId {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    throw new RangeError(`Cannot build a series id from "${title}"`);
  }
  return slug as SeriesId;
}

export function toSeasonId(season: number): SeasonId {
  assertPositiveInt(season, 'season');
  return `s${pad(season)}` as SeasonId;
}

export function toEpisodeId(ref: EpisodeRef): EpisodeId {
  assertPositiveInt(ref.season, 'season');
  assertPositiveInt(ref.episode, 'episode');
  return `s${pad(ref.season)}e${pad(ref.episode)}` as EpisodeId;
}

const EPISODE_ID = /^s(\d{2,})e(\d{2,})$/;

/** Parses `s01e05` back into `{ season: 1, episode: 5 }`; `null` when malformed. */
export function parseEpisodeId(id: string): EpisodeRef | null {
  const match = EPISODE_ID.exec(id);
  if (!match) return null;
  return { season: Number(match[1]), episode: Number(match[2]) };
}

/** `users/{uid}/progress/{seriesId}_{episodeId}` */
export function toProgressId(seriesId: SeriesId, episodeId: EpisodeId): string {
  return `${seriesId}_${episodeId}`;
}
