import {
  IMPORT_AGENT_STALE_MS,
  type ImportAgentDoc,
  type ImportJobDoc,
  type ImportScanDoc,
  type ImportScanStatus,
} from '@ani/contracts';

export type { AniListPick, ImportJobStage, ImportJobStatus, ImportScanStatus } from '@ani/contracts';

/** Timestamps in ms (the infrastructure converts Firestore Timestamps). */
export type ScanEntry = ImportScanDoc & { readonly id: string };
export type ImportJob = ImportJobDoc & { readonly id: string };
export type AgentStatus = ImportAgentDoc;

/** Heartbeat younger than 75 s. */
export function isAgentOnline(agent: AgentStatus | null, now: number): boolean {
  return !!agent && agent.state !== 'stopped' && now - agent.lastSeen < IMPORT_AGENT_STALE_MS;
}

/** Files that can be put in a job. */
export const SELECTABLE: ReadonlySet<ImportScanStatus> = new Set<ImportScanStatus>(['new', 'failed', 'pending']);

export type ReviewTab = 'all' | 'new' | 'review' | 'imported';

/** One row of the review list: a series + season from the file names. */
export interface ScanGroup {
  /** `seriesId|season`, or `?` for unparseable files */
  readonly key: string;
  readonly seriesId: string | null;
  readonly title: string;
  readonly season: number | null;
  readonly entries: readonly ScanEntry[];
  readonly bytes: number;
  readonly groupNames: readonly string[];
  readonly quality: string;
  readonly match: ScanEntry['match'];
  readonly matchProblem: string | null;
  readonly candidates: ScanEntry['candidates'];
  readonly inLibrary: boolean;
  /** which review tab(s) it belongs to */
  readonly needsReview: boolean;
  readonly newCount: number;
  readonly importedCount: number;
  /** files with a problem (unparseable, failed, duplicate, no AniList match) */
  readonly reviewCount: number;
}

const entryNeedsReview = (e: ScanEntry) =>
  e.status === 'unparseable' || e.status === 'failed' || e.status === 'duplicate' || (!e.match && e.status !== 'imported');

/** Group the scanned files by series + season (file order: season, episode). */
export function groupScan(entries: readonly ScanEntry[]): ScanGroup[] {
  const map = new Map<string, ScanEntry[]>();
  for (const e of entries) {
    const key = e.parsed && e.seriesId ? `${e.seriesId}|${e.parsed.season}` : '?';
    map.set(key, [...(map.get(key) ?? []), e]);
  }
  const groups: ScanGroup[] = [];
  for (const [key, list] of map) {
    const sorted = [...list].sort((a, b) => (a.parsed?.episode ?? 0) - (b.parsed?.episode ?? 0) || a.fileName.localeCompare(b.fileName));
    const first = sorted[0]!;
    const withMeta = sorted.find((e) => e.match) ?? first;
    groups.push({
      key,
      seriesId: first.seriesId,
      title: key === '?' ? 'Files the importer can\'t read' : first.parsed!.title,
      season: first.parsed?.season ?? null,
      entries: sorted,
      bytes: sorted.reduce((s, e) => s + e.size, 0),
      groupNames: [...new Set(sorted.map((e) => e.parsed?.group).filter((g): g is string => !!g))],
      quality: [...new Set(sorted.map((e) => e.parsed?.quality).filter((q): q is string => !!q))].join(' / '),
      match: withMeta.match,
      matchProblem: withMeta.matchProblem,
      candidates: withMeta.candidates,
      inLibrary: sorted.some((e) => e.inLibrary),
      needsReview: sorted.some(entryNeedsReview),
      reviewCount: sorted.filter(entryNeedsReview).length,
      newCount: sorted.filter((e) => SELECTABLE.has(e.status)).length,
      importedCount: sorted.filter((e) => e.status === 'imported').length,
    });
  }
  // needs review first, then new, then fully imported; alphabetical inside
  const rank = (g: ScanGroup) => (g.key === '?' ? 3 : g.needsReview ? 0 : g.newCount ? 1 : 2);
  return groups.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title) || (a.season ?? 0) - (b.season ?? 0));
}

export function inTab(g: ScanGroup, tab: ReviewTab): boolean {
  switch (tab) {
    case 'new':
      return g.newCount > 0 && !!g.match;
    case 'review':
      return g.needsReview;
    case 'imported':
      return g.importedCount > 0;
    default:
      return true;
  }
}

/**
 * Dropped / picked files → scan ids. The browser gives only names and sizes, so a file matches
 * a scanned one with the same name and size. Unknown files are returned so the page can say
 * they aren't in the agent's folder.
 */
export function matchDropped(
  entries: readonly ScanEntry[],
  files: readonly { name: string; size: number }[],
): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const f of files) {
    const hit = entries.find((e) => e.fileName === f.name && e.size === f.size) ?? entries.find((e) => e.fileName === f.name);
    if (hit) ids.push(hit.id);
    else if (/\.(mkv|mp4|m4v|webm|avi|m2ts|ts|mov)$/i.test(f.name)) unknown.push(f.name);
  }
  return { ids, unknown };
}

/** Overall job progress 0–1: finished episodes + the encoding one + the uploading one. */
export function jobProgress(job: ImportJob): number {
  const total = job.sources.length || 1;
  const done = Object.keys(job.results).length;
  const enc = job.current ? Math.min(1, job.current.fraction) * (job.current.stage === 'encode' ? 0.6 : 0.05) : 0;
  const up = job.uploading ? 0.6 + Math.min(1, job.uploading.fraction) * 0.4 : 0;
  return Math.min(1, (done + enc + up) / total);
}

/** `12.3 MB/s` */
export function formatSpeed(bytesPerSec: number): string {
  return bytesPerSec >= 1e6 ? `${(bytesPerSec / 1e6).toFixed(1)} MB/s` : `${Math.round(bytesPerSec / 1e3)} kB/s`;
}

export const STAGE_LABEL: Record<string, string> = {
  waiting: 'Starting',
  probe: 'Checking',
  encode: 'Encoding',
  extract: 'Extracting subtitles',
  upload: 'Uploading',
  firestore: 'Saving',
};
