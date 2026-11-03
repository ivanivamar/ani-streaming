import type { AppEnv } from '@shared/infrastructure';

/**
 * Public identifiers of the `myanime-streaming` deployment — not secrets (README "Step 3 setup").
 *
 * - googleClientId: Google Cloud → APIs & Services → Credentials → the "ani.stream Web" client.
 * - firebase: Firebase console → Project settings → General → Your apps → Web app → SDK config.
 *
 * While a value is empty the sign-in screen says which one is missing.
 */
export const APP_ENV_VALUES: AppEnv = {
  googleClientId: '259000610793-5jjvtkt9gjf9n73k410h9ur7f972n0su.apps.googleusercontent.com',
  firebase: {
    apiKey: 'AIzaSyBw6IuWoo762kCfzrwRhkIBQ-M3MuPtH4Q',
    appId: '1:259000610793:web:95f989675277b0c6e3e578',
    projectId: 'myanime-streaming',
    authDomain: 'myanime-streaming.firebaseapp.com',
    messagingSenderId: '259000610793',
  },
  apiBase: '/',
};
