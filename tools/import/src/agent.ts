/**
 * Import agent — the PC side of the app's Import page.
 *
 *   npm run agent -w @ani/import                       watch C:\Users\ivani\Videos\Anime
 *   npm run agent -w @ani/import -- --src D:\Anime     another folder
 *   npm run agent -w @ani/import -- --encoder x265     PC without NVIDIA
 *
 * Keeps running until Ctrl+C. Through Firestore (Admin SDK, so the security rules don't apply here):
 *   - `importAgent/main`  heartbeat every 20 s (online, host, folder, state, upload budget);
 *                         the app sets `scanRequestedAt` to ask for a rescan.
 *   - `importScan/{id}`   one doc per video file in the folder: parsed name, import state,
 *                         AniList match / candidates. Rescanned at start, on request, after each job
 *                         and every 10 minutes.
 *   - `importJobs/{id}`   the app queues jobs (list of scan ids); the agent runs them one at a time
 *                         with the same code path as `npm run import` and writes progress back.
 *                         `cancelRequested` stops after the current episode.
 * Originals are only read, exactly like the CLI.
 */
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  COLLECTIONS, IMPORT_AGENT_ID, toEpisodeId, toSeriesId,
  type AniListPick, type ImportAgentDoc, type ImportJobDoc, type ImportJobStage, type ImportScanDoc, type ImportScanStatus,
} from '@ani/contracts';
import type { Media } from './anilist.ts';
import { FirestoreCatalog } from './catalog.ts';
import { DEFAULTS } from './config.ts';
import { importFiles, Metadata, openSession, options, scanSources, sourceHash, type ImportSession } from './import.ts';
import { parseEpisodeName } from './parse-name.ts';
import { setProgressSink } from './progress.ts';
import { Report } from './report.ts';

const HEARTBEAT_MS = 20_000;
const RESCAN_EVERY_MS = 10 * 60_000;
const PROGRESS_EVERY_MS = 1_500;

type Firestore = import('firebase-admin/firestore').Firestore;
type AdminFs = typeof import('firebase-admin/firestore');

const pick = (m: Media): AniListPick => ({
  anilistId: m.id,
  title: m.title.english ?? m.title.romaji ?? m.title.native ?? `AniList ${m.id}`,
  posterUrl: m.coverImage?.large ?? m.coverImage?.extraLarge ?? null,
  year: m.seasonYear ?? m.startDate?.year ?? null,
  format: m.format ?? null,
});

/** Test seam: an in-memory Firestore and a stop signal instead of firebase-admin and Ctrl+C. */
export interface AgentDeps {
  db: Firestore;
  fromMillis: (ms: number) => unknown;
  stop: Promise<void>;
}

