import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CatalogRepository, type Episode, type Series } from '@catalog/application';
import { SessionStore, UserProfilePort, type AccessGate, type UserDoc } from '@identity/application';
import { UserDataRepository, type UserData } from '@library/application';
import { VideoSourcePort } from '@playback/application';
import { NotifyRepository, SchedulePort } from '@releases/application';
import { App } from './app';
import { routes } from './app.routes';

const series = {
  id: 'aoashi',
  title: 'Aoashi',
  aliases: [],
  genres: ['Sports'],
  searchTokens: ['aoashi'],
  status: 'FINISHED',
  episodeCount: 1,
  seasonCount: 1,
  addedAt: 1,
  updatedAt: 1,
  posterUrl: null,
  bannerUrl: null,
  synopsis: null,
} as unknown as Series;
const episode = {
  id: 's01e01',
  seriesId: 'aoashi',
  season: 1,
  number: 1,
  title: null,
  durationSec: 1440,
  sizeBytes: 298_000_000,
  addedAt: 1,
  video: { driveFileId: 'drive-file', codec: 'hevc', bitDepth: 10, width: 1920, height: 1080, bitrate: 1 },
  audio: [],
  subs: [{ lang: 'en', kind: 'full', driveFileId: 'subs' }],
  chapters: [],
  thumbDriveFileId: null,
} as unknown as Episode;

class FakeCatalog extends CatalogRepository {
  listSeries = async () => [series];
  getSeries = async (id: string) => (id === 'aoashi' ? series : null);
  listSeasons = async () => [];
  listEpisodes = async () => [episode];
  getEpisode = async (_s: string, id: string) => (id === 's01e01' ? episode : null);
}

class FakeVideoSource extends VideoSourcePort {
  init = async () => true;
  streamUrl = async () => '/__drive/drive-file?size=298000000&type=video%2Fmp4';
  imageUrl = () => null;
}

/** null = first sign-in (→ Welcome) */
let profile: UserDoc | null;

class FakeProfiles extends UserProfilePort {
  get = async () => profile;
  create = async (_uid: string, doc: UserDoc) => void (profile = doc);
  updatePrefs = async () => undefined;
  deleteAll = async () => undefined;
}

class FakeUserData extends UserDataRepository {
  load = async (): Promise<UserData> => ({ progress: [], entries: [], favourites: [], recent: [] });
  saveProgress = async () => undefined;
  deleteProgress = async () => undefined;
  saveEntry = async () => undefined;
  deleteEntry = async () => undefined;
  addFavourite = async () => undefined;
  removeFavourite = async () => undefined;
  saveRecent = async () => undefined;
  deleteRecent = async () => undefined;
}

class FakeSchedule extends SchedulePort {
  airing = async () => [];
  premieres = async () => [];
}

class FakeNotify extends NotifyRepository {
  list = async () => [];
  set = async () => undefined;
  remove = async () => undefined;
}

function fakeSession(gate: AccessGate) {
  return {
    gate: async () => gate,
    status: signal(gate === 'signed-out' ? 'signed-out' : 'signed-in'),
    account: signal(null),
    pending: signal(false),
    error: signal(null),
    phase: signal(gate === 'ready' ? 'ready' : 'idle'),
    uid: signal(gate === 'ready' ? 'u1' : null),
    ready: signal(gate === 'ready'),
    preload: () => undefined,
    connect: async () => 'ready',
    signOut: () => undefined,
    signIn: async () => 'ready',
    retry: async () => 'ready',
  };
}

function configure(gate: AccessGate, firstSignIn = false) {
  profile = firstSignIn ? null : { displayName: 'Ivan', email: 'ivan@example.com', photoURL: null, createdAt: 1, prefs: {} };
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      { provide: SessionStore, useValue: fakeSession(gate) },
      { provide: CatalogRepository, useClass: FakeCatalog },
      { provide: VideoSourcePort, useClass: FakeVideoSource },
      { provide: UserProfilePort, useClass: FakeProfiles },
      { provide: UserDataRepository, useClass: FakeUserData },
      { provide: SchedulePort, useClass: FakeSchedule },
      { provide: NotifyRepository, useClass: FakeNotify },
    ],
  });
}

