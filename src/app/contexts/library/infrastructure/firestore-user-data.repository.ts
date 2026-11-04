import { inject, Injectable, Injector } from '@angular/core';
import { collection, deleteDoc, doc, getDocs, setDoc, Timestamp, writeBatch, type WriteBatch } from 'firebase/firestore';
import {
  COLLECTIONS,
  toProgressId,
  type EpisodeId,
  type FavouriteDoc,
  type LibraryEntryDoc,
  type ProgressDoc,
  type RecentSearchDoc,
  type SeriesId,
} from '@ani/contracts';
import { FIRESTORE } from '@shared/infrastructure';
import {
  parseProgressId,
  UserDataRepository,
  type Favourite,
  type LibraryEntry,
  type RecentSearch,
  type UserData,
  type WatchProgress,
} from '../domain';

/** A batch holds at most 500 writes. */
const BATCH = 450;

const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0);
const ts = (v: number) => Timestamp.fromMillis(v);

/** `users/{uid}/{progress,library,favourites,recent}` (rules: only that uid). */
@Injectable()
export class FirestoreUserDataRepository extends UserDataRepository {
  private readonly injector = inject(Injector);
  private get db() {
    return this.injector.get(FIRESTORE);
  }

  private col(uid: string, name: string) {
    return collection(this.db, COLLECTIONS.users, uid, name);
  }

  async load(uid: string): Promise<UserData> {
    const [progress, library, favourites, recent] = await Promise.all(
      [COLLECTIONS.progress, COLLECTIONS.library, COLLECTIONS.favourites, COLLECTIONS.recent].map((c) => getDocs(this.col(uid, c))),
    );
    return {
      progress: progress.docs.flatMap((d): WatchProgress[] => {
        const ids = parseProgressId(d.id);
        const x = d.data() as ProgressDoc;
        return ids ? [{ ...ids, position: x.position, duration: x.duration, updatedAt: ms(x.updatedAt) }] : [];
      }),
      entries: library.docs.map((d): LibraryEntry => {
        const x = d.data() as LibraryEntryDoc;
        return { seriesId: d.id as SeriesId, status: x.status, watched: x.watched ?? 0, updatedAt: ms(x.updatedAt) };
      }),
      favourites: favourites.docs.map((d): Favourite => ({ seriesId: d.id as SeriesId, addedAt: ms((d.data() as FavouriteDoc).addedAt) })),
      recent: recent.docs.map((d): RecentSearch => {
        const x = d.data() as RecentSearchDoc;
        return { id: d.id, term: x.term, at: ms(x.at) };
      }),
    };
  }

  async saveProgress(uid: string, p: WatchProgress): Promise<void> {
    await setDoc(doc(this.col(uid, COLLECTIONS.progress), toProgressId(p.seriesId, p.episodeId)), {
      position: p.position,
      duration: p.duration,
      updatedAt: ts(p.updatedAt),
    });
  }

  async deleteProgress(uid: string, ids: readonly { seriesId: string; episodeId: string }[]): Promise<void> {
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = writeBatch(this.db);
      ids
        .slice(i, i + BATCH)
        .forEach((p) =>
          batch.delete(doc(this.col(uid, COLLECTIONS.progress), toProgressId(p.seriesId as SeriesId, p.episodeId as EpisodeId))),
        );
      await batch.commit();
    }
  }

  async saveEntry(uid: string, e: LibraryEntry): Promise<void> {
    await setDoc(doc(this.col(uid, COLLECTIONS.library), e.seriesId), { status: e.status, watched: e.watched, updatedAt: ts(e.updatedAt) });
  }

  async deleteEntry(uid: string, seriesId: string): Promise<void> {
    await deleteDoc(doc(this.col(uid, COLLECTIONS.library), seriesId));
  }

  async addFavourite(uid: string, f: Favourite): Promise<void> {
    await setDoc(doc(this.col(uid, COLLECTIONS.favourites), f.seriesId), { addedAt: ts(f.addedAt) });
  }

  async removeFavourite(uid: string, seriesId: string): Promise<void> {
    await deleteDoc(doc(this.col(uid, COLLECTIONS.favourites), seriesId));
  }

  async saveRecent(uid: string, r: RecentSearch): Promise<void> {
    await setDoc(doc(this.col(uid, COLLECTIONS.recent), r.id), { term: r.term, at: ts(r.at) });
  }

  async deleteRecent(uid: string, ids: readonly string[]): Promise<void> {
    const batch = writeBatch(this.db);
    ids.forEach((id) => batch.delete(doc(this.col(uid, COLLECTIONS.recent), id)));
    await batch.commit();
  }

  async clearHistory(uid: string): Promise<number> {
    const [progress, library] = await Promise.all([getDocs(this.col(uid, COLLECTIONS.progress)), getDocs(this.col(uid, COLLECTIONS.library))]);
    const writes: ((b: WriteBatch) => void)[] = [
      ...progress.docs.map((d) => (b: WriteBatch) => b.delete(d.ref)),
      ...library.docs
        .filter((d) => ((d.data() as LibraryEntryDoc).watched ?? 0) !== 0)
        .map((d) => (b: WriteBatch) => b.update(d.ref, { watched: 0, updatedAt: Timestamp.now() })),
    ];
    for (let i = 0; i < writes.length; i += BATCH) {
      const batch = writeBatch(this.db);
      writes.slice(i, i + BATCH).forEach((w) => w(batch));
      await batch.commit();
    }
    return progress.size;
  }
}
