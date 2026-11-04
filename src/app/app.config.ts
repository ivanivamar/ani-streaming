import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { PreloadAllModules, provideRouter, withComponentInputBinding, withInMemoryScrolling, withPreloading } from '@angular/router';
import { provideCatalog } from '@catalog/infrastructure';
import { provideIdentity } from '@identity/infrastructure';
import { provideLibrary } from '@library/infrastructure';
import { provideReleases } from '@releases/infrastructure';
import { providePlayback } from '@playback/infrastructure';
import { APP_ENV } from '@shared/infrastructure';

import { APP_ENV_VALUES } from './app.env';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless is the v22 default; kept explicit so it's obvious zone.js is gone on purpose.
    provideZonelessChangeDetection(),
    // Page motion is Web Animations (shared/ui Motion), so no router view transitions.
    // Every lazy page chunk is fetched in the background after start-up, so the first visit to a
    // page doesn't wait for its download.
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      withPreloading(PreloadAllModules),
    ),
    { provide: APP_ENV, useValue: APP_ENV_VALUES },
    provideIdentity(),
    provideCatalog(),
    providePlayback(),
    provideLibrary(),
    provideReleases(),
  ],
};