async function settle(harness: RouterTestingHarness) {
  // resources resolve on microtasks; give them a couple of turns
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r));
    await harness.fixture.whenStable();
  }
}

describe('App', () => {
  it('creates the root component', () => {
    configure('ready');
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  describe('signed in and allowlisted', () => {
    beforeEach(() => configure('ready'));

    it.each([
      ['/', 'Continue watching'],
      ['/search', 'All titles'],
      ['/search?q=aoa', 'Results'],
      ['/anime/aoashi', 'Aoashi'],
      ['/anime/nope', 'Not found'],
      ['/library', 'Library'],
      ['/releases', 'New releases'],
      ['/settings', 'Settings'],
    ])('routes %s to "%s"', async (url, heading) => {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(url);
      await settle(harness);
      expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(heading);
    });

    it('lists the catalogue on Home and streams through the worker URL', async () => {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/');
      await settle(harness);
      expect(harness.routeNativeElement?.textContent).toContain('Aoashi');
      await harness.navigateByUrl('/watch/aoashi/s01e01');
      await settle(harness);
      const video = harness.routeNativeElement?.querySelector('video');
      expect(video?.getAttribute('src')).toBe('/__drive/drive-file?size=298000000&type=video%2Fmp4');
      expect(harness.routeNativeElement?.querySelector('.title')?.textContent?.trim()).toBe('Aoashi');
      expect(harness.routeNativeElement?.querySelector('.sub')?.textContent?.trim()).toBe('Season 1 · Episode 1');
      // the player is full-screen: no shell nav
      expect(harness.fixture.nativeElement.querySelector('nav')).toBeNull();
    });

    it('player Back returns to the page it was opened from without stacking history', async () => {
      const harness = await RouterTestingHarness.create();
      const router = TestBed.inject(Router);
      const location = TestBed.inject(Location);
      // the harness doesn't run initialNavigation(), so popstate isn't wired to the router yet
      router.setUpLocationChangeListener();
      await harness.navigateByUrl('/');
      await harness.navigateByUrl('/anime/aoashi');
      await harness.navigateByUrl('/watch/aoashi/s01e01');
      await settle(harness);
      (harness.fixture.nativeElement.querySelector('button.back') as HTMLButtonElement).click();
      await settle(harness);

      expect(router.url).toBe('/anime/aoashi');
      location.back();
      await settle(harness);
      expect(router.url).toBe('/');
    });

    it('finds the series from the search page', async () => {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/search?q=aoa');
      await settle(harness);
      expect(harness.routeNativeElement?.textContent).toContain('Aoashi');
      await harness.navigateByUrl('/search?q=zzz');
      await settle(harness);
      expect(harness.routeNativeElement?.textContent).toContain('No titles matched.');
    });

    it('renders the shell nav only inside the shell', async () => {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/library');
      expect(harness.fixture.nativeElement.querySelector('nav')).not.toBeNull();
      await harness.navigateByUrl('/auth');
      expect(harness.fixture.nativeElement.querySelector('nav')).toBeNull();
    });
  });

  it('sends a first sign-in through Welcome', async () => {
    configure('ready', true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/library');
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/welcome?next=%2Flibrary');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe('Welcome, there');
  });

  it.each<AccessGate>(['signed-out', 'expired', 'no-access', 'error'])(
    'sends %s visitors to /auth and remembers where they were going',
    async (gate) => {
      configure(gate);
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/watch/aoashi/s01e01');
      expect(TestBed.inject(Router).url).toBe('/auth?next=%2Fwatch%2Faoashi%2Fs01e01');
      expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe('Sign in');
    },
  );
});
