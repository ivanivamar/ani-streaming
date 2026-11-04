import { computed, effect, inject, Service, signal, untracked } from '@angular/core';
import { CatalogStore } from '@catalog/application';
import { SessionStore } from '@identity/application';
import { LibraryStore } from '@library/application';
import { toEpisodeId, type SeriesId } from '@shared/kernel';
import {
  airingKey,
  NotifyRepository,
  popularOnly,
  POPULAR_LIMIT,
  premiereKey,
  SchedulePort,
  weekDays,
  weekRange,
  weekTitle,
  type Airing,
  type NotifyEntry,
  type Premiere,
} from '../domain';

/** Where an airing / premiere points in our catalogue (null = not imported). */
export interface LibraryMatch {
  readonly seriesId: SeriesId;
  readonly season: number;
}

export type AiringState = 'upcoming' | 'out' | 'out-missing' | 'watched';

export interface AiringItem extends Airing {
  readonly match: LibraryMatch | null;
  readonly state: AiringState;
  /** our episode id when it's imported */
  readonly episodeId: string | null;
}

export interface DayColumn {
  readonly date: number;
  readonly items: readonly AiringItem[];
}

export interface WeekView {
  readonly offset: number;
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly days: readonly DayColumn[];
  readonly total: number;
  readonly released: number;
  /** shows left out of "Everything" (0 when showing all or "My library") */
  readonly hiddenShows: number;
}

export interface PremiereItem extends Premiere {
  readonly match: LibraryMatch | null;
  readonly upcoming: boolean;
}

export type ReleaseScope = 'all' | 'mine';

const PREMIERE_LIMIT = 8;

/**
 * New releases: the AniList airing schedule for a week, joined to the catalogue (series and
 * season AniList ids) and the user's progress, plus new seasons & premieres and the user's
 * "notify me" flags (`users/{uid}/notify`).
 */
@Service()
export class ReleasesStore {
  private readonly schedule = inject(SchedulePort);
  private readonly notifyRepo = inject(NotifyRepository);
  private readonly session = inject(SessionStore);
  private readonly catalog = inject(CatalogStore);
  private readonly library = inject(LibraryStore);

  private readonly _notify = signal<ReadonlyMap<string, NotifyEntry>>(new Map());
  readonly notify = this._notify.asReadonly();
  private matches: Promise<Map<number, LibraryMatch>> | null = null;

  /** current time, refreshed every minute by the page (countdowns, "now" line) */
  readonly now = signal(Date.now());
  readonly nowMinute = computed(() => Math.floor(this.now() / 60_000));

  constructor() {
    effect(() => {
      const uid = this.session.ready() ? this.session.uid() : null;
      untracked(() => {
        this._notify.set(new Map());
        if (uid) void this.notifyRepo.list(uid).then((l) => this._notify.set(new Map(l.map((n) => [n.key, n]))), () => undefined);
      });
    });
  }

  /** Settings → Export JSON: the "notify me" flags, read fresh from Firestore. */
  async exportNotify(): Promise<{ key: string; title: string; ep?: number; at: string }[]> {
    const uid = this.session.uid();
    if (!uid) return [];
    const list = await this.notifyRepo.list(uid);
    return list
      .sort((a, b) => b.at - a.at)
      .map((n) => ({ key: n.key, title: n.title, ...(n.ep !== undefined ? { ep: n.ep } : {}), at: new Date(n.at).toISOString() }));
  }

  /** AniList id → our series/season (series id covers season 1; later seasons carry their own id). */
  private libraryMatches(): Promise<Map<number, LibraryMatch>> {
    this.matches ??= (async () => {
      const all = await this.catalog.allSeries();
      const details = await this.catalog.detailsOf(all.map((s) => s.id));
      const map = new Map<number, LibraryMatch>();
      for (const s of all) {
        if (s.anilistId) map.set(s.anilistId, { seriesId: s.id, season: 1 });
        for (const season of details.get(s.id)?.seasons ?? []) {
          if (season.anilistId) map.set(season.anilistId, { seriesId: s.id, season: season.number });
        }
      }
      return map;
    })().catch((e) => {
      this.matches = null;
      throw e;
    });
    return this.matches;
  }

