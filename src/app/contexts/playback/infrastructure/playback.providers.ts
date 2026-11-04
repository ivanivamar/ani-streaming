import { inject, makeEnvironmentProviders, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import { IS_NATIVE } from '@shared/infrastructure';
import { DecoderProbePort, NativePlayerPort, OfflineStorePort, SkipTimesPort, SubtitleRendererPort, VideoSourcePort } from '../domain';
import { AniSkipClient } from './aniskip.client';
import { DriveStreamBridge } from './drive-stream.bridge';
import { JassubRenderer, NativeJassubRenderer } from './jassub-renderer';
import { MediaCapabilitiesProbe } from './media-capabilities.probe';
import { NativeDecoderProbe } from './native-decoder.probe';
import { CapacitorNativePlayer, NoNativePlayer } from './native-player';
import { NativeVideoSource } from './native-video-source';
import { CapacitorOfflineStore, NoOfflineStore } from './offline-store';

/**
 * Browser: the video source is the service-worker bridge, registered at boot (not awaited: it
 * also caches the app shell, and the first play waits for it anyway).
 *
 * Android app (Step 8): Media3 plays the video under the WebView, MediaCodec answers the decode
 * check, JASSUB draws on its own canvas, and downloads go through WorkManager. No service worker.
 */
export function providePlayback(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: VideoSourcePort, useClass: IS_NATIVE ? NativeVideoSource : DriveStreamBridge },
    { provide: SubtitleRendererPort, useClass: IS_NATIVE ? NativeJassubRenderer : JassubRenderer },
    { provide: SkipTimesPort, useClass: AniSkipClient },
    { provide: DecoderProbePort, useClass: IS_NATIVE ? NativeDecoderProbe : MediaCapabilitiesProbe },
    { provide: NativePlayerPort, useClass: IS_NATIVE ? CapacitorNativePlayer : NoNativePlayer },
    { provide: OfflineStorePort, useClass: IS_NATIVE ? CapacitorOfflineStore : NoOfflineStore },
    provideAppInitializer(() => {
      void inject(VideoSourcePort).init();
    }),
  ]);
}
