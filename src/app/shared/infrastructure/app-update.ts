import { DOCUMENT, inject, Injectable, InjectionToken, signal } from '@angular/core';

/** How often an open tab asks the server for a new `sw.js` (plus on every return to the tab). */
export const UPDATE_CHECK_MS = 30 * 60_000;
/** Returning to the tab checks again only if the last check is older than this. */
const VISIBLE_RECHECK_MS = 5 * 60_000;
/** Reload anyway if the new worker hasn't taken over by then. */
const RELOAD_FALLBACK_MS = 4_000;

/** The browser's service worker container (null: unsupported or insecure origin). Overridable in tests. */
export const SW_CONTAINER = new InjectionToken<ServiceWorkerContainer | null>('SW_CONTAINER', {
  providedIn: 'root',
  factory: () => {
    const win = inject(DOCUMENT).defaultView;
    return win && win.isSecureContext && 'serviceWorker' in win.navigator ? win.navigator.serviceWorker : null;
  },
});

/**
 * "New version · Reload" (PLAN.md Step 7). `public/sw.js` installs a new deploy next to the
 * running one and waits; this service notices the waiting worker and, when the user agrees,
 * tells it to take over (`ani:skip-waiting`) and reloads once it controls the page.
 *
 * The worker itself is registered by playback's `DriveStreamBridge`; this only watches the
 * registration. The first install (nothing to replace) never prompts: the worker skips waiting
 * on its own, and `controllerchange` only reloads after the user pressed Reload.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdate {
  private readonly sw = inject(SW_CONTAINER);
  private readonly doc = inject(DOCUMENT);
  private reg: ServiceWorkerRegistration | null = null;
  private started = false;
  private reloading = false;
  private lastCheck = 0;

  /** A new build is installed and waiting for the user. */
  readonly available = signal(false);

  /** Starts watching (idempotent). Resolves once the registration is known. */
  async start(): Promise<void> {
    const sw = this.sw;
    if (this.started || !sw) return;
    this.started = true;
    const reg = await sw.ready;
    this.reg = reg;
    this.lastCheck = Date.now();

    if (reg.waiting && sw.controller) this.available.set(true);
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      next?.addEventListener('statechange', () => {
        // installed + a controller already = an update (not the first install)
        if (next.state === 'installed' && sw.controller) this.available.set(true);
      });
    });
    sw.addEventListener('controllerchange', () => {
      if (this.reloading) this.doc.defaultView?.location.reload();
    });

    const win = this.doc.defaultView;
    win?.setInterval(() => void this.check(), UPDATE_CHECK_MS);
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'visible' && Date.now() - this.lastCheck > VISIBLE_RECHECK_MS) {
        void this.check();
      }
    });
  }

  /** Asks the server for a newer `sw.js` (sw.js is served no-cache). */
  async check(): Promise<void> {
    if (!this.reg) return;
    this.lastCheck = Date.now();
    try {
      await this.reg.update();
    } catch {
      /* offline or server down: try again next time */
    }
  }

  /** Activates the waiting build and reloads the page into it. */
  reload(): void {
    const win = this.doc.defaultView;
    const waiting = this.reg?.waiting;
    if (!waiting) {
      win?.location.reload();
      return;
    }
    this.reloading = true;
    waiting.postMessage({ type: 'ani:skip-waiting' });
    win?.setTimeout(() => win.location.reload(), RELOAD_FALLBACK_MS);
  }

  /** Hides the prompt until the next build is found (the waiting one still activates once every ani.stream tab is closed). */
  dismiss(): void {
    this.available.set(false);
  }
}
