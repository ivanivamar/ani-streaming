import { afterNextRender, Directive, ElementRef, inject, Service } from '@angular/core';

const EASE = 'cubic-bezier(.2,.7,.2,1)';
/** stagger groups rendered later than this after navigation (data arrived late, tab switch) don't animate */
const STAGGER_WINDOW_MS = 2500;

const reduced = () =>
  typeof window === 'undefined' ||
  typeof Element === 'undefined' ||
  !Element.prototype.animate ||
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * v3 motion spec, all Web Animations, skipped under `prefers-reduced-motion`.
 *
 * - Page enter: `opacity 0, translateY(±10px) → none`, 350ms; `[appStagger]` children 350ms,
 *   delay `80 + i·28` (cap 900). Compact pages (anime detail): 260ms, `40 + i·10` (cap 360).
 * - Back navigation (lower depth) reverses direction. Depths: auth −1 · top-level 0 · search 1 ·
 *   anime 2 · player 3 (route `data.depth`).
 * - Open player: the clicked poster grows to the viewport (720ms), fades to black from 45%,
 *   then the player fades in. Leave player: black overlay fades + scales to .94 (380ms).
 * - Auth → app: 520ms scale .985 → 1.
 */
@Service()
export class Motion {
  private depth = 0;
  private back = false;
  private compact = false;
  private navAt = 0;
  private index = 0;
  private fromAuth = false;
  private launch: { rect: DOMRect; bg: string; at: number } | null = null;

  /** Called by the shell / app root on every completed navigation. */
  navigated(depth: number, compact = false): void {
    this.back = depth < this.depth;
    this.fromAuth = this.depth < 0 && depth >= 0;
    this.depth = depth;
    this.compact = compact;
    this.navAt = performance.now();
    this.index = 0;
  }

  get isBack(): boolean {
    return this.back;
  }

  /** Page container enter (the shell calls this with the routed page's host). */
  pageEnter(el: HTMLElement): void {
    if (reduced()) return;
    const dy = this.back ? -10 : 10;
    el.animate([{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }], {
      duration: 350,
      easing: EASE,
    });
  }

  /** Shell chrome after sign-in. */
  shellEnter(el: HTMLElement): void {
    if (reduced() || !this.fromAuth) return;
    this.fromAuth = false;
    el.animate([{ opacity: 0, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: EASE });
  }

  stagger(group: HTMLElement): void {
    if (reduced() || performance.now() - this.navAt > STAGGER_WINDOW_MS) return;
    const dy = this.back ? -8 : 8;
    for (const child of Array.from(group.children)) {
      const i = this.index++;
      (child as HTMLElement).animate([{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }], {
        duration: this.compact ? 260 : 350,
        delay: this.compact ? Math.min(40 + i * 10, 360) : Math.min(80 + i * 28, 900),
        easing: EASE,
        fill: 'backwards',
      });
    }
  }

  /** Remember the artwork the user clicked to open the player. */
  rememberLaunch(el: HTMLElement, bg: string): void {
    this.launch = { rect: el.getBoundingClientRect(), bg, at: performance.now() };
  }

  playerEnter(el: HTMLElement): void {
    const l = this.launch;
    this.launch = null;
    if (reduced()) return;
    if (!l || l.rect.width < 20 || performance.now() - l.at > 1500) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: EASE });
      return;
    }
    const D = 720;
    const ov = document.createElement('div');
    ov.style.cssText = `position:fixed;z-index:300;pointer-events:none;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6);background:${l.bg}`;
    const dark = document.createElement('div');
    dark.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0';
    ov.appendChild(dark);
    document.body.appendChild(ov);
    const r = l.rect;
    ov.animate(
      [
        { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '14px' },
        { left: '0px', top: '0px', width: `${window.innerWidth}px`, height: `${window.innerHeight}px`, borderRadius: '0px' },
      ],
      { duration: D, easing: 'cubic-bezier(.65,0,.15,1)', fill: 'forwards' },
    );
    dark.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: D, easing: 'ease-in', fill: 'forwards' });
    const hold = el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: D - 40, fill: 'forwards' });
    hold.onfinish = () => {
      hold.cancel();
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
      ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' }).onfinish = () => ov.remove();
    };
  }

  playerLeave(): void {
    if (reduced()) return;
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:200;background:#000;pointer-events:none';
    document.body.appendChild(ov);
    ov.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.94)' }], {
      duration: 380,
      easing: EASE,
    }).onfinish = () => ov.remove();
  }
}

/** Marks a stagger group: its direct children enter one after another (see `Motion`). */
@Directive({ selector: '[appStagger]' })
export class Stagger {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const motion = inject(Motion);
    afterNextRender(() => motion.stagger(el));
  }
}
