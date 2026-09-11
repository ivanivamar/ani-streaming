import { Injectable, computed, signal } from '@angular/core';
import { AppUser } from '../models/user.model';

export type AuthMode = 'signin' | 'register';

/**
 * STUB. Backed by an in-memory fake account instead of Firebase
 * Authentication / AngularFire (README.md "Backend contract" §Auth).
 *
 * Swap the bodies of `signIn` / `register` / `signOut` for the real
 * `signInWithEmailAndPassword` / `createUserWithEmailAndPassword` +
 * `updateProfile` / `signOut` calls once AngularFire is wired up — the
 * public signal-based surface (`user`, `isAuthenticated`) is meant to stay
 * the same so nothing downstream has to change.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _user = signal<AppUser | null>(null);
  private readonly _authMode = signal<AuthMode>('signin');
  private readonly _pending = signal(false);
  private readonly _error = signal<string | null>(null);

  /** Currently signed-in user, or null when signed out. */
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  /** Whether the auth screen is in "sign in" or "create account" mode. */
  readonly authMode = this._authMode.asReadonly();

  /** True while a stubbed sign-in/register call is "in flight". */
  readonly pending = this._pending.asReadonly();

  /** Last auth error message, if any, for display on the auth screen. */
  readonly error = this._error.asReadonly();

  /** Simulated network latency for the stub, so the UI's pending state is exercised. */
  private static readonly FAKE_LATENCY_MS = 450;

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
    await this.simulateLatency();
    this._user.set({
      uid: 'stub-user',
      displayName: email.split('@')[0] || 'Account',
      email,
    });
  }

  async register(displayName: string, email: string, password: string): Promise<void> {
    this._error.set(null);
    if (!displayName || !email || !password) {
      this._error.set('Fill in every field to create an account.');
      return;
    }
    await this.simulateLatency();
    this._user.set({ uid: 'stub-user', displayName, email });
  }

  signOut(): void {
    this._user.set(null);
    this._authMode.set('signin');
  }

  private simulateLatency(): Promise<void> {
    this._pending.set(true);
    return new Promise((resolve) => {
      setTimeout(() => {
        this._pending.set(false);
        resolve();
      }, AuthService.FAKE_LATENCY_MS);
    });
  }
}
