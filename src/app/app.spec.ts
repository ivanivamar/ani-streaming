import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding())],
    });
  });

  it('creates the root component', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it.each([
    ['/', 'Home'],
    ['/search', 'Search'],
    ['/anime/attack-on-titan', 'Anime detail'],
    ['/watch/attack-on-titan/s01e01', 'Watch'],
    ['/library', 'Library'],
    ['/releases', 'New releases'],
    ['/settings', 'Settings'],
    ['/auth', 'Sign in'],
    ['/welcome', 'Welcome'],
  ])('routes %s to the %s placeholder', async (url, heading) => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe(heading);
  });

  it('renders the shell nav only inside the shell', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/library');
    expect(harness.fixture.nativeElement.querySelector('nav')).not.toBeNull();
    await harness.navigateByUrl('/auth');
    expect(harness.fixture.nativeElement.querySelector('nav')).toBeNull();
  });
});