export async function agent(argv: string[], deps?: AgentDeps): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      src: { type: 'string' },
      encoder: { type: 'string', default: 'nvenc' },
      'daily-limit': { type: 'string' },
      // testing: Drive + catalogue in a local folder (the agent's own docs still go to Firestore)
      out: { type: 'string' },
      'no-anilist': { type: 'boolean', default: false },
    },
  });
  const srcDir = path.resolve(values.src ?? DEFAULTS.animeDir);
  await fs.access(srcDir).catch(() => {
    throw new Error(`source folder not found: ${srcDir}`);
  });
  const baseArgs = [
    srcDir,
    '--encoder', values.encoder!,
    ...(values['daily-limit'] ? ['--daily-limit', values['daily-limit']] : []),
    ...(values.out ? ['--out', values.out] : []),
    ...(values['no-anilist'] ? ['--no-anilist'] : []),
  ];
  const opts = options(baseArgs, false);

  console.log(`ani.stream import agent — watching ${srcDir}`);
  const session = await openSession(opts, new Report('agent'));
  let db: Firestore;
  let ts: (ms: number) => unknown;
  if (deps) {
    db = deps.db;
    ts = deps.fromMillis;
  } else {
    if (opts.out) await FirestoreCatalog.open(); // initialises firebase-admin for the agent docs
    const admin: AdminFs = await import('firebase-admin/firestore');
    db = admin.getFirestore();
    ts = (ms) => admin.Timestamp.fromMillis(ms);
  }
  const agentRef = db.collection(COLLECTIONS.importAgent).doc(IMPORT_AGENT_ID);
  const startedAt = Date.now();

  let state: ImportAgentDoc['state'] = 'idle';
  let lastScanAt: number | null = null;
  let lastError: string | null = null;
  let busy = false;
  let stopping = false;
  const queue: string[] = [];

  const heartbeat = async (extra: Partial<Record<keyof ImportAgentDoc, unknown>> = {}) => {
    await agentRef
      .set(
        {
          host: os.hostname(),
          sourceDir: srcDir,
          state,
          encoder: opts.encoder === 'nvenc' ? 'hevc_nvenc' : 'libx265',
          lastSeen: ts(Date.now()),
          startedAt: ts(startedAt),
          lastScanAt: lastScanAt ? ts(lastScanAt) : null,
          uploadedToday: session.budget.used(),
          dailyLimit: session.budget.limit,
          error: lastError,
          ...extra,
        },
        { merge: true },
      )
      .catch((e: Error) => console.warn(`  heartbeat failed: ${e.message}`));
  };

  // ── scan ──────────────────────────────────────────────────────────────────────────────────

  const scanNow = async () => {
    if (busy) return;
    busy = true;
    state = 'scanning';
    await heartbeat();
    try {
      const files = await scanSources([srcDir]);
      // fresh metadata each scan, so overrides set from the app are picked up
      const metadata = new Metadata(session.catalog, { ...opts, refreshMeta: false });
      const seen = new Set<string>();
      for (const file of files) {
        const doc = await planEntry(session, metadata, file, srcDir).catch((e: Error) => {
          console.warn(`  scan ${path.basename(file)}: ${e.message}`);
          return null;
        });
        if (!doc) continue;
        seen.add(doc.id);
        const { id, ...data } = doc;
        await db
          .collection(COLLECTIONS.importScan)
          .doc(id)
          .set({ ...data, mtime: ts(data.mtime), scannedAt: ts(data.scannedAt) });
      }
      const existing = await db.collection(COLLECTIONS.importScan).listDocuments();
      const stale = existing.filter((d) => !seen.has(d.id));
      for (let i = 0; i < stale.length; i += 400) {
        const b = db.batch();
        stale.slice(i, i + 400).forEach((d) => b.delete(d));
        await b.commit();
      }
      lastScanAt = Date.now();
      lastError = null;
      console.log(`  scanned ${files.length} files${stale.length ? `, ${stale.length} gone` : ''}`);
    } catch (e) {
      lastError = `scan failed: ${(e as Error).message}`;
      console.warn(`  ${lastError}`);
    } finally {
      busy = false;
      state = 'idle';
      await heartbeat();
      void drain();
    }
  };

  // ── jobs ──────────────────────────────────────────────────────────────────────────────────

  const runJob = async (jobId: string) => {
    const ref = db.collection(COLLECTIONS.importJobs).doc(jobId);
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || (snap.data() as ImportJobDoc).status !== 'queued') return null;
      tx.update(ref, { status: 'running', startedAt: ts(Date.now()) });
      return snap.data() as ImportJobDoc;
    });
    if (!claimed) return;

    state = 'importing';
    await heartbeat();
    let cancel = !!claimed.cancelRequested;
    const unsubJob = ref.onSnapshot((s) => {
      if ((s.data() as ImportJobDoc | undefined)?.cancelRequested) cancel = true;
    });
    const report = new Report('import');
    report.log(`ani.stream import (from the app, job ${jobId})`);
    const jobSession: ImportSession = {
      ...session,
      opts: { ...session.opts, forceEncode: !!claimed.forceEncode, replace: !!claimed.replace },
      report,
      metadata: new Metadata(session.catalog, session.opts),
    };
    const results: ImportJobDoc['results'] = {};
    let failed = 0;
    // encode of one episode overlaps the upload of the previous one: two slots
    let current: ImportJobDoc['current'] = null;
    let uploading: ImportJobDoc['uploading'] = null;
    let lastPush = 0;
    const push = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastPush < PROGRESS_EVERY_MS) return;
      lastPush = now;
      await ref.update({ current, uploading, results }).catch(() => undefined);
    };
    setProgressSink((e) => {
      if (e.kind === 'encode' && current) current = { ...current, fraction: e.fraction };
      // only the video (last file, by far the biggest) drives the upload bar
      else if (e.kind === 'upload' && uploading && e.label.endsWith('.mp4')) {
        uploading = { ...uploading, fraction: e.fraction, bytesPerSec: Math.round(e.bytesPerSec ?? 0) };
      } else return;
      void push();
    });

    try {
      // resolve scan ids → files (missing ones fail right away)
      const files: string[] = [];
      const fileIds: string[] = [];
      for (const id of claimed.sources) {
        const scan = await db.collection(COLLECTIONS.importScan).doc(id).get();
        const doc = scan.data() as { relPath?: string } | undefined;
        if (!doc?.relPath) {
          results[id] = { outcome: 'failed', detail: 'file is no longer in the folder' };
          failed++;
          continue;
        }
        files.push(path.join(srcDir, doc.relPath));
        fileIds.push(id);
      }
      const labelOf = (id: string) => claimed.labels?.[claimed.sources.indexOf(id)] ?? id;
      await importFiles(jobSession, files, {
        shouldStop: () => (cancel || stopping ? 'cancelled' : null),
        stage: (i, stage) => {
          const id = fileIds[i]!;
          if (stage === 'upload') {
            if (current?.source === id) current = null;
            uploading = { source: id, label: labelOf(id), stage: 'upload', fraction: 0, bytesPerSec: 0 };
          } else if (stage === 'firestore') {
            if (uploading?.source === id) uploading = { ...uploading, stage: 'firestore', fraction: 1 };
          } else {
            current = { source: id, label: labelOf(id), stage: stage as ImportJobStage, fraction: 0 };
          }
          void push(true);
        },
        done: (i, entry) => {
          const id = fileIds[i]!;
          const outcome = entry.outcome === 'stopped' && entry.detail === 'cancelled' ? 'cancelled' : entry.outcome;
          results[id] = { outcome, detail: outcome === 'cancelled' ? null : (entry.detail ?? null) };
          if (entry.outcome === 'failed' || entry.outcome === 'unsupported') failed++;
          if (entry.outcome === 'stopped') cancel = true; // Drive limit: the rest waits for the next job
          if (current?.source === id) current = null;
          if (uploading?.source === id) uploading = null;
          void push(true);
        },
      });
      current = null;
      uploading = null;
      report.summary([]);
      await report.save().catch(() => undefined);
      const allCancelled = Object.values(results).every((r) => r.outcome === 'cancelled');
      await ref.update({
        status: allCancelled ? 'cancelled' : failed ? 'failed' : 'done',
        current: null,
        uploading: null,
        results,
        finishedAt: ts(Date.now()),
        error: failed ? `${failed} episode${failed === 1 ? '' : 's'} failed` : null,
      });
    } catch (e) {
      await ref
        .update({ status: 'failed', current: null, uploading: null, results, finishedAt: ts(Date.now()), error: (e as Error).message })
        .catch(() => undefined);
    } finally {
      setProgressSink(null);
      unsubJob();
      state = 'idle';
    }
  };

  const drain = async () => {
    if (busy || stopping) return;
    const next = queue.shift();
    if (!next) return;
    busy = true;
    try {
      await runJob(next);
    } catch (e) {
      console.warn(`  job ${next}: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
    if (queue.length) void drain();
    else void scanNow(); // statuses changed
  };

  // ── listeners ─────────────────────────────────────────────────────────────────────────────

  const unsubAgent = agentRef.onSnapshot((s) => {
    const req = s.get('scanRequestedAt') as import('firebase-admin/firestore').Timestamp | null | undefined;
    if (req && (!lastScanAt || req.toMillis() > lastScanAt) && !busy) void scanNow();
  });
  const unsubJobs = db
    .collection(COLLECTIONS.importJobs)
    .where('status', '==', 'queued')
    .onSnapshot((snap) => {
      const ids = snap.docs
        .map((d) => ({ id: d.id, at: (d.get('createdAt') as import('firebase-admin/firestore').Timestamp | undefined)?.toMillis() ?? 0 }))
        .sort((a, b) => a.at - b.at)
        .map((d) => d.id);
      for (const id of ids) if (!queue.includes(id)) queue.push(id);
      void drain();
    });

  const beat = setInterval(() => void heartbeat(), HEARTBEAT_MS);
  const rescan = setInterval(() => void scanNow(), RESCAN_EVERY_MS);

  const shutdown = async () => {
    stopping = true;
    while (busy && state === 'importing') await new Promise((r) => setTimeout(r, 500));
    clearInterval(beat);
    clearInterval(rescan);
    unsubAgent();
    unsubJobs();
    state = 'stopped';
    await heartbeat({ lastSeen: ts(0) });
  };

  void scanNow();
  if (deps) {
    await deps.stop;
    await shutdown();
    return;
  }
  await new Promise<void>((resolve) => {
    let presses = 0;
    process.on('SIGINT', () => {
      presses++;
      if (presses > 1) process.exit(130);
      console.log(busy ? '\n  Ctrl+C — finishing the current episode, then stopping (again to quit now).' : '\n  stopping…');
      void shutdown().then(resolve);
    });
  });
  process.exit(0);
}

/** One `importScan` doc for a file: parse, import state, duplicate check, AniList match (no probe). */
async function planEntry(
  s: ImportSession,
  metadata: Metadata,
  file: string,
  srcDir: string,
): Promise<ImportScanDoc & { id: string }> {
  const st = await fs.stat(file);
  const id = sourceHash(file, st.size);
  const fileName = path.basename(file);
  const base: ImportScanDoc & { id: string } = {
    id,
    fileName,
    relPath: path.relative(srcDir, file),
    size: st.size,
    mtime: Math.round(st.mtimeMs),
    parsed: null,
    parseError: null,
    seriesId: null,
    episodeId: null,
    status: 'new',
    error: null,
    inLibrary: false,
    match: null,
    matchProblem: null,
    candidates: [],
    scannedAt: Date.now(),
  };
  const name = parseEpisodeName(fileName);
  if (!name.ok) return { ...base, status: 'unparseable', parseError: name.reason };
  const v = name.value;
  const seriesId = toSeriesId(v.title);
  const episodeId = toEpisodeId({ season: v.season, episode: v.episode });
  const parsed = { title: v.title, season: v.season, episode: v.episode, group: v.group, quality: v.quality, seasonAssumed: v.seasonAssumed };

  const stateDoc = await s.catalog.getImportState(id);
  let status: ImportScanStatus = 'new';
  let error: string | null = null;
  if (stateDoc?.status === 'done') status = 'imported';
  else if (stateDoc?.status === 'pending') status = 'pending';
  else if (stateDoc?.status === 'failed') {
    status = 'failed';
    error = stateDoc.error ?? null;
  }
  if (status !== 'imported') {
    const others = (await s.catalog.findImportsForEpisode(seriesId, episodeId)).filter((o) => o.id !== id && o.doc.status === 'done');
    if (others.length) {
      status = 'duplicate';
      error = `${episodeId.toUpperCase()} already imported from ${path.basename(others[0]!.doc.path)}`;
    }
  }

  const meta = await metadata.get(seriesId, v.title);
  return {
    ...base,
    parsed,
    seriesId,
    episodeId,
    status,
    error,
    inLibrary: !!meta.existing,
    match: meta.media ? pick(meta.media) : null,
    matchProblem: meta.matchProblem,
    candidates: meta.candidates.map(pick),
  };
}
