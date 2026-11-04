import { inject, makeEnvironmentProviders, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import { DecoderProbePort, SkipTimesPort, SubtitleRendererPort, VideoSourcePort } from '../domain';
import { AniSkipClient } from './aniskip.client';
import { DriveStreamBridge } from './drive-stream.bridge';
import { JassubRenderer } from './jassub-renderer';
import { MediaCapabilitiesProbe } from './media-capabilities.probe';

/**
 * Binds the video source to the service-worker bridge and registers the worker at boot (not
 * awaited: it also caches the app shell, and the first play waits for it anyway).
 */
export function providePlayback(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: VideoSourcePort, useClass: DriveStreamBridge },
    { provide: SubtitleRendererPort, useClass: JassubRenderer },
    { provide: SkipTimesPort, useClass: AniSkipClient },
    { provide: DecoderProbePort, useClass: MediaCapabilitiesProbe },
    provideAppInitializer(() => {
      void inject(VideoSourcePort).init();
    }),
  ]);
}
