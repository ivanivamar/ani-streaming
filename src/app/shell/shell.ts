import { afterNextRender, Component, DestroyRef, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionStore } from '@identity/application';
import { Avatar, ContextMenuHost, Icon, Logo, Motion, Viewport, type IconName } from '@shared/ui';
import { filter } from 'rxjs';
import { HeaderSearch } from './header-search';
import { WavesBackground } from './waves-background';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly short: string;
  readonly icon: IconName;
}

/** Downloads (Android only, Step 8) and Import (dropped) aren't on the web nav. */
const NAV: readonly NavItem[] = [
  { path: '/', label: 'Home', short: 'Home', icon: 'home' },
  { path: '/library', label: 'Library', short: 'Library', icon: 'library' },
  { path: '/releases', label: 'New releases', short: 'Releases', icon: 'releases' },
];

const RAIL_KEY = 'ani.railed';

const readRailed = (): boolean => {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * App shell (v3). Desktop ≥ 760px: collapsible inset sidebar (236px / 72px railed, remembered)
 * and an inset content panel with its own scroll and the Waves background. Mobile: no sidebar
 * or panel, the page scrolls, fixed 4-column bottom nav (Home, Library, Releases, Profile).
 * Header search on every page. Page motion runs on each navigation (shared/ui `Motion`).
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Logo, Avatar, HeaderSearch, WavesBackground, ContextMenuHost],
  host: { '[class.mobile]': 'vp.mobile()', '[class.railed]': 'railed()', '(document:keydown.escape)': 'profileOpen.set(false)' },
  template: `
    @if (vp.mobile()) {
      <app-waves-background class="fixed" />
    }
    <div class="chrome" #chrome>
      @if (!vp.mobile()) {
        <aside>
          <div class="side-head">
            @if (!railed()) {
              <a routerLink="/" class="logo-link" aria-label="ani.stream home"><app-logo /></a>
            }
            <button type="button" class="rail-btn" [title]="railed() ? 'Expand sidebar' : 'Collapse sidebar'" (click)="toggleRail()">
              <app-icon name="panel" [size]="18" />
            </button>
          </div>
          <nav aria-label="Main">
            @for (n of nav; track n.path) {
              <a
                class="nav-item"
                [routerLink]="n.path"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: n.path === '/' }"
                [title]="n.label"
              >
                <app-icon [name]="n.icon" [size]="18" class="nav-icon" />
                @if (!railed()) {
                  <span>{{ n.label }}</span>
                }
              </a>
            }
          </nav>
          <div class="grow"></div>
          <button type="button" class="account" title="Account" [attr.aria-expanded]="profileOpen()" (click)="toggleProfile()">
            <app-avatar [name]="account()?.name || account()?.email" [photo]="account()?.photo" [size]="34" />
            @if (!railed()) {
              <span class="who">
                <span class="name">{{ shortName() }}</span>
                <span class="email">{{ account()?.email }}</span>
              </span>
              <app-icon name="updown" [size]="18" class="updown" />
            }
          </button>
        </aside>
      }

      <div class="panel">
        @if (!vp.mobile()) {
          <app-waves-background />
        }
        <div class="scroll" #scroll>
          <header>
            @if (vp.mobile()) {
              <a routerLink="/" class="logo-link" aria-label="ani.stream home"><app-logo /></a>
            }
            <app-header-search />
          </header>
          <main #main>
            <router-outlet />
          </main>
        </div>
      </div>
    </div>

    @if (vp.mobile()) {
      <nav class="bottom" aria-label="Main">
        @for (n of nav; track n.path) {
          <a [routerLink]="n.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: n.path === '/' }">
            <app-icon [name]="n.icon" [size]="20" class="nav-icon" />{{ n.short }}
          </a>
        }
        <button type="button" [class.active]="profileOpen()" [attr.aria-expanded]="profileOpen()" (click)="toggleProfile()">
          <app-avatar [name]="account()?.name || account()?.email" [photo]="account()?.photo" [size]="22" />Profile
        </button>
      </nav>
    }

    @if (profileOpen()) {
      <div class="scrim" (click)="profileOpen.set(false)" aria-hidden="true"></div>
      <div class="profile" role="menu" aria-label="Account">
        <div class="p-head">
          <app-avatar [name]="account()?.name || account()?.email" [photo]="account()?.photo" [size]="44" />
          <div class="who">
            <span class="name">{{ shortName() }}</span>
            <span class="email">{{ account()?.email }}</span>
          </div>
        </div>
        <div class="p-div"></div>
        <a routerLink="/settings" role="menuitem" class="p-item" (click)="profileOpen.set(false)">
          <app-icon name="settings" [size]="17" class="p-icon" />Settings
        </a>
        <button type="button" role="menuitem" class="p-item logout" (click)="signOut()">
          <app-icon name="logout" [size]="17" />Log out
        </button>
      </div>
    }

    <app-context-menu-host />
  `,
  styleUrl: './shell.css',
})
export class Shell {
  protected readonly session = inject(SessionStore);
  protected readonly vp = inject(Viewport);
  private readonly router = inject(Router);
  private readonly motion = inject(Motion);
  private readonly injector = inject(Injector);

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly scroll = viewChild.required<ElementRef<HTMLElement>>('scroll');
  private readonly chrome = viewChild.required<ElementRef<HTMLElement>>('chrome');

  protected readonly nav = NAV;
  protected readonly railed = signal(readRailed());
  protected readonly profileOpen = signal(false);
  protected readonly account = this.session.account;

  constructor() {
    const sub = this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.onNavigated());
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
    // first render (also the auth → app entrance)
    afterNextRender(() => {
      this.motion.shellEnter(this.chrome().nativeElement);
      this.animatePage();
    });
  }

  protected shortName(): string {
    const a = this.account();
    return a?.email?.split('@')[0] || a?.name || '';
  }

  protected toggleRail(): void {
    const v = !this.railed();
    this.railed.set(v);
    try {
      localStorage.setItem(RAIL_KEY, v ? '1' : '0');
    } catch {
      /* private mode: not remembered */
    }
  }

  protected toggleProfile(): void {
    this.profileOpen.update((v) => !v);
  }

  protected signOut(): void {
    this.profileOpen.set(false);
    this.session.signOut();
    void this.router.navigateByUrl('/auth');
  }

  private onNavigated(): void {
    this.profileOpen.set(false);
    // same page with new query params (search typing) only moves the results
    afterNextRender(
      () => {
        this.animatePage();
      },
      { injector: this.injector },
    );
  }

  private lastPath: string | null = null;

  /** Enter animation + scroll to top when the path changes (not for query-param-only changes). */
  private animatePage(): void {
    const path = this.router.url.split(/[?#]/)[0];
    const page = this.main().nativeElement.querySelector(':scope > :not(router-outlet)');
    if (!(page instanceof HTMLElement) || path === this.lastPath) return;
    this.lastPath = path;
    if (!this.vp.mobile()) this.scroll().nativeElement.scrollTop = 0;
    this.motion.pageEnter(page);
  }
}
