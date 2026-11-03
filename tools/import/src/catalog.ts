/**
 * Step 2.5 — Firestore catalogue (firebase-admin, service account; the Admin SDK bypasses the
 * security rules). `LocalCatalog` mirrors the same documents as JSON files for `--out` test runs.
 *
 * Timestamps: the contract types carry milliseconds (`FirestoreTime`); they are stored as
 * Firestore `Timestamp`s and converted back when read.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  COLLECTIONS, type EpisodeDoc, type EpisodeId, type ImportStateDoc, type OverrideDoc, type SeasonDoc,
  type SeasonId, type SeriesDoc, type SeriesId,
} from '@ani/contracts';
import { FIREBASE_PROJECT_ID, SERVICE_ACCOUNT_FILE } from './config.ts';

export interface EpisodeCommit {
  seriesId: SeriesId;
  series: SeriesDoc;
  seasonId: SeasonId;
  season: SeasonDoc;
  episodeId: EpisodeId;
  episode: EpisodeDoc;
  stateId: string;
  state: ImportStateDoc;
}

export interface Catalog {
  describe(): string;
  readonly writable: boolean;
  getImportState(id: string): Promise<ImportStateDoc | null>;
  setImportState(id: string, doc: ImportStateDoc): Promise<void>;
  /** Other import sources already mapped to this episode. */
  findImportsForEpisode(seriesId: SeriesId, episodeId: EpisodeId): Promise<Array<{ id: string; doc: ImportStateDoc }>>;
  getOverride(seriesId: SeriesId): Promise<OverrideDoc | null>;
  getSeries(seriesId: SeriesId): Promise<SeriesDoc | null>;
  getSeason(seriesId: SeriesId, seasonId: SeasonId): Promise<SeasonDoc | null>;
  getEpisode(seriesId: SeriesId, episodeId: EpisodeId): Promise<EpisodeDoc | null>;
  /** Writes episode + season + series + importState, then recounts episodes/seasons. */
  commitEpisode(c: EpisodeCommit): Promise<{ seasonEpisodes: number; seriesEpisodes: number; seasons: number }>;
}

const TIME_KEYS = new Set(['addedAt', 'updatedAt', 'mtime', 'createdAt', 'at']);

// ---------------------------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------------------------

type Admin = typeof import('firebase-admin/firestore');

export class FirestoreCatalog implements Catalog {
  readonly writable = true;
  private readonly db: import('firebase-admin/firestore').Firestore;
  private readonly admin: Admin;
  private readonly projectId: string;
  private constructor(db: import('firebase-admin/firestore').Firestore, admin: Admin, projectId: string) {
    this.db = db;
    this.admin = admin;
    this.projectId = projectId;
  }

