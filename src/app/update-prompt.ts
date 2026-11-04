import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { AppUpdate } from '@shared/infrastructure';
import { Icon, Viewport } from '@shared/ui';
import { filter, map } from 'rxjs';

/**
 * "New version · Reload" toast (PLAN.md Step 7), shown on every page once a new deploy is
 * installed and waiting. Hidden in the player so it never covers the video; it shows again
 * after leaving it. Reload activates the new build; × hides it until the next deploy.
 */
@Component({
  selector: 'app-update-prompt',
  imports: [Icon],
  host: { '[class.mobile]': 'viewport.mobile()' },
  template: `
    @if (visible()) {
      <div class="update" role="status" aria-live="polite">
        <app-icon name="refresh" [size]="16" class="update-icon" />
        <span class="update-text">New version</span>
        <button type="button" class="btn btn-primary btn-sm" (click)="updates.reload()">Reload</button>
        <button type="button" class="update-close" aria-label="Not now" (click)="updates.dismiss()">
          <app-icon name="close" [size]="14" />
        </button>
      </div>
    }
  `,
  styles: `
    .update {
      position: fixed;
      left: 50%;
      bottom: 24px;
      z-index: 300;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 8px 8px 14px;
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      background: var(--menu-bg);
      box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
      color: var(--text);
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      animation: update-in 0.32s var(--ease) both;
    }
    /* above the bottom nav */
    :host(.mobile) .update {
      bottom: calc(80px + env(safe-area-inset-bottom));
    }
    .update-icon {
      color: var(--accent);
    }
    .update-close {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--text-4);
      cursor: pointer;
    }
    .update-close:hover {
      background: var(--menu-hover);
      color: var(--text);
    }
    @keyframes update-in {
      from {
        opacity: 0;
        transform: translate(-50%, 12px);
      }
    }
  `,
})
export class UpdatePrompt {
  protected readonly updates = inject(AppUpdate);
  protected readonly viewport = inject(Viewport);
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly visible = computed(() => this.updates.available() && !this.url().startsWith('/watch'));

  constructor() {
    void this.updates.start();
  }
}
