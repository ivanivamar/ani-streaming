/** The Google account signed in to the app (from Drive's `about`, no profile scope needed). */
export interface Account {
  readonly email: string;
  readonly name: string;
  readonly photo?: string;
}

/** Google side of the session. `expired` keeps the account so "Sign in again" can hint it. */
export type SessionStatus = 'signed-out' | 'signed-in' | 'expired';

/**
 * Firebase side, after Google: `connecting` (custom token + allowlist check), `ready` (Firestore
 * usable, uid allowlisted), `no-access` (signed in, but the uid isn't in `config/access`),
 * `error` (function / network / config problem, message in `SessionStore.error`).
 */
export type ConnectionPhase = 'idle' | 'connecting' | 'ready' | 'no-access' | 'error';

/** What a route guard needs to know: may the app be used right now, and if not, why. */
export type AccessGate = 'ready' | 'signed-out' | 'expired' | 'no-access' | 'error';
