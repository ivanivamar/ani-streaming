import { inject, Injectable, Injector } from '@angular/core';
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { COLLECTIONS, IMPORT_AGENT_ID } from '@ani/contracts';
import { FIRESTORE } from '@shared/infrastructure';
import { ImportGateway, type AgentStatus, type ImportJob, type ScanEntry } from '../domain';

/** Timestamps → ms, deep. */
function plain<T>(data: unknown): T {
  const conv = (x: unknown): unknown => {
    if (x instanceof Timestamp) return x.toMillis();
    if (Array.isArray(x)) return x.map(conv);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, conv(v)]));
    return x;
  };
  return conv(data) as T;
}

const JOBS_SHOWN = 20;

/** `importAgent/main`, `importScan`, `importJobs`, `overrides` (rules: allowlisted users only). */
@Injectable()
export class FirestoreImportGateway extends ImportGateway {
  private readonly injector = inject(Injector);
  private get db() {
    return this.injector.get(FIRESTORE);
  }

  watchAgent(cb: (agent: AgentStatus | null) => void, err: (e: Error) => void): () => void {
    return onSnapshot(
      doc(this.db, COLLECTIONS.importAgent, IMPORT_AGENT_ID),
      (s) => cb(s.exists() ? plain<AgentStatus>(s.data()) : null),
      err,
    );
  }

  watchScan(cb: (entries: ScanEntry[]) => void, err: (e: Error) => void): () => void {
    return onSnapshot(collection(this.db, COLLECTIONS.importScan), (s) => cb(s.docs.map((d) => ({ ...plain<ScanEntry>(d.data()), id: d.id }))), err);
  }

  watchJobs(cb: (jobs: ImportJob[]) => void, err: (e: Error) => void): () => void {
    return onSnapshot(
      query(collection(this.db, COLLECTIONS.importJobs), orderBy('createdAt', 'desc'), limit(JOBS_SHOWN)),
      (s) => cb(s.docs.map((d) => ({ ...plain<ImportJob>(d.data()), id: d.id }))),
      err,
    );
  }

  async requestScan(): Promise<void> {
    await updateDoc(doc(this.db, COLLECTIONS.importAgent, IMPORT_AGENT_ID), { scanRequestedAt: serverTimestamp() });
  }

  async createJob(job: { sources: string[]; labels: string[]; createdBy: string; forceEncode: boolean; replace: boolean }): Promise<string> {
    const ref = await addDoc(collection(this.db, COLLECTIONS.importJobs), {
      ...job,
      createdAt: serverTimestamp(),
      status: 'queued',
      cancelRequested: false,
      current: null,
      results: {},
      startedAt: null,
      finishedAt: null,
      error: null,
    });
    return ref.id;
  }

  async cancelJob(id: string): Promise<void> {
    await updateDoc(doc(this.db, COLLECTIONS.importJobs, id), { cancelRequested: true });
  }

  async setOverride(seriesId: string, anilistId: number): Promise<void> {
    await setDoc(doc(this.db, COLLECTIONS.overrides, seriesId), { anilistId }, { merge: true });
  }
}
