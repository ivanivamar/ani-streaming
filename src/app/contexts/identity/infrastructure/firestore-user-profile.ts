import { inject, Injectable, Injector } from '@angular/core';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { COLLECTIONS, type UserDoc, type UserPrefs } from '@ani/contracts';
import { FIRESTORE } from '@shared/infrastructure';
import { UserProfilePort } from '../application/ports';

/** Sub-collections of `users/{uid}` (deleted with the account data). */
const USER_SUBCOLLECTIONS = [
  COLLECTIONS.library,
  COLLECTIONS.favourites,
  COLLECTIONS.progress,
  COLLECTIONS.recent,
  COLLECTIONS.notify,
] as const;

/** `users/{uid}` in Firestore (rules: only that uid). `createdAt` stored as a Timestamp. */
@Injectable()
export class FirestoreUserProfile extends UserProfilePort {
  private readonly injector = inject(Injector);
  private get db() {
    return this.injector.get(FIRESTORE);
  }

  async get(uid: string): Promise<UserDoc | null> {
    const snap = await getDoc(doc(this.db, COLLECTIONS.users, uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    const created = data['createdAt'];
    return {
      displayName: data['displayName'] ?? null,
      email: data['email'] ?? null,
      photoURL: data['photoURL'] ?? null,
      createdAt: created instanceof Timestamp ? created.toMillis() : Number(created) || 0,
      prefs: (data['prefs'] as UserPrefs | undefined) ?? {},
    };
  }

  async create(uid: string, user: UserDoc): Promise<void> {
    await setDoc(doc(this.db, COLLECTIONS.users, uid), { ...user, createdAt: Timestamp.fromMillis(user.createdAt) });
  }

  async updatePrefs(uid: string, prefs: UserPrefs): Promise<void> {
    await updateDoc(doc(this.db, COLLECTIONS.users, uid), { prefs });
  }

  async deleteAll(uid: string): Promise<void> {
    for (const name of USER_SUBCOLLECTIONS) {
      const snap = await getDocs(collection(this.db, COLLECTIONS.users, uid, name));
      // batches hold at most 500 writes
      for (let i = 0; i < snap.docs.length; i += 450) {
        const batch = writeBatch(this.db);
        snap.docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await deleteDoc(doc(this.db, COLLECTIONS.users, uid));
  }
}
