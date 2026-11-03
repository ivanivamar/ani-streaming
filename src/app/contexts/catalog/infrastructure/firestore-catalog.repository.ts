import { inject, Injectable, Injector } from '@angular/core';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { COLLECTIONS } from '@ani/contracts';
import { FIRESTORE } from '@shared/infrastructure';
import { CatalogRepository, type Episode, type Season, type Series } from '../domain';
import { toEpisode, toSeason, toSeries } from './mappers';

/**
 * `series/{id}`, `series/{id}/seasons/{sNN}`, `series/{id}/episodes/{sNNeNN}` — read-only.
 * No `orderBy` in queries (would need composite indexes); the application layer sorts.
 */
@Injectable()
export class FirestoreCatalogRepository extends CatalogRepository {
  private readonly injector = inject(Injector);
  private get db() {
    return this.injector.get(FIRESTORE);
  }

  async listSeries(): Promise<Series[]> {
    const snap = await getDocs(collection(this.db, COLLECTIONS.series));
    return snap.docs.map((d) => toSeries(d.id, d.data()));
  }

  async getSeries(seriesId: string): Promise<Series | null> {
    const snap = await getDoc(doc(this.db, COLLECTIONS.series, seriesId));
    return snap.exists() ? toSeries(snap.id, snap.data()) : null;
  }

  async listSeasons(seriesId: string): Promise<Season[]> {
    const snap = await getDocs(collection(this.db, COLLECTIONS.series, seriesId, COLLECTIONS.seasons));
    return snap.docs.map((d) => toSeason(d.id, d.data()));
  }

  async listEpisodes(seriesId: string): Promise<Episode[]> {
    const snap = await getDocs(collection(this.db, COLLECTIONS.series, seriesId, COLLECTIONS.episodes));
    return snap.docs.map((d) => toEpisode(seriesId, d.id, d.data()));
  }

  async getEpisode(seriesId: string, episodeId: string): Promise<Episode | null> {
    const snap = await getDoc(doc(this.db, COLLECTIONS.series, seriesId, COLLECTIONS.episodes, episodeId));
    return snap.exists() ? toEpisode(seriesId, snap.id, snap.data()) : null;
  }
}
