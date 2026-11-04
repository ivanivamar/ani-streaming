const DAY = 86_400_000;

export interface WeekRange {
  /** local Monday 00:00 */
  readonly start: number;
  /** next Monday 00:00 */
  readonly end: number;
  readonly offset: number;
}

/** Monday-based week `offset` weeks from the one containing `now` (local time). */
export function weekRange(offset: number, now = Date.now()): WeekRange {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  d.setDate(d.getDate() - dow + offset * 7);
  const start = d.getTime();
  const e = new Date(d);
  e.setDate(e.getDate() + 7);
  return { start, end: e.getTime(), offset };
}

/** Midnights of the 7 days in a week (DST-safe). */
export function weekDays(w: WeekRange): number[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(w.start);
    d.setDate(d.getDate() + i);
    return d.getTime();
  });
}

/** "This week", "Last week", "Next week", "In 3 weeks", "3 weeks ago". */
export function weekTitle(offset: number): string {
  if (offset === 0) return 'This week';
  if (offset === -1) return 'Last week';
  if (offset === 1) return 'Next week';
  return offset > 0 ? `In ${offset} weeks` : `${-offset} weeks ago`;
}

export const sameDay = (a: number, b: number) => Math.abs(a - b) < DAY && new Date(a).getDate() === new Date(b).getDate();
