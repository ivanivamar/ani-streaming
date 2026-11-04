/**
 * playback / infrastructure — service-worker bridge for Drive streaming (public/sw.js),
 * JassubRenderer (ASS subtitles), AniSkipClient (OP/ED fallback), MediaCapabilitiesProbe (HEVC check).
 *
 * Implements the ports declared in domain/; wired through `providePlayback()` in app.config.ts.
 * Never imported by ui/.
 */
export { providePlayback } from './playback.providers';
