import { Injectable } from '@angular/core';
import { AniNative } from '@shared/infrastructure';
import { NativeAuthPort, type GoogleTokens } from '../application/ports';

/** Browser build: no native sign-in. */
@Injectable()
export class NoNativeAuth extends NativeAuthPort {
  readonly available = false;

  authorize(): Promise<GoogleTokens> {
    return Promise.reject(new Error('Native sign-in is only available in the Android app.'));
  }

  clearToken(): Promise<void> {
    return Promise.resolve();
  }

  share(): void {
    /* nothing to share with */
  }
}

/**
 * Android app: Play services AuthorizationClient through the `AniNative` plugin (ported from the
 * music app's `PelagicNativePlugin`). The OAuth client is matched by package name + signing-key
 * SHA-1 (the "ani.stream Android" client in Google Cloud), so no client id appears here.
 */
@Injectable()
export class PlayServicesAuth extends NativeAuthPort {
  readonly available = true;
  private lastShared: string | null | undefined;

  async authorize(interactive: boolean): Promise<GoogleTokens> {
    try {
      const t = await AniNative.authorize({ interactive });
      return { accessToken: t.accessToken, expiresInSec: t.expiresInSec || 3000, scope: t.scope };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === 'cancelled') throw new Error('Sign-in was cancelled.', { cause: e });
      throw new Error(err?.message || 'Google sign-in failed.', { cause: e });
    }
  }

  async clearToken(token: string): Promise<void> {
    await AniNative.clearToken({ token });
  }

  share(token: string | null, expiresAt: number, email: string | null): void {
    const key = `${token}|${email}`;
    if (key === this.lastShared) return;
    this.lastShared = key;
    const call = token || email ? AniNative.setAuth({ email, token, expiresAt }) : AniNative.clearAuth();
    void call.catch(() => undefined);
  }
}
