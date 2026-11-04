import type { Chapter } from '@ani/contracts';

/**
 * Skip OP/ED: the episode's own chapters first, AniSkip (crowd-sourced times, keyed by MAL id)
 * for whatever the chapters don't mark. Aoashi S01E01 is the typical case: its chapters are
 * "Intro / OP / Preview" with the opening song used as the ending, so nothing gets tagged.
 */

export type SkipKind = 'op' | 'ed';

/** One skippable range in the player. */
export interface SkipSegment {
  readonly kind: SkipKind;
  readonly startSec: number;
  readonly endSec: number;
  readonly source: 'chapters' | 'aniskip';
}

/** One AniSkip result, already in seconds. `episodeLengthSec` is the submitter's video length (0 = unknown). */
export interface ExternalSkip {
  readonly kind: 'op' | 'ed' | 'mixed-op' | 'mixed-ed';
  readonly startSec: number;
  readonly endSec: number;
  readonly episodeLengthSec: number;
}

export interface SkipTimesQuery {
  /** AniList id of the *season* the episode belongs to (AniSkip maps it to MAL) */
  readonly anilistId: number;
  /** episode number inside that season */
  readonly episode: number;
  readonly durationSec: number;
}

/** Port: external skip times (AniSkip on the web; the Android app reuses the same adapter). */
export abstract class SkipTimesPort {
  /** Empty when nothing is known. Rejects only on network/API failure. */
  abstract find(query: SkipTimesQuery): Promise<ExternalSkip[]>;
}

/** AniSkip times are only trusted when the submitter's video is about as long as ours. */
export const SKIP_LENGTH_TOLERANCE_SEC = 12;
/** OP/ED song length window (same idea as the importer's chapter tagging, a bit wider). */
const MIN_SKIP_SEC = 20;
const MAX_SKIP_SEC = 200;

/** OP/ED from the chapters (the importer tags at most one of each). */
export function chapterSkips(chapters: readonly Chapter[]): SkipSegment[] {
  return chapters
    .filter((c): c is Chapter & { kind: SkipKind } => c.kind === 'op' || c.kind === 'ed')
    .map((c) => ({ kind: c.kind, startSec: c.startSec, endSec: c.endSec, source: 'chapters' as const }));
}

/** Which of OP / ED the chapters don't cover (→ ask AniSkip). */
export function missingSkipKinds(chapters: readonly Chapter[]): SkipKind[] {
  const have = new Set(chapterSkips(chapters).map((s) => s.kind));
  return (['op', 'ed'] as const).filter((k) => !have.has(k));
}

/**
 * Chapters + the best AniSkip result for each kind the chapters miss. AniSkip results are
 * dropped when the submitter's episode length is off by more than the tolerance (different cut,
 * times would be shifted), when they fall outside the video, or aren't song-length. A clean
 * `op`/`ed` beats `mixed-op`/`mixed-ed` (song over story); then the closest episode length wins.
 */
export function skipSegments(chapters: readonly Chapter[], external: readonly ExternalSkip[], durationSec: number): SkipSegment[] {
  const out = chapterSkips(chapters);
  for (const kind of missingSkipKinds(chapters)) {
    const best = external
      .filter((x) => x.kind === kind || x.kind === `mixed-${kind}`)
      .filter((x) => usable(x, durationSec))
      .sort((a, b) => rank(a, kind, durationSec) - rank(b, kind, durationSec))[0];
    if (best) {
      out.push({ kind, startSec: Math.max(0, best.startSec), endSec: Math.min(best.endSec, durationSec), source: 'aniskip' });
    }
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

function usable(x: ExternalSkip, durationSec: number): boolean {
  const len = x.endSec - x.startSec;
  if (!(len >= MIN_SKIP_SEC && len <= MAX_SKIP_SEC)) return false;
  if (x.startSec < 0 || (durationSec > 0 && x.startSec >= durationSec - 5)) return false;
  if (x.episodeLengthSec > 0 && durationSec > 0 && Math.abs(x.episodeLengthSec - durationSec) > SKIP_LENGTH_TOLERANCE_SEC) return false;
  return true;
}

function rank(x: ExternalSkip, kind: SkipKind, durationSec: number): number {
  const mixed = x.kind === kind ? 0 : 1000;
  const off = x.episodeLengthSec > 0 && durationSec > 0 ? Math.abs(x.episodeLengthSec - durationSec) : SKIP_LENGTH_TOLERANCE_SEC;
  return mixed + off;
}

/**
 * AniList id for one season: the season doc's own id, else the series id for season 1 (the
 * importer stores the first season's match on the series). Null → no AniSkip lookup.
 */
export function seasonAnilistId(
  season: number,
  seasons: readonly { number: number; anilistId: number | null }[],
  seriesAnilistId: number | null,
): number | null {
  return seasons.find((s) => s.number === season)?.anilistId ?? (season === 1 ? seriesAnilistId : null);
}
