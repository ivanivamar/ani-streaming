import type { EpisodeId, SeriesId } from '@ani/contracts';
import { fraction, isWatched, nextEpisode, parseProgressId, resumeTarget, type WatchProgress } from './index';

const eps = [1, 2, 3].map((n) => ({ id: `s01e0${n}`, season: 1, number: n }));
const p = (ep: number, position: number, at: number): WatchProgress => ({
  seriesId: 'aoashi' as SeriesId,
  episodeId: `s01e0${ep}` as EpisodeId,
  position,
  duration: 100,
  updatedAt: at,
});

describe('library domain', () => {
  it('computes fraction and watched with a threshold', () => {
    expect(fraction(p(1, 50, 1))).toBe(0.5);
    expect(fraction({ position: 5, duration: 0 })).toBe(0);
    expect(isWatched(p(1, 90, 1), 0.9)).toBe(true);
    expect(isWatched(p(1, 89, 1), 0.9)).toBe(false);
  });

  it('parses progress ids', () => {
    expect(parseProgressId('attack-on-titan_s02e05')).toEqual({ seriesId: 'attack-on-titan', episodeId: 's02e05' });
    expect(parseProgressId('nounderscore')).toBeNull();
  });

  it('resumes the latest unfinished episode, else the next one, else starts over', () => {
    const map = (list: WatchProgress[]) => (id: string) => list.find((x) => x.episodeId === id);
    expect(resumeTarget(eps, map([]), 0.9)).toMatchObject({ episode: eps[0], fresh: true });
    expect(resumeTarget(eps, map([p(1, 100, 1), p(2, 40, 2)]), 0.9)).toMatchObject({ episode: eps[1], position: 40 });
    expect(resumeTarget(eps, map([p(2, 95, 5), p(1, 10, 1)]), 0.9)).toMatchObject({ episode: eps[2], position: 0 });
    // last one watched, an earlier one isn't → that earlier one
    expect(resumeTarget(eps, map([p(3, 100, 5), p(2, 100, 4)]), 0.9)).toMatchObject({ episode: eps[0] });
    expect(resumeTarget(eps, map([p(1, 100, 1), p(2, 100, 2), p(3, 100, 3)]), 0.9)).toMatchObject({ episode: eps[0], finished: true });
    expect(resumeTarget([], map([]), 0.9)).toBeNull();
  });

  it('finds the next episode', () => {
    expect(nextEpisode(eps, 's01e02')).toBe(eps[2]);
    expect(nextEpisode(eps, 's01e03')).toBeNull();
  });
});