  /** `showAll` = no popularity cut on "Everything". */
  async week(offset: number, scope: ReleaseScope, showAll = false): Promise<WeekView> {
    const range = weekRange(offset, this.now());
    const [airings, matches] = await Promise.all([this.schedule.airing(range.start, range.end), this.libraryMatches()]);
    let list = scope === 'mine' ? airings.filter((a) => matches.has(a.anilistId)) : airings;
    let hiddenShows = 0;
    if (scope === 'all' && !showAll) {
      const cut = popularOnly(list, POPULAR_LIMIT, (a) => matches.has(a.anilistId) || this.isNotified(airingKey(a)));
      list = cut.shown;
      hiddenShows = cut.hiddenShows;
    }
    const items: AiringItem[] = [];
    for (const a of list) items.push(await this.airingItem(a, matches.get(a.anilistId) ?? null));
    const days = weekDays(range).map((date, i, all) => ({
      date,
      items: items.filter((it) => it.airingAt >= date && it.airingAt < (all[i + 1] ?? range.end)).sort((x, y) => x.airingAt - y.airingAt),
    }));
    return {
      offset,
      title: weekTitle(offset),
      start: range.start,
      end: range.end,
      days,
      total: items.length,
      released: items.filter((i) => i.state !== 'upcoming').length,
      hiddenShows,
    };
  }

  /** Premieres are fetched most-popular first; "Everything" shows the top 8 unless `showAll`. */
  async premieres(scope: ReleaseScope, showAll = false): Promise<PremiereItem[]> {
    const [list, matches] = await Promise.all([this.schedule.premieres(this.now()), this.libraryMatches()]);
    const now = this.now();
    return list
      .map((p) => ({ ...p, match: matches.get(p.anilistId) ?? null, upcoming: p.startsAt === null || p.startsAt > now }))
      .filter((p) => scope === 'all' || p.match)
      .filter((p, i) => scope === 'mine' || showAll || i < PREMIERE_LIMIT || p.match || this.isNotified(premiereKey(p)));
  }

  /** Re-derive the state of an item (time passed, episode watched) without refetching. */
  stateOf(item: AiringItem): AiringState {
    if (item.airingAt > this.now()) return 'upcoming';
    if (!item.match) return 'out';
    if (!item.episodeId) return 'out-missing';
    return this.library.isEpisodeWatched(item.match.seriesId, item.episodeId) ? 'watched' : 'out';
  }

  isNotified(key: string): boolean {
    return this._notify().has(key);
  }

  toggleNotify(target: { kind: 'airing'; item: Airing } | { kind: 'premiere'; item: Premiere }): void {
    const uid = this.session.uid();
    const key = target.kind === 'airing' ? airingKey(target.item) : premiereKey(target.item);
    if (this._notify().has(key)) {
      this._notify.update((m) => {
        const n = new Map(m);
        n.delete(key);
        return n;
      });
      if (uid) void this.notifyRepo.remove(uid, key).catch((e) => console.error('[releases] notify', e));
      return;
    }
    const entry: NotifyEntry = {
      key,
      title: target.item.title,
      ...(target.kind === 'airing' ? { ep: target.item.episode } : {}),
      at: Date.now(),
    };
    this._notify.update((m) => new Map(m).set(key, entry));
    if (uid) void this.notifyRepo.set(uid, entry).catch((e) => console.error('[releases] notify', e));
  }

  private async airingItem(a: Airing, match: LibraryMatch | null): Promise<AiringItem> {
    let episodeId: string | null = null;
    if (match) {
      const d = await this.catalog.seriesDetail(match.seriesId).catch(() => null);
      const id = toEpisodeId({ season: match.season, episode: a.episode });
      episodeId = d?.episodes.some((e) => e.id === id) ? id : null;
    }
    const base = { ...a, match, episodeId, state: 'out' as AiringState };
    return { ...base, state: this.stateOf(base) };
  }
}
