import { DOCUMENT, inject, Injectable } from '@angular/core';
import { AccessTokenSource } from '@shared/infrastructure';
import { VideoSourcePort, type DriveVideo } from '../domain';

/**
 * Service-worker bridge (ported from the music app's `lib/driveStream.ts`): registers `/sw.js`,
 * answers its per-request token questions over a MessageChannel and builds the same-origin
 * `/__drive/<fileId>?size=&type=` URLs the worker proxies to Drive with range requests.
 *
 * Without a controlling worker (unsupported, blocked, insecure origin) `streamUrl()` is null; an
 * episode is far too big to download whole, so the player shows an error instead.
 */
@Injectable()
export class DriveStreamBridge extends VideoSourcePort {
  private readonly doc = inject(DOCUMENT);
  private readonly tokens = inject(AccessTokenSource);
  private ready: Promise<boolean> | null = null;

  private get container(): ServiceWorkerContainer | null {
    const nav = this.doc.defaultView?.navigator;
    return nav && 'serviceWorker' in nav && this.doc.defaultView?.isSecureContext ? nav.serviceWorker : null;
  }

  /** `<base href>` of the app, so the worker's scope matches a non-root deploy too. */
  private get base(): string {
    return new URL(this.doc.baseURI).pathname;
  }

  init(): Promise<boolean> {
    this.ready ??= (async () => {
      const sw = this.container;
      if (!sw) return false;
      try {
        this.listen(sw);
        await sw.register(`${this.base}sw.js`, { scope: this.base });
        const reg = await sw.ready;
        // After a hard reload the page starts uncontrolled: ask the active worker to claim it.
        if (!sw.controller) reg.active?.postMessage({ type: 'ani:claim' });
        return await this.waitForController(sw, 4000);
      } catch (e) {
        console.warn('[ani] service worker unavailable, Drive streaming is off', e);
        return false;
      }
    })();
    return this.ready;
  }

  async streamUrl(video: DriveVideo): Promise<string | null> {
    if (!(await this.init()) || !this.container?.controller) return null;
    const q = new URLSearchParams({ size: String(video.sizeBytes || 0), type: video.mimeType });
    return `${this.base}__drive/${encodeURIComponent(video.driveFileId)}?${q}`;
  }

  imageUrl(driveFileId: string, mimeType = 'image/webp'): string | null {
    if (!this.container?.controller) return null;
    return `${this.base}__drive/${encodeURIComponent(driveFileId)}?${new URLSearchParams({ type: mimeType })}`;
  }

  private listen(sw: ServiceWorkerContainer): void {
    sw.addEventListener('message', (e: MessageEvent) => {
      const type = (e.data as { type?: string } | null)?.type;
      if (type === 'ani:token') {
        const port = e.ports[0];
        void this.tokens
          .ensureToken()
          .catch(() => null)
          .then((token) => port?.postMessage({ token }));
      } else if (type === 'ani:drive-401') {
        this.tokens.expire();
      }
    });
    sw.startMessages();
  }

  private waitForController(sw: ServiceWorkerContainer, ms: number): Promise<boolean> {
    if (sw.controller) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        sw.removeEventListener('controllerchange', done);
        resolve(!!sw.controller);
      };
      const t = setTimeout(done, ms);
      sw.addEventListener('controllerchange', done);
    });
  }
}
