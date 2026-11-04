import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { NotifyRepository, SchedulePort } from '../domain';
import { AniListSchedule } from './anilist-schedule';
import { FirestoreNotifyRepository } from './firestore-notify.repository';

/** AniList schedule + Firestore notify flags (app.config.ts). */
export function provideReleases(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: SchedulePort, useClass: AniListSchedule },
    { provide: NotifyRepository, useClass: FirestoreNotifyRepository },
  ]);
}
