import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchSeries, seasonMedia, type Media } from './anilist.ts';

const media = (id: number, english: string | null, romaji: string, format: string, year: number, sequel?: number): Media => ({
  id, format: format as Media['format'], status: 'FINISHED', episodes: 12, seasonYear: year, startDate: { year },
  title: { english, romaji, native: null }, synonyms: [], description: '<i>x</i>', genres: [],
  coverImage: { extraLarge: `https://img/${id}.jpg`, large: null, color: '#fff' }, bannerImage: null,
  relations: { edges: sequel ? [{ relationType: 'SEQUEL', node: { id: sequel, type: 'ANIME', format: 'TV' } }] : [] },
});

const db: Record<number, Media> = {
  16498: media(16498, 'Attack on Titan', 'Shingeki no Kyojin', 'TV', 2013, 20958),
  20958: media(20958, 'Attack on Titan Season 2', 'Shingeki no Kyojin Season 2', 'TV', 2017),
  99: media(99, 'Attack on Titan: Junior High', 'Shingeki! Kyojin Chuugakkou', 'TV', 2015),
  100: media(100, 'Attack on Titan: Crimson Bow and Arrow', 'Shingeki no Kyojin Movie', 'MOVIE', 2014),
  140657: media(140657, 'Aoashi', 'Ao Ashi', 'TV', 2022),
  1: media(1, 'Hunter x Hunter', 'HUNTER×HUNTER', 'TV', 1999),
  2: media(2, 'Hunter x Hunter (2011)', 'HUNTER×HUNTER (2011)', 'TV', 2011),
};
db[2]!.synonyms = ['Hunter x Hunter'];

globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const { variables } = JSON.parse(init.body as string) as { variables: { search?: string; id?: number } };
  if (variables.id) return Response.json({ data: { Media: db[variables.id] ?? null } });
  const s = variables.search!.toLowerCase().split(' ')[0]!;
  const hits = Object.values(db).filter((m) => [m.title.english, m.title.romaji].some((t) => t?.toLowerCase().includes(s)));
  return Response.json({ data: { Page: { media: hits } } });
}) as typeof fetch;

test('exact title match prefers the TV entry; seasons follow SEQUEL', { timeout: 30000 }, async () => {
  const m = await matchSeries('Attack on Titan');
  assert.ok(m.ok);
  assert.equal(m.media.id, 16498);
  assert.equal((await seasonMedia(m.media, 2)).media?.id, 20958);
  assert.equal((await seasonMedia(m.media, 3)).media, null);
});

test('romaji spacing/punctuation is ignored', { timeout: 30000 }, async () => {
  const m = await matchSeries('Aoashi');
  assert.ok(m.ok);
  assert.equal(m.media.id, 140657);
});

test('two unrelated entries with the same title → no match (reported)', { timeout: 30000 }, async () => {
  const m = await matchSeries('Hunter x Hunter');
  assert.equal(m.ok, false);
});

test('no exact title → no match', { timeout: 30000 }, async () => {
  assert.equal((await matchSeries('Attack')).ok, false);
});
