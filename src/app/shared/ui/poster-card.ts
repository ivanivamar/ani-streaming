import { booleanAttribute, Component, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icon';
import { Motion } from './motion';
import { Poster, posterGradient } from './poster';

/**
 * Poster card (Home, Search, Library grids and the Continue-watching carousel): 2:3 artwork
 * (radius 16, hairline, shadow, light/dark overlay), opaque chips projected into the corners,
 * optional ⋯ menu button and 3px progress bar, then title + meta. Hover lifts 4px; right-click
 * emits `menu`.
 *
 * Slots: `[cardTopLeft]`, `[cardTopRight]` (replaces ⋯), `[cardBottom]`.
 */
@Component({
  selector: 'app-poster-card',
  imports: [RouterLink, Icon, Poster],
  template: `
    <a
      class="pc"
      [routerLink]="link()"
      [queryParams]="queryParams()"
      (click)="onClick()"
      (contextmenu)="hasMenu() && menu.emit($event)"
    >
      <div class="art" #art>
        <app-poster [src]="src()" [seed]="seed()" [priority]="priority()" />
        <div class="shade"></div>
        <div class="tl"><ng-content select="[cardTopLeft]" /></div>
        <div class="tr">
          <ng-content select="[cardTopRight]" />
          @if (hasMenu()) {
            <button type="button" class="more" title="More" aria-label="More actions" (click)="more($event)">
              <app-icon name="more" [size]="16" />
            </button>
          }
        </div>
        <div class="bl"><ng-content select="[cardBottom]" /></div>
        @if (progress() !== null) {
          <div class="prog"><i [style.width.%]="progress()! * 100" [style.background]="progressColor()"></i></div>
        }
      </div>
      <div class="text">
        <div class="title">{{ title() }}</div>
        @if (meta()) {
          <div class="meta">{{ meta() }}</div>
        }
      </div>
    </a>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .pc {
      display: flex;
      flex-direction: column;
      gap: 12px;
      color: var(--text);
      transition: transform 0.18s ease;
    }
    .pc:hover {
      color: var(--text);
      transform: translateY(-4px);
    }
    .art {
      position: relative;
      aspect-ratio: 2 / 3;
      border-radius: 16px;
      border: 1px solid var(--line-4);
      overflow: hidden;
      box-shadow:
        var(--shadow-poster),
        0 0 0 1px rgba(0, 0, 0, 0.2);
    }
    .shade {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(120% 70% at 20% 0%, rgba(255, 255, 255, 0.16), transparent 55%),
        linear-gradient(180deg, transparent 55%, rgba(0, 0, 0, 0.55));
    }
    .tl {
      position: absolute;
      top: 10px;
      left: 10px;
      display: flex;
      gap: 6px;
    }
    .tr {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      gap: 6px;
    }
    .bl {
      position: absolute;
      left: 10px;
      bottom: 12px;
      display: flex;
      gap: 6px;
    }
    .more {
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: var(--chip-dark);
      color: #fff;
    }
    .more:hover {
      background: var(--menu-selected);
    }
    .prog {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 3px;
      background: rgba(0, 0, 0, 0.45);
    }
    .prog i {
      display: block;
      height: 100%;
    }
    .title {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.35;
      letter-spacing: -0.01em;
      text-wrap: pretty;
    }
    .meta {
      font-size: 12px;
      color: var(--text-5);
      margin-top: 3px;
    }
  `,
})
export class PosterCard {
  private readonly motion = inject(Motion);

  readonly title = input.required<string>();
  readonly meta = input('');
  readonly src = input<string | null | undefined>(null);
  /** placeholder hue seed (series id) */
  readonly seed = input.required<string>();
  readonly link = input.required<string | readonly unknown[]>();
  readonly queryParams = input<Record<string, string> | null>(null);
  /** 0–1, or null for no bar */
  readonly progress = input<number | null>(null);
  readonly progressColor = input('var(--accent)');
  readonly hasMenu = input(false, { transform: booleanAttribute });
  /** the link opens the player: grow the poster into it (Motion "open player") */
  readonly launch = input(false, { transform: booleanAttribute });
  readonly priority = input(false, { transform: booleanAttribute });

  readonly menu = output<MouseEvent>();

  private readonly art = viewChild.required<ElementRef<HTMLElement>>('art');

  protected onClick(): void {
    if (this.launch()) this.motion.rememberLaunch(this.art().nativeElement, posterGradient(this.seed()));
  }

  protected more(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.menu.emit(e);
  }
}
