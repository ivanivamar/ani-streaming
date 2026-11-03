import { fromFirestore, toEpisode } from './mappers';

const ts = (ms: number) => ({ toMillis: () => ms, seconds: ms / 1000, nanoseconds: 0 });

describe('catalog mappers', () => {
  it('turns Firestore Timestamps into milliseconds at any depth', () => {
    expect(fromFirestore({ addedAt: ts(1000), nested: [{ at: ts(2000) }], title: 'x' })).toEqual({
      addedAt: 1000,
      nested: [{ at: 2000 }],
      title: 'x',
    });
  });

  it('adds the ids to episodes', () => {
    const ep = toEpisode('aoashi', 's01e01', { season: 1, number: 1, addedAt: ts(5) });
    expect(ep).toMatchObject({ id: 's01e01', seriesId: 'aoashi', season: 1, number: 1, addedAt: 5 });
  });
});
