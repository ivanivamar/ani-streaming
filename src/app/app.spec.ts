import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CatalogRepository, type Episode, type Series } from '@catalog/application';
import { SessionStore, type AccessGate } from '@identity/application';
import { VideoSourcePort } from '@playback/application';
import { App } from './app';
import { routes } from './app.routes';

const series = { id: 'aoashi', title: 'Aoashi', episodeCount: 1, addedAt: 1, posterUrl: null, synopsis: null } as unknown as Series;
const episode = {
  id: 's01e01',
  seriesId: 'aoashi',
  season: 1,
  number: 1,
  title: null,
  durationSec: 1440,
  sizeBytes: 298_000_000,
  video: { driveFileId: 'drive-file', codec: 'hevc', bitDepth: 10, width: 1920, height: 1080, bitrate: 1 },
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
}

function fakeSession(gate: AccessGate) {
  return {
    gate: async () => gate,
    status: signal(gate === 'signed-out' ? 'signed-out' : 'signed-in'),
    account: signal(null),
    pending: signal(false),
    error: signal(null),
    phase: signal(gate === 'ready' ? 'ready' : 'idle'),
    uid: signal(null),
    ready: signal(gate === 'ready'),
    preload: () => undefined,
    connect: async () => 'ready',
    signOut: () => undefined,
  };
}

function configure(gate: AccessGate) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      { provide: SessionStore, useValue: fakeSession(gate) },
      { provide: CatalogRepository, useClass: FakeCatalog },
      { provide: VideoSourcePort, useClass: FakeVideoSource },
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
      ['/', 'Home'],
      ['/search', 'Search'],
      ['/anime/aoashi', 'Aoashi'],
      ['/anime/nope', 'Not found'],
      ['/watch/aoashi/s01e01', 'S1 · E1'],
      ['/library', 'Library'],
      ['/releases', 'New releases'],
      ['/settings', 'Settings'],
      ['/welcome', 'Welcome'],
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
    });

    it('renders the shell nav only inside the shell', async () => {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/library');
      expect(harness.fixture.nativeElement.querySelector('nav')).not.toBeNull();
      await harness.navigateByUrl('/auth');
      expect(harness.fixture.nativeElement.querySelector('nav')).toBeNull();
    });
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
