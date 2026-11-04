import type { ScanEntry } from './models';
import { groupScan, inTab, isAgentOnline, jobProgress, matchDropped, type ImportJob } from './models';

const e = (id: string, ep: number, extra: Partial<ScanEntry> = {}): ScanEntry =>
  ({
    id,
    fileName: `[G] Aoashi - S01E0${ep} (1080p).mkv`,
    relPath: '',
    size: 100 + ep,
    mtime: 0,
    parsed: { title: 'Aoashi', season: 1, episode: ep, group: 'G', quality: '1080p', seasonAssumed: false },
    parseError: null,
    seriesId: 'aoashi',
    episodeId: `s01e0${ep}`,
    status: 'new',
    error: null,
    inLibrary: true,
    match: { anilistId: 1, title: 'Aoashi', posterUrl: null, year: 2022, format: 'TV' },
    matchProblem: null,
    candidates: [],
    scannedAt: 0,
    ...extra,
  }) as ScanEntry;

describe('importing domain', () => {
  it('groups by series + season and puts problems first', () => {
    const groups = groupScan([
      e('a2', 2),
      e('a1', 1, { status: 'imported' }),
      e('x', 0, { parsed: null, seriesId: null, status: 'unparseable', fileName: 'weird.mkv' }),
      e('b1', 1, { seriesId: 'zzz' as never, parsed: { title: 'Zzz', season: 1, episode: 1, group: '', quality: '', seasonAssumed: true }, match: null, matchProblem: 'no match' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['zzz|1', 'aoashi|1', '?']);
    expect(groups[1]!.entries.map((x) => x.id)).toEqual(['a1', 'a2']);
    expect(groups[1]!.newCount).toBe(1);
    expect(inTab(groups[0]!, 'review')).toBe(true);
    expect(inTab(groups[1]!, 'new')).toBe(true);
    expect(inTab(groups[1]!, 'imported')).toBe(true);
  });

  it('matches dropped files by name and size', () => {
    const r = matchDropped([e('a1', 1)], [
      { name: '[G] Aoashi - S01E01 (1080p).mkv', size: 101 },
      { name: 'Elsewhere - 01.mkv', size: 5 },
      { name: 'notes.txt', size: 1 },
    ]);
    expect(r).toEqual({ ids: ['a1'], unknown: ['Elsewhere - 01.mkv'] });
  });

  it('knows when the agent is online and how far a job is', () => {
    const agent = { state: 'idle', lastSeen: 1000 } as never;
    expect(isAgentOnline(agent, 30_000)).toBe(true);
    expect(isAgentOnline(agent, 200_000)).toBe(false);
    const job = {
      sources: ['a', 'b', 'c'],
      results: { a: { outcome: 'imported', detail: null } },
      current: { source: 'c', label: '', stage: 'encode', fraction: 0.5 },
      uploading: { source: 'b', label: '', stage: 'upload', fraction: 0.5, bytesPerSec: 1 },
    } as unknown as ImportJob;
    expect(jobProgress(job)).toBeCloseTo((1 + 0.3 + 0.8) / 3);
  });
});
