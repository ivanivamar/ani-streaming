import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android app (PLAN.md Step 8). `npm run android:sync` builds the web app and copies
 * dist/ani-stream/browser into the APK, so the UI loads from the phone (https://localhost) and
 * works offline; Google sign-in, the video player and downloads are native
 * (android/app/src/main/java/com/anistream/*Plugin.java). The sign-in function is called on
 * https://myanime-streaming.web.app (shared/infrastructure/native.ts NATIVE_API_BASE).
 */
const config: CapacitorConfig = {
  appId: 'com.ivan.anistream',
  appName: 'ani.stream',
  webDir: 'dist/ani-stream/browser',
  backgroundColor: '#0a0b0d',
  plugins: {
    SystemBars: {
      // the WebView sits between the status and navigation bars; the player hides both (immersive)
      insetsHandling: 'native',
      style: 'DARK', // light status-bar icons on the dark UI
    },
  },
};

export default config;
