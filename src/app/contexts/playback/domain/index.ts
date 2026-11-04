/**
 * playback / domain — what a playable Drive video is, the video-source and subtitle ports,
 * caption/skip rules (chapters + AniSkip fallback), the HEVC decode-support rules and the Android
 * app's native player + offline downloads (Step 8).
 *
 * Pure TypeScript: no Angular, Firebase or RxJS imports (enforced by eslint-plugin-boundaries).
 */
export * from './video-source';
export * from './player-rules';
export * from './subtitle-renderer';
export * from './skip-times';
export * from './decode-support';
export * from './native-player';
export * from './downloads';
export * from './offline-store';
