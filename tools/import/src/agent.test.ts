/**
 * End-to-end test of the import agent: a real (tiny) MKV, a real x265 encode into a local
 * `--out` folder (LocalStore + LocalCatalog), and an in-memory stand-in for the Firestore
 * documents the app and the agent share (importAgent, importScan, importJobs).
 * Skipped when ffmpeg with libx265 isn't installed.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// ── a minimal in-memory Firestore (only what agent.ts uses) ─────────────────────────────────

class FakeTimestamp {
  readonly ms: number;
  constructor(ms: number) {
    this.ms = ms;
  }
  toMillis() {
    return this.ms;
  }
}

type Data = Record<string, unknown>;
type Listener = () => void;

class FakeDb {
  readonly store = new Map<string, Map<string, Data>>();
  private listeners = new Set<Listener>();

  private col(name: string) {
    let c = this.store.get(name);
    if (!c) this.store.set(name, (c = new Map()));
    return c;
  }
  notify() {
    queueMicrotask(() => [...this.listeners].forEach((l) => l()));
  }
  listen(l: Listener) {
    this.listeners.add(l);
    queueMicrotask(l);
    return () => this.listeners.delete(l);
  }

  collection(name: string) {
    const db = this;
    const col = () => this.col(name);
    const snapOf = (id: string) => {
      const data = col().get(id);
      return { id, exists: !!data, data: () => (data ? structuredClone(data) : undefined), get: (k: string) => data?.[k] };
    };
    const docRef = (id: string) => ({
      id,
      async set(data: Data, opts?: { merge?: boolean }) {
        col().set(id, opts?.merge ? { ...(col().get(id) ?? {}), ...data } : { ...data });
        db.notify();
      },
      async update(data: Data) {
        if (!col().has(id)) throw new Error(`no doc ${name}/${id}`);
        col().set(id, { ...col().get(id), ...data });
        db.notify();
      },
      async get() {
        return snapOf(id);
      },
      onSnapshot(cb: (s: ReturnType<typeof snapOf>) => void) {
        return db.listen(() => cb(snapOf(id)));
      },
      _delete() {
        col().delete(id);
        db.notify();
      },
    });
    return {
      doc: docRef,
      async listDocuments() {
        return [...col().keys()].map(docRef);
      },
      where(field: string, _op: '==', value: unknown) {
        return {
          onSnapshot(cb: (s: { docs: ReturnType<typeof snapOf>[] }) => void) {
            return db.listen(() => cb({ docs: [...col().entries()].filter(([, d]) => d[field] === value).map(([id]) => snapOf(id)) }));
          },
        };
      },
    };
  }

  batch() {
    const ops: Array<() => void> = [];
    return {
      delete: (ref: { _delete(): void }) => ops.push(() => ref._delete()),
      commit: async () => ops.forEach((o) => o()),
    };
  }

  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn({
      get: (ref: { get(): Promise<unknown> }) => ref.get(),
      update: (ref: { update(d: Data): Promise<void> }, d: Data) => void ref.update(d),
    });
  }
}

const hasX265 = (() => {
  try {
    return execFileSync(process.env['FFMPEG_PATH'] || 'ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes('libx265');
  } catch {
    return false;
  }
})();

const until = async (what: string, ok: () => boolean, ms = 120_000) => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

test('agent: scan → job from the app → x265 import → job done, rescan shows imported', { skip: !hasX265, timeout: 180_000 }, async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ani-agent-'));
  const src = path.join(tmp, 'src');
  const out = path.join(tmp, 'out');
  await fs.mkdir(src, { recursive: true });
  const file = path.join(src, '[Test] Agentshow - S01E02 (1080p).mkv');
  const file3 = path.join(src, '[Test] Agentshow - S01E03 (1080p).mkv');
  for (const f of [file, file3]) {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=3',
      '-f', 'lavfi', '-i', `sine=frequency=${f === file ? 440 : 660}:duration=3`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-c:a', 'aac', '-metadata:s:a:0', 'language=jpn', '-shortest', f,
    ]);
  }
  await fs.writeFile(path.join(src, 'Not an episode.mkv'), 'x');

  const db = new FakeDb();
  let stop!: () => void;
  const stopped = new Promise<void>((r) => (stop = r));
  const { agent } = await import('./agent.ts');
  const running = agent(['--src', src, '--out', out, '--encoder', 'x265', '--no-anilist'], {
    db: db as never,
    fromMillis: (ms) => new FakeTimestamp(ms),
    stop: stopped,
  });

  const scan = () => [...(db.store.get('importScan')?.values() ?? [])];
  await until('the first scan', () => scan().length === 3 && db.store.get('importAgent')?.get('main')?.['state'] === 'idle');
  const ep = scan().find((d) => d['fileName'] === path.basename(file))!;
  assert.equal(ep['status'], 'new');
  assert.equal(ep['seriesId'], 'agentshow');
  assert.equal(ep['episodeId'], 's01e02');
  assert.equal(scan().find((d) => d['fileName'] === 'Not an episode.mkv')!['status'], 'unparseable');
  const scanId = [...db.store.get('importScan')!.entries()].find(([, d]) => d === ep)?.[0];
  const scanId3 = [...db.store.get('importScan')!.entries()].find(([, d]) => d['fileName'] === path.basename(file3))?.[0];
  assert.ok(scanId && scanId3);

  // the app queues a job (same fields as FirestoreImportGateway.createJob)
  await db.collection('importJobs').doc('job1').set({
    sources: [scanId, scanId3], labels: ['Agentshow S01E02', 'Agentshow S01E03'], createdBy: 'u1', forceEncode: false, replace: false,
    createdAt: new FakeTimestamp(Date.now()), status: 'queued', cancelRequested: false, current: null, results: {},
    startedAt: null, finishedAt: null, error: null,
  });

  const job = () => db.store.get('importJobs')!.get('job1')!;
  await until('the job to finish', () => ['done', 'failed', 'cancelled'].includes(job()['status'] as string));
  assert.equal(job()['status'], 'done', JSON.stringify(job()));
  const results = job()['results'] as Record<string, { outcome: string }>;
  assert.equal(results[scanId!]!.outcome, 'imported');
  assert.equal(results[scanId3!]!.outcome, 'imported');
  assert.equal(job()['current'], null);
  assert.equal(job()['uploading'], null);

  // catalogue + "Drive" in the out folder
  const epDoc = JSON.parse(await fs.readFile(path.join(out, 'firestore', 'series', 'agentshow', 'episodes', 's01e02.json'), 'utf8'));
  assert.equal(epDoc.number, 2);
  const ep3 = JSON.parse(await fs.readFile(path.join(out, 'firestore', 'series', 'agentshow', 'episodes', 's01e03.json'), 'utf8'));
  assert.equal(ep3.number, 3);

  // the agent rescans after a job
  await until('the rescan', () => scan().find((d) => d['fileName'] === path.basename(file))?.['status'] === 'imported');

  stop();
  await running;
  assert.equal(db.store.get('importAgent')!.get('main')!['state'], 'stopped');
  await fs.rm(tmp, { recursive: true, force: true });
});
