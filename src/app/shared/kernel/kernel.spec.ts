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

describe('relative time', () => {
  const now = Date.UTC(2026, 10, 3, 12);
  it('formats ago', async () => {
    const { formatAgo } = await import('./format');
    expect(formatAgo(now - 30_000, now)).toBe('just now');
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatAgo(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('formats countdowns and minutes left', async () => {
    const { formatCountdown, formatMinutesLeft, epLabel } = await import('./format');
    expect(formatCountdown(now + 3 * 3_600_000 + 20 * 60_000, now)).toBe('in 3h 20m');
    expect(formatCountdown(now + 2 * 86_400_000 + 4 * 3_600_000, now)).toBe('in 2d 4h');
    expect(formatMinutesLeft(600, 1440)).toBe('14 min left');
    expect(epLabel(7)).toBe('E07');
  });
});
