import { Component, DestroyRef, inject, signal } from '@angular/core';
import {
  ActivatedRoute,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';
import { Motion } from '@shared/ui';

/** navigations quicker than this never show the progress bar */
const SHOW_AFTER_MS = 120;

/**
 * Root: the router outlet, a thin progress bar while a navigation takes longer than 120 ms
 * (guards, a chunk still downloading), and route depth bookkeeping for page motion (route
 * `data.depth`: auth −1 · top-level 0 · search 1 · anime 2 · player 3; going to a lower depth
 * plays the "back" direction).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    @if (busy()) {
      <div class="nav-progress" role="progressbar" aria-label="Loading page"><i></i></div>
    }
    <router-outlet />
  `,
  styles: `
    .nav-progress {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 400;
      height: 2px;
      overflow: hidden;
      pointer-events: none;
    }
    .nav-progress i {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 40%;
      background: var(--accent);
      box-shadow: 0 0 8px oklch(0.84 0.14 155 / 0.6);
      animation: nav-slide 1s var(--ease) infinite;
    }
    @keyframes nav-slide {
      from {
        left: -40%;
      }
      to {
        left: 100%;
      }
    }
  `,
})
export class App {
  protected readonly busy = signal(false);

  constructor() {
    const router = inject(Router);
    const root = inject(ActivatedRoute);
    const motion = inject(Motion);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        clearTimeout(timer);
        timer = setTimeout(() => this.busy.set(true), SHOW_AFTER_MS);
        return;
      }
      if (e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError) {
        clearTimeout(timer);
        this.busy.set(false);
      }
      if (e instanceof NavigationEnd) {
        let r = root;
        while (r.firstChild) r = r.firstChild;
        const data = r.snapshot.data;
        motion.navigated((data['depth'] as number | undefined) ?? 0, !!data['compactMotion']);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      clearTimeout(timer);
    });
  }
}
