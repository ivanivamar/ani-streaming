import { inject, InjectionToken } from '@angular/core';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { indexedDBLocalPersistence, inMemoryPersistence, initializeAuth, type Auth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { APP_ENV } from './app-env';

/**
 * Firebase JS SDK behind DI tokens (no AngularFire). Each instance is created on first injection,
 * so nothing initializes until a repository or the identity context asks for it, and tests that
 * provide fakes never touch the SDK.
 */
export const FIREBASE_APP = new InjectionToken<FirebaseApp>('FIREBASE_APP', {
  providedIn: 'root',
  factory: () => initializeApp(inject(APP_ENV).firebase, 'ani'),
});

/**
 * Firebase Auth. Only custom-token sign-in is used (identity context, `/api/firebase/token`);
 * IndexedDB keeps the session across reloads, memory is the fallback (private windows).
 */
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH', {
  providedIn: 'root',
  factory: () =>
    initializeAuth(inject(FIREBASE_APP), { persistence: [indexedDBLocalPersistence, inMemoryPersistence] }),
});

/**
 * Firestore with the persistent local cache (IndexedDB, shared between tabs), so home and search
 * render from cache instantly and reads stay cheap.
 */
export const FIRESTORE = new InjectionToken<Firestore>('FIRESTORE', {
  providedIn: 'root',
  factory: () =>
    initializeFirestore(inject(FIREBASE_APP), {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    }),
});
