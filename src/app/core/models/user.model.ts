/**
 * Authenticated user shape.
 *
 * Production note (see README.md "Backend contract" / "Firestore"): this
 * mirrors the Firebase Authentication user object plus the
 * `users/{uid}` Firestore profile doc. This is a single-user instance —
 * there is exactly one account.
 */
export interface AppUser {
  uid: string;
  displayName: string;
  email: string;
}
