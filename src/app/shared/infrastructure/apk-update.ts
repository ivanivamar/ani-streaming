import { DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { AniNative, IS_NATIVE, type NativeAppInfo } from './native';

/**
 * GitHub repo whose Releases carry the APK (`.github/workflows/android.yml` publishes every build
 * as `android-<versionCode>` with `ani-stream.apk`). The unauthenticated API only sees a **public**
 * repo's releases; for a private one the check finds nothing and stays quiet.
 */
export const APK_REPO = 'ivanivamar/my-streaming';
const EVERY_MS = 6 * 60 * 60_000;

export interface ApkRelease {
  readonly versionCode: number;
  readonly versionName: string;
  readonly url: string;
}

interface GhRelease {
  tag_name: string;
  name?: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
}

/** Newest `android-<n>` release with an APK, if newer than `current`. */
export function newerRelease(releases: readonly GhRelease[], current: number): ApkRelease | null {
  let best: ApkRelease | null = null;
  for (const r of releases) {
    const m = /^android-(\d+)$/.exec(r.tag_name);
    const apk = r.assets.find((a) => a.name.endsWith('.apk'));
    if (!m || !apk || r.draft || r.prerelease) continue;
    const code = Number(m[1]);
    if (!best || code > best.versionCode) best = { versionCode: code, versionName: r.name || r.tag_name, url: apk.browser_download_url };
  }
  return best && best.versionCode > current ? best : null;
}

/**
 * Android app updates (ported from the music app's `native/updates.ts`). On launch and when the
 * app comes back to the foreground (at most every 6 h) the latest GitHub release is compared with
 * the installed versionCode; "Install" opens the APK download and Android's installer updates in
 * place (same signing key). The web build uses `AppUpdate` (service worker) instead.
 */
@Injectable({ providedIn: 'root' })
export class ApkUpdate {
  private readonly doc = inject(DOCUMENT);
  private started = false;
  private lastCheck = 0;

  readonly current = signal<NativeAppInfo | null>(null);
  /** A newer APK than the installed one. */
  readonly available = signal<ApkRelease | null>(null);

  start(): void {
    if (!IS_NATIVE || this.started) return;
    this.started = true;
    void this.check();
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'visible' && Date.now() - this.lastCheck > EVERY_MS) void this.check();
    });
  }

  async check(): Promise<void> {
    this.lastCheck = Date.now();
    try {
      const current = this.current() ?? (await AniNative.appInfo());
      this.current.set(current);
      const res = await fetch(`https://api.github.com/repos/${APK_REPO}/releases?per_page=10`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return;
      this.available.set(newerRelease((await res.json()) as GhRelease[], current.versionCode));
    } catch {
      /* offline: try again later */
    }
  }

  install(): void {
    const r = this.available();
    if (r) void AniNative.openUrl({ url: r.url }).catch(() => undefined);
  }

  dismiss(): void {
    this.available.set(null);
  }
}
