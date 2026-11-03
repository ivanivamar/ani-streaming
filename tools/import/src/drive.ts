/**
 * Step 2.4 — Drive storage (ported from the music importer's `stores.js`) with **resumable
 * uploads that survive a restart**: the upload session URI is saved next to the work copy, so
 * an interrupted run (crash, Ctrl+C twice, Drive's daily limit) continues from the last
 * confirmed byte on the next run.
 *
 * Uploads are idempotent: a file with the same name and MD5 already in the folder is reused;
 * the same name with other content is overwritten in place (its file id stays the same).
 * Nothing is ever deleted from Drive.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { google, type drive_v3 } from 'googleapis';
import type { OAuthClient } from './auth.ts';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
/** Must be a multiple of 256 KiB. */
const CHUNK = 64 * 1024 * 1024;
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Drive refused more uploads today (750 GB / 24 h) or the account is full. Stops the run. */
export class DriveStopError extends Error {
  readonly kind: 'daily-limit' | 'storage-full';
  constructor(kind: 'daily-limit' | 'storage-full', message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface UploadResult {
  id: string;
  size: number;
  /** True when an identical file was already there (nothing uploaded). */
  reused: boolean;
  /** Bytes actually sent in this run. */
  sentBytes: number;
}

export interface UploadOptions {
  mimeType: string;
  /** Where the resumable session is remembered (inside the episode's work folder). */
  sessionFile?: string;
  label?: string;
}

export interface Store {
  describe(): string;
  /** `parts` are folder names under the root, e.g. `['series', 'attack-on-titan', 's01']`. */
  upload(localPath: string, name: string, parts: string[], opts: UploadOptions): Promise<UploadResult>;
}

export async function md5File(file: string): Promise<string> {
  const h = crypto.createHash('md5');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

interface GaxiosLikeError {
  code?: number | string;
  status?: number;
  response?: { status?: number; data?: { error?: { errors?: Array<{ reason?: string }>; message?: string } } };
  errors?: Array<{ reason?: string }>;
  message?: string;
}

function errorReason(err: GaxiosLikeError): string | undefined {
  return err.errors?.[0]?.reason ?? err.response?.data?.error?.errors?.[0]?.reason;
}

const DAILY_LIMIT_REASONS = new Set(['dailyLimitExceeded', 'uploadLimitExceeded', 'quotaExceeded']);

function stopErrorFor(reason: string | undefined, message: string): DriveStopError | null {
  if (reason && DAILY_LIMIT_REASONS.has(reason)) return new DriveStopError('daily-limit', `Drive daily upload limit reached (${reason})`);
  if (reason === 'storageQuotaExceeded') return new DriveStopError('storage-full', 'Drive storage is full');
  if (/upload limit|daily limit/i.test(message)) return new DriveStopError('daily-limit', `Drive daily upload limit reached (${message})`);
  return null;
}

async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const err = e as GaxiosLikeError;
      const code = Number(err.status ?? err.response?.status ?? err.code) || undefined;
      const reason = errorReason(err);
      const stop = stopErrorFor(reason, err.message ?? '');
      if (stop) throw stop;
      const retryable = !code || code === 429 || code >= 500 || (code === 403 && /rateLimit/i.test(reason ?? ''));
      if (!retryable || i >= tries) throw e;
      const wait = 1000 * 2 ** (i - 1) + Math.random() * 500;
      console.warn(`  ↻ ${label} failed (${reason ?? code ?? err.message}), retry ${i}/${tries - 1} in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
}

interface Session {
  uri: string;
  size: number;
  md5: string;
  startedAt: string;
}

export class DriveStore implements Store {
  private readonly drive: drive_v3.Drive;
  private readonly folders = new Map<string, Promise<string>>();
  private rootId = '';
  private readonly auth: OAuthClient;
  private readonly rootName: string;

  constructor(auth: OAuthClient, rootName: string) {
    this.auth = auth;
    this.rootName = rootName;
    this.drive = google.drive({ version: 'v3', auth });
  }

  async init(): Promise<this> {
    this.rootId = await this.findOrCreateFolder(this.rootName, 'root');
    this.folders.set('', Promise.resolve(this.rootId));
    return this;
  }

  describe(): string {
    return `Google Drive → /${this.rootName}`;
  }

  private async findChild(name: string, parentId: string, folder: boolean) {
    const mime = folder ? `mimeType = '${FOLDER_MIME}'` : `mimeType != '${FOLDER_MIME}'`;
    const res = await withRetry(
      () =>
        this.drive.files.list({
          q: `name = '${q(name)}' and '${parentId}' in parents and ${mime} and trashed = false`,
          fields: 'files(id, size, md5Checksum)',
          spaces: 'drive',
          pageSize: 10,
        }),
      `find ${name}`,
    );
    return res.data.files?.[0] ?? null;
  }

  private async findOrCreateFolder(name: string, parentId: string): Promise<string> {
    const found = await this.findChild(name, parentId, true);
    if (found?.id) return found.id;
    const res = await withRetry(
      () => this.drive.files.create({ requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] }, fields: 'id' }),
      `mkdir ${name}`,
    );
    if (!res.data.id) throw new Error(`Drive did not return an id for folder ${name}`);
    return res.data.id;
  }

  /** Resolves (creating as needed) a folder path. Cached across calls. */
  folder(parts: string[]): Promise<string> {
    const key = parts.join('/');
    const cached = this.folders.get(key);
    if (cached) return cached;
    const p = (async () => {
      const parent = await this.folder(parts.slice(0, -1));
      return this.findOrCreateFolder(parts.at(-1)!, parent);
    })();
    p.catch(() => this.folders.delete(key));
    this.folders.set(key, p);
    return p;
  }

  private async token(): Promise<string> {
    const t = await this.auth.getAccessToken();
    if (!t.token) throw new Error('no Drive access token');
    return t.token;
  }

  async upload(localPath: string, name: string, parts: string[], opts: UploadOptions): Promise<UploadResult> {
    const parentId = await this.folder(parts);
    const size = (await fsp.stat(localPath)).size;
    const md5 = await md5File(localPath);
    const existing = await this.findChild(name, parentId, false);
    if (existing?.id && existing.md5Checksum === md5) {
      return { id: existing.id, size, reused: true, sentBytes: 0 };
    }

    let session = await this.loadSession(opts.sessionFile, size, md5);
    let offset = 0;
    if (session) {
      const st = await this.queryStatus(session.uri, size);
      if (st.done) return this.finish(st.done, size, md5, 0);
      if (st.offset === null) session = null; // expired
      else offset = st.offset;
      if (session && offset > 0) console.log(`  ↪ resuming ${opts.label ?? name} at ${(offset / size * 100).toFixed(1)}%`);
    }
    if (!session) {
      session = await this.startSession(name, parentId, existing?.id ?? null, opts.mimeType, size, md5);
      if (opts.sessionFile) await fsp.writeFile(opts.sessionFile, JSON.stringify(session, null, 2));
    }

    const sentFrom = offset;
    const fd = await fsp.open(localPath, 'r');
    try {
      let failures = 0;
      while (true) {
        const len = Math.min(CHUNK, size - offset);
        const buf = Buffer.alloc(len);
        if (len > 0) await fd.read(buf, 0, len, offset);
        let res: Response;
        try {
          res = await fetch(session.uri, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${await this.token()}`,
              'Content-Length': String(len),
              'Content-Range': len > 0 ? `bytes ${offset}-${offset + len - 1}/${size}` : `bytes */${size}`,
            },
            body: buf,
          });
        } catch (e) {
          res = new Response(null, { status: 599, statusText: (e as Error).message });
        }

        if (res.status === 200 || res.status === 201) {
          const body = (await res.json()) as { id: string };
          if (process.stdout.isTTY) process.stdout.write('\r'.padEnd(72) + '\r');
          return this.finish(body.id, size, md5, size - sentFrom);
        }
        if (res.status === 308) {
          failures = 0;
          offset = rangeEnd(res.headers.get('range'));
          const msg = `  ↑ ${opts.label ?? name} ${(offset / size * 100).toFixed(1)}%`;
          if (process.stdout.isTTY) process.stdout.write(`\r${msg.padEnd(70)}`);
          continue;
        }
        const text = await res.text().catch(() => '');
        let reason: string | undefined;
        try {
          reason = (JSON.parse(text) as { error?: { errors?: Array<{ reason?: string }> } }).error?.errors?.[0]?.reason;
        } catch { /* not JSON */ }
        const stop = stopErrorFor(reason, text);
        if (stop) throw stop;
        if (res.status === 404 || res.status === 410) {
          // Session expired (they last about a week): start over.
          session = await this.startSession(name, parentId, existing?.id ?? null, opts.mimeType, size, md5);
          if (opts.sessionFile) await fsp.writeFile(opts.sessionFile, JSON.stringify(session, null, 2));
          offset = 0;
          continue;
        }
        const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit/i.test(reason ?? ''));
        if (!retryable || ++failures > 8) {
          // Repeated per-user rate limiting during an upload is how Drive reports the daily cap.
          if (res.status === 403 && reason === 'userRateLimitExceeded') {
            throw new DriveStopError('daily-limit', 'Drive keeps refusing uploads (userRateLimitExceeded) — most likely the 750 GB/day limit');
          }
          throw new Error(`upload ${name}: HTTP ${res.status} ${reason ?? ''} ${text.slice(0, 300)}`);
        }
        const wait = Math.min(60_000, 1000 * 2 ** (failures - 1) + Math.random() * 500);
        console.warn(`  ↻ upload ${name}: HTTP ${res.status} ${reason ?? res.statusText}, retry ${failures}/8 in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        const st = await this.queryStatus(session.uri, size);
        if (st.done) return this.finish(st.done, size, md5, size - sentFrom);
        if (st.offset !== null) offset = st.offset;
      }
    } finally {
      await fd.close();
    }
  }

  private async finish(id: string, size: number, md5: string, sentBytes: number): Promise<UploadResult> {
    const meta = await withRetry(() => this.drive.files.get({ fileId: id, fields: 'id, size, md5Checksum' }), 'check upload');
    if (Number(meta.data.size) !== size || (meta.data.md5Checksum && meta.data.md5Checksum !== md5)) {
      throw new Error(`Drive copy of ${id} does not match the local file (size ${meta.data.size} vs ${size})`);
    }
    return { id, size, reused: false, sentBytes };
  }

  private async loadSession(file: string | undefined, size: number, md5: string): Promise<Session | null> {
    if (!file) return null;
    try {
      const s = JSON.parse(await fsp.readFile(file, 'utf8')) as Session;
      return s.size === size && s.md5 === md5 ? s : null;
    } catch {
      return null;
    }
  }

  private async startSession(
    name: string, parentId: string, existingId: string | null, mimeType: string, size: number, md5: string,
  ): Promise<Session> {
    const url = existingId
      ? `${UPLOAD_URL}/${existingId}?uploadType=resumable&fields=id,size,md5Checksum`
      : `${UPLOAD_URL}?uploadType=resumable&fields=id,size,md5Checksum`;
    const body = existingId ? {} : { name, parents: [parentId], mimeType };
    return withRetry(async () => {
      const res = await fetch(url, {
        method: existingId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(size),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        let errors: Array<{ reason?: string }> | undefined;
        try { errors = (JSON.parse(text) as { error?: { errors?: Array<{ reason?: string }> } }).error?.errors; } catch { /* ignore */ }
        throw Object.assign(new Error(`start upload ${name}: HTTP ${res.status} ${text.slice(0, 300)}`), { status: res.status, errors });
      }
      const uri = res.headers.get('location');
      if (!uri) throw new Error('Drive did not return an upload session');
      return { uri, size, md5, startedAt: new Date().toISOString() };
    }, `start upload ${name}`);
  }

  /** Asks the session how much it has. `offset: null` = session gone. */
  private async queryStatus(uri: string, size: number): Promise<{ offset: number | null; done?: string }> {
    try {
      const res = await fetch(uri, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Length': '0', 'Content-Range': `bytes */${size}` },
      });
      if (res.status === 200 || res.status === 201) return { offset: size, done: ((await res.json()) as { id: string }).id };
      if (res.status === 308) return { offset: rangeEnd(res.headers.get('range')) };
      return { offset: null };
    } catch {
      return { offset: 0 };
    }
  }
}

/** `Range: bytes=0-1234` → next offset 1235; no header = nothing stored yet. */
function rangeEnd(range: string | null): number {
  const m = /bytes=\d+-(\d+)/.exec(range ?? '');
  return m ? Number(m[1]) + 1 : 0;
}

/** Local-folder store with the same API, for testing without Drive (`--out <dir>`). */
export class LocalStore implements Store {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = path.resolve(dir, 'drive');
  }
  async init(): Promise<this> {
    await fsp.mkdir(this.dir, { recursive: true });
    return this;
  }
  describe(): string {
    return `local folder → ${this.dir}`;
  }
  async upload(localPath: string, name: string, parts: string[]): Promise<UploadResult> {
    const dest = path.join(this.dir, ...parts, name);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const size = (await fsp.stat(localPath)).size;
    let reused = false;
    try {
      reused = (await md5File(dest)) === (await md5File(localPath));
    } catch { /* not there yet */ }
    if (!reused) await fsp.copyFile(localPath, dest);
    return { id: path.relative(this.dir, dest).split(path.sep).join('/'), size, reused, sentBytes: reused ? 0 : size };
  }
}
