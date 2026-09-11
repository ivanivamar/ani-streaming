import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';

/**
 * Attaches the Firebase ID token to every call to our own backend
 * (README.md "Backend contract": every `/api/*` route needs a bearer
 * token). Scoped to `environment.apiBaseUrl` so it never touches
 * third-party requests (Google Fonts, allanime itself is only ever called
 * server-side, etc.).
 *
 * Note: this only covers requests made through Angular's HttpClient. The
 * one exception is the watch screen's <video>/hls.js playback, which
 * issues its own requests outside HttpClient and can't have a header
 * attached this way — see CatalogService.resolvePlaybackUrl and
 * server/src/middleware/auth.ts for how that case is handled instead.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBaseUrl)) {
    return next(req);
  }

  const auth = inject(AuthService);
  return from(auth.getIdToken()).pipe(
    switchMap((token) => next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req)),
  );
};
