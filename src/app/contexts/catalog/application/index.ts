/**
 * catalog / application — public API of the catalog context.
 *
 * Other contexts and the shell may import only from this file, never from another
 * context's domain/, infrastructure/ or ui/.
 */
export { CatalogStore } from './catalog.store';
export {
  CatalogRepository,
  genresOf,
  normalize,
  NO_FILTERS,
  searchSeries,
  seasonName,
  STATUS_NAME,
  type Episode,
  type SearchFilters,
  type Season,
  type Series,
  type SeriesDetail,
} from '../domain';
