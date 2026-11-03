import type { Episode, Season, Series } from './models';

/**
 * Port: read-only access to the catalogue (the importer is the only writer). Abstract class so it
 * doubles as a DI token; implemented in ../infrastructure (Firestore).
 */
export abstract class CatalogRepository {
  abstract listSeries(): Promise<Series[]>;
  abstract getSeries(seriesId: string): Promise<Series | null>;
  abstract listSeasons(seriesId: string): Promise<Season[]>;
  abstract listEpisodes(seriesId: string): Promise<Episode[]>;
  abstract getEpisode(seriesId: string, episodeId: string): Promise<Episode | null>;
}
