import type { Series } from './models';
import { genresOf, normalize, searchSeries } from './search';

const s = (id: string, title: string, extra: Partial<Series> = {}) =>
  ({ id, title, titleRomaji: null, titleNative: null, aliases: [], genres: [], status: 'FINISHED', searchTokens: [], ...extra }) as unknown as Series;

const all = [
  s('aot', 'Attack on Titan', { titleRomaji: 'Shingeki no Kyojin', genres: ['Action', 'Drama'] }),
  s('aoashi', 'Aoashi', { genres: ['Sports'], status: 'RELEASING' }),
  s('frieren', "Frieren: Beyond Journey's End", { aliases: ['Sousou no Frieren'], genres: ['Fantasy', 'Drama'] }),
];

describe('catalogue search', () => {
  it('normalizes accents and punctuation', () => {
    expect(normalize('  Pokémon: XY!! ')).toBe('pokemon xy');
  });

  it('matches word prefixes across titles and aliases, best first', () => {
    expect(searchSeries(all, 'a').map((x) => x.id)).toEqual(['aoashi', 'aot']);
    expect(searchSeries(all, 'shingeki').map((x) => x.id)).toEqual(['aot']);
    expect(searchSeries(all, 'sousou frie').map((x) => x.id)).toEqual(['frieren']);
    expect(searchSeries(all, 'titan attack').map((x) => x.id)).toEqual(['aot']);
    expect(searchSeries(all, 'zzz')).toEqual([]);
  });

  it('filters by genre and status; empty query lists everything', () => {
    expect(searchSeries(all, '', { genre: 'Drama', status: null }).map((x) => x.id)).toEqual(['aot', 'frieren']);
    expect(searchSeries(all, '', { genre: null, status: 'RELEASING' }).map((x) => x.id)).toEqual(['aoashi']);
    expect(genresOf(all)).toEqual(['Action', 'Drama', 'Fantasy', 'Sports']);
  });
});
