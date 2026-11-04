package com.anistream;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * ani.stream for Android (PLAN.md Step 8): the Angular app in Capacitor's WebView, plus
 *   AniNative     Play services sign-in, app info, immersive mode
 *   AniPlayer     Media3 ExoPlayer under the WebView
 *   AniDownloads  offline downloads (WorkManager)
 * and DriveWebViewClient, which answers `/__drive/<id>` (thumbnails, subtitles, fonts).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // local plugins must be registered before the bridge starts
        registerPlugin(AniNativePlugin.class);
        registerPlugin(AniPlayerPlugin.class);
        registerPlugin(AniDownloadsPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new DriveWebViewClient(bridge));
    }
}
