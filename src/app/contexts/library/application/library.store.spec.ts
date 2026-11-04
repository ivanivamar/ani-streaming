import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PrefsStore, SessionStore } from '@identity/application';
import type { EpisodeId, SeriesId } from '@shared/kernel';
import { UserDataRepository, type UserData } from '../domain';
import { LibraryStore } from './library.store';

const writes: string[] = [];

let stored: UserData = { progress: [], entries: [], favourites: [], recent: [] };
let failClear = false;

class MemoryRepo extends UserDataRepository {
  load = async (): Promise<UserData> => stored;
  saveProgress = async () => void writes.push('progress');
  deleteProgress = async () => void writes.push('delete-progress');
  saveEntry = async () => void writes.push('entry');
  deleteEntry = async () => void writes.push('delete-entry');
  addFavourite = async () => void writes.push('fav');
  removeFavourite = async () => void writes.push('unfav');
  saveRecent = async () => void writes.push('recent');
  deleteRecent = async () => void writes.push('delete-recent');
  clearHistory = async () => {
    if (failClear) throw new Error('permission-denied');
    writes.push('clear-history');
    return 7;
  };
}

const sid = 'aoashi' as SeriesId;
const ep = (n: number) => `s01e0${n}` as EpisodeId;

function setup() {
  writes.length = 0;
  stored = { progress: [], entries: [], favourites: [], recent: [] };
  failClear = false;
  TestBed.configureTestingModule({
    providers: [
      { provide: SessionStore, useValue: { ready: signal(true), uid: signal('u1') } },
      { provide: PrefsStore, useValue: { prefs: signal({ watchedThreshold: 0.9 }) } },
      { provide: UserDataRepository, useClass: MemoryRepo },
    ],
  });
  return TestBed.inject(LibraryStore);
}

describe('LibraryStore', () => {
  it('writes progress only when asked and keeps the entry in step', () => {
    const lib = setup();
    lib.recordProgress(sid, ep(1), 30, 100, { persist: false, totalEpisodes: 2 });
    expect(writes).toEqual([]);
    expect(lib.fractionOf(sid, ep(1))).toBeCloseTo(0.3);
    lib.recordProgress(sid, ep(1), 95, 100, { persist: true, totalEpisodes: 2 });
    expect(lib.entry(sid)).toMatchObject({ status: 'watching', watched: 1 });
    lib.markWatched(sid, [{ id: ep(2), durationSec: 100 }], 2);
    expect(lib.entry(sid)?.status).toBe('completed');
    expect(lib.history()).toHaveLength(2);
  });

  it('keeps 6 recent searches, newest first, without duplicates', () => {
    const lib = setup();
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'B'].forEach((t) => lib.addRecent(t));
    expect(lib.recent().map((r) => r.term)).toEqual(['B', 'g', 'f', 'e', 'd', 'c']);
  });

  it('favouriting an untracked series plans it', () => {
    const lib = setup();
    lib.toggleFavourite(sid);
    expect(lib.isFavourite(sid)).toBe(true);
    expect(lib.entry(sid)?.status).toBe('planned');
    lib.toggleFavourite(sid);
    expect(lib.isFavourite(sid)).toBe(false);
  });

  it('clears history in Firestore, then memory, and zeroes watched counts', async () => {
    const lib = setup();
    lib.recordProgress(sid, ep(1), 95, 100, { persist: true, totalEpisodes: 3 });
    lib.toggleFavourite('other' as SeriesId);
    expect(lib.entry(sid)?.watched).toBe(1);
    await expect(lib.clearHistory()).resolves.toBe(7);
    expect(writes).toContain('clear-history');
    expect(lib.history()).toEqual([]);
    expect(lib.entry(sid)).toMatchObject({ status: 'watching', watched: 0 });
    expect(lib.isFavourite('other')).toBe(true);
  });

  it('keeps memory and rejects when clearing fails', async () => {
    const lib = setup();
    lib.recordProgress(sid, ep(1), 30, 100, { persist: true });
    failClear = true;
    await expect(lib.clearHistory()).rejects.toThrow('permission-denied');
    expect(lib.history()).toHaveLength(1);
  });

  it('exports what Firestore holds, not only what is in memory', async () => {
    const lib = setup();
    stored = {
      progress: [
        { seriesId: sid, episodeId: ep(1), position: 10, duration: 100, updatedAt: 1000 },
        { seriesId: sid, episodeId: ep(2), position: 20, duration: 100, updatedAt: 2000 },
      ],
      entries: [{ seriesId: sid, status: 'watching', watched: 0, updatedAt: 0 }],
      favourites: [{ seriesId: sid, addedAt: 0 }],
      recent: [{ id: 'r1', term: 'aoashi', at: 5 }],
    };
    const out = await lib.exportData();
    expect(out.progress.map((p) => p.episodeId)).toEqual(['s01e02', 's01e01']);
    expect(out.progress[0].updatedAt).toBe('1970-01-01T00:00:02.000Z');
    expect(out.library).toEqual([{ seriesId: 'aoashi', status: 'watching', watched: 0, updatedAt: '1970-01-01T00:00:00.000Z' }]);
    expect(out.recentSearches).toEqual([{ term: 'aoashi', at: '1970-01-01T00:00:00.005Z' }]);
  });
});
