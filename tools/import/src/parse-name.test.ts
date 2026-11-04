import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEpisodeName } from './parse-name.ts';

const ok = (name: string) => {
  const r = parseEpisodeName(name);
  assert.ok(r.ok, `${name}: ${!r.ok ? r.reason : ''}`);
  return r.value;
};

test('release-group SxxEyy (the Step 1 samples)', () => {
  const a = ok('[TatakaeSubs] Attack on Titan - S01E01 (BD 1080p HEVC OPUS) [21D9AE40].mkv');
  assert.deepEqual([a.title, a.season, a.episode, a.group, a.quality, a.seasonAssumed], ['Attack on Titan', 1, 1, 'TatakaeSubs', '1080p', false]);
  const b = ok('[LostYears] Aoashi - S01E01 (WEB 1080p x264 E-AC-3 AAC) [720C6417].mkv');
  assert.deepEqual([b.title, b.season, b.episode], ['Aoashi', 1, 1]);
});

test('dotted scene names', () => {
  const v = ok('Vinland.Saga.S02E06.1080p.WEB.H264.mkv');
  assert.deepEqual([v.title, v.season, v.episode], ['Vinland Saga', 2, 6]);
});

test('" - NN" absolute numbers, with version suffix', () => {
  const f = ok('[SubsPlease] Sousou no Frieren - 05 (1080p) [E8B1C3A2].mkv');
  assert.deepEqual([f.title, f.season, f.episode, f.seasonAssumed], ['Sousou no Frieren', 1, 5, true]);
  assert.equal(ok('[Group] Show - 12v2 [720p].mkv').episode, 12);
  assert.equal(ok('[Group] Show - S01E02v2 [1080p].mkv').episode, 2);
  assert.equal(ok('Shingeki no Kyojin - 03 [BD 720p].mp4').title, 'Shingeki no Kyojin');
});

test('season word before " - NN"', () => {
  const s = ok('[Group] Mushoku Tensei S2 - 03 [1080p].mkv');
  assert.deepEqual([s.title, s.season, s.episode], ['Mushoku Tensei', 2, 3]);
  const t = ok('Spy x Family Season 2 - 07.mkv');
  assert.deepEqual([t.title, t.season, t.episode], ['Spy x Family', 2, 7]);
});

test('E / Ep / Episode', () => {
  assert.deepEqual(
    (({ title, episode }) => [title, episode])(ok('Monster Episode 14.mkv')),
    ['Monster', 14],
  );
  assert.equal(ok('Mononoke Ep 3.mkv').episode, 3);
});

test('unparseable names are reported, not guessed', () => {
  for (const n of ['VID_20240311_221045.mp4', 'ending_clip_final.mkv', '[Group] - 05.mkv', 'S01E02.mkv']) {
    assert.equal(parseEpisodeName(n).ok, false, n);
  }
});
