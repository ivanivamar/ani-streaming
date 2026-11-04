import type { AgentStatus, ImportJob, ScanEntry } from './models';

/**
 * Port: the Firestore side of the PC import agent (`npm run agent -w @ani/import`).
 * `watch*` start a live listener and return its unsubscribe.
 */
export abstract class ImportGateway {
  abstract watchAgent(cb: (agent: AgentStatus | null) => void, err: (e: Error) => void): () => void;
  abstract watchScan(cb: (entries: ScanEntry[]) => void, err: (e: Error) => void): () => void;
  abstract watchJobs(cb: (jobs: ImportJob[]) => void, err: (e: Error) => void): () => void;
  abstract requestScan(): Promise<void>;
  abstract createJob(job: { sources: string[]; labels: string[]; createdBy: string; forceEncode: boolean; replace: boolean }): Promise<string>;
  abstract cancelJob(id: string): Promise<void>;
  /** `overrides/{seriesId}.anilistId` — the importer's manual AniList match. */
  abstract setOverride(seriesId: string, anilistId: number): Promise<void>;
}
