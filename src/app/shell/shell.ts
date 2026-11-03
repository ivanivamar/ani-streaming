import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionStore } from '@identity/application';

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
      <span class="spacer"></span>
      @if (session.account(); as account) {
        <span class="account">{{ account.email }}</span>
      }
      <button type="button" class="link" (click)="signOut()">Sign out</button>
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
    .spacer {
      flex: 1;
    }
    .account {
      opacity: 0.6;
    }
    .link {
      font: inherit;
      color: inherit;
      background: none;
      border: 0;
      padding: 0;
      cursor: pointer;
      opacity: 0.6;
    }
  `,
})
export class Shell {
  protected readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  protected signOut(): void {
    this.session.signOut();
    void this.router.navigateByUrl('/auth');
  }

  protected readonly links = [
    { path: '/', label: 'Home' },
    { path: '/search', label: 'Search' },
    { path: '/library', label: 'Library' },
    { path: '/releases', label: 'New releases' },
    { path: '/settings', label: 'Settings' },
  ] as const;
}
