import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { AccessTokenSource, ApkUpdate, IS_NATIVE } from '@shared/infrastructure';
import {
  AccessPort,
  AppReleasePort,
  AuthHelperPort,
  FirebaseSessionPort,
  GoogleIdentityPort,
  GoogleProfilePort,
  NativeAuthPort,
  SessionPersistencePort,
  UserProfilePort,
} from '../application/ports';
import { SessionStore } from '../application/session.store';
import { AuthHelperClient } from './auth-helper.client';
import { CustomTokenFirebaseSession } from './firebase-session';
import { FirestoreAccess } from './firestore-access';
import { FirestoreUserProfile } from './firestore-user-profile';
import { GisGoogleIdentity } from './gis';
import { DriveAboutProfile } from './google-profile';
import { LocalSessionPersistence } from './local-session-persistence';
import { NoNativeAuth, PlayServicesAuth } from './native-auth';

/**
 * Binds the identity ports to the browser / Google / Firebase adapters (app.config.ts). In the
 * Android app sign-in goes through Play services (`PlayServicesAuth`) instead of the GIS popup.
 */
export function provideIdentity(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: GoogleIdentityPort, useClass: GisGoogleIdentity },
    { provide: AuthHelperPort, useClass: AuthHelperClient },
    { provide: GoogleProfilePort, useClass: DriveAboutProfile },
    { provide: NativeAuthPort, useClass: IS_NATIVE ? PlayServicesAuth : NoNativeAuth },
    { provide: SessionPersistencePort, useClass: LocalSessionPersistence },
    { provide: FirebaseSessionPort, useClass: CustomTokenFirebaseSession },
    { provide: AccessPort, useClass: FirestoreAccess },
    { provide: UserProfilePort, useClass: FirestoreUserProfile },
    { provide: AppReleasePort, useExisting: ApkUpdate },
    // Drive access for shared/playback infrastructure comes from the session
    { provide: AccessTokenSource, useExisting: SessionStore },
  ]);
}
