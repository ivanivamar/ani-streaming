import type { SeriesStatus } from '@ani/contracts';
import type { Series } from './models';

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface SearchFilters {
  /** genre name, or null for any */
  readonly genre: string | null;
  readonly status: SeriesStatus | null;
}

export const NO_FILTERS: SearchFilters = { genre: null, status: null };

/**
 * Client-side catalogue search (the whole `series` collection is small): every query word must
 * prefix a word of the title, romaji/native title, an alias or a search token. Ranked: title
 * starts with the query, then title contains it, then the rest; ties by title.
 */
export function searchSeries(all: readonly Series[], query: string, filters: SearchFilters = NO_FILTERS): Series[] {
  const q = normalize(query);
  const words = q ? q.split(' ') : [];
  const hits: { s: Series; rank: number }[] = [];
  for (const s of all) {
    if (filters.genre && !s.genres.includes(filters.genre)) continue;
    if (filters.status && s.status !== filters.status) continue;
    if (!words.length) {
      hits.push({ s, rank: 3 });
      continue;
    }
    const title = normalize(s.title);
    const hay = [title, normalize(s.titleRomaji ?? ''), normalize(s.titleNative ?? ''), ...s.aliases.map(normalize), ...(s.searchTokens ?? [])]
      .join(' ')
      .split(' ');
    if (!words.every((w) => hay.some((h) => h.startsWith(w)))) continue;
    hits.push({ s, rank: title.startsWith(q) ? 0 : title.includes(q) ? 1 : 2 });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.s.title.localeCompare(b.s.title)).map((h) => h.s);
}

/** Every genre in the catalogue, alphabetical. */
export function genresOf(all: readonly Series[]): string[] {
  return [...new Set(all.flatMap((s) => s.genres))].sort((a, b) => a.localeCompare(b));
}

export const STATUS_NAME: Record<SeriesStatus, string> = {
  RELEASING: 'Airing',
  FINISHED: 'Finished',
  NOT_YET_RELEASED: 'Not yet aired',
  HIATUS: 'On hiatus',
  CANCELLED: 'Cancelled',
};

/** Seasons label: "Season 1" or the season's own title. */
export function seasonName(number: number, title?: string | null): string {
  return title && !/^season \d+$/i.test(title) ? title : `Season ${number}`;
}
