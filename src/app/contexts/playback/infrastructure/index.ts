/**
 * playback / infrastructure — service-worker bridge for Drive streaming (public/sw.js);
 * JassubRenderer arrives in Step 5.
 *
 * Implements the ports declared in domain/; wired through `providePlayback()` in app.config.ts.
 * Never imported by ui/.
 */
export { providePlayback } from './playback.providers';
