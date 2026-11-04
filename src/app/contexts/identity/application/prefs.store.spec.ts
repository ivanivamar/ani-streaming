import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { UserDoc } from '../domain';
import { UserProfilePort } from './ports';
import { PrefsStore } from './prefs.store';
import { SessionStore } from './session.store';

let stored: UserDoc | null = null;

class MemoryProfiles extends UserProfilePort {
  get = async () => stored;
  create = async (_uid: string, doc: UserDoc) => void (stored = doc);
  updatePrefs = async () => undefined;
  deleteAll = async () => undefined;
}

describe('PrefsStore', () => {
  it('says the profile exists once Welcome created it (guard after "Start watching")', async () => {
    stored = null;
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStore, useValue: { ready: signal(true), uid: signal('u1'), account: signal({ email: 'a@b.c', name: 'A' }) } },
        { provide: UserProfilePort, useClass: MemoryProfiles },
      ],
    });
    const prefs = TestBed.inject(PrefsStore);
    expect(await prefs.load()).toBe(false);
    await prefs.create({ subtitles: 'signs' });
    expect(await prefs.load()).toBe(true);
    expect(prefs.prefs().subtitles).toBe('signs');
    expect((stored as UserDoc | null)?.email).toBe('a@b.c');
  });
});
