/**
 * catalog / domain — Series, Season, Episode entities; ordering rules; the repository port.
 *
 * Pure TypeScript: no Angular, Firebase or RxJS imports (enforced by eslint-plugin-boundaries).
 */
export * from './models';
export { CatalogRepository } from './catalog.repository';
