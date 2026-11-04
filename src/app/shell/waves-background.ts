import { Component } from '@angular/core';

interface Band {
  readonly paths: readonly { d: string; opacity: number }[];
  readonly color: string;
  readonly duration: number;
  readonly reverse: boolean;
}

/** v3 `bg('Waves')`: n sine lines around y0, centre lines most opaque. Path maths copied from the prototype. */
function band(n: number, y0: number, gap: number, amp: number, ph: number, color: string, duration: number, reverse: boolean): Band {
  const paths = Array.from({ length: n }, (_, k) => {
    const y = y0 + k * gap;
    const a = amp * (0.6 + 0.4 * Math.sin(k * 0.7 + ph));
    const p1 = ph + k * 0.18;
    const p2 = ph * 2 + k * 0.33;
    let d = '';
    for (let x = 0; x <= 2000; x += 20) {
      const yy = y + a * Math.sin((2 * Math.PI * x) / 1000 + p1) + a * 0.35 * Math.sin((2 * Math.PI * x) / 500 + p2);
      d += `${x ? 'L' : 'M'}${x} ${yy.toFixed(1)}`;
    }
    const mid = Math.abs(k - (n - 1) / 2) / ((n - 1) / 2);
    return { d, opacity: +(1 - mid * 0.85).toFixed(2) };
  });
  return { paths, color, duration, reverse };
}

const BANDS: readonly Band[] = [
  band(16, 120, 15, 70, 0.4, 'oklch(0.84 0.14 155 / 0.26)', 140, false),
  band(14, 640, 17, 85, 2.1, 'oklch(0.78 0.11 265 / 0.22)', 180, true),
];

/**
 * "Waves" background: two radial glows (green top-right, violet bottom-left) and two bands of
 * flowing lines drifting in opposite directions (140 s / 180 s). The SVG is 200% wide and moves
 * −50% for a seamless loop. Decorative, `pointer-events: none`.
 */
@Component({
  selector: 'app-waves-background',
  host: { 'aria-hidden': 'true' },
  template: `
    @for (b of bands; track $index) {
      <svg
        viewBox="0 0 2000 1000"
        preserveAspectRatio="none"
        [style.animation-duration.s]="b.duration"
        [style.animation-direction]="b.reverse ? 'reverse' : 'normal'"
      >
        @for (p of b.paths; track $index) {
          <path [attr.d]="p.d" fill="none" [attr.stroke]="b.color" stroke-width="1.2" vector-effect="non-scaling-stroke" [attr.opacity]="p.opacity" />
        }
      </svg>
    }
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      pointer-events: none;
      background:
        radial-gradient(1000px 640px at 95% -5%, oklch(0.42 0.09 160 / 0.2), transparent 62%),
        radial-gradient(900px 640px at 0% 105%, oklch(0.38 0.07 265 / 0.17), transparent 62%);
    }
    :host(.fixed) {
      position: fixed;
    }
    svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 200%;
      height: 100%;
      animation-name: waveX;
      animation-timing-function: linear;
      animation-iteration-count: infinite;
    }
    @keyframes waveX {
      to {
        transform: translateX(-50%);
      }
    }
  `,
})
export class WavesBackground {
  protected readonly bands = BANDS;
}
