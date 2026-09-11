import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AnimeCard,
  AnimeSeries,
  AudioMode,
  ProgressMap,
  WATCHED_THRESHOLD,
} from '../models/anime.model';
import { AuthService } from './auth.service';

/** README.md "Poster tile colors (placeholders for AniList covers)". */
const PLACEHOLDER_COLORS = [
  '#3d3a34',
  '#3a3128',
  '#2e3a3c',
  '#3c2f2f',
  '#2b3339',
  '#39343f',
  '#2f3a35',
  '#333540',
  '#3e3440',
  '#37372c',
];

/** Deterministic pick from PLACEHOLDER_COLORS, so a given entry always gets the same tile color. */
function placeholderColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PLACEHOLDER_COLORS[hash % PLACEHOLDER_COLORS.length];
}

interface SearchEntry {
  entryId: string;
  title: string;
  episodes: number;
}

interface EpisodeList {
  title: string;
  episodes: number[];
}

interface SourceResponse {
  url: string;
  headers: { Referer: string; Origin: string };
}

/** A minimal, favourite-worth snapshot — enough to render a poster card without another network call. */
interface FavouriteSnapshot {
  title: string;
  episodes: number;
}

/**
 * Backed by the real `/api/*` endpoints (README.md "Backend contract") for
 * search, episode listing, and playback. Favourites, recent searches and
 * watch progress stay in-memory for now — they'd be Firestore
 * (`users/{uid}/...`) in production, but that's a separate pass.
 *
 * One important simplification versus the original design: allanime has no
 * concept of a "franchise" grouping several seasons — that only exists via
 * AniList `relations` (README.md "Metadata"), which isn't wired up either.
 * So every entry is its own standalone `AnimeSeries` with exactly one
 * season here; genre/synopsis/year/status are empty (no source for them
 * yet) and the screens hide those fields gracefully rather than fake them.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  /** `users/{uid}/favourites` stub, keyed by entryId. */
  private readonly _favourites = signal<Record<string, FavouriteSnapshot>>({});

  /** `users/{uid}/recent` stub, capped at 8, most recent first. */
  private readonly _recentSearches = signal<string[]>([]);

  /** `users/{uid}/progress/{entryId}_{ep}` stub, keyed `entryId|0|episode` (seasonIndex is always 0 — see class doc). */
  private readonly _progress = signal<ProgressMap>({});

  /** Sub/Dub, set from the search screen's filter pills; shared globally
   *  (also drives the sub/dub suffix on Home's favourite cards, and every
   *  `dub` param sent to the backend) because the prototype treats it as
   *  one app-wide preference, not per-screen. */
  private readonly _audioMode = signal<AudioMode>('Sub');
  readonly audioMode = this._audioMode.asReadonly();

  readonly recentSearches = this._recentSearches.asReadonly();
  readonly favouriteIds = computed(() => Object.keys(this._favourites()));
  readonly favouriteCount = computed(() => this.favouriteIds().length);

  readonly favourites = computed<AnimeCard[]>(() =>
    Object.entries(this._favourites()).map(([entryId, snapshot]) =>
      this.toCard({ entryId, title: snapshot.title, episodes: snapshot.episodes }),
    ),
  );

  setAudioMode(mode: AudioMode): void {
    this._audioMode.set(mode);
  }

  toggleFavourite(entryId: string, title: string, episodes: number): void {
    this._favourites.update((favourites) => {
      if (favourites[entryId]) {
        const { [entryId]: _removed, ...rest } = favourites;
        return rest;
      }
      return { ...favourites, [entryId]: { title, episodes } };
    });
  }

  addRecentSearch(term: string): void {
    const trimmed = term.trim();
    if (!trimmed) return;
    this._recentSearches.update((recent) => [trimmed, ...recent.filter((r) => r !== trimmed)].slice(0, 8));
  }

  /** `GET /api/search?q=&dub=` (README.md "Backend contract"): one card per season entry. */
  async search(query: string): Promise<AnimeCard[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const params = new HttpParams().set('q', trimmed).set('dub', this.dubParam());
    const entries = await firstValueFrom(
      this.http.get<SearchEntry[]>(`${environment.apiBaseUrl}/search`, { params }),
    );
    return entries.map((entry) => this.toCard(entry));
  }

  /**
   * `GET /api/episodes?entryId=&dub=`, wrapped into the shape the
   * anime-detail and watch screens expect. Returns null on any failure
   * (not-found, upstream error, bad id) — the caller treats that
   * generically (README.md "States to implement": not-found/playback
   * error).
   */
  async getEntry(entryId: string): Promise<{ series: AnimeSeries; seasonIndex: number } | null> {
    const params = new HttpParams().set('entryId', entryId).set('dub', this.dubParam());
    try {
      const result = await firstValueFrom(
        this.http.get<EpisodeList>(`${environment.apiBaseUrl}/episodes`, { params }),
      );
      const series: AnimeSeries = {
        id: entryId,
        title: result.title || entryId,
        color: placeholderColor(entryId),
        year: '',
        status: '',
        genres: [],
        synopsis: '',
        seasons: [{ entryId, seasonLabel: 'Season 1', episodes: result.episodes }],
      };
      return { series, seasonIndex: 0 };
    } catch {
      return null;
    }
  }

  /**
   * `GET /api/sources` + `/api/proxy` (README.md "Backend contract"),
   * combined into one URL a <video>/hls.js can load directly. Those issue
   * their own requests outside Angular's HttpClient, so they can't carry
   * the Authorization header the auth interceptor adds elsewhere — the ID
   * token rides along as a `token` query param instead (see
   * server/src/middleware/auth.ts).
   */
  async resolvePlaybackUrl(entryId: string, episode: number, quality = 'best'): Promise<string> {
    const sourceParams = new HttpParams()
      .set('entryId', entryId)
      .set('ep', String(episode))
      .set('dub', this.dubParam())
      .set('q', quality);
    const source = await firstValueFrom(
      this.http.get<SourceResponse>(`${environment.apiBaseUrl}/sources`, { params: sourceParams }),
    );

    const token = (await this.authService.getIdToken()) ?? '';
    const proxyParams = new HttpParams()
      .set('url', source.url)
      .set('referer', source.headers.Referer)
      .set('token', token);
    return `${environment.apiBaseUrl}/proxy?${proxyParams.toString()}`;
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

  private dubParam(): string {
    return this._audioMode() === 'Dub' ? 'true' : 'false';
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

  private toCard(entry: SearchEntry): AnimeCard {
    const watched = this.lastWatched(entry.entryId, 0);
    return {
      seriesId: entry.entryId,
      seasonIndex: 0,
      entryId: entry.entryId,
      title: entry.title,
      color: placeholderColor(entry.entryId),
      meta: this._audioMode() === 'Dub' ? 'dub' : 'sub',
      episodesLabel: `${entry.episodes} episode${entry.episodes === 1 ? '' : 's'}`,
      hasProgress: !!watched,
      progressPercent: watched ? Math.round(watched.percent * 100) : 0,
    };
  }
}
