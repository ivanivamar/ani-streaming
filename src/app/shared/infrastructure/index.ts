/**
 * shared / infrastructure — Firebase providers/DI tokens (Auth, Firestore with persistent
 * cache), app configuration, the Drive HTTP client, update checks (service worker on the web,
 * GitHub Releases for the APK) and the Android bridge (`native.ts`). Firebase JS SDK only, no AngularFire.
 */
export { APP_ENV, missingEnv, type AppEnv } from './app-env';
export { FIREBASE_APP, FIREBASE_AUTH, FIRESTORE } from './firebase';
export { AccessTokenSource } from './access-token-source';
export { AuthError, DriveClient, DriveError, type DriveFile } from './drive-client';
export { AppUpdate, SW_CONTAINER, UPDATE_CHECK_MS } from './app-update';
export { APK_REPO, ApkUpdate, newerRelease, type ApkRelease } from './apk-update';
export {
  AniDownloads,
  AniNative,
  AniPlayer,
  IS_NATIVE,
  NATIVE_API_BASE,
  nativeDriveUrl,
  type NativeAppInfo,
  type NativeDecoderInfo,
  type NativeDownloadItem,
  type NativeDownloadProgress,
  type NativeDownloadState,
  type NativePlayerError,
  type NativePlayerState,
  type NativeToken,
} from './native';
export { provideNativeShell } from './native-shell';
