import { inject, Injectable, Injector } from '@angular/core';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { APP_ENV, FIREBASE_AUTH, missingEnv } from '@shared/infrastructure';
import { FirebaseSessionPort } from '../application/ports';

/**
 * Firebase Auth through a custom token from `/api/firebase/token` (ported from the music app's
 * `sync/firebase.ts`). Firebase keeps its own session in IndexedDB and renews it by itself; a
 * different Google account → sign out of Firebase and swap again.
 */
@Injectable()
export class CustomTokenFirebaseSession extends FirebaseSessionPort {
  private readonly env = inject(APP_ENV);
  // resolved lazily so the SDK initializes only when a connection is made
  private readonly injector = inject(Injector);

  async connect(email: string, accessToken: () => Promise<string | null>): Promise<string> {
    const missing = missingEnv(this.env).filter((k) => k.startsWith('firebase.'));
    if (missing.length) {
      throw new Error(`Firebase web config is missing (${missing.join(', ')}): fill it in src/app/app.env.ts.`);
    }
    const auth = this.injector.get(FIREBASE_AUTH);
    await auth.authStateReady();
    let user = auth.currentUser;
    if (user) {
      const claims = (await user.getIdTokenResult().catch(() => null))?.claims;
      if (!claims || (email && claims['email'] !== email)) {
        await signOut(auth);
        user = null;
      }
    }
    if (!user) {
      const t = await accessToken();
      if (!t) throw new Error('Not signed in to Google.');
      user = (await signInWithCustomToken(auth, await this.customToken(t))).user;
    }
    return user.uid;
  }

  async disconnect(): Promise<void> {
    await signOut(this.injector.get(FIREBASE_AUTH));
  }

  private async customToken(accessToken: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.env.apiBase}api/firebase/token`, {
        method: 'POST',
        headers: { 'X-Ani': '1', Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new Error('Could not reach the sign-in function (/api/firebase/token).');
    }
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    if (!isJson) {
      throw new Error(
        'The sign-in function is not reachable (/api/firebase/token). Deploy it (firebase deploy --only functions) ' +
          'and, on ng serve, start with `npm start` so /api is proxied.',
      );
    }
    const j = (await res.json().catch(() => ({}))) as { token?: string; message?: string; error?: string };
    if (!res.ok || !j.token) throw new Error(j.message || j.error || `Firebase sign-in answered ${res.status}`);
    return j.token;
  }
}
