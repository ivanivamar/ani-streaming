import type { UserPrefs } from '@ani/contracts';
export type { UserDoc, UserPrefs } from '@ani/contracts';

/** Preferences with every field filled in. */
export type Prefs = Required<UserPrefs>;

export type SubtitleMode = Prefs['subtitles'];
export type WatchedThreshold = Prefs['watchedThreshold'];

export const DEFAULT_PREFS: Prefs = {
  autoplayNext: true,
  autoSkipIntro: false,
  subtitles: 'full',
  resume: true,
  watchedThreshold: 0.9,
};

const THRESHOLDS: readonly WatchedThreshold[] = [0.8, 0.9, 0.95];
const SUBS: readonly SubtitleMode[] = ['full', 'signs', 'off'];

/** Stored prefs (maybe partial, maybe from an older app version) → complete, valid prefs. */
export function withDefaults(stored: UserPrefs | null | undefined): Prefs {
  const p = stored ?? {};
  return {
    autoplayNext: typeof p.autoplayNext === 'boolean' ? p.autoplayNext : DEFAULT_PREFS.autoplayNext,
    autoSkipIntro: typeof p.autoSkipIntro === 'boolean' ? p.autoSkipIntro : DEFAULT_PREFS.autoSkipIntro,
    subtitles: p.subtitles && SUBS.includes(p.subtitles) ? p.subtitles : DEFAULT_PREFS.subtitles,
    resume: typeof p.resume === 'boolean' ? p.resume : DEFAULT_PREFS.resume,
    watchedThreshold:
      p.watchedThreshold && THRESHOLDS.includes(p.watchedThreshold) ? p.watchedThreshold : DEFAULT_PREFS.watchedThreshold,
  };
}
