import { inject, Injectable, Injector } from '@angular/core';
import { collection, deleteDoc, doc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import { COLLECTIONS, type NotifyDoc } from '@ani/contracts';
import { FIRESTORE } from '@shared/infrastructure';
import { NotifyRepository, type NotifyEntry } from '../domain';

/** `users/{uid}/notify/{key}` */
@Injectable()
export class FirestoreNotifyRepository extends NotifyRepository {
  private readonly injector = inject(Injector);
  private col(uid: string) {
    return collection(this.injector.get(FIRESTORE), COLLECTIONS.users, uid, COLLECTIONS.notify);
  }

  async list(uid: string): Promise<NotifyEntry[]> {
    const snap = await getDocs(this.col(uid));
    return snap.docs.map((d) => {
      const x = d.data() as Omit<NotifyDoc, 'at'> & { at: unknown };
      const at = x.at instanceof Timestamp ? x.at.toMillis() : Number(x.at) || 0;
      return { key: d.id, title: x.title, ...(x.ep !== undefined ? { ep: x.ep } : {}), at };
    });
  }

  async set(uid: string, e: NotifyEntry): Promise<void> {
    await setDoc(doc(this.col(uid), e.key), { title: e.title, ...(e.ep !== undefined ? { ep: e.ep } : {}), at: Timestamp.fromMillis(e.at) });
  }

  async remove(uid: string, key: string): Promise<void> {
    await deleteDoc(doc(this.col(uid), key));
  }
}
