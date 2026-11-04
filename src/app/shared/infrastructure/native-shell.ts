import { DOCUMENT, inject, makeEnvironmentProviders, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { IS_NATIVE } from './native';

/**
 * Android system Back (gesture or button), ported from the music app's `native/backButton.ts`.
 * Without a listener Android closes the activity from anywhere. Now, in order:
 *   1. an open menu / popover (anything with role="menu") → close it (Escape)
 *   2. a page to go back to (anime → home, player → anime …) → back
 *   3. any page but Home → Home
 *   4. Home → the app goes to the background (it resumes where it was)
 */
export function provideNativeShell(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      if (!IS_NATIVE) return;
      const doc = inject(DOCUMENT);
      const router = inject(Router);
      const location = inject(Location);
      void App.addListener('backButton', ({ canGoBack }) => {
        if (doc.querySelector('[role="menu"]')) {
          doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return;
        }
        const path = router.url.split(/[?#]/)[0];
        if (canGoBack && router.lastSuccessfulNavigation()?.previousNavigation) {
          location.back();
          return;
        }
        if (path !== '/' && !path.startsWith('/auth')) {
          void router.navigateByUrl('/', { replaceUrl: true });
          return;
        }
        void App.minimizeApp();
      });
    }),
  ]);
}
