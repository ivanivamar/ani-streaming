import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ImportStore,
  inTab,
  jobProgress,
  formatSpeed,
  matchDropped,
  SELECTABLE,
  STAGE_LABEL,
  type ImportJob,
  type ReviewTab,
  type ScanEntry,
  type ScanGroup,
} from '@importing/application';
import { formatAgo } from '@shared/kernel';
import { Dropdown, Icon, Pill, posterBackground, Stagger, type DropdownOption } from '@shared/ui';

const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

const OUTCOME_LABEL: Record<string, string> = {
  imported: 'Imported',
  unchanged: 'Already imported',
  duplicate: 'Duplicate',
  unsupported: 'Unsupported',
  unparseable: "Name couldn't be read",
  failed: 'Failed',
  stopped: 'Stopped (Drive limit)',
  cancelled: 'Cancelled',
};

interface Chip {
  readonly n: string;
  readonly cls: 'new' | 'done' | 'bad' | 'dup' | 'busy';
  readonly tip: string;
}

/**
 * Import (v3, adapted to the PC agent). The page lists what the agent found in its folder on the
 * PC, grouped by series + season and matched to AniList; you pick episodes (checkboxes, or drop
 * the same files on the drop zone) and queue them. The agent encodes and uploads them one at a
 * time with the Step 1/2 pipeline and reports progress here. Desktop only.
 */
@Component({
  selector: 'app-import-page',
  imports: [Dropdown, Icon, Pill, RouterLink, Stagger],
  templateUrl: './import.page.html',
  styleUrl: './import.page.css',
})
export class ImportPage {
  protected readonly store = inject(ImportStore);

  protected readonly tab = signal<ReviewTab>('all');
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly open = signal<ReadonlySet<string>>(new Set());
  protected readonly dragOver = signal(false);
  protected readonly forceEncode = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly copied = signal(false);
  protected readonly command = 'npm run agent -w @ani/import';

  constructor() {
    this.store.connect(inject(DestroyRef));
  }

  protected readonly groups = computed(() => this.store.groups().filter((g) => inTab(g, this.tab())));

  protected readonly tabs = computed(() => {
    const all = this.store.groups();
    const sum = (f: (g: ScanGroup) => number) => all.reduce((s, g) => s + f(g), 0);
    return [
      { value: 'all' as ReviewTab, name: 'All', count: this.store.scan().length },
      { value: 'new' as ReviewTab, name: 'Ready', count: sum((g) => (g.match ? g.newCount : 0)) },
      { value: 'review' as ReviewTab, name: 'Needs review', count: sum((g) => g.reviewCount) },
      { value: 'imported' as ReviewTab, name: 'Imported', count: sum((g) => g.importedCount) },
    ];
  });

  /** selectable ids in the current tab */
  private readonly selectableHere = computed(() =>
    this.groups().flatMap((g) => g.entries.filter((e) => this.canSelect(e)).map((e) => e.id)),
  );

  protected readonly selectedEntries = computed(() => {
    const sel = this.selected();
    return this.store.scan().filter((e) => sel.has(e.id) && this.canSelect(e));
  });
  protected readonly selectedBytes = computed(() => this.selectedEntries().reduce((s, e) => s + e.size, 0));
  protected readonly allSelected = computed(() => {
    const ids = this.selectableHere();
    return ids.length > 0 && ids.every((id) => this.selected().has(id));
  });

  protected readonly agentLine = computed(() => {
    const a = this.store.agent();
    if (!a) return null;
    const state = a.state === 'importing' ? 'importing' : a.state === 'scanning' ? 'scanning the folder…' : 'idle';
    return {
      host: a.host,
      folder: a.sourceDir,
      state,
      scanned: a.lastScanAt ? `scanned ${formatAgo(a.lastScanAt, this.store.now())}` : 'not scanned yet',
      budget: `${gb(a.uploadedToday)} of ${gb(a.dailyLimit)} uploaded in 24 h`,
      seen: formatAgo(a.lastSeen, this.store.now()),
    };
  });

  /* ── selection ── */

  canSelect(e: ScanEntry): boolean {
    return SELECTABLE.has(e.status) && !!e.match && !this.store.busyIds().has(e.id);
  }

  protected groupState(g: ScanGroup): 'all' | 'some' | 'none' {
    const ids = g.entries.filter((e) => this.canSelect(e)).map((e) => e.id);
    const n = ids.filter((id) => this.selected().has(id)).length;
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
  }

