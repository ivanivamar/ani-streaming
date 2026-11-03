import { inject, Service } from '@angular/core';
import { byEpisodeOrder, byRecentlyAdded, CatalogRepository, type Episode, type Series, type SeriesDetail } from '../domain';

/**
 * Catalogue use cases. Async methods; pages wrap them in `resource()` with their route inputs.
 * Firestore's persistent cache makes repeat reads instant.
 */
@Service()
export class CatalogStore {
  private readonly repo = inject(CatalogRepository);

  /** Every series, most recently added first (hundreds of docs at most). */
  async allSeries(): Promise<Series[]> {
    return (await this.repo.listSeries()).sort(byRecentlyAdded);
  }

  /** Series page: the series, its seasons and all episodes in order. Null when it doesn't exist. */
  async seriesDetail(seriesId: string): Promise<SeriesDetail | null> {
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

  /** One episode with its series (watch page). */
  async episode(seriesId: string, episodeId: string): Promise<{ series: Series; episode: Episode } | null> {
    const [series, episode] = await Promise.all([this.repo.getSeries(seriesId), this.repo.getEpisode(seriesId, episodeId)]);
    return series && episode ? { series, episode } : null;
  }
}
