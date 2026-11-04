import { computed, DestroyRef, DOCUMENT, inject, Service, signal } from '@angular/core';
import {
  canRenew,
  DRIVE_READONLY_SCOPE,
  hasScope,
  initialStatus,
  isLive,
  needsRenewal,
  timerDelay,
  type AccessGate,
  type Account,
  type ConnectionPhase,
  type RenewMode,
  type SessionStatus,
  type StoredSession,
} from '../domain';
import {
  AccessPort,
  AuthHelperError,
  AuthHelperPort,
  FirebaseSessionPort,
  GoogleIdentityPort,
  GoogleProfilePort,
  NativeAuthPort,
  SessionPersistencePort,
  type GoogleTokens,
} from './ports';

const NEEDS_DRIVE =
  'ani.stream needs read access to Google Drive to stream your episodes. Tick the Drive box when Google asks.';

/**
 * One Google sign-in for Drive and Firestore (ported from the music app's `state/session.ts` +
 * `sync/firebase.ts`).
 *
 * Google: when the sign-in helper function is deployed (`/api/auth`), sign-in uses the
 * authorization-code flow; the helper keeps the refresh token in an HttpOnly cookie and the app
 * silently gets a new 1-hour access token 5 min before the old one runs out, on wake-up and when
 * the connection returns — sign in once, not every hour. Without the helper (plain `ng serve`) it
 * falls back to the token model: one click on "Sign in again" every hour.
 *
 * Firebase: the Drive token is swapped once for a Firebase custom token (`/api/firebase/token`);
 * Firebase Auth then keeps its own session. Then `config/access` decides whether this uid may use
 * the app (`phase` = `ready` or `no-access`).
 *
 * Android (Step 8): sign-in and renewal go through Play services (`NativeAuthPort`, renew mode
 * `native`): no popup, no helper, no refresh token. Every new token is also handed to the native
 * side (`share`), which streams, downloads and serves `/__drive/` with it.
 */
@Service()
export class SessionStore {
  private readonly google = inject(GoogleIdentityPort);
  private readonly helper = inject(AuthHelperPort);
  private readonly profile = inject(GoogleProfilePort);
  private readonly persistence = inject(SessionPersistencePort);
  private readonly firebase = inject(FirebaseSessionPort);
  private readonly access = inject(AccessPort);
  private readonly native = inject(NativeAuthPort);
  private readonly doc = inject(DOCUMENT);

  private stored: StoredSession | null = this.persistence.read();

  private readonly _status = signal<SessionStatus>(initialStatus(this.stored, Date.now()));
  private readonly _account = signal<Account | null>(this.stored?.account ?? null);
  private readonly _pending = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _phase = signal<ConnectionPhase>('idle');
  private readonly _uid = signal<string | null>(null);
  private readonly _resets = signal(0);

  /** Google side: signed-out / signed-in / expired. */
  readonly status = this._status.asReadonly();
  readonly account = this._account.asReadonly();
  /** True while Google's popup or the helper exchange is in flight. */
  readonly pending = this._pending.asReadonly();
  /** Last failure, shown on the sign-in screen. */
  readonly error = this._error.asReadonly();
  /** Firebase side + allowlist. */
  readonly phase = this._phase.asReadonly();
  /** Firebase uid ("g" + Drive permission id) once connected. */
  readonly uid = this._uid.asReadonly();
  /** Increments on sign-out and account switch, so user-data stores can drop their caches. */
  readonly resets = this._resets.asReadonly();
  /** The app is usable: Google signed in, Firebase connected, uid allowlisted. */
  readonly ready = computed(() => this._status() === 'signed-in' && this._phase() === 'ready');

  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<boolean> | null = null;
  private connecting: Promise<ConnectionPhase> | null = null;
  private lastAttempt = 0;