  static async open(): Promise<FirestoreCatalog> {
    let sa: { project_id?: string };
    try {
      sa = JSON.parse(await fs.readFile(SERVICE_ACCOUNT_FILE, 'utf8')) as { project_id?: string };
    } catch {
      throw new Error(
        `Missing ${SERVICE_ACCOUNT_FILE}\nFirebase console → myanime-streaming → Project settings → Service accounts → ` +
          '"Generate new private key", save the JSON there (or set GOOGLE_APPLICATION_CREDENTIALS).',
      );
    }
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const admin = await import('firebase-admin/firestore');
    const projectId = sa.project_id ?? FIREBASE_PROJECT_ID;
    const app = getApps()[0] ?? initializeApp({ credential: cert(SERVICE_ACCOUNT_FILE), projectId });
    const db = admin.getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });
    return new FirestoreCatalog(db, admin, projectId);
  }

  static async available(): Promise<boolean> {
    return fs.access(SERVICE_ACCOUNT_FILE).then(() => true, () => false);
  }

  describe(): string {
    return `Firestore → ${this.projectId}`;
  }

  private toFs(v: unknown, key = ''): unknown {
    if (typeof v === 'number' && TIME_KEYS.has(key)) return this.admin.Timestamp.fromMillis(v);
    if (Array.isArray(v)) return v.map((x) => this.toFs(x));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, this.toFs(x, k)]));
    }
    return v;
  }

  private fromFs<T>(v: unknown): T {
    const conv = (x: unknown): unknown => {
      if (x instanceof this.admin.Timestamp) return x.toMillis();
      if (Array.isArray(x)) return x.map(conv);
      if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, y]) => [k, conv(y)]));
      return x;
    };
    return conv(v) as T;
  }

  private series(id: SeriesId) {
    return this.db.collection(COLLECTIONS.series).doc(id);
  }

  private async get<T>(ref: import('firebase-admin/firestore').DocumentReference): Promise<T | null> {
    const snap = await ref.get();
    return snap.exists ? this.fromFs<T>(snap.data()) : null;
  }

  getImportState(id: string) {
    return this.get<ImportStateDoc>(this.db.collection(COLLECTIONS.importState).doc(id));
  }

  async setImportState(id: string, doc: ImportStateDoc): Promise<void> {
    await this.db.collection(COLLECTIONS.importState).doc(id).set(this.toFs(doc) as Record<string, unknown>);
  }

  async findImportsForEpisode(seriesId: SeriesId, episodeId: EpisodeId) {
    const snap = await this.db
      .collection(COLLECTIONS.importState)
      .where('episodeRef.seriesId', '==', seriesId)
      .where('episodeRef.episodeId', '==', episodeId)
      .get();
    return snap.docs.map((d) => ({ id: d.id, doc: this.fromFs<ImportStateDoc>(d.data()) }));
  }

  getOverride(seriesId: SeriesId) {
    return this.get<OverrideDoc>(this.db.collection(COLLECTIONS.overrides).doc(seriesId));
  }
  getSeries(seriesId: SeriesId) {
    return this.get<SeriesDoc>(this.series(seriesId));
  }
  getSeason(seriesId: SeriesId, seasonId: SeasonId) {
    return this.get<SeasonDoc>(this.series(seriesId).collection(COLLECTIONS.seasons).doc(seasonId));
  }
  getEpisode(seriesId: SeriesId, episodeId: EpisodeId) {
    return this.get<EpisodeDoc>(this.series(seriesId).collection(COLLECTIONS.episodes).doc(episodeId));
  }

  async commitEpisode(c: EpisodeCommit) {
    const s = this.series(c.seriesId);
    const batch = this.db.batch();
    batch.set(s, this.toFs(c.series) as Record<string, unknown>);
    batch.set(s.collection(COLLECTIONS.seasons).doc(c.seasonId), this.toFs(c.season) as Record<string, unknown>);
    batch.set(s.collection(COLLECTIONS.episodes).doc(c.episodeId), this.toFs(c.episode) as Record<string, unknown>);
    batch.set(this.db.collection(COLLECTIONS.importState).doc(c.stateId), this.toFs(c.state) as Record<string, unknown>);
    await batch.commit();

    const eps = s.collection(COLLECTIONS.episodes);
    const [seasonCount, seriesCount, seasons] = await Promise.all([
      eps.where('season', '==', c.season.number).count().get(),
      eps.count().get(),
      s.collection(COLLECTIONS.seasons).count().get(),
    ]);
    const counts = {
      seasonEpisodes: seasonCount.data().count,
      seriesEpisodes: seriesCount.data().count,
      seasons: seasons.data().count,
    };
    const fix = this.db.batch();
    fix.update(s.collection(COLLECTIONS.seasons).doc(c.seasonId), { episodeCount: counts.seasonEpisodes });
    fix.update(s, { episodeCount: counts.seriesEpisodes, seasonCount: counts.seasons });
    await fix.commit();
    return counts;
  }
}

// ---------------------------------------------------------------------------------------------
// Local JSON mirror (`--out <dir>`): <dir>/firestore/<collection>/<doc>.json
// ---------------------------------------------------------------------------------------------

