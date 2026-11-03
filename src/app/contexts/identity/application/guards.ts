import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { SessionStore } from './session.store';

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
