import type { Signal } from '@angular/core';
import type { Account, StoredSession } from '../domain';
import type { UserDoc, UserPrefs } from '../domain';

/**
 * Ports of the identity context. Abstract classes double as DI tokens; the implementations live
 * in ../infrastructure and are bound by `provideIdentity()`. Tests bind fakes.
 */

export interface GoogleTokens {
  readonly accessToken: string;
  readonly expiresInSec: number;
  /** space-separated granted scopes */
  readonly scope: string;
}

export interface PopupOptions {
  /** pre-select this account in Google's chooser */
  readonly hint?: string;
  /** force the account chooser (switch account) */
  readonly selectAccount?: boolean;
}

/** Google Identity Services in the browser (popup). */
export abstract class GoogleIdentityPort {
  /** Load the GIS script early so the popup can open inside the click's user gesture. */
  abstract preload(): void;
  /** Authorization-code popup; the code goes to the sign-in helper. */
  abstract requestCode(opts: PopupOptions): Promise<string>;
  /** Token-model popup (no helper available): a ~1 hour token, no refresh. */
  abstract requestToken(opts: PopupOptions): Promise<GoogleTokens>;
  abstract revoke(accessToken: string): void;
}

export class AuthHelperError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuthHelperError';
    this.status = status;
  }
}

/**
 * Android app (Step 8): Google's web OAuth flow doesn't run inside a WebView, so the APK asks
 * Play services for the Drive token. Play services remembers the grant and mints a fresh token
 * silently whenever asked, so these sessions renew without a refresh token or the helper.
 * In the browser `available` is false and nothing else is called.
 */
export abstract class NativeAuthPort {
  abstract readonly available: boolean;
  /** `interactive: false` never shows UI and rejects when Google needs the user. */
  abstract authorize(interactive: boolean): Promise<GoogleTokens>;
  /** Forget a token in Play services' cache, so the next authorize() mints a new one. */
  abstract clearToken(token: string): Promise<void>;
  /**
   * Hand the current token + account to the native side (player, downloads, `/__drive/`),
   * null on sign-out. Fire-and-forget.
   */
  abstract share(token: string | null, expiresAt: number, email: string | null): void;
}

/** The sign-in helper function (`/api/auth/*`), which keeps the refresh token in a cookie. */
export abstract class AuthHelperPort {
  /** Is the helper deployed and configured on this origin? (cached; false on plain `ng serve` without proxy) */
  abstract available(): Promise<boolean>;
  /** Does the helper already hold a refresh token for this browser? */
  abstract hasSession(): Promise<boolean>;
  abstract exchange(code: string): Promise<GoogleTokens & { readonly refresh: boolean }>;
  /** @throws AuthHelperError (401 = grant gone, sign in again) */
  abstract refresh(): Promise<GoogleTokens>;
  abstract logout(): Promise<void>;
}

/** Who the token belongs to (Drive `about`). */
export abstract class GoogleProfilePort {
  abstract fetchAccount(accessToken: string): Promise<Account | null>;
}

/** Where the Google session survives reloads (localStorage). */
export abstract class SessionPersistencePort {
  abstract read(): StoredSession | null;
  abstract write(session: StoredSession | null): void;
}

/** Firebase Auth via custom token (`/api/firebase/token`). */
export abstract class FirebaseSessionPort {
  /**
   * Signed-in Firebase uid for this Google account: reuses Firebase's own persisted session when it
   * belongs to `email`, otherwise swaps a Google access token for a custom token.
   */
  abstract connect(email: string, accessToken: () => Promise<string | null>): Promise<string>;
  abstract disconnect(): Promise<void>;
}

/** `config/access` allowlist. */
export abstract class AccessPort {
  abstract isAllowed(uid: string): Promise<boolean>;
}

/** `users/{uid}`: profile + prefs. `get` is null for a first sign-in (→ Welcome). */
export abstract class UserProfilePort {
  abstract get(uid: string): Promise<UserDoc | null>;
  abstract create(uid: string, doc: UserDoc): Promise<void>;
  abstract updatePrefs(uid: string, prefs: UserPrefs): Promise<void>;
  /** Deletes `users/{uid}` and everything under it (Settings → Delete account data). */
  abstract deleteAll(uid: string): Promise<void>;
}

/**
 * Android app updates for Settings → App (GitHub Releases; bound to shared/infrastructure's
 * ApkUpdate). Nothing is ever available in the browser.
 */
export abstract class AppReleasePort {
  abstract readonly current: Signal<{ readonly versionName: string; readonly versionCode: number } | null>;
  abstract readonly available: Signal<{ readonly versionName: string; readonly versionCode: number; readonly url: string } | null>;
  abstract check(): Promise<void>;
  abstract install(): void;
}