export class LocalCatalog implements Catalog {
  readonly writable = true;
  readonly dir: string;
  constructor(outDir: string) {
    this.dir = path.resolve(outDir, 'firestore');
  }
  describe(): string {
    return `local JSON → ${this.dir}`;
  }
  private file(...parts: string[]) {
    return path.join(this.dir, ...parts.slice(0, -1), `${parts.at(-1)}.json`);
  }
  private async read<T>(...parts: string[]): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(...parts), 'utf8')) as T;
    } catch {
      return null;
    }
  }
  private async write(doc: unknown, ...parts: string[]) {
    const f = this.file(...parts);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, JSON.stringify(doc, null, 2));
  }
  getImportState(id: string) {
    return this.read<ImportStateDoc>(COLLECTIONS.importState, id);
  }
  setImportState(id: string, doc: ImportStateDoc) {
    return this.write(doc, COLLECTIONS.importState, id);
  }
  async findImportsForEpisode(seriesId: SeriesId, episodeId: EpisodeId) {
    const dir = path.join(this.dir, COLLECTIONS.importState);
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const out: Array<{ id: string; doc: ImportStateDoc }> = [];
    for (const n of names) {
      const id = n.replace(/\.json$/, '');
      const doc = await this.read<ImportStateDoc>(COLLECTIONS.importState, id);
      if (doc?.episodeRef?.seriesId === seriesId && doc.episodeRef.episodeId === episodeId) out.push({ id, doc });
    }
    return out;
  }
  getOverride(seriesId: SeriesId) {
    return this.read<OverrideDoc>(COLLECTIONS.overrides, seriesId);
  }
  getSeries(seriesId: SeriesId) {
    return this.read<SeriesDoc>(COLLECTIONS.series, seriesId);
  }
  getSeason(seriesId: SeriesId, seasonId: SeasonId) {
    return this.read<SeasonDoc>(COLLECTIONS.series, seriesId, COLLECTIONS.seasons, seasonId);
  }
  getEpisode(seriesId: SeriesId, episodeId: EpisodeId) {
    return this.read<EpisodeDoc>(COLLECTIONS.series, seriesId, COLLECTIONS.episodes, episodeId);
  }
  async commitEpisode(c: EpisodeCommit) {
    await this.write(c.episode, COLLECTIONS.series, c.seriesId, COLLECTIONS.episodes, c.episodeId);
    await this.write(c.state, COLLECTIONS.importState, c.stateId);
    const epDir = path.join(this.dir, COLLECTIONS.series, c.seriesId, COLLECTIONS.episodes);
    const eps = await Promise.all(
      (await fs.readdir(epDir)).map(async (n) => JSON.parse(await fs.readFile(path.join(epDir, n), 'utf8')) as EpisodeDoc),
    );
    const seasonsDir = path.join(this.dir, COLLECTIONS.series, c.seriesId, COLLECTIONS.seasons);
    await this.write({ ...c.season, episodeCount: eps.filter((e) => e.season === c.season.number).length }, COLLECTIONS.series, c.seriesId, COLLECTIONS.seasons, c.seasonId);
    const seasons = (await fs.readdir(seasonsDir)).length;
    const counts = { seasonEpisodes: eps.filter((e) => e.season === c.season.number).length, seriesEpisodes: eps.length, seasons };
    await this.write({ ...c.series, episodeCount: eps.length, seasonCount: seasons }, COLLECTIONS.series, c.seriesId);
    return counts;
  }
}

/** Read-only stand-in for dry runs without credentials. */
export class NoCatalog implements Catalog {
  readonly writable = false;
  describe() {
    return 'no Firestore (secrets/service-account.json missing) — importState and overrides not checked';
  }
  getImportState() { return Promise.resolve(null); }
  setImportState() { return Promise.reject(new Error('read-only')); }
  findImportsForEpisode() { return Promise.resolve([]); }
  getOverride() { return Promise.resolve(null); }
  getSeries() { return Promise.resolve(null); }
  getSeason() { return Promise.resolve(null); }
  getEpisode() { return Promise.resolve(null); }
  commitEpisode(): Promise<never> { return Promise.reject(new Error('read-only')); }
}
