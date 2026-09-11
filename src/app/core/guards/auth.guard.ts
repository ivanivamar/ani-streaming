import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Waits for Firebase to resolve whether there's a persisted session
 * (`AuthService.authReady`) before letting either guard decide — on a cold
 * load / page refresh that resolution is async, so deciding off
 * `isAuthenticated()` immediately would incorrectly bounce an
 * already-signed-in user to `/auth`.
 */
function whenAuthReady(auth: AuthService) {
  return toObservable(auth.authReady).pipe(
    filter((ready) => ready),
    take(1),
  );
}

/** Blocks chrome routes (home, search, …) until signed in. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return whenAuthReady(auth).pipe(map(() => (auth.isAuthenticated() ? true : router.parseUrl('/auth'))));
};

/** Keeps a signed-in user off the auth screen. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return whenAuthReady(auth).pipe(map(() => (auth.isAuthenticated() ? router.parseUrl('/') : true)));
};
