import { Injectable } from '@angular/core';
import { SchedulePort, type Airing, type Premiere, type PremiereKind } from '../domain';

const ENDPOINT = 'https://graphql.anilist.co';
const MAX_PAGES = 8;
const DAY = 86_400_000;

const AIRING = `
query ($from: Int, $to: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      id airingAt episode
      media { id isAdult countryOfOrigin popularity title { english romaji userPreferred } coverImage { medium } }
    }
  }
}`;

const PREMIERES = `
query ($from: FuzzyDateInt, $to: FuzzyDateInt) {
  Page(perPage: 16) {
    media(type: ANIME, isAdult: false, countryOfOrigin: "JP", startDate_greater: $from, startDate_lesser: $to, sort: [POPULARITY_DESC]) {
      id format title { english romaji userPreferred } coverImage { medium }
      startDate { year month day }
      relations { edges { relationType } }
    }
  }
}`;

interface MediaTitle {
  english: string | null;
  romaji: string | null;
  userPreferred: string | null;
}
const titleOf = (t: MediaTitle) => t.english || t.userPreferred || t.romaji || 'Untitled';

const fuzzy = (ms: number) => {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

/** AniList GraphQL (public, CORS-enabled, no key; ~90 requests/min). Results cached per range. */
@Injectable()
export class AniListSchedule extends SchedulePort {
  private readonly cache = new Map<string, Promise<unknown>>();

  airing(fromMs: number, toMs: number): Promise<Airing[]> {
    return this.cached(`a2:${fromMs}:${toMs}`, async () => {
      const out: Airing[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await this.query<{
          Page: {
            pageInfo: { hasNextPage: boolean };
            airingSchedules: {
              id: number;
              airingAt: number;
              episode: number;
              media: { id: number; isAdult: boolean; countryOfOrigin: string; popularity: number | null; title: MediaTitle; coverImage: { medium: string | null } };
            }[];
          };
        }>(AIRING, { from: Math.floor(fromMs / 1000) - 1, to: Math.floor(toMs / 1000), page });
        for (const s of data.Page.airingSchedules) {
          if (s.media.isAdult || s.media.countryOfOrigin !== 'JP') continue;
          out.push({
            id: s.id,
            anilistId: s.media.id,
            title: titleOf(s.media.title),
            cover: s.media.coverImage.medium,
            episode: s.episode,
            airingAt: s.airingAt * 1000,
            popularity: s.media.popularity ?? 0,
          });
        }
        if (!data.Page.pageInfo.hasNextPage) break;
      }
      return out;
    });
  }

  premieres(nowMs: number): Promise<Premiere[]> {
    const from = fuzzy(nowMs - 14 * DAY);
    const to = fuzzy(nowMs + 42 * DAY);
    return this.cached(`p:${from}`, async () => {
      const data = await this.query<{
        Page: {
          media: {
            id: number;
            format: string | null;
            title: MediaTitle;
            coverImage: { medium: string | null };
            startDate: { year: number | null; month: number | null; day: number | null };
            relations: { edges: { relationType: string }[] };
          }[];
        };
      }>(PREMIERES, { from, to });
      return data.Page.media.map((m): Premiere => {
        const sequel = m.relations.edges.some((e) => e.relationType === 'PREQUEL');
        const kind: PremiereKind = m.format === 'MOVIE' ? 'Movie' : m.format === 'SPECIAL' || m.format === 'OVA' ? 'Special' : sequel ? 'New season' : 'Premiere';
        const { year, month, day } = m.startDate;
        return {
          anilistId: m.id,
          title: titleOf(m.title),
          cover: m.coverImage.medium,
          kind,
          startsAt: year && month && day ? new Date(year, month - 1, day).getTime() : null,
        };
      });
    });
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = this.cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load().catch((e) => {
        this.cache.delete(key);
        throw e;
      });
      this.cache.set(key, p);
    }
    return p;
  }

  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`AniList ${res.status}${res.status === 429 ? ' (rate limited, try again in a minute)' : ''}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (!body.data) throw new Error(body.errors?.[0]?.message ?? 'AniList returned no data');
    return body.data;
  }
}
