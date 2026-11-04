import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PrefsStore, SessionStore } from '@identity/application';
import type { EpisodeId, SeriesId } from '@shared/kernel';
import { UserDataRepository, type UserData } from '../domain';
import { LibraryStore } from './library.store';

const writes: string[] = [];

class MemoryRepo extends UserDataRepository {
  load = async (): Promise<UserData> => ({ progress: [], entries: [], favourites: [], recent: [] });
  saveProgress = async () => void writes.push('progress');
  deleteProgress = async () => void writes.push('delete-progress');
  saveEntry = async () => void writes.push('entry');
  deleteEntry = async () => void writes.push('delete-entry');
  addFavourite = async () => void writes.push('fav');
  removeFavourite = async () => void writes.push('unfav');
  saveRecent = async () => void writes.push('recent');
  deleteRecent = async () => void writes.push('delete-recent');
}

const sid = 'aoashi' as SeriesId;
const ep = (n: number) => `s01e0${n}` as EpisodeId;

function setup() {
  writes.length = 0;
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
});
