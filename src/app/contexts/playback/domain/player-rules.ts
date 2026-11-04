import type { Chapter, SubtitleTrack } from '@ani/contracts';

export type CaptionMode = 'full' | 'signs' | 'off';

/** OP/ED chapter playing at `t`, if any (the skip button shows during it; not in the last 2 s). */
export function skippableChapter(chapters: readonly Chapter[], t: number): Chapter | null {
  return chapters.find((c) => (c.kind === 'op' || c.kind === 'ed') && t >= c.startSec && t < c.endSec - 2) ?? null;
}

/** CC modes this episode offers, in button order. "off" is always there. */
export function captionModes(subs: readonly SubtitleTrack[]): CaptionMode[] {
  const modes: CaptionMode[] = [];
  if (subs.some((s) => s.kind === 'full')) modes.push('full');
  if (subs.some((s) => s.kind === 'signs' || s.kind === 'songs')) modes.push('signs');
  return [...modes, 'off'];
}

/** Preferred mode if the episode has it, else the closest available one. */
export function initialCaption(subs: readonly SubtitleTrack[], preferred: CaptionMode): CaptionMode {
  const modes = captionModes(subs);
  if (modes.includes(preferred)) return preferred;
  return preferred === 'off' ? 'off' : modes[0];
}

/** The subtitle file for a mode (Step 5 renders it with JASSUB). */
export function captionTrack(subs: readonly SubtitleTrack[], mode: CaptionMode): SubtitleTrack | null {
  if (mode === 'off') return null;
  if (mode === 'full') return subs.find((s) => s.kind === 'full') ?? null;
  return subs.find((s) => s.kind === 'signs') ?? subs.find((s) => s.kind === 'songs') ?? null;
}

export const CAPTION_LABEL: Record<CaptionMode, string> = { full: 'Subtitles', signs: 'Signs & songs', off: 'Off' };
