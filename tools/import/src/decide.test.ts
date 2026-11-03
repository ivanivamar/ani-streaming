import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from './decide.ts';
import { mapChapters } from './extract.ts';
import type { Source } from './probe.ts';

function src(over: Partial<Source> & { codec?: string; pix?: string; profile?: string }): Source {
  const { codec = 'h264', pix = 'yuv420p', profile = 'High', ...rest } = over;
  const width = rest.width ?? 1920;
  const height = rest.height ?? 1080;
  return {
    file: 'x.mkv', size: 1e9, mtimeMs: 0,
    probe: { streams: [], format: { filename: 'x.mkv' } },
    video: { index: 0, codec_type: 'video', codec_name: codec, pix_fmt: pix, profile, width, height },
    audio: { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2 },
    audioNote: '', audioProblem: null, duration: 1440, width, height,
    bitDepth: pix.includes('10') ? 10 : 8, sar: 1, rotation: 0,
    displayWidth: width, displayHeight: height, interlaced: false, interlaceNote: '',
    crop: null, cropNote: '', videoBitrate: 4e6, videoBitrateEstimated: false,
    ...rest,
  };
}

test('H.264 8-bit 1080p under 8 Mb/s is copied', () => {
  const d = decide(src({}));
  assert.equal(d.action, 'copy');
  assert.deepEqual(d.audioArgs, ['-c:a', 'copy']);
});

test('H.264 10-bit (Aoashi) is encoded', () => {
  const d = decide(src({ pix: 'yuv420p10le', profile: 'High 10' }));
  assert.equal(d.action, 'encode');
  assert.match(d.reasons[0]!, /10-bit/);
  assert.ok(d.videoArgs.includes('hevc_nvenc'));
});

test('HEVC Main 10 above 8 Mb/s (AoT) is encoded, audio to AAC', () => {
  const d = decide(src({ codec: 'hevc', pix: 'yuv420p10le', profile: 'Main 10', videoBitrate: 12e6,
    audio: { index: 1, codec_type: 'audio', codec_name: 'opus', channels: 2 } }));
  assert.equal(d.action, 'encode');
  assert.deepEqual(d.audioArgs.slice(0, 2), ['-c:a', 'aac']);
});

test('HEVC Main 10 under the ceiling is copied with hvc1', () => {
  const d = decide(src({ codec: 'hevc', pix: 'yuv420p10le', profile: 'Main 10' }));
  assert.equal(d.action, 'copy');
  assert.ok(d.videoArgs.includes('hvc1'));
});

test('2160p is scaled to 1920×1080', () => {
  const d = decide(src({ codec: 'hevc', pix: 'yuv420p10le', profile: 'Main 10', width: 3840, height: 2160, displayWidth: 3840, displayHeight: 2160 }));
  assert.equal(d.action, 'encode+scale');
  assert.deepEqual([d.outWidth, d.outHeight], [1920, 1080]);
});

test('anamorphic DVD gets square pixels; interlaced gets bwdif', () => {
  const d = decide(src({ codec: 'mpeg2video', pix: 'yuv420p', width: 720, height: 480, sar: 32 / 27, displayWidth: 854, displayHeight: 480, interlaced: true }));
  assert.equal(d.action, 'encode+scale');
  assert.deepEqual([d.outWidth, d.outHeight], [854, 480]);
  assert.match(d.filters[0]!, /^bwdif/);
});

test('letterboxed source is cropped and encoded (not scaled)', () => {
  const d = decide(src({ crop: { w: 1920, h: 800, x: 0, y: 140 }, cropNote: 'black bars: crop 1920×1080 → 1920×800' }));
  assert.equal(d.action, 'encode');
  assert.ok(d.filters.includes('crop=1920:800:0:140'));
  assert.deepEqual([d.outWidth, d.outHeight], [1920, 800]);
});

test('--force-encode', () => {
  assert.equal(decide(src({}), { forceEncode: true }).action, 'encode');
});

test('chapters: OP/ED by name, then by length', () => {
  const ch = (title: string, s: number, e: number) => ({ id: 0, start_time: String(s), end_time: String(e), tags: { title } });
  const named = mapChapters(src({ probe: { streams: [], format: { filename: '' }, chapters: [
    ch('Prologue', 0, 120), ch('Opening', 120, 210), ch('Part A', 210, 700), ch('Ending', 1300, 1390), ch('Preview', 1390, 1420),
  ] } }));
  assert.deepEqual(named.map((c) => c.kind), ['other', 'op', 'other', 'ed', 'other']);
  const generic = mapChapters(src({ probe: { streams: [], format: { filename: '' }, chapters: [
    ch('Chapter 1', 0, 100), ch('Chapter 2', 100, 189), ch('Chapter 3', 189, 1300), ch('Chapter 4', 1300, 1390), ch('Chapter 5', 1390, 1440),
  ] } }));
  assert.deepEqual(generic.map((c) => c.kind), ['other', 'op', 'other', 'ed', 'other']);
});

test('chapters: "Intro" cold open / whole-episode chapters are not the OP', () => {
  const ch = (title: string, s: number, e: number) => ({ id: 0, start_time: String(s), end_time: String(e), tags: { title } });
  const cold = mapChapters(src({ probe: { streams: [], format: { filename: '' }, chapters: [
    ch('Intro', 0, 122), ch('Opening', 122, 215), ch('Part A', 215, 800), ch('Part B', 800, 1434), ch('Ending', 1434, 1524), ch('Preview', 1524, 1540),
  ] } }));
  assert.deepEqual(cold.map((c) => c.kind), ['other', 'op', 'other', 'other', 'ed', 'other']);
  const web = mapChapters(src({ probe: { streams: [], format: { filename: '' }, chapters: [
    ch('Intro', 0, 1356), ch('Intro', 1356, 1444), ch('Preview', 1444, 1460),
  ] } }));
  assert.deepEqual(web.map((c) => c.kind), ['other', 'other', 'other']);
  const weakOnly = mapChapters(src({ probe: { streams: [], format: { filename: '' }, chapters: [
    ch('Intro', 0, 90), ch('Episode', 90, 1350), ch('Credits', 1350, 1440),
  ] } }));
  assert.deepEqual(weakOnly.map((c) => c.kind), ['op', 'other', 'ed']);
});
