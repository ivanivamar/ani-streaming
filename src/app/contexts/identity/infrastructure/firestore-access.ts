import { inject, Injectable, Injector } from '@angular/core';
import { FirebaseError } from 'firebase/app';
import { doc, getDoc } from 'firebase/firestore';
import { COLLECTIONS, type AccessConfigDoc } from '@ani/contracts';
import { FIRESTORE } from '@shared/infrastructure';
import { AccessPort } from '../application/ports';
import { isAllowed } from '../domain';

/**
 * `config/access` allowlist. The rules let only listed uids read that doc, so "permission denied"
 * means "not allowed" and anything else is a real error.
 */
@Injectable()
export class FirestoreAccess extends AccessPort {
  private readonly injector = inject(Injector);

  async isAllowed(uid: string): Promise<boolean> {
    const db = this.injector.get(FIRESTORE);
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.config, 'access'));
      return isAllowed(uid, (snap.data() as AccessConfigDoc | undefined)?.allowedUids);
    } catch (e) {
      if (e instanceof FirebaseError && e.code === 'permission-denied') return false;
      throw e;
    }
  }
}
