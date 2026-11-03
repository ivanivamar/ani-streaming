import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideCatalog } from '@catalog/infrastructure';
import { provideIdentity } from '@identity/infrastructure';
import { providePlayback } from '@playback/infrastructure';
import { APP_ENV } from '@shared/infrastructure';

import { APP_ENV_VALUES } from './app.env';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless is the v22 default; kept explicit so it's obvious zone.js is gone on purpose.
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    { provide: APP_ENV, useValue: APP_ENV_VALUES },
    provideIdentity(),
    provideCatalog(),
    providePlayback(),
  ],
};
