/** One episode airing (AniList airing schedule). Times in ms. */
export interface Airing {
  readonly id: number;
  readonly anilistId: number;
  readonly title: string;
  readonly cover: string | null;
  readonly episode: number;
  readonly airingAt: number;
  /** AniList popularity (users with it on their list) — used to trim "Everything" */
  readonly popularity: number;
}

/** How many shows "Everything" lists before "Show all". */
export const POPULAR_LIMIT = 30;

/**
 * "Everything" without the long tail: the `limit` most popular *shows* of the week (all their
 * episodes), plus anything `keep` says must stay (in the library, notify on).
 */
export function popularOnly<T extends Pick<Airing, 'anilistId' | 'popularity'>>(
  items: readonly T[],
  limit: number,
  keep: (item: T) => boolean,
): { shown: T[]; hiddenShows: number } {
  const best = new Map<number, number>();
  for (const it of items) best.set(it.anilistId, Math.max(best.get(it.anilistId) ?? 0, it.popularity));
  const top = new Set([...best].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id));
  const keptIds = new Set(items.filter(keep).map((i) => i.anilistId));
  const shown = items.filter((i) => top.has(i.anilistId) || keptIds.has(i.anilistId));
  const shownIds = new Set(shown.map((i) => i.anilistId));
  return { shown, hiddenShows: best.size - shownIds.size };
}

export type PremiereKind = 'New season' | 'Premiere' | 'Movie' | 'Special';

/** A new show or new season starting around now. */
export interface Premiere {
  readonly anilistId: number;
  readonly title: string;
  readonly cover: string | null;
  readonly kind: PremiereKind;
  /** start date (local midnight, ms), null when AniList has none yet */
  readonly startsAt: number | null;
}

/** `users/{uid}/notify/{key}` */
export interface NotifyEntry {
  readonly key: string;
  readonly title: string;
  readonly ep?: number;
  readonly at: number;
}

/** Notify keys: one per airing episode, one per premiere. */
export const airingKey = (a: Pick<Airing, 'anilistId' | 'episode'>) => `a${a.anilistId}e${a.episode}`;
export const premiereKey = (p: Pick<Premiere, 'anilistId'>) => `p${p.anilistId}`;

/** Port: the airing schedule (AniList GraphQL). */
export abstract class SchedulePort {
  abstract airing(fromMs: number, toMs: number): Promise<Airing[]>;
  /** New seasons & premieres starting from ~2 weeks ago to ~6 weeks ahead. */
  abstract premieres(nowMs: number): Promise<Premiere[]>;
}

/** Port: the user's "notify me" flags. */
export abstract class NotifyRepository {
  abstract list(uid: string): Promise<NotifyEntry[]>;
  abstract set(uid: string, entry: NotifyEntry): Promise<void>;
  abstract remove(uid: string, key: string): Promise<void>;
}
