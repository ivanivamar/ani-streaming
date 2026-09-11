import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  User,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../firebase';
import { AppUser } from '../models/user.model';

export type AuthMode = 'signin' | 'register';

/**
 * Real Firebase Authentication (README.md "Backend contract" §Auth),
 * via the plain `firebase/auth` SDK rather than AngularFire — see
 * `core/firebase.ts` for why. Single-user instance: sign-up isn't gated
 * client-side (README.md "Firestore": "Disable sign-up in the Firebase
 * console once your account exists" is the actual gate, plus the
 * backend's `OWNER_UID` check on every `/api/*` call).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** `undefined` until the first auth-state resolution, then `null` (signed out) or a `User`. */
  private readonly _firebaseUser = signal<User | null | undefined>(undefined);
  private readonly _authMode = signal<AuthMode>('signin');
  private readonly _pending = signal(false);
  private readonly _error = signal<string | null>(null);

  /** False until Firebase has resolved whether there's a persisted session — see auth.guard.ts. */
  readonly authReady = computed(() => this._firebaseUser() !== undefined);

  /** Currently signed-in user, or null when signed out (or not yet resolved). */
  readonly user = computed<AppUser | null>(() => {
    const firebaseUser = this._firebaseUser();
    if (!firebaseUser) return null;
    return {
      uid: firebaseUser.uid,
      displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Account',
      email: firebaseUser.email ?? '',
    };
  });

  readonly isAuthenticated = computed(() => this.user() !== null);

  /** Whether the auth screen is in "sign in" or "create account" mode. */
  readonly authMode = this._authMode.asReadonly();

  /** True while a sign-in/register/sign-out call is in flight. */
  readonly pending = this._pending.asReadonly();

  /** Last auth error message, if any, for display on the auth screen. */
  readonly error = this._error.asReadonly();

  constructor() {
    const unsubscribe = onIdTokenChanged(auth, (firebaseUser) => this._firebaseUser.set(firebaseUser));
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  setAuthMode(mode: AuthMode): void {
    this._authMode.set(mode);
    this._error.set(null);
  }

  toggleAuthMode(): void {
    this.setAuthMode(this._authMode() === 'signin' ? 'register' : 'signin');
  }

  async signIn(email: string, password: string): Promise<void> {
    this._error.set(null);
    if (!email || !password) {
      this._error.set('Enter your email and password.');
      return;
    }
    this._pending.set(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      this._error.set(this.describeError(err));
    } finally {
      this._pending.set(false);
    }
  }

  async register(displayName: string, email: string, password: string): Promise<void> {
    this._error.set(null);
    if (!displayName || !email || !password) {
      this._error.set('Fill in every field to create an account.');
      return;
    }
    this._pending.set(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName });
    } catch (err) {
      this._error.set(this.describeError(err));
    } finally {
      this._pending.set(false);
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(auth);
    this._authMode.set('signin');
  }

  /** Bearer token for `/api/*` calls (README.md "Backend contract"). Null if signed out. */
  getIdToken(): Promise<string | null> {
    return auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
  }

  private describeError(err: unknown): string {
    const code = (err as { code?: string } | null)?.code ?? '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password.';
      case 'auth/email-already-in-use':
        return 'An account with that email already exists.';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters.';
      case 'auth/invalid-email':
        return 'Enter a valid email address.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Try again in a moment.';
      case 'auth/network-request-failed':
        return 'Network error — check your connection.';
      default:
        return 'Something went wrong. Try again.';
    }
  }
}
