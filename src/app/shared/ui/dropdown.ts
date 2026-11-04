import { Component, computed, DestroyRef, ElementRef, inject, input, model, signal, viewChild } from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import { Icon, type IconName } from './icon';

export interface DropdownOption<T> {
  readonly value: T;
  readonly label: string;
  readonly sub?: string;
  /** status colour dot */
  readonly dot?: string;
  /** small poster image (or CSS gradient) */
  readonly poster?: string;
}

/**
 * Dropdown: 38px trigger, radius 9, `#1a1b1f`, chevron rotates and the border goes mint while
 * open. Menu is fixed-position (`#1c1d21`, radius 13, max 340px), flips above the trigger when
 * there's no room, closes on outside click, Esc and scroll.
 */
@Component({
  selector: 'app-dropdown',
  imports: [Icon],
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <button
      #trigger
      type="button"
      class="trigger"
      [class.open]="open()"
      [style.min-width.px]="minWidth()"
      [attr.aria-expanded]="open()"
      aria-haspopup="listbox"
      [attr.aria-label]="ariaLabel() || null"
      (click)="toggle()"
    >
      @if (icon(); as i) {
        <app-icon [name]="i" [size]="14" [stroke]="2" class="lead" />
      }
      @if (current()?.dot; as d) {
        <span class="dot" [style.background]="d"></span>
      }
      <span class="label" [class.placeholder]="!current()">{{ current()?.label ?? placeholder() }}</span>
      <app-icon name="chevron-down" [size]="12" [stroke]="2.2" class="chev" />
    </button>

    @if (pos(); as p) {
      <div class="scrim" (click)="close()" (contextmenu)="close()" aria-hidden="true"></div>
      <div class="menu" role="listbox" [style.left.px]="p.x" [style.top.px]="p.y" [style.width.px]="p.w">
        @if (title()) {
          <div class="eyebrow title">{{ title() }}</div>
        }
        @for (o of options(); track o.value) {
          <button
            type="button"
            role="option"
            [attr.aria-selected]="o.value === value()"
            [class.sel]="o.value === value()"
            (click)="pick(o.value)"
          >
            @if (o.dot) {
              <span class="odot" [style.background]="o.dot" [style.box-shadow]="'0 0 0 3px ' + ring(o.dot)"></span>
            }
            @if (o.poster) {
              <span class="poster" [style.background]="bg(o.poster)"></span>
            }
            <span class="text">
              <span class="ol">{{ o.label }}</span>
              @if (o.sub) {
                <span class="os">{{ o.sub }}</span>
              }
            </span>
            @if (o.value === value()) {
              <app-icon name="check" [size]="15" [stroke]="2.6" class="check" />
            }
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .trigger {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      height: 38px;
      padding: 0 11px 0 12px;
      border-radius: 9px;
      border: 1px solid var(--line-4);
      background: var(--surface-2);
      color: #e4e4e8;
      font-size: 13px;
      font-weight: 500;
      text-align: left;
    }
    .trigger:hover {
      background: var(--surface-hover-2);
    }
    .trigger.open {
      border-color: oklch(0.84 0.14 155 / 0.6);
    }
    .lead,
    .chev {
      color: var(--text-4);
    }
    .chev {
      transition: transform 0.15s;
    }
    .open .chev {
      transform: rotate(180deg);
    }
    .label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .placeholder {
      color: var(--text-4);
    }
    .scrim {
      position: fixed;
      inset: 0;
      z-index: 72;
    }
    .menu {
      position: fixed;
      z-index: 73;
      max-height: 340px;
      overflow-y: auto;
      padding: 6px;
      background: var(--menu-bg);
      border: 1px solid var(--line-4);
      border-radius: 13px;
      box-shadow: var(--shadow-menu);
      animation: pop 0.12s ease-out;
    }
    .title {
      padding: 8px 10px 6px;
      color: var(--text-6);
    }
    .menu button {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 9px 10px;
      border: none;
      border-radius: 9px;
      background: transparent;
      color: #e4e4e8;
      font-size: 13.5px;
      text-align: left;
    }
    .menu button.sel {
      background: var(--menu-selected);
    }
    .menu button:hover {
      background: var(--menu-hover);
    }
    .odot {
      width: 9px;
      height: 9px;
      flex: none;
      border-radius: 50%;
    }
    .poster {
      width: 28px;
      height: 40px;
      flex: none;
      border-radius: 5px;
      background-size: cover !important;
      border: 1px solid var(--line-4);
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .ol {
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .os {
      font-size: 11.5px;
      color: var(--text-5);
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .check {
      color: var(--accent);
    }
  `,
})
export class Dropdown<T> implements FormValueControl<T> {
  readonly value = model.required<T>();
  readonly options = input.required<readonly DropdownOption<T>[]>();
  readonly placeholder = input('Select…');
  readonly title = input('');
  readonly icon = input<IconName | null>(null);
  readonly minWidth = input(0);
  /** menu width when wider than the trigger */
  readonly menuWidth = input(210);
  readonly ariaLabel = input('');

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  protected readonly pos = signal<{ x: number; y: number; w: number } | null>(null);
  protected readonly open = computed(() => this.pos() !== null);
  protected readonly current = computed(() => this.options().find((o) => o.value === this.value()));

  private readonly onScroll = (e: Event) => {
    // scrolling inside the menu itself is fine
    if (e.target instanceof Element && e.target.closest('.menu')) return;
    this.close();
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.unlisten());
  }

  protected toggle(): void {
    if (this.open()) return this.close();
    const r = this.trigger().nativeElement.getBoundingClientRect();
    const w = Math.max(r.width, this.menuWidth());
    const rowH = this.options().some((o) => o.sub) ? 52 : 38;
    const estH = Math.min(340, this.options().length * rowH + (this.title() ? 32 : 0) + 14);
    let y = r.bottom + 6;
    if (y + estH > window.innerHeight - 8) y = Math.max(8, r.top - 6 - estH);
    const x = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    this.pos.set({ x, y, w });
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
  }

  close(): void {
    if (!this.pos()) return;
    this.pos.set(null);
    this.unlisten();
  }

  protected pick(v: T): void {
    this.value.set(v);
    this.close();
  }

  protected bg(poster: string): string {
    return poster.includes('gradient(') ? poster : `center / cover url("${poster}")`;
  }

  protected ring(dot: string): string {
    return dot.startsWith('oklch(') ? dot.replace(')', ' / 0.2)') : 'rgba(255,255,255,0.12)';
  }

  private unlisten(): void {
    window.removeEventListener('scroll', this.onScroll, { capture: true });
  }
}
