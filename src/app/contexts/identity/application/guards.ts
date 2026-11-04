import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { SessionStore } from './session.store';
import { PrefsStore } from './prefs.store';

/**
 * Shell routes: only for a signed-in, allowlisted account. Anything else goes to `/auth`, which
 * explains why (signed out, expired, not on the allowlist, error) and comes back to `next`.
 */
export const requireAccess: CanActivateFn = async (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  if ((await session.gate()) === 'ready') return true;
  return router.createUrlTree(['/auth'], { queryParams: state.url && state.url !== '/' ? { next: state.url } : {} });
};

/**
 * After `requireAccess`: a first sign-in (no `users/{uid}` doc yet) goes through Welcome once.
 * If the profile can't be read (offline, …) the app opens anyway.
 */
export const requireProfile: CanActivateFn = async (_route, state) => {
  const prefs = inject(PrefsStore);
  const router = inject(Router);
  // guards run together; requireAccess (listed first) wins when the session isn't ready
  if ((await inject(SessionStore).gate()) !== 'ready') return true;
  const exists = await prefs.load().catch(() => true);
  if (exists) return true;
  return router.createUrlTree(['/welcome'], { queryParams: state.url && state.url !== '/' ? { next: state.url } : {} });
};