  constructor() {
    this.shareNative();
    this.armExpiry();
    this.renewIfNeeded();
    // Timers are throttled or frozen in background tabs; renew when the tab comes back or the
    // connection returns (an offline renewal attempt left the session expired).
    const doc = this.doc;
    const win = doc.defaultView;
    const onVisible = () => doc.visibilityState === 'visible' && this.renewIfNeeded();
    const onOnline = () => this.renewIfNeeded();
    doc.addEventListener('visibilitychange', onVisible);
    win?.addEventListener('online', onOnline);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.expiryTimer);
      doc.removeEventListener('visibilitychange', onVisible);
      win?.removeEventListener('online', onOnline);
    });
  }

  /* ── tokens (also the AccessTokenSource of shared/playback infrastructure) ── */

  /** Current access token, or null when signed out / expired (no renewal). */
  token(): string | null {
    const s = this.stored;
    if (!s) return null;
    if (!isLive(s, Date.now())) {
      if (this._status() === 'signed-in') this.expire();
      return null;
    }
    return s.token;
  }

  /** A usable token, renewing it first if this session can. */
  async ensureToken(): Promise<string | null> {
    const s = this.stored;
    if (s && isLive(s, Date.now())) return s.token;
    if (!canRenew(s)) return this.token();
    return (await this.refresh()) ? this.token() : null;
  }

  /** New token without UI (helper / Play services). False when the session can't renew or Google needs the user. */
  refresh(): Promise<boolean> {
    const s = this.stored;
    if (!canRenew(s) || !s?.account) return Promise.resolve(false);
    if (s.renew === 'native') {
      this.refreshing ??= (async () => {
        try {
          // drop the cached (old or rejected) token so Play services mints a full-length one
          if (s.token) await this.native.clearToken(s.token).catch(() => undefined);
          await this.adopt(await this.native.authorize(false), false, 'native');
          return true;
        } catch {
          return false;
        } finally {
          this.refreshing = null;
        }
      })();
      return this.refreshing;
    }
    this.refreshing ??= (async () => {
      try {
        const t = await this.helper.refresh();
        await this.adopt(t, false, 'server');
        return true;
      } catch (e) {
        // 401: the grant is gone (revoked, or unused for 6 months) → sign in again
        if (e instanceof AuthHelperError && e.status === 401 && this.stored) {
          this.store({ ...this.stored, renew: undefined });
        }
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Token ran out or Drive answered 401. Tries a silent renewal first. */
  expire(): void {
    if (!this.stored) return;
    if (canRenew(this.stored) && this._status() === 'signed-in') {
      void this.refresh().then((ok) => ok || this.renewFailed());
      return;
    }
    this.markExpired();
  }

  /* ── sign-in / sign-out ── */

  /** Start loading Google's script (sign-in screen mount). */
  preload(): void {
    if (this.native.available) return;
    this.google.preload();
    void this.helper.available();
  }

  /**
   * Opens the Google popup — call from a click handler (pop-up blockers need the user gesture),
   * then connects Firebase. Resolves with the resulting phase; failures land in `error`.
   */
  async signIn(opts: { switchAccount?: boolean } = {}): Promise<ConnectionPhase> {
    this._pending.set(true);
    this._error.set(null);
    const hint = opts.switchAccount ? undefined : (this._account()?.email ?? undefined);
    const popup = { hint, selectAccount: !!opts.switchAccount };
    try {
      if (this.native.available) {
        const old = this.stored?.token;
        if (opts.switchAccount && old) {
          // revoking makes Google ask again, which shows the account chooser
          this.google.revoke(old);
          await this.native.clearToken(old).catch(() => undefined);
        }
        const t = await this.native.authorize(true);
        if (!hasScope(t.scope, DRIVE_READONLY_SCOPE)) throw new Error(NEEDS_DRIVE);
        await this.adopt(t, true, 'native');
      } else if (await this.helper.available()) {
        const code = await this.google.requestCode(popup);
        const t = await this.helper.exchange(code);
        if (!hasScope(t.scope, DRIVE_READONLY_SCOPE)) throw new Error(NEEDS_DRIVE);
        // no refresh token (Google issues one per grant): renewable only if the cookie already holds one
        const renewable = t.refresh || (await this.helper.hasSession());
        await this.adopt(t, true, renewable ? 'server' : undefined);
      } else {
        const t = await this.google.requestToken(popup);
        if (!hasScope(t.scope, DRIVE_READONLY_SCOPE)) throw new Error(NEEDS_DRIVE);
        await this.adopt(t, true, undefined);
      }
    } catch (e) {
      this._pending.set(false);
      this._error.set(e instanceof Error ? e.message : String(e));
      return this._phase();
    }
    this._pending.set(false);
    return this.connect();
  }

  signOut(): void {
    const token = this.stored?.token;
    if (token) this.google.revoke(token);
    if (token && this.native.available) void this.native.clearToken(token).catch(() => undefined);
    // the helper revokes the refresh token and clears its cookie
    if (this.stored?.renew === 'server') void this.helper.logout().catch(() => undefined);
    this.store(null);
    clearTimeout(this.expiryTimer);
    this._status.set('signed-out');
    this._account.set(null);
    this._pending.set(false);
    this._error.set(null);
    this.resetConnection();
  }

  /* ── Firebase + allowlist ── */

  /**
   * Connect Firebase and check the allowlist (idempotent while in flight). Called after sign-in
   * and by the route guard on boot.
   */
  connect(): Promise<ConnectionPhase> {
    if (this._status() !== 'signed-in') return Promise.resolve(this._phase());
    if (this._phase() === 'ready') return Promise.resolve('ready');
    this.connecting ??= (async (): Promise<ConnectionPhase> => {
      this._phase.set('connecting');
      try {
        const uid = await this.firebase.connect(this._account()?.email ?? '', () => this.ensureToken());
        this._uid.set(uid);
        const allowed = await this.access.isAllowed(uid);
        this._phase.set(allowed ? 'ready' : 'no-access');
      } catch (e) {
        this._error.set(e instanceof Error ? e.message : String(e));
        this._phase.set('error');
      } finally {
        this.connecting = null;
      }
      return this._phase();
    })();
    return this.connecting;
  }

  /** For guards: settle the session (renewal + Firebase) and say whether the app may be used. */
  async gate(): Promise<AccessGate> {
    if (this.refreshing) await this.refreshing;
    const status = this._status();
    if (status !== 'signed-in') return status;
    const phase = await this.connect();
    return phase === 'ready' || phase === 'no-access' || phase === 'error' ? phase : 'error';
  }

  /** "Try again" on the no-access / error screen (e.g. after adding the uid to the allowlist). */
  retry(): Promise<ConnectionPhase> {
    if (this._phase() !== 'connecting') this._phase.set('idle');
    this._error.set(null);
    return this.connect();
  }

  /* ── internals ── */

  private async adopt(t: GoogleTokens, withAccount: boolean, renew: RenewMode | undefined): Promise<void> {
    const fetched = withAccount ? await this.profile.fetchAccount(t.accessToken).catch(() => null) : null;
    const previous = this._account();
    const account = fetched ?? previous;
    const switched = !!previous && !!account && previous.email !== account.email;
    this.store({
      token: t.accessToken,
      expiresAt: Date.now() + t.expiresInSec * 1000,
      account,
      ...(renew ? { renew } : {}),
    });
    this.armExpiry();
    this._account.set(account);
    this._status.set('signed-in');
    this._error.set(null);
    if (switched) this.resetConnection();
  }

  private resetConnection(): void {
    void this.firebase.disconnect().catch(() => undefined);
    this.connecting = null;
    this._phase.set('idle');
    this._uid.set(null);
    this._resets.update((n) => n + 1);
  }

  /**
   * A silent renewal didn't work. Android offline (watching downloads): stay signed in, the
   * native side and Firestore's cache don't need a fresh token; renewal runs again when the
   * connection is back. Otherwise the user has to sign in again.
   */
  private renewFailed(): void {
    if (this.stored?.renew === 'native' && this.doc.defaultView?.navigator.onLine === false) return;
    this.markExpired();
  }

  private markExpired(): void {
    if (!this.stored) return;
    this.store({ ...this.stored, token: '', expiresAt: 0 });
    clearTimeout(this.expiryTimer);
    this._status.set('expired');
  }

  private store(s: StoredSession | null): void {
    this.stored = s;
    this.persistence.write(s);
    this.shareNative();
  }

  /** Android: the native side streams and downloads with the same token (and renews it while JS sleeps). */
  private shareNative(): void {
    if (!this.native.available) return;
    const s = this.stored;
    this.native.share(s?.token || null, s?.expiresAt ?? 0, s?.account?.email ?? null);
  }

  private armExpiry(): void {
    clearTimeout(this.expiryTimer);
    const s = this.stored;
    if (!s) return;
    const delay = timerDelay(s, Date.now());
    if (delay === null) return;
    // tokens last an hour, well under setTimeout's ~24-day limit
    this.expiryTimer = setTimeout(() => {
      if (canRenew(this.stored)) void this.refresh().then((ok) => ok || this.renewFailed());
      else this.markExpired();
    }, delay);
  }

  /** Renewable sessions: renew a stale token on boot, on wake-up and when back online. */
  private renewIfNeeded(): void {
    const s = this.stored;
    if (!s || !canRenew(s) || this._status() === 'signed-out') return;
    const now = Date.now();
    if (!needsRenewal(s, now)) return;
    if (this._status() === 'expired' && now - this.lastAttempt < 10_000) return;
    this.lastAttempt = now;
    void this.refresh().then((ok) => ok || this.renewFailed());
  }
}
