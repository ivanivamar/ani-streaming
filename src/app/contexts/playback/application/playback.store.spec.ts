import { TestBed } from '@angular/core/testing';
import { CatalogStore, type Episode, type Series } from '@catalog/application';
import { DecoderProbePort, SkipTimesPort, VideoSourcePort, type ExternalSkip, type SkipTimesQuery } from '../domain';
import { PlaybackStore, type PlayableEpisode } from './playback.store';

type Chapter = Episode['chapters'][number];
const ch = (kind: Chapter['kind'], startSec: number, endSec: number): Chapter => ({ title: kind, kind, startSec, endSec });

function playable(chapters: Chapter[], season = 1, anilistId: number | null = 134732): PlayableEpisode {
  return {
    series: { id: 'aoashi', anilistId } as unknown as Series,
    episode: { id: 's01e01', season, number: 1, durationSec: 1474, chapters } as unknown as Episode,
    detail: null,
    src: '/__drive/x',
  };
}

describe('PlaybackStore.skips', () => {
  let queries: SkipTimesQuery[];
  let answer: () => Promise<ExternalSkip[]>;

  beforeEach(() => {
    queries = [];
    answer = async () => [{ kind: 'ed', startSec: 1356, endSec: 1444, episodeLengthSec: 1475 }];
    TestBed.configureTestingModule({
      providers: [
        { provide: CatalogStore, useValue: {} },
        { provide: VideoSourcePort, useValue: {} },
        { provide: DecoderProbePort, useValue: {} },
        {
          provide: SkipTimesPort,
          useValue: {
            find: (q: SkipTimesQuery) => {
              queries.push(q);
              return answer();
            },
          },
        },
      ],
    });
  });

  it('asks AniSkip when the chapters mark no OP/ED (Aoashi E01)', async () => {
    const got = await TestBed.inject(PlaybackStore).skips(playable([ch('other', 0, 1356), ch('other', 1356, 1444)]));
    expect(queries).toEqual([{ anilistId: 134732, episode: 1, durationSec: 1474 }]);
    expect(got).toEqual([{ kind: 'ed', startSec: 1356, endSec: 1444, source: 'aniskip' }]);
  });

  it("doesn't ask when the chapters have both, or when there's no AniList id", async () => {
    const store = TestBed.inject(PlaybackStore);
    await store.skips(playable([ch('op', 60, 150), ch('ed', 1300, 1390)]));
    await store.skips(playable([], 2, 111));
    expect(queries).toEqual([]);
  });

  it('falls back to the chapters when AniSkip fails', async () => {
    answer = () => Promise.reject(new Error('offline'));
    const got = await TestBed.inject(PlaybackStore).skips(playable([ch('op', 60, 150)]));
    expect(got).toEqual([{ kind: 'op', startSec: 60, endSec: 150, source: 'chapters' }]);
  });
});
