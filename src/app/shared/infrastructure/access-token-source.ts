/**
 * Where infrastructure gets a Google access token for Drive. Implemented by the identity context's
 * SessionStore and bound in `provideIdentity()`, so shared and playback infrastructure never
 * import identity.
 */
export abstract class AccessTokenSource {
  /** A usable token, renewed silently first when the session can; null when the user must sign in. */
  abstract ensureToken(): Promise<string | null>;
  /** Get a new token without UI. False when the session can't renew. */
  abstract refresh(): Promise<boolean>;
  /** Drive answered 401: renew silently if possible, otherwise mark the session expired. */
  abstract expire(): void;
}
