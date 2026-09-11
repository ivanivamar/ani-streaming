/**
 * Dev build config (angular.json swaps this for environment.prod.ts in the
 * production configuration — README.md OpenAPI `servers`: "Same-origin
 * (via a Hosting rewrite in production, or ALLOWED_ORIGIN in dev)"). This
 * is the ALLOWED_ORIGIN side: `ng serve` on :4200 talks to the Node server
 * directly on its own port, cross-origin, relying on the backend's dev CORS
 * middleware (server/src/middleware/cors.ts).
 */
export const environment = {
  apiBaseUrl: 'http://localhost:8080/api',
};
