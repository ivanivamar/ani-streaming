/**
 * Production build config — same-origin via a Firebase Hosting rewrite in
 * front of the Cloud Run service (README.md Overview), so there's no cross-
 * origin call and no CORS to configure at all.
 */
export const environment = {
  apiBaseUrl: '/api',
};
