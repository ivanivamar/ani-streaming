import { entryProgress, toDownloadEntry, wantedFiles, type DownloadSource, type StoreSnapshot } from './downloads';
import { interpolatedPosition, nativeSrc, parseNativeSrc, type NativePlaybackState } from './native-player';

const source = (id: string, number: number, fonts = ['font-a']): DownloadSource => ({
  series: { id: 'aoashi', title: 'Aoashi', posterUrl: null, fontFileIds: fonts },
  episode: {
    id,
    season: 1,
    number,
    title: null,
    durationSec: 1440,
    sizeBytes: 300,
    video: { driveFileId: `v-${id}` },
    subs: [{ driveFileId: `s-${id}` }],
    thumbDriveFileId: `t-${id}`,
  },
});

const snap = (p: Partial<StoreSnapshot> = {}): StoreSnapshot => ({ stored: new Map(), failed: new Set(), current: null, paused: false, ...p });

describe('downloads', () => {
  it('snapshots an episode as its video, subs, thumbnail and the series fonts', () => {
    const e = toDownloadEntry(source('s01e01', 1), 5);
    expect(e.files.map((f) => `${f.kind}:${f.id}`)).toEqual(['video:v-s01e01', 'sub:s-s01e01', 'thumb:t-s01e01', 'font:font-a']);
    expect(e.files[0].size).toBe(300);
    expect(e.at).toBe(5);
  });

  it('lists each file once, small files before each video, oldest pick first', () => {
    const a = toDownloadEntry(source('s01e02', 2), 2);
    const b = toDownloadEntry(source('s01e01', 1), 1);
    const ids = wantedFiles([a, b], (e) => `E${e.number}`).map((f) => f.id);
    expect(ids).toEqual(['s-s01e01', 't-s01e01', 'font-a', 'v-s01e01', 's-s01e02', 't-s01e02', 'v-s01e02']);
  });

  it('reports progress from the stored files and the current download', () => {
    const e = toDownloadEntry(source('s01e01', 1), 1);
    expect(entryProgress(e, snap()).status).toBe('queued');
    expect(entryProgress(e, snap({ paused: true })).status).toBe('paused');

    const small = new Map([
      ['s-s01e01', 10],
      ['t-s01e01', 5],
      ['font-a', 20],
    ]);
    const half = entryProgress(e, snap({ stored: small, current: { id: 'v-s01e01', bytes: 150 } }));
    expect(half.status).toBe('downloading');
    expect(half.bytes).toBe(185);
    expect(half.total).toBe(335);

    const done = entryProgress(e, snap({ stored: new Map([...small, ['v-s01e01', 300]]) }));
    expect(done).toMatchObject({ status: 'done', fraction: 1, bytes: 335 });

    expect(entryProgress(e, snap({ failed: new Set(['v-s01e01']) })).status).toBe('failed');
  });
});

describe('native player helpers', () => {
  it('round-trips the native "src"', () => {
    const src = nativeSrc({ driveFileId: 'a b/c', sizeBytes: 1234, mimeType: 'video/mp4' });
    expect(parseNativeSrc(src)).toEqual({ driveFileId: 'a b/c', sizeBytes: 1234, mimeType: 'video/mp4' });
    expect(parseNativeSrc('/__drive/x?size=1')).toBeNull();
  });

  it('interpolates the position while playing, at most half a second ahead', () => {
    const s: NativePlaybackState = {
      positionSec: 10,
      durationSec: 100,
      bufferedSec: 30,
      playing: true,
      buffering: false,
      ended: false,
      videoWidth: 1920,
      videoHeight: 1080,
    };
    expect(interpolatedPosition(s, 1000, 1200, 100)).toBeCloseTo(10.2);
    expect(interpolatedPosition(s, 1000, 3000, 100)).toBeCloseTo(10.5);
    expect(interpolatedPosition({ ...s, playing: false }, 1000, 3000, 100)).toBe(10);
    expect(interpolatedPosition({ ...s, buffering: true }, 1000, 3000, 100)).toBe(10);
  });
});
