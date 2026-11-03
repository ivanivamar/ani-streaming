import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/**
 * App shell: inset sidebar / bottom nav, Waves background, header search, page motion
 * (Step 4). For now a minimal nav so every lazy context route is reachable.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="nav" aria-label="Main">
      @for (link of links; track link.path) {
        <a
          [routerLink]="link.path"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: link.path === '/' }"
          >{{ link.label }}</a
        >
      }
    </nav>
    <main>
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
    }
    .nav {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      padding: 16px 32px;
    }
    a {
      color: inherit;
      opacity: 0.6;
      text-decoration: none;
    }
    a.active {
      opacity: 1;
    }
  `,
})
export class Shell {
  protected readonly links = [
    { path: '/', label: 'Home' },
    { path: '/search', label: 'Search' },
    { path: '/library', label: 'Library' },
    { path: '/releases', label: 'New releases' },
    { path: '/settings', label: 'Settings' },
  ] as const;
}
