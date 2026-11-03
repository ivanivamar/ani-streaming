/**
 * Step 2.5 — AniList metadata. Season 1 is matched by title (exact match after normalising
 * case, accents, spaces and punctuation, against English/romaji/native titles and synonyms);
 * later seasons follow the SEQUEL relations. No confident match → `null` and a report line;
 * `overrides/{seriesId}` (`anilistId`, `seasons.sNN.anilistId`) fixes it on the next run.
 */
import type { SeriesFormat, SeriesStatus } from '@ani/contracts';

const ENDPOINT = 'https://graphql.anilist.co';

export interface Media {
  id: number;
  format: SeriesFormat | 'MUSIC' | null;
  status: SeriesStatus | null;
  episodes: number | null;
  seasonYear: number | null;
  startDate: { year: number | null } | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[];
  description: string | null;
  genres: string[];
  coverImage: { extraLarge: string | null; large: string | null; color: string | null } | null;
  bannerImage: string | null;
  relations: { edges: Array<{ relationType: string; node: { id: number; type: string; format: string | null } }> } | null;
}

const FIELDS = `id format status episodes seasonYear startDate { year }
  title { romaji english native } synonyms description(asHtml: false) genres
  coverImage { extraLarge large color } bannerImage
  relations { edges { relationType node { id type format } } }`;

const SEARCH = `query ($search: String) { Page(perPage: 10) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) { ${FIELDS} } } }`;
const BY_ID = `query ($id: Int) { Media(id: $id, type: ANIME) { ${FIELDS} } }`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    // AniList allows ~30–90 requests/min; stay well under it.
    const wait = lastCall + 2100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    }).catch((e: Error) => new Response(null, { status: 599, statusText: e.message }));
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`AniList HTTP ${res.status}`);
      const retry = Number(res.headers.get('retry-after') ?? 0);
      await sleep((retry > 0 ? retry : 5 * attempt) * 1000);
      continue;
    }
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string; status?: number }> };
    if (body.errors?.length) {
      if (body.errors.some((e) => e.status === 404)) return { Media: null } as T;
      throw new Error(`AniList: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (!body.data) throw new Error(`AniList HTTP ${res.status}`);
    return body.data;
  }
}

const cache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function getMedia(id: number): Promise<Media | null> {
  return cached(`id:${id}`, async () => (await gql<{ Media: Media | null }>(BY_ID, { id })).Media);
}

export function searchMedia(search: string): Promise<Media[]> {
  return cached(`q:${search.toLowerCase()}`, async () => (await gql<{ Page: { media: Media[] } }>(SEARCH, { search })).Page.media);
}

export const normTitle = (s: string): string =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const titlesOf = (m: Media): string[] =>
  [m.title.english, m.title.romaji, m.title.native, ...m.synonyms].filter((t): t is string => !!t);

const SERIES_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA', 'OVA', 'MOVIE', 'SPECIAL']);
const SEASON_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);

export type MatchResult =
  | { ok: true; media: Media; note: string }
  | { ok: false; reason: string; candidates: string[] };

export function describeMedia(m: Media): string {
  return `${m.title.english ?? m.title.romaji} (${m.format ?? '?'}, ${m.seasonYear ?? m.startDate?.year ?? '?'}, id ${m.id})`;
}

/** Season 1 entry for a parsed series title. */
export async function matchSeries(title: string): Promise<MatchResult> {
  const results = (await searchMedia(title)).filter((m) => m.format && SERIES_FORMATS.has(m.format));
  const want = normTitle(title);
  const exact = results.filter((m) => titlesOf(m).some((t) => normTitle(t) === want));
  // Prefer TV entries: a title often matches its TV series plus a movie or recap.
  const tv = exact.filter((m) => m.format && SEASON_FORMATS.has(m.format));
  const pool = tv.length ? tv : exact;
  const candidates = results.slice(0, 5).map(describeMedia);
  if (pool.length === 1) return { ok: true, media: pool[0]!, note: `AniList: ${describeMedia(pool[0]!)}` };
  if (pool.length > 1) {
    // Remakes / sequels sharing a title: the earliest one is season 1 only when it is a prequel of the rest.
    const sorted = [...pool].sort((a, b) => (a.seasonYear ?? a.startDate?.year ?? 9999) - (b.seasonYear ?? b.startDate?.year ?? 9999));
    const first = sorted[0]!;
    const sequels = new Set(first.relations?.edges.filter((e) => e.relationType === 'SEQUEL').map((e) => e.node.id) ?? []);
    if (sorted.slice(1).every((m) => sequels.has(m.id))) {
      return { ok: true, media: first, note: `AniList: ${describeMedia(first)} (earliest of ${pool.length} with this title)` };
    }
    return { ok: false, reason: `${pool.length} AniList entries have this exact title`, candidates: pool.map(describeMedia) };
  }
  return { ok: false, reason: 'no AniList entry with this exact title', candidates };
}

/** Follows SEQUEL relations (TV/ONA only) `season - 1` times from the season 1 entry. */
export async function seasonMedia(first: Media, season: number): Promise<{ media: Media | null; note: string }> {
  let cur: Media | null = first;
  for (let s = 2; s <= season && cur; s++) {
    const next = cur.relations?.edges.find(
      (e) => e.relationType === 'SEQUEL' && e.node.type === 'ANIME' && e.node.format && SEASON_FORMATS.has(e.node.format),
    );
    if (!next) return { media: null, note: `AniList: no TV sequel after ${describeMedia(cur)} for season ${s}` };
    cur = await getMedia(next.node.id);
  }
  return cur ? { media: cur, note: season > 1 ? `AniList season ${season}: ${describeMedia(cur)}` : '' } : { media: null, note: 'AniList entry not found' };
}

export function cleanSynopsis(s: string | null): string | null {
  if (!s) return null;
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
