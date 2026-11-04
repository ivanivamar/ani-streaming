import { Component, computed, inject } from '@angular/core';
import { Logo, posterGradient, Viewport } from '@shared/ui';

/** Seeds for the placeholder tiles (the catalogue isn't readable before sign-in). */
const SEEDS = ['aot', 'fma', 'mob', 'csm', 'vin', 'spy', 'fri', 'ode', 'brl', 'dun', 'aoashi', 'haikyu', 'mushi', 'nana', 'yuru', 'kaguya'];

/**
 * Sign-in / Welcome layout (v3): left a drifting poster mosaic (5 columns, 4 on mobile, rotated
 * −6°, alternate columns scrolling up/down) with the big logo; right a 360px column.
 */
@Component({
  selector: 'app-auth-layout',
  imports: [Logo],
  template: `
    <div class="art" aria-hidden="true">
      <div class="mosaic">
        @for (col of columns(); track $index; let c = $index) {
          <div class="col" [class.down]="c % 2 === 1" [style.animation-duration.s]="70 + c * 9">
            @for (bg of col; track $index) {
              <div class="tile" [style.background]="bg"><div class="dots"></div></div>
            }
          </div>
        }
      </div>
      <div class="shade"></div>
      <div class="brand">
        <app-logo [size]="vp.mobile() ? 28 : 40" />
        <p>Stream and track your own anime library, from your Google Drive.</p>
      </div>
    </div>
    <div class="side">
      <div class="col-content"><ng-content /></div>
    </div>
  `,
  styles: `
    :host {
      position: relative;
      z-index: 1;
      min-height: 100vh;
      display: flex;
      flex-wrap: wrap;
      background: var(--app-bg);
    }
    .art {
      position: sticky;
      top: 0;
      align-self: flex-start;
      flex: 1 1 480px;
      height: 100vh;
      overflow: hidden;
    }
    .mosaic {
      position: absolute;
      inset: -10%;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 14px;
      transform: rotate(-6deg) scale(1.12);
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 14px;
      animation: colUp 70s linear infinite;
    }
    .col.down {
      animation-name: colDown;
    }
    @keyframes colUp {
      to {
        transform: translateY(-50%);
      }
    }
    @keyframes colDown {
      from {
        transform: translateY(-50%);
      }
      to {
        transform: none;
      }
    }
    .tile {
      position: relative;
      aspect-ratio: 2 / 3;
      flex: none;
      border-radius: 12px;
      border: 1px solid var(--line-3);
      overflow: hidden;
    }
    .dots {
      position: absolute;
      inset: 0;
      background-image: radial-gradient(rgba(255, 255, 255, 0.14) 1px, transparent 1.5px);
      background-size: 7px 7px;
      mask-image: linear-gradient(160deg, #000, transparent 60%);
    }
    .shade {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(10, 11, 13, 0.2), rgba(10, 11, 13, 0.55) 70%, #0a0b0d),
        linear-gradient(0deg, #0a0b0d 0%, #0a0b0d 24%, rgba(10, 11, 13, 0) 58%);
    }
    .brand {
      position: absolute;
      left: clamp(24px, 4vw, 56px);
      right: 24px;
      bottom: clamp(24px, 4vw, 52px);
    }
    .brand p {
      margin: 10px 0 0;
      max-width: 38ch;
      font-size: 14.5px;
      line-height: 1.6;
      color: var(--completed);
      text-wrap: pretty;
    }
    .side {
      flex: 1 1 420px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: clamp(32px, 6vw, 72px) clamp(20px, 5vw, 64px);
    }
    .col-content {
      width: 100%;
      max-width: 360px;
      animation: fade 0.25s ease-out;
    }
    @media (max-width: 759px) {
      .art {
        position: relative;
        height: 300px;
      }
      .mosaic {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
  `,
})
export class AuthLayout {
  protected readonly vp = inject(Viewport);

  protected readonly columns = computed(() => {
    const cols = this.vp.mobile() ? 4 : 5;
    return Array.from({ length: cols }, (_, c) => {
      const list = [...SEEDS.slice(c * 3), ...SEEDS.slice(0, c * 3)].slice(0, 7).map(posterGradient);
      // doubled for a seamless −50% loop
      return [...list, ...list];
    });
  });
}
