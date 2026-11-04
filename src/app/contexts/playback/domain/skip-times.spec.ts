import type { Chapter } from '@ani/contracts';
import { chapterSkips, missingSkipKinds, seasonAnilistId, skipSegments, type ExternalSkip } from './skip-times';

const ch = (kind: Chapter['kind'], startSec: number, endSec: number, title: string = kind): Chapter => ({ title, kind, startSec, endSec });
const ext = (kind: ExternalSkip['kind'], startSec: number, endSec: number, episodeLengthSec = 0): ExternalSkip => ({ kind, startSec, endSec, episodeLengthSec });

/** Aoashi S01E01 as imported: nothing tagged (OP song used as the ending). */
const AOASHI_E01: Chapter[] = [ch('other', 0, 1356, 'Intro'), ch('other', 1356, 1444, 'OP'), ch('other', 1444, 1474, 'Preview')];
const AOASHI_LEN = 1474;

describe('skip times', () => {
  it('uses only the chapters when they mark both OP and ED', () => {
    const chapters = [ch('other', 0, 122), ch('op', 122, 215), ch('ed', 1434, 1524)];
    expect(missingSkipKinds(chapters)).toEqual([]);
    expect(skipSegments(chapters, [ext('op', 10, 100), ext('ed', 1300, 1390)], 1524)).toEqual(chapterSkips(chapters));
  });

  it('fills OP and ED from AniSkip when the chapters mark neither (Aoashi E01)', () => {
    expect(missingSkipKinds(AOASHI_E01)).toEqual(['op', 'ed']);
    const got = skipSegments(AOASHI_E01, [ext('ed', 1356.4, 1444.2, 1475)], AOASHI_LEN);
    expect(got).toEqual([{ kind: 'ed', startSec: 1356.4, endSec: 1444.2, source: 'aniskip' }]);
  });

  it('only fills the kind the chapters miss', () => {
    const chapters = [ch('op', 60, 150)];
    const got = skipSegments(chapters, [ext('op', 0, 90), ext('ed', 1300, 1390)], 1440);
    expect(got.map((s) => [s.kind, s.source])).toEqual([
      ['op', 'chapters'],
      ['ed', 'aniskip'],
    ]);
  });

  it('drops times from a cut of a different length, bad ranges and non-song lengths', () => {
    expect(skipSegments([], [ext('op', 0, 90, 1500)], 1440)).toEqual([]); // 60 s longer
    expect(skipSegments([], [ext('op', 90, 80)], 1440)).toEqual([]); // reversed
    expect(skipSegments([], [ext('op', 0, 8)], 1440)).toEqual([]); // too short
    expect(skipSegments([], [ext('ed', 1438, 1530)], 1440)).toEqual([]); // starts at the very end
    expect(skipSegments([], [ext('op', 0, 90, 1450)], 1440)).toHaveLength(1); // 10 s off: ok
  });

  it('prefers a clean OP over mixed-op, then the closest episode length, and clamps to the video', () => {
    const got = skipSegments([], [ext('mixed-op', 0, 90, 1440), ext('op', 5, 95, 1449), ext('op', 6, 96, 1442), ext('ed', 1350, 1445, 1440)], 1440);
    expect(got[0]).toEqual({ kind: 'op', startSec: 6, endSec: 96, source: 'aniskip' });
    expect(got[1].endSec).toBe(1440);
    expect(skipSegments([], [ext('mixed-op', 0, 90)], 1440)[0].kind).toBe('op');
  });

  it("finds the season's AniList id (season doc, else the series for season 1)", () => {
    const seasons = [
      { number: 1, anilistId: null },
      { number: 2, anilistId: 222 },
    ];
    expect(seasonAnilistId(1, seasons, 111)).toBe(111);
    expect(seasonAnilistId(2, seasons, 111)).toBe(222);
    expect(seasonAnilistId(3, seasons, 111)).toBeNull();
    expect(seasonAnilistId(1, [], null)).toBeNull();
  });
});
