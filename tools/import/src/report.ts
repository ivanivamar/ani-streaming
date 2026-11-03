/**
 * Run report: every line printed is also kept for the log file, and each source file gets one
 * entry with its outcome. Saved as `tmp/import-logs/<command>-<time>.log` (+ `.json`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULTS } from './config.ts';

export type Outcome =
  | 'imported'
  | 'planned'
  | 'unchanged'
  | 'unparseable'
  | 'duplicate'
  | 'unsupported'
  | 'failed'
  | 'stopped';

export interface FileEntry {
  file: string;
  outcome: Outcome;
  episode?: string;
  action?: string;
  detail?: string;
  notes: string[];
  sourceBytes?: number;
  outputBytes?: number;
  uploadedBytes?: number;
  seconds?: number;
}

export class Report {
  readonly lines: string[] = [];
  readonly entries: FileEntry[] = [];
  readonly started = new Date();

  readonly command: string;
  constructor(command: string) {
    this.command = command;
  }

  log(line = ''): void {
    console.log(line);
    this.lines.push(line);
  }

  warn(line: string): void {
    console.warn(line);
    this.lines.push(line);
  }

  add(e: FileEntry): FileEntry {
    this.entries.push(e);
    return e;
  }

  count(o: Outcome): number {
    return this.entries.filter((e) => e.outcome === o).length;
  }

  summary(extra: string[] = []): void {
    const gb = (b: number) => `${(b / 1e9).toFixed(2)} GB`;
    const sum = (k: 'sourceBytes' | 'outputBytes' | 'uploadedBytes') =>
      this.entries.reduce((s, e) => s + (e.outcome === 'imported' ? (e[k] ?? 0) : 0), 0);
    this.log('');
    this.log('─'.repeat(72));
    const parts = (['imported', 'planned', 'unchanged', 'duplicate', 'unparseable', 'unsupported', 'failed', 'stopped'] as const)
      .map((o) => [o, this.count(o)] as const)
      .filter(([, n]) => n > 0)
      .map(([o, n]) => `${n} ${o}`);
    this.log(`${this.command}: ${parts.join(', ') || 'nothing to do'}`);
    if (this.count('imported')) {
      this.log(`  source ${gb(sum('sourceBytes'))} → output ${gb(sum('outputBytes'))}, uploaded ${gb(sum('uploadedBytes'))}`);
    }
    for (const l of extra) this.log(l);

    const needs = this.entries.filter((e) => ['unparseable', 'unsupported', 'failed', 'duplicate'].includes(e.outcome));
    if (needs.length) {
      this.log('');
      this.log('Needs attention:');
      for (const e of needs) this.log(`  [${e.outcome}] ${e.file}${e.detail ? ` — ${e.detail}` : ''}`);
    }
    const noted = this.entries.filter((e) => e.notes.length && !needs.includes(e));
    if (noted.length) {
      this.log('');
      this.log('Notes:');
      for (const e of noted) {
        this.log(`  ${e.episode ?? e.file}`);
        for (const n of e.notes) this.log(`    · ${n}`);
      }
    }
  }

  async save(): Promise<string> {
    await fs.mkdir(DEFAULTS.logDir, { recursive: true });
    const stamp = this.started.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const base = path.join(DEFAULTS.logDir, `${this.command}-${stamp}`);
    await fs.writeFile(`${base}.log`, this.lines.join('\n') + '\n');
    await fs.writeFile(
      `${base}.json`,
      JSON.stringify({ command: this.command, started: this.started.toISOString(), finished: new Date().toISOString(), entries: this.entries }, null, 2),
    );
    return `${base}.log`;
  }
}

/** Bytes uploaded in the last 24 h (Drive's 750 GB limit is a rolling window). */
export class UploadBudget {
  private events: Array<{ at: number; bytes: number }> = [];
  private readonly file: string;
  readonly limit: number;
  constructor(file: string, limit: number) {
    this.file = file;
    this.limit = limit;
  }

  async load(): Promise<this> {
    try {
      this.events = JSON.parse(await fs.readFile(this.file, 'utf8')) as Array<{ at: number; bytes: number }>;
    } catch {
      this.events = [];
    }
    this.prune();
    return this;
  }

  private prune() {
    const since = Date.now() - 24 * 3600 * 1000;
    this.events = this.events.filter((e) => e.at >= since);
  }

  used(): number {
    this.prune();
    return this.events.reduce((s, e) => s + e.bytes, 0);
  }

  /** When enough of the window frees up for `bytes` more. */
  freeAt(bytes: number): Date {
    this.prune();
    let used = this.used();
    for (const e of [...this.events].sort((a, b) => a.at - b.at)) {
      if (used + bytes <= this.limit) break;
      used -= e.bytes;
      if (used + bytes <= this.limit) return new Date(e.at + 24 * 3600 * 1000);
    }
    return new Date();
  }

  async add(bytes: number): Promise<void> {
    if (bytes <= 0) return;
    this.events.push({ at: Date.now(), bytes });
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.events));
  }
}
