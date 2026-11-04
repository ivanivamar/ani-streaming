import { DestroyRef, inject, Service, signal } from '@angular/core';

const MOBILE = '(max-width: 759px)';
/** phone held sideways: short and wider than tall (only the Watch screen is designed for it) */
const LANDSCAPE_PHONE = '(max-height: 499px) and (orientation: landscape)';
const TOUCH = '(pointer: coarse)';

/** Breakpoints as signals (v3: desktop ≥ 760px, mobile below; landscape phone for the player). */
@Service()
export class Viewport {
  readonly mobile = signal(false);
  readonly landscapePhone = signal(false);
  readonly touch = signal(false);

  constructor() {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const bind = (query: string, target: ReturnType<typeof signal<boolean>>) => {
      const mq = window.matchMedia(query);
      target.set(mq.matches);
      const on = (e: MediaQueryListEvent) => target.set(e.matches);
      mq.addEventListener('change', on);
      return () => mq.removeEventListener('change', on);
    };
    const offs = [bind(MOBILE, this.mobile), bind(LANDSCAPE_PHONE, this.landscapePhone), bind(TOUCH, this.touch)];
    inject(DestroyRef).onDestroy(() => offs.forEach((off) => off()));
  }
}
