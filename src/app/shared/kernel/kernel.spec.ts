import { formatDuration, parseEpisodeId, toEpisodeId, toSeasonId, toSeriesId } from './index';

describe('ids', () => {
  it('builds series slugs', () => {
    expect(toSeriesId('Attack on Titan')).toBe('attack-on-titan');
    expect(toSeriesId("Frieren: Beyond Journey's End")).toBe('frieren-beyond-journeys-end');
    expect(toSeriesId('Pokémon')).toBe('pokemon');
  });

  it('rejects titles without usable characters', () => {
    expect(() => toSeriesId('!!!')).toThrow(RangeError);
  });

  it('round-trips episode ids', () => {
    expect(toSeasonId(1)).toBe('s01');
    expect(toEpisodeId({ season: 1, episode: 5 })).toBe('s01e05');
    expect(toEpisodeId({ season: 2, episode: 112 })).toBe('s02e112');
    expect(parseEpisodeId('s02e112')).toEqual({ season: 2, episode: 112 });
    expect(parseEpisodeId('S1E5')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(1425)).toBe('23:45');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-3)).toBe('0:00');
  });
});
