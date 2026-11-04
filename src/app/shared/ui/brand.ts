import { booleanAttribute, Component, computed, input, signal } from '@angular/core';

/** "ani" 600 · "." mint · "stream" 300 grey. */
@Component({
  selector: 'app-logo',
  host: { '[style.font-size.px]': 'size()', '[class.big]': 'size() > 24' },
  template: `ani<span class="dot">.</span><span class="rest">stream</span>`,
  styles: `
    :host {
      display: inline-flex;
      align-items: baseline;
      gap: 2px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--text);
    }
    :host(.big) {
      letter-spacing: -0.03em;
    }
    .dot {
      color: var(--accent-logo);
    }
    .rest {
      font-weight: 300;
      color: var(--text-4);
    }
    :host(.big) .rest {
      color: var(--text-3);
    }
  `,
})
export class Logo {
  readonly size = input(20);
}

/** Official four-colour Google "G". */
@Component({
  selector: 'app-google-g',
  host: { 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
  `,
})
export class GoogleG {
  readonly size = input(18);
}

/** Initials from a display name or email: "Ivan Ivamar" → "II", "ivanivamar@…" → "IV". */
export function initials(name: string | null | undefined): string {
  const clean = (name ?? '').replace(/@.*/, '').trim();
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || '?';
}

/**
 * Avatar: green-grey gradient disc with mint initials (or the Google photo), optional white
 * Google badge bottom-right (welcome, settings).
 */
@Component({
  selector: 'app-avatar',
  imports: [GoogleG],
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    <div class="disc" [style.font-size.px]="fontSize()">
      @if (photo() && !failed()) {
        <img [src]="photo()" alt="" referrerpolicy="no-referrer" (error)="failed.set(true)" />
      } @else {
        {{ letters() }}
      }
    </div>
    @if (badge()) {
      <div class="badge" [style.width.px]="badgeSize()" [style.height.px]="badgeSize()">
        <app-google-g [size]="12" />
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      flex: none;
    }
    .disc {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: linear-gradient(150deg, #2f4a3c, #1b1e1c);
      border: 1px solid var(--line-strong);
      display: flex;
      align-items: center;
      justify-content: center;
      color: oklch(0.86 0.11 155);
      font-weight: 600;
      letter-spacing: 0.02em;
      overflow: hidden;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .badge {
      position: absolute;
      right: -2px;
      bottom: -2px;
      border-radius: 50%;
      background: #fff;
      border: 2px solid var(--surface);
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `,
})
export class Avatar {
  readonly name = input<string | null | undefined>('');
  readonly photo = input<string | null | undefined>(null);
  readonly size = input(34);
  readonly badge = input(false, { transform: booleanAttribute });

  protected readonly failed = signal(false);
  protected readonly letters = computed(() => initials(this.name()));
  protected readonly fontSize = computed(() => Math.round(this.size() * 0.32));
  protected readonly badgeSize = computed(() => (this.size() >= 60 ? 26 : 21));
}
