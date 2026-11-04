import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { UserDataRepository } from '../domain';
import { FirestoreUserDataRepository } from './firestore-user-data.repository';

/** Binds the library ports to Firestore (app.config.ts). */
export function provideLibrary(): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: UserDataRepository, useClass: FirestoreUserDataRepository }]);
}
