import { Injectable } from '@angular/core';
import { SkipTimesPort, type ExternalSkip, type SkipTimesQuery } from '../domain';

const ANILIST = 'https://graphql.anilist.co';
const ANISKIP = 'https://api.aniskip.com/v2/skip-times';
const TYPES = ['op', 'ed', 'mixed-op', 'mixed-ed'] as const;
const TIMEOUT_MS = 8000;
/** AniList → MAL ids never change; remembered across sessions (per browser). */
const MAL_KEY = 'ani.malIds.v1';

interface AniSkipResponse {
  found: boolean;
  results?: { interval: { startTime: number; endTime: number }; skipType: string; episodeLength: number }[];
}

/**
 * AniSkip (https://api.aniskip.com, public, CORS-enabled, no key). It's keyed by MyAnimeList
 * id, so the season's AniList id is turned into a MAL id first (AniList `Media.idMal`).
 * Results are cached for the session; a 404 means "no times submitted" → [].
 */
@Injectable()
export class AniSkipClient extends SkipTimesPort {
  private readonly malIds = new Map<number, Promise<number | null>>(Object.entries(readMalCache()).map(([k, v]) => [Number(k), Promise.resolve(v)]));
  private readonly results = new Map<string, Promise<ExternalSkip[]>>();

  find(q: SkipTimesQuery): Promise<ExternalSkip[]> {
    const key = `${q.anilistId}:${q.episode}:${Math.round(q.durationSec)}`;
    let p = this.results.get(key);
    if (!p) {
      p = this.lookup(q);
      this.results.set(key, p);
      p.catch(() => this.results.delete(key));
    }
    return p;
  }

  private async lookup(q: SkipTimesQuery): Promise<ExternalSkip[]> {
    const mal = await this.malId(q.anilistId);
    if (!mal) return [];
    const params = new URLSearchParams();
    for (const t of TYPES) params.append('types[]', t);
    params.set('episodeLength', String(Math.round(q.durationSec)));
    const res = await fetch(`${ANISKIP}/${mal}/${q.episode}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`AniSkip ${res.status}`);
    const body = (await res.json()) as AniSkipResponse;
    if (!body.found || !body.results) return [];
    return body.results
      .filter((r) => (TYPES as readonly string[]).includes(r.skipType))
      .map((r) => ({
        kind: r.skipType as ExternalSkip['kind'],
        startSec: r.interval.startTime,
        endSec: r.interval.endTime,
        episodeLengthSec: r.episodeLength || 0,
      }));
  }

  private malId(anilistId: number): Promise<number | null> {
    let p = this.malIds.get(anilistId);
    if (!p) {
      p = (async () => {
        const res = await fetch(ANILIST, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query: 'query ($id: Int) { Media(id: $id) { idMal } }', variables: { id: anilistId } }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`AniList ${res.status}`);
        const body = (await res.json()) as { data?: { Media?: { idMal: number | null } | null } };
        const mal = body.data?.Media?.idMal ?? null;
        writeMalCache(anilistId, mal);
        return mal;
      })();
      this.malIds.set(anilistId, p);
      p.catch(() => this.malIds.delete(anilistId));
    }
    return p;
  }
}

function readMalCache(): Record<string, number | null> {
  try {
    const raw = localStorage.getItem(MAL_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number | null>) : {};
  } catch {
    return {};
  }
}

function writeMalCache(anilistId: number, mal: number | null): void {
  try {
    localStorage.setItem(MAL_KEY, JSON.stringify({ ...readMalCache(), [anilistId]: mal }));
  } catch {
    /* private mode / storage full: the session cache still works */
  }
}
