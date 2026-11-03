import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { CatalogRepository } from '../domain';
import { FirestoreCatalogRepository } from './firestore-catalog.repository';

export function provideCatalog(): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: CatalogRepository, useClass: FirestoreCatalogRepository }]);
}
