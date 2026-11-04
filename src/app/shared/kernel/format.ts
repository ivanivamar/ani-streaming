/** `1425` → `"23:45"`, `3725` → `"1:02:05"`. Negative or non-finite input → `"0:00"`. */
export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** `"just now"`, `"5m ago"`, `"3h ago"`, `"2d ago"`, `"3w ago"`, then a short date. */
export function formatAgo(ms: number, now = Date.now()): string {
  const d = now - ms;
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d ago`;
  if (d < 35 * DAY) return `${Math.floor(d / (7 * DAY))}w ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Countdown until `ms`: `"in 3h 20m"`, `"in 2d 4h"`, `"in 12m"`. */
export function formatCountdown(ms: number, now = Date.now()): string {
  const d = Math.max(0, ms - now);
  if (d >= DAY) return `in ${Math.floor(d / DAY)}d ${Math.floor((d % DAY) / HOUR)}h`;
  if (d >= HOUR) return `in ${Math.floor(d / HOUR)}h ${Math.floor((d % HOUR) / MIN)}m`;
  return `in ${Math.max(1, Math.ceil(d / MIN))}m`;
}

/** Whole minutes left: `"12 min left"`. */
export function formatMinutesLeft(positionSec: number, durationSec: number): string {
  return `${Math.max(1, Math.round((durationSec - positionSec) / 60))} min left`;
}

/** `"E07"` */
export const epLabel = (n: number): string => `E${String(n).padStart(2, '0')}`;
