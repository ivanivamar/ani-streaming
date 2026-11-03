/**
 * catalog / infrastructure — Firestore repository for series/seasons/episodes, doc <-> entity mappers.
 *
 * Implements the ports declared in domain/; wired through `provideCatalog()` in app.config.ts.
 * Never imported by ui/.
 */
export { provideCatalog } from './catalog.providers';
export { fromFirestore } from './mappers';
