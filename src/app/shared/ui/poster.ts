import { NgOptimizedImage } from '@angular/common';
import { booleanAttribute, Component, computed, input, signal } from '@angular/core';

/** Stable hue 0–359 from any string (series id). */
export function hueOf(seed: string): number {
  // FNV-1a, so near-identical seeds ("al1", "al2") still land far apart
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return (h >>> 0) % 360;
}

/** v3 poster placeholder gradient (stands in for a missing AniList cover). */
export function posterGradient(seed: string): string {
  const hu = hueOf(seed);
  return `linear-gradient(160deg, oklch(0.56 0.11 ${hu}), oklch(0.32 0.07 ${hu + 25}) 60%, oklch(0.2 0.04 ${hu + 40}))`;
}

/** v3 episode-thumb placeholder: per-episode angle/lightness around the series hue. */
export function thumbGradient(seed: string, n: number): string {
  const hu = hueOf(seed) + ((n * 37) % 50) - 25;
  const ang = 110 + ((n * 53) % 140);
  const lit = 0.42 + ((n * 13) % 7) * 0.025;
  return `linear-gradient(${ang}deg, oklch(${lit} 0.1 ${hu}), oklch(0.24 0.05 ${hu + 30}) 75%)`;
}

/** CSS `background` for a poster: the cover image, or the gradient while it's missing. */
export function posterBackground(src: string | null | undefined, seed: string): string {
  return src ? `center / cover no-repeat url("${src}"), ${posterGradient(seed)}` : posterGradient(seed);
}

/**
 * Poster artwork filling its (positioned) parent: AniList cover through `NgOptimizedImage`,
 * gradient placeholder underneath (visible while loading and when there's no cover).
 */
@Component({
  selector: 'app-poster',
  imports: [NgOptimizedImage],
  host: { '[style.background]': 'gradient()' },
  template: `
    @if (src() && !failed()) {
      <img
        [ngSrc]="src()!"
        fill
        [priority]="priority()"
        alt=""
        (error)="failed.set(true)"
      />
    }
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      display: block;
      overflow: hidden;
    }
    img {
      object-fit: cover;
    }
  `,
})
export class Poster {
  readonly src = input<string | null | undefined>(null);
  readonly seed = input.required<string>();
  readonly priority = input(false, { transform: booleanAttribute });

  protected readonly failed = signal(false);
  protected readonly gradient = computed(() => posterGradient(this.seed()));
}