  protected groupSelectable(g: ScanGroup): boolean {
    return g.entries.some((e) => this.canSelect(e));
  }

  protected toggleGroup(g: ScanGroup): void {
    const ids = g.entries.filter((e) => this.canSelect(e)).map((e) => e.id);
    const on = this.groupState(g) !== 'all';
    this.selected.update((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });
  }

  protected toggleEntry(e: ScanEntry): void {
    if (!this.canSelect(e)) return;
    this.selected.update((s) => {
      const n = new Set(s);
      if (!n.delete(e.id)) n.add(e.id);
      return n;
    });
  }

  protected toggleAll(): void {
    const ids = this.selectableHere();
    const on = !this.allSelected();
    this.selected.update((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });
  }

  protected toggleOpen(g: ScanGroup): void {
    this.open.update((s) => {
      const n = new Set(s);
      if (!n.delete(g.key)) n.add(g.key);
      return n;
    });
  }

  /* ── drop zone ── */

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(true);
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
    this.pickFiles(Array.from(e.dataTransfer?.files ?? []));
  }

  protected onPicked(input: HTMLInputElement): void {
    this.pickFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  private pickFiles(files: File[]): void {
    const { ids, unknown } = matchDropped(this.store.scan(), files.map((f) => ({ name: f.name, size: f.size })));
    const byId = new Map(this.store.scan().map((e) => [e.id, e]));
    const usable = ids.filter((id) => byId.get(id) && this.canSelect(byId.get(id)!));
    this.selected.update((s) => new Set([...s, ...usable]));
    const skipped = ids.length - usable.length;
    const parts: string[] = [];
    if (usable.length) parts.push(`Selected ${usable.length} episode${usable.length === 1 ? '' : 's'}.`);
    if (skipped) parts.push(`${skipped} already imported, queued or needing review.`);
    if (unknown.length) {
      const where = this.store.agent()?.sourceDir ?? 'the agent’s folder';
      parts.push(`${unknown.length} file${unknown.length === 1 ? ' isn’t' : 's aren’t'} in ${where} — move ${unknown.length === 1 ? 'it' : 'them'} there and rescan.`);
    }
    this.notice.set(parts.join(' ') || 'No video files in that drop.');
    if (usable.length) this.tab.set('all');
  }

  /* ── actions ── */

  protected async rescan(): Promise<void> {
    await this.store.requestScan().catch((e: Error) => this.notice.set(`Couldn't ask for a rescan: ${e.message}`));
  }

  protected async queue(): Promise<void> {
    const ids = this.selectedEntries().map((e) => e.id);
    if (!ids.length) return;
    this.busy.set(true);
    try {
      await this.store.queue(ids, { forceEncode: this.forceEncode() });
      this.selected.set(new Set());
      this.notice.set(this.store.online() ? null : 'Queued. The agent starts as soon as it runs on the PC.');
    } catch (e) {
      this.notice.set(`Couldn't queue: ${(e as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected cancel(job: ImportJob): void {
    void this.store.cancel(job.id).catch((e: Error) => this.notice.set(e.message));
  }

  protected useMatch(g: ScanGroup, anilistId: number): void {
    if (!g.seriesId) return;
    void this.store.useMatch(g.seriesId, anilistId).catch((e: Error) => this.notice.set(`Couldn't save the match: ${e.message}`));
  }

  protected copyCommand(): void {
    void navigator.clipboard?.writeText(this.command).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }

  /* ── view helpers ── */

  protected candidateOptions(g: ScanGroup): DropdownOption<number>[] {
    return g.candidates.map((c) => ({
      value: c.anilistId,
      label: c.title,
      sub: [c.format, c.year, `id ${c.anilistId}`].filter(Boolean).join(' · '),
      poster: c.posterUrl ?? posterBackground(null, `al${c.anilistId}`),
    }));
  }

  protected srcMeta(g: ScanGroup): string {
    return [
      `${g.entries.length} file${g.entries.length === 1 ? '' : 's'}`,
      gb(g.bytes),
      g.quality,
      g.groupNames.join(', '),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected chips(g: ScanGroup): Chip[] {
    return g.entries.map((e) => {
      const n = e.parsed ? String(e.parsed.episode).padStart(2, '0') : '?';
      if (this.store.busyIds().has(e.id)) return { n, cls: 'busy', tip: 'In the import queue' };
      switch (e.status) {
        case 'imported':
          return { n, cls: 'done', tip: 'Imported' };
        case 'duplicate':
          return { n, cls: 'dup', tip: e.error ?? 'Duplicate' };
        case 'failed':
        case 'unparseable':
          return { n, cls: 'bad', tip: e.error ?? e.parseError ?? 'Failed' };
        default:
          return { n, cls: 'new', tip: e.status === 'pending' ? 'Interrupted — will resume' : 'Not imported yet' };
      }
    });
  }

  protected entryStatus(e: ScanEntry): string {
    if (this.store.busyIds().has(e.id)) return 'Queued';
    switch (e.status) {
      case 'imported':
        return 'Imported';
      case 'pending':
        return 'Interrupted — resumes';
      case 'failed':
        return `Failed: ${e.error ?? 'unknown error'}`;
      case 'duplicate':
        return e.error ?? 'Duplicate';
      case 'unparseable':
        return `Can’t read the name: ${e.parseError}. Rename it like “Title - S01E05.mkv”.`;
      default:
        return e.match ? 'New' : 'Needs an AniList match';
    }
  }

  protected entryLabel(e: ScanEntry): string {
    return e.episodeId ? e.episodeId.toUpperCase().replace(/^S\d+/, '') : '—';
  }

  protected size(b: number): string {
    return gb(b);
  }

  protected poster(url: string | null, id: number): string {
    return posterBackground(url, `al${id}`);
  }

  protected progress(job: ImportJob): number {
    return jobProgress(job);
  }

  protected jobTitle(job: ImportJob): string {
    const n = job.sources.length;
    const ep = `${n} episode${n === 1 ? '' : 's'}`;
    switch (job.status) {
      case 'queued':
        return `Waiting to import ${ep}`;
      case 'running':
        return `Importing ${ep}`;
      case 'done':
        return `Imported ${ep}`;
      case 'cancelled':
        return `Cancelled · ${ep}`;
      default:
        return `Import finished with problems · ${ep}`;
    }
  }

  protected jobLine(job: ImportJob): string {
    if (job.status === 'queued') return this.store.online() ? 'Next in line' : 'Waiting for the agent on the PC';
    const parts: string[] = [];
    if (job.current) {
      const stage = STAGE_LABEL[job.current.stage] ?? job.current.stage;
      const pct = job.current.stage === 'encode' && job.current.fraction > 0 ? ` · ${Math.round(job.current.fraction * 100)}%` : '';
      parts.push(`${stage} ${job.current.label}${pct}`);
    }
    if (job.uploading) {
      const u = job.uploading;
      if (u.stage === 'firestore') parts.push(`Saving ${u.label}`);
      else parts.push(`Uploading ${u.label} · ${Math.round(u.fraction * 100)}%${u.bytesPerSec ? ` · ${formatSpeed(u.bytesPerSec)}` : ''}`);
    }
    if (parts.length) return parts.join('  ·  ') + (job.cancelRequested ? ' · stopping after these' : '');
    const done = Object.keys(job.results).length;
    if (job.status === 'running') return `${done} of ${job.sources.length} done`;
    return job.error ?? (job.finishedAt ? `Finished ${formatAgo(job.finishedAt, this.store.now())}` : '');
  }

  protected jobChips(job: ImportJob): { label: string; cls: string; tip: string }[] {
    return job.sources.map((s, i) => {
      const r = job.results[s];
      const label = (job.labels[i] ?? '').split(' ').pop() ?? '';
      if (r) {
        const ok = r.outcome === 'imported' || r.outcome === 'unchanged';
        return { label, cls: ok ? 'done' : r.outcome === 'cancelled' ? 'skip' : 'bad', tip: `${job.labels[i]}: ${OUTCOME_LABEL[r.outcome] ?? r.outcome}${r.detail ? ` — ${r.detail}` : ''}` };
      }
      if (job.current?.source === s) return { label, cls: 'busy', tip: `${job.labels[i]}: encoding` };
      if (job.uploading?.source === s) return { label, cls: 'busy', tip: `${job.labels[i]}: uploading` };
      return { label, cls: 'wait', tip: `${job.labels[i]}: waiting` };
    });
  }

  protected failures(job: ImportJob): { label: string; detail: string }[] {
    return job.sources
      .map((s, i) => ({ r: job.results[s], label: job.labels[i] ?? s }))
      .filter(({ r }) => r && !['imported', 'unchanged', 'cancelled'].includes(r.outcome))
      .map(({ r, label }) => ({ label, detail: `${OUTCOME_LABEL[r!.outcome] ?? r!.outcome}${r!.detail ? ` — ${r!.detail}` : ''}` }));
  }
}
