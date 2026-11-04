import { TestBed } from '@angular/core/testing';
import { EMPTY_OFFLINE, OfflineStorePort, type DownloadEntry, type DownloadSource, type OfflineState } from '../domain';
import { DownloadsStore } from './downloads.store';

class FakeOffline extends OfflineStorePort {
  available = true;
  entries: DownloadEntry[] = [];
  synced: { id: string; size: number; title: string }[][] = [];
  wifi: (boolean | undefined)[] = [];
  next: OfflineState = EMPTY_OFFLINE;
  sync = vi.fn(async (items: readonly { id: string; size: number; title: string }[], wifiOnly?: boolean) => {
    this.synced.push([...items]);
    this.wifi.push(wifiOnly);
    return this.next;
  });
  state = vi.fn(async () => this.next);
  setPaused = vi.fn(async () => this.next);
  retryFailed = vi.fn(async () => this.next);
  askNotifications = vi.fn(async () => undefined);
  watch = vi.fn(() => () => undefined);
  readEntries = () => this.entries;
  writeEntries = (e: readonly DownloadEntry[]) => {
    this.entries = [...e];
  };
}

const src = (id: string, number: number): DownloadSource => ({
  series: { id: 'aot', title: 'Attack on Titan', posterUrl: null, fontFileIds: [] },
  episode: { id, season: 1, number, title: null, durationSec: 1500, sizeBytes: 500, video: { driveFileId: `v${number}` }, subs: [], thumbDriveFileId: null },
});

function setup() {
  const port = new FakeOffline();
  TestBed.configureTestingModule({ providers: [{ provide: OfflineStorePort, useValue: port }] });
  return { port, store: TestBed.inject(DownloadsStore) };
}

describe('DownloadsStore', () => {
  it('syncs the native list on start, on add and on remove; persists the picks', async () => {
    const { port, store } = setup();
    await Promise.resolve();
    expect(port.sync).toHaveBeenCalledTimes(1);

    await store.add([src('s01e01', 1), src('s01e02', 2)]);
    expect(port.entries.map((e) => e.episodeId)).toEqual(['s01e01', 's01e02']);
    expect(port.synced.at(-1)?.map((f) => f.id)).toEqual(['v1', 'v2']);
    expect(port.synced.at(-1)?.[0].title).toBe('Attack on Titan · S1 · E01');
    expect(port.askNotifications).toHaveBeenCalledTimes(1);

    // adding again keeps the original pick
    await store.add([src('s01e01', 1)]);
    expect(port.entries).toHaveLength(2);

    await store.remove('aot', 's01e01');
    expect(port.synced.at(-1)?.map((f) => f.id)).toEqual(['v2']);
    expect(store.groups()[0].rows.map((r) => r.label)).toEqual(['S1 · E02']);
  });

  it('shows progress from the native state', async () => {
    const { port, store } = setup();
    port.next = { ...EMPTY_OFFLINE, stored: [{ id: 'v1', size: 500 }] };
    await store.add([src('s01e01', 1), src('s01e02', 2)]);
    expect(store.progressOf('aot', 's01e01')?.status).toBe('done');
    expect(store.progressOf('aot', 's01e02')?.status).toBe('queued');
    expect(store.doneCount()).toBe(1);
    expect(store.progressOf('aot', 's01e03')).toBeNull();
  });

  it('passes the Wi-Fi setting through', async () => {
    const { port, store } = setup();
    await store.setWifiOnly(false);
    expect(port.wifi.at(-1)).toBe(false);
  });
});
