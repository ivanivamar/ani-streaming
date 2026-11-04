import type { Account, SessionStatus } from './account';

/**
 * Google access-token rules (ported from the music app's `state/session.ts`). Pure functions of a
 * stored session and the current time, so they are unit-tested without timers.
 */

/** Drive read-only: the app only streams and reads; the importer has its own (full) Drive grant. */
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Treat the token as expired a minute early so in-flight requests don't race the deadline. */
export const SKEW_MS = 60_000;
/** Renewable sessions renew this long before the token runs out. */
export const RENEW_EARLY_MS = 5 * 60_000;

/**
 * How a session gets new tokens without the user: `server` = the sign-in helper's refresh-token
 * cookie (`/api/auth/refresh`), `native` = Play services on Android (Step 8). Absent = the hourly
 * token model (local dev without the function): one click on "Sign in again" every hour.
 */
export type RenewMode = 'server' | 'native';

export interface StoredSession {
  readonly token: string;
  /** ms since epoch */
  readonly expiresAt: number;
  readonly account: Account | null;
  readonly renew?: RenewMode;
}

export const isLive = (s: StoredSession, now: number): boolean => !!s.token && now < s.expiresAt - SKEW_MS;

export const canRenew = (s: StoredSession | null): boolean => !!s?.renew;

/** Status right after boot: a stale but renewable session counts as signed in (renewed right away). */
export function initialStatus(s: StoredSession | null, now: number): SessionStatus {
  if (!s) return 'signed-out';
  return isLive(s, now) || (canRenew(s) && !!s.account) ? 'signed-in' : 'expired';
}

/** Is it time to renew (no token, or less than RENEW_EARLY_MS left)? */
export const needsRenewal = (s: StoredSession, now: number): boolean =>
  !s.token || s.expiresAt - SKEW_MS - now < RENEW_EARLY_MS;

/**
 * When the expiry timer should fire: renewable sessions renew RENEW_EARLY_MS before the
 * deadline, others just expire at it. Null when there is no token.
 */
export function timerDelay(s: StoredSession, now: number): number | null {
  if (!s.token) return null;
  const left = s.expiresAt - SKEW_MS - now;
  return Math.max(0, canRenew(s) ? left - RENEW_EARLY_MS : left);
}

/** Did Google grant this scope? (`scope` is the space-separated list from the token response) */
export const hasScope = (granted: string, scope: string): boolean => granted.split(/\s+/).includes(scope);

/** Only same-app paths may be used as a post-sign-in redirect. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/auth')) return '/';
  return next;
}
