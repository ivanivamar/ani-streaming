import { Component, inject, Service, signal } from '@angular/core';
import { Icon, type IconName } from './icon';

export interface MenuItem {
  readonly label: string;
  readonly icon: IconName;
  readonly run: () => void;
  readonly danger?: boolean;
  /** hairline above this item */
  readonly separator?: boolean;
}

interface OpenMenu {
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly items: readonly MenuItem[];
}

/**
 * Context menu state. Right-click (or the ⋯ button) on any poster/row calls `open()`; the
 * shell renders one `<app-context-menu-host>`. Opens at the cursor, clamped to the viewport.
 */
@Service()
export class ContextMenu {
  private readonly _menu = signal<OpenMenu | null>(null);
  readonly menu = this._menu.asReadonly();

  open(e: MouseEvent, title: string, items: readonly MenuItem[]): void {
    e.preventDefault();
    e.stopPropagation();
    // ⋯ buttons are clicked, not right-clicked: anchor under the button instead of (0, 0) keyboard clicks
    let { clientX: x, clientY: y } = e;
    if (!x && !y && e.currentTarget instanceof Element) {
      const r = e.currentTarget.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 4;
    }
    const seps = items.filter((i) => i.separator).length;
    this._menu.set({
      x: Math.max(8, Math.min(x, window.innerWidth - 230)),
      y: Math.max(8, Math.min(y, window.innerHeight - (items.length * 36 + seps * 11 + 56))),
      title,
      items,
    });
  }

  close(): void {
    this._menu.set(null);
  }
}

@Component({
  selector: 'app-context-menu-host',
  imports: [Icon],
  host: { '(document:keydown.escape)': 'menus.close()', '(window:resize)': 'menus.close()' },
  template: `
    @if (menus.menu(); as m) {
      <div class="scrim" (click)="menus.close()" (contextmenu)="$event.preventDefault(); menus.close()" aria-hidden="true"></div>
      <div class="menu" role="menu" [attr.aria-label]="m.title" [style.left.px]="m.x" [style.top.px]="m.y">
        <div class="title">{{ m.title }}</div>
        @for (item of m.items; track item.label) {
          @if (item.separator) {
            <div class="sep" role="separator"></div>
          }
          <button type="button" role="menuitem" [class.danger]="item.danger" (click)="run(item)">
            <app-icon [name]="item.icon" [size]="16" />{{ item.label }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    .scrim {
      position: fixed;
      inset: 0;
      z-index: 70;
    }
    .menu {
      position: fixed;
      z-index: 71;
      width: 220px;
      padding: 6px;
      background: var(--menu-bg);
      border: 1px solid var(--line-4);
      border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.55);
      animation: pop 0.12s ease-out;
    }
    .title {
      padding: 7px 10px 8px;
      font-size: 11.5px;
      color: var(--text-5);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sep {
      height: 1px;
      background: var(--line-3);
      margin: 5px 4px;
    }
    button {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #e4e4e8;
      font-size: 13px;
      text-align: left;
    }
    button:hover {
      background: rgba(255, 255, 255, 0.07);
    }
    button.danger {
      color: var(--danger);
    }
    button.danger:hover {
      background: rgba(255, 90, 90, 0.1);
    }
  `,
})
export class ContextMenuHost {
  protected readonly menus = inject(ContextMenu);

  protected run(item: MenuItem): void {
    this.menus.close();
    item.run();
  }
}
