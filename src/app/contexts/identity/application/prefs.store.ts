import { computed, effect, inject, Service, signal, untracked } from '@angular/core';
import type { UserDoc, UserPrefs } from '../domain';
import { DEFAULT_PREFS, withDefaults, type Prefs } from '../domain';
import { UserProfilePort } from './ports';
import { SessionStore } from './session.store';

/**
 * The signed-in user's `users/{uid}` doc: whether it exists yet (first sign-in → Welcome) and
 * the playback preferences. Loads when the session becomes ready, resets on sign-out.
 * Writes are optimistic.
 */
@Service()
export class PrefsStore {
  private readonly session = inject(SessionStore);
  private readonly profiles = inject(UserProfilePort);

  private readonly _doc = signal<UserDoc | null>(null);
  private readonly _loaded = signal(false);
  private loading: { uid: string; promise: Promise<boolean> } | null = null;

  /** False until `users/{uid}` was read. */
  readonly loaded = this._loaded.asReadonly();
  /** True once the user has a profile doc (finished Welcome). */
  readonly exists = computed(() => this._doc() !== null);
  readonly prefs = computed<Prefs>(() => withDefaults(this._doc()?.prefs));

  constructor() {
    effect(() => {
      const uid = this.session.ready() ? this.session.uid() : null;
      untracked(() => {
        if (uid) void this.load();
        else this.reset();
      });
    });
  }

  /** Read the profile (once per uid). Resolves with "does it exist". */
  load(): Promise<boolean> {
    const uid = this.session.uid();
    if (!uid) return Promise.resolve(false);
    // answer from state once read: the cached promise would still say "no profile" after create()
    if (this.loading?.uid === uid) return this._loaded() ? Promise.resolve(this.exists()) : this.loading.promise;
    const promise = this.profiles.get(uid).then(
      (doc) => {
        if (this.session.uid() === uid) {
          this._doc.set(doc);
          this._loaded.set(true);
        }
        return doc !== null;
      },
      (e) => {
        this.loading = null;
        throw e;
      },
    );
    this.loading = { uid, promise };
    return promise;
  }

  /** Welcome → "Start watching": create the profile with the chosen defaults. */
  async create(prefs: UserPrefs): Promise<void> {
    const uid = this.session.uid();
    if (!uid) throw new Error('Not signed in');
    const account = this.session.account();
    const doc: UserDoc = {
      displayName: account?.name ?? null,
      email: account?.email ?? null,
      photoURL: account?.photo ?? null,
      createdAt: Date.now(),
      prefs: { ...DEFAULT_PREFS, ...prefs },
    };
    await this.profiles.create(uid, doc);
    if (this.session.uid() !== uid) return;
    this._doc.set(doc);
    this._loaded.set(true);
    this.loading = { uid, promise: Promise.resolve(true) };
  }

  /** Settings: change some prefs (optimistic; reverted if the write fails). */
  async update(patch: Partial<Prefs>): Promise<void> {
    const uid = this.session.uid();
    const before = this._doc();
    if (!uid || !before) return;
    const prefs = { ...this.prefs(), ...patch };
    this._doc.set({ ...before, prefs });
    try {
      await this.profiles.updatePrefs(uid, prefs);
    } catch (e) {
      this._doc.set(before);
      throw e;
    }
  }

  /** Settings → Delete account data: removes `users/{uid}/**`, then signs out. */
  async deleteAccountData(): Promise<void> {
    const uid = this.session.uid();
    if (!uid) return;
    await this.profiles.deleteAll(uid);
    this.session.signOut();
  }

  private reset(): void {
    this.loading = null;
    this._doc.set(null);
    this._loaded.set(false);
  }
}
