import { inject, makeEnvironmentProviders, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import { VideoSourcePort } from '../domain';
import { DriveStreamBridge } from './drive-stream.bridge';

/**
 * Binds the video source to the service-worker bridge and registers the worker at boot (not
 * awaited: it also caches the app shell, and the first play waits for it anyway).
 */
export function providePlayback(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: VideoSourcePort, useClass: DriveStreamBridge },
    provideAppInitializer(() => {
      void inject(VideoSourcePort).init();
    }),
  ]);
}
