import { Injectable, computed, signal } from '@angular/core';
import {
  AnimeCard,
  AnimeSeries,
  AudioMode,
  ProgressMap,
  WATCHED_THRESHOLD,
} from '../models/anime.model';

/**
 * STUB. Ports the design prototype's fake `CATALOG` / `EP_COUNTS` fixtures
 * (see Anime Streaming.dc.html) so the Home screen has something real to
 * render. Cover colors stand in for AniList cover images (README.md
 * "Fidelity").
 *
 * Production note (README.md "Backend contract" / "Metadata" / "Firestore"):
 * this whole service gets replaced by calls to `GET /api/search`,
 * `GET /api/episodes`, and the cached AniList metadata in
 * `meta/{entryId}` — plus `users/{uid}/favourites`, `.../recent` and
 * `.../progress` for the per-user state below. Keep the public
 * signal-based surface (`favourites`, `recentSearches`, progress helpers)
 * stable so the Home/Search/Detail components don't need to change when
 * that swap happens.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly catalog: readonly AnimeSeries[] = [
    {
      id: 'aot',
      title: 'Attack on Titan',
      color: '#3d3a34',
      year: '2013',
      status: 'Finished',
      genres: ['Action', 'Drama', 'Fantasy'],
      synopsis:
        'Humanity lives caged behind enormous walls, hiding from the giant humanoids that devour them. When the outermost wall is breached, a young recruit joins the corps that fights back.',
      seasons: [
        { entryId: 'aot-s1', seasonLabel: 'Season 1', episodeCount: 25 },
        { entryId: 'aot-s2', seasonLabel: 'Season 2', episodeCount: 12 },
        { entryId: 'aot-s3', seasonLabel: 'Season 3', episodeCount: 22 },
        { entryId: 'aot-s4', seasonLabel: 'Final Season', episodeCount: 28 },
      ],
    },
    {
      id: 'fma',
      title: 'Fullmetal Alchemist: Brotherhood',
      color: '#3a3128',
      year: '2009',
      status: 'Finished',
      genres: ['Adventure', 'Fantasy'],
      synopsis:
        'Two brothers break the laws of alchemy trying to bring back their mother, and pay for it with their bodies. Their search for restoration leads them into a nation-sized conspiracy.',
      seasons: [
        { entryId: 'fma-s1', seasonLabel: 'Season 1', episodeCount: 33 },
        { entryId: 'fma-s2', seasonLabel: 'Season 2', episodeCount: 31 },
      ],
    },
    {
      id: 'mob',
      title: 'Mob Psycho 100',
      color: '#2e3a3c',
      year: '2016',
      status: 'Finished',
      genres: ['Action', 'Comedy', 'Supernatural'],
      synopsis:
        'A middle schooler with overwhelming psychic power just wants to be ordinary. His conman mentor is happy to keep him grounded, for a fee.',
      seasons: [
        { entryId: 'mob-s1', seasonLabel: 'Season 1', episodeCount: 12 },
        { entryId: 'mob-s2', seasonLabel: 'Season 2', episodeCount: 13 },
        { entryId: 'mob-s3', seasonLabel: 'Season 3', episodeCount: 12 },
      ],
    },
    {
      id: 'csm',
      title: 'Chainsaw Man',
      color: '#3c2f2f',
      year: '2022',
      status: 'Airing',
      genres: ['Action', 'Horror'],
      synopsis:
        'A debt-ridden teenager merges with his chainsaw devil dog and is drafted into a government devil-hunting unit.',
      seasons: [{ entryId: 'csm-s1', seasonLabel: 'Season 1', episodeCount: 12 }],
    },
    {
      id: 'vin',
      title: 'Vinland Saga',
      color: '#2b3339',
      year: '2019',
      status: 'Finished',
      genres: ['Action', 'Historical', 'Drama'],
      synopsis:
        'Raised among the mercenaries who killed his father, a young Norseman pursues revenge across a war-torn Europe, and slowly learns what it costs.',
      seasons: [
        { entryId: 'vin-s1', seasonLabel: 'Season 1', episodeCount: 24 },
        { entryId: 'vin-s2', seasonLabel: 'Season 2', episodeCount: 24 },
      ],
    },
    {
      id: 'spy',
      title: 'Spy x Family',
      color: '#39343f',
      year: '2022',
      status: 'Airing',
      genres: ['Comedy', 'Action'],
      synopsis:
        'A master spy assembles a fake family for a mission, unaware his wife is an assassin and his daughter reads minds.',
      seasons: [
        { entryId: 'spy-s1', seasonLabel: 'Season 1', episodeCount: 12 },
        { entryId: 'spy-s2', seasonLabel: 'Season 2', episodeCount: 25 },
      ],
    },
    {
      id: 'fri',
      title: 'Frieren: Beyond Journey’s End',
      color: '#2f3a35',
      year: '2023',
      status: 'Finished',
      genres: ['Adventure', 'Drama', 'Fantasy'],
      synopsis:
        'An elven mage outlives the party she saved the world with, and sets out to understand the humans she never took the time to know.',
      seasons: [{ entryId: 'fri-s1', seasonLabel: 'Season 1', episodeCount: 28 }],
    },
    {
      id: 'ode',
      title: 'Odd Taxi',
      color: '#333540',
      year: '2021',
      status: 'Finished',
      genres: ['Mystery', 'Drama'],
      synopsis:
        'A walrus cab driver ferries the strange residents of a city through their nights, and drives straight into a missing-person case.',
      seasons: [{ entryId: 'ode-s1', seasonLabel: 'Season 1', episodeCount: 13 }],
    },
    {
      id: 'brl',
      title: 'Bocchi the Rock!',
      color: '#3e3440',
      year: '2022',
      status: 'Finished',
      genres: ['Comedy', 'Music'],
      synopsis:
        'A crushingly shy guitarist with a bedroom following gets pulled into a band that plays in front of actual people.',
      seasons: [{ entryId: 'brl-s1', seasonLabel: 'Season 1', episodeCount: 12 }],
    },
    {
      id: 'dun',
      title: 'Delicious in Dungeon',
      color: '#37372c',
      year: '2024',
      status: 'Airing',
      genres: ['Adventure', 'Comedy', 'Fantasy'],
      synopsis:
        'A broke adventuring party descends to rescue a lost member, eating the monsters they meet on the way down.',
      seasons: [{ entryId: 'dun-s1', seasonLabel: 'Season 1', episodeCount: 24 }],
    },
  ];

  /** `users/{uid}/favourites` stub. */
  private readonly _favouriteIds = signal<string[]>(['aot', 'fma', 'mob', 'csm', 'vin', 'spy']);

  /** `users/{uid}/recent` stub, capped at 8, most recent first. */
  private readonly _recentSearches = signal<string[]>(['frieren', 'odd taxi', 'bocchi', 'dungeon meshi']);

  /** `users/{uid}/progress/{entryId}_{ep}` stub, keyed `seriesId|seasonIndex|episode`. */
  private readonly _progress = signal<ProgressMap>({
    'aot|0|7': 0.42,
    'vin|0|3': 0.88,
    'fri|0|12': 1,
    'mob|1|2': 0.15,
  });

  /** Sub/Dub, set from the search screen's filter pills; shared globally
   *  (also drives the sub/dub suffix on Home's favourite cards) because
   *  the prototype treats it as one app-wide preference, not per-screen. */
  private readonly _audioMode = signal<AudioMode>('Sub');
  readonly audioMode = this._audioMode.asReadonly();

  readonly recentSearches = this._recentSearches.asReadonly();
  readonly favouriteIds = this._favouriteIds.asReadonly();

  readonly favourites = computed<AnimeCard[]>(() =>
    this._favouriteIds()
      .map((id) => this.catalog.find((series) => series.id === id))
      .filter((series): series is AnimeSeries => !!series)
      .map((series) => this.toCard(series, 0)),
  );

  readonly favouriteCount = computed(() => this._favouriteIds().length);

  setAudioMode(mode: AudioMode): void {
    this._audioMode.set(mode);
  }

  toggleFavourite(seriesId: string): void {
    this._favouriteIds.update((ids) =>
      ids.includes(seriesId) ? ids.filter((id) => id !== seriesId) : [...ids, seriesId],
    );
  }

  /**
   * STUB combining `GET /api/episodes` with the cached AniList metadata in
   * `meta/{entryId}` (README.md "Metadata"): given a search result's
   * entryId (one season), finds the whole series it belongs to plus which
   * season index that entry is. Simulates latency so the detail screen's
   * loading state (README.md "States to implement") is exercised.
   */
  async getEntry(entryId: string): Promise<{ series: AnimeSeries; seasonIndex: number } | null> {
    await this.simulateLatency();
    for (const series of this.catalog) {
      const seasonIndex = series.seasons.findIndex((season) => season.entryId === entryId);
      if (seasonIndex !== -1) return { series, seasonIndex };
    }
    return null;
  }

  /** Progress fraction (0..1) for one episode; 0 if nothing recorded. */
  episodeProgress(seriesId: string, seasonIndex: number, episode: number): number {
    return this._progress()[`${seriesId}|${seasonIndex}|${episode}`] ?? 0;
  }

  /** Most recent unfinished episode in a season — drives the detail screen's Resume button. */
  resumeEpisode(seriesId: string, seasonIndex: number): number | null {
    const watched = this.lastWatched(seriesId, seasonIndex);
    return watched ? watched.episode : null;
  }

  /**
   * STUB for `users/{uid}/progress/{entryId}_{ep}` (README.md "Firestore").
   * Called by the watch screen per the "Progress rules" in README.md
   * "State model" — every ~10s while playing, plus on pause/seek/route
   * leave/`visibilitychange`, never every tick.
   */
  setEpisodeProgress(seriesId: string, seasonIndex: number, episode: number, fraction: number): void {
    const key = `${seriesId}|${seasonIndex}|${episode}`;
    const clamped = Math.max(0, Math.min(1, fraction));
    this._progress.update((progress) => ({ ...progress, [key]: clamped }));
  }

  addRecentSearch(term: string): void {
    const trimmed = term.trim();
    if (!trimmed) return;
    this._recentSearches.update((recent) => [trimmed, ...recent.filter((r) => r !== trimmed)].slice(0, 8));
  }

  /**
   * STUB for `GET /api/search?q=&dub=` (README.md "Backend contract").
   * Filters the local catalog by title, one row per season entry — ani-cli
   * lists every season as its own entry (data-sources.md), which the
   * `AnimeCard`s already reflect. Simulates request latency so loading
   * state is exercised.
   *
   * Dev hook: a query of exactly "error" rejects, to exercise the "Source
   * unavailable" state (README.md "States to implement") without a real
   * backend to fail against. Delete this branch once `/api/search` is real
   * — a genuine upstream failure will reject on its own.
   */
  async search(query: string): Promise<AnimeCard[]> {
    await this.simulateLatency();

    const trimmed = query.trim();
    if (trimmed.toLowerCase() === 'error') {
      throw new Error('Source unavailable');
    }

    const q = trimmed.toLowerCase();
    const entries: AnimeCard[] = [];
    for (const series of this.catalog) {
      series.seasons.forEach((_, seasonIndex) => {
        const card = this.toCard(series, seasonIndex);
        if (!q || card.title.toLowerCase().includes(q)) {
          entries.push(card);
        }
      });
    }
    return entries;
  }

  private simulateLatency(ms = 300): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Season entry title, e.g. "Attack on Titan" (i=0) or "Attack on Titan Season 2". */
  private entryTitle(series: AnimeSeries, seasonIndex: number): string {
    return seasonIndex === 0 ? series.title : `${series.title} ${series.seasons[seasonIndex].seasonLabel}`;
  }

  /** Most recent unfinished episode within a season, or null if none in progress. */
  private lastWatched(seriesId: string, seasonIndex: number): { episode: number; percent: number } | null {
    let best: { episode: number; percent: number } | null = null;
    for (const [key, value] of Object.entries(this._progress())) {
      const [id, season, episode] = key.split('|');
      if (id === seriesId && Number(season) === seasonIndex && value < WATCHED_THRESHOLD) {
        best = { episode: Number(episode), percent: value };
      }
    }
    return best;
  }

  private toCard(series: AnimeSeries, seasonIndex: number): AnimeCard {
    const season = series.seasons[seasonIndex];
    const watched = this.lastWatched(series.id, seasonIndex);
    return {
      seriesId: series.id,
      seasonIndex,
      entryId: season.entryId,
      title: this.entryTitle(series, seasonIndex),
      color: series.color,
      meta: `${series.year} · ${this._audioMode() === 'Dub' ? 'dub' : 'sub'}`,
      episodesLabel: `${season.episodeCount} episodes`,
      hasProgress: !!watched,
      progressPercent: watched ? Math.round(watched.percent * 100) : 0,
    };
  }
}
