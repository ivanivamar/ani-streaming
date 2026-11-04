import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { ImportGateway } from '../domain';
import { FirestoreImportGateway } from './firestore-import.gateway';

/** Binds the importing port to Firestore (app.config.ts). */
export function provideImporting(): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: ImportGateway, useClass: FirestoreImportGateway }]);
}
