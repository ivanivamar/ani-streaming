import { computed, inject, Service, signal } from '@angular/core';
import {
  byEpisodeOrder,
  byRecentlyAdded,
  CatalogRepository,
  searchSeries,
  type Episode,
  type SearchFilters,
  type Series,
  type SeriesDetail,
} from '../domain';

/**
 * Catalogue use cases. The series list is read once and kept (it's small, and the header search
 * suggests from it on every keystroke); series details are cached per id for the session.
 * Firestore's persistent cache makes repeat reads after a reload instant too.
 */
@Service()
export class CatalogStore {
  private readonly repo = inject(CatalogRepository);
  private listing: Promise<Series[]> | null = null;
  private readonly details = new Map<string, Promise<SeriesDetail | null>>();
  private readonly _series = signal<readonly Series[] | null>(null);

  /** Every series once loaded (most recently added first), null before. */
  readonly series = this._series.asReadonly();
  readonly byId = computed(() => new Map((this._series() ?? []).map((s) => [s.id as string, s])));

  /** Every series, most recently added first (hundreds of docs at most). */
  allSeries(): Promise<Series[]> {
    this.listing ??= this.repo.listSeries().then(
      (list) => {
        const sorted = list.sort(byRecentlyAdded);
        this._series.set(sorted);
        return sorted;
      },
      (e) => {
        this.listing = null;
        throw e;
      },
    );
    return this.listing;
  }

  async search(query: string, filters?: SearchFilters): Promise<Series[]> {
    return searchSeries(await this.allSeries(), query, filters);
  }

  /** Series page: the series, its seasons and all episodes in order. Null when it doesn't exist. */
  seriesDetail(seriesId: string): Promise<SeriesDetail | null> {
    let p = this.details.get(seriesId);
    if (!p) {
      p = this.loadDetail(seriesId).catch((e) => {
        this.details.delete(seriesId);
        throw e;
      });
      this.details.set(seriesId, p);
    }
    return p;
  }

  /** Several series' details at once (Home / Library need episode lists to resolve "resume"). */
  async detailsOf(ids: readonly string[]): Promise<Map<string, SeriesDetail>> {
    const out = new Map<string, SeriesDetail>();
    const all = await Promise.all(ids.map((id) => this.seriesDetail(id).catch(() => null)));
    all.forEach((d, i) => d && out.set(ids[i], d));
    return out;
  }

  /** One episode with its series (watch page). */
  async episode(seriesId: string, episodeId: string): Promise<{ series: Series; episode: Episode } | null> {
    const d = await this.seriesDetail(seriesId);
    const episode = d?.episodes.find((e) => e.id === episodeId);
    if (d && episode) return { series: d.series, episode };
    // not in the cached detail (imported meanwhile): ask directly
    const [series, ep] = await Promise.all([this.repo.getSeries(seriesId), this.repo.getEpisode(seriesId, episodeId)]);
    return series && ep ? { series, episode: ep } : null;
  }

  private async loadDetail(seriesId: string): Promise<SeriesDetail | null> {
    const [series, seasons, episodes] = await Promise.all([
      this.repo.getSeries(seriesId),
      this.repo.listSeasons(seriesId),
      this.repo.listEpisodes(seriesId),
    ]);
    if (!series) return null;
    return {
      series,
      seasons: seasons.sort((a, b) => a.number - b.number),
      episodes: episodes.sort(byEpisodeOrder),
    };
  }
}
