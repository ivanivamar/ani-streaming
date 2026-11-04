import type { Chapter, SubtitleTrack } from '@ani/contracts';
import { captionModes, captionTrack, initialCaption, skippableChapter } from './player-rules';

const ch = (kind: Chapter['kind'], startSec: number, endSec: number): Chapter => ({ title: kind, kind, startSec, endSec });
const sub = (kind: SubtitleTrack['kind']): SubtitleTrack => ({ lang: 'en', kind, driveFileId: kind });

describe('player rules', () => {
  it('offers a skip during OP/ED but not in the last 2 s', () => {
    const chapters = [ch('other', 0, 122), ch('op', 122, 215), ch('ed', 1434, 1524)];
    expect(skippableChapter(chapters, 100)).toBeNull();
    expect(skippableChapter(chapters, 130)?.kind).toBe('op');
    expect(skippableChapter(chapters, 214)).toBeNull();
    expect(skippableChapter(chapters, 1500)?.kind).toBe('ed');
  });

  it('derives CC modes from the subtitle tracks', () => {
    expect(captionModes([sub('full'), sub('signs')])).toEqual(['full', 'signs', 'off']);
    expect(captionModes([])).toEqual(['off']);
    expect(initialCaption([sub('signs')], 'full')).toBe('signs');
    expect(initialCaption([sub('full')], 'off')).toBe('off');
    expect(captionTrack([sub('full'), sub('songs')], 'signs')?.kind).toBe('songs');
    expect(captionTrack([sub('full')], 'off')).toBeNull();
  });
});
