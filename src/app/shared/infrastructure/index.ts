/**
 * shared / infrastructure — Firebase providers/DI tokens (Auth, Firestore with persistent
 * cache), app configuration and the Drive HTTP client. Firebase JS SDK only, no AngularFire.
 */
export { APP_ENV, missingEnv, type AppEnv } from './app-env';
export { FIREBASE_APP, FIREBASE_AUTH, FIRESTORE } from './firebase';
export { AccessTokenSource } from './access-token-source';
export { AuthError, DriveClient, DriveError, type DriveFile } from './drive-client';
