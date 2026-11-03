import { Component, computed, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { safeNext, SessionStore } from '@identity/application';

/**
 * Sign in (functional version; the v3 design lands in Step 4). Google only. Also explains the
 * states a guard sends people here for: expired, not on the allowlist, connection errors.
 */
@Component({
  selector: 'app-sign-in-page',
  template: `
    <section class="auth">
      <h1>Sign in</h1>

      @switch (view()) {
        @case ('busy') {
          <p class="muted">{{ session.pending() ? 'Waiting for Google…' : 'Connecting to your library…' }}</p>
        }
        @case ('no-access') {
          <p>
            <strong>{{ session.account()?.email }}</strong> isn't on this library's access list yet.
          </p>
          <p class="muted">Add this account's id, then try again:</p>
          <code class="uid">{{ session.uid() }}</code>
          <p class="muted small">
            On the PC: <code>npm run allow -w &#64;ani/import -- {{ session.uid() }}</code>
          </p>
          <div class="row">
            <button type="button" (click)="retry()">Try again</button>
            <button type="button" class="ghost" (click)="signIn(true)">Use another account</button>
          </div>
        }
        @case ('error') {
          <p class="error" role="alert">{{ session.error() }}</p>
          <div class="row">
            <button type="button" (click)="retry()">Try again</button>
            <button type="button" class="ghost" (click)="signOut()">Sign out</button>
          </div>
        }
        @default {
          @if (session.status() === 'expired' && session.account(); as account) {
            <p class="muted">Your Google session ended. Sign in again as {{ account.email }}.</p>
          } @else {
            <p class="muted">Sign in with the Google account that holds the AniStream folder on Drive.</p>
          }
          <button type="button" class="google" (click)="signIn()">Continue with Google</button>
          @if (session.status() === 'expired') {
            <button type="button" class="ghost" (click)="signIn(true)">Use another account</button>
          }
          @if (session.error(); as error) {
            <p class="error" role="alert">{{ error }}</p>
          }
        }
      }
    </section>
  `,
  styles: `
    .auth {
      max-width: 420px;
      margin: 12vh auto 0;
      padding: 0 16px;
      display: grid;
      gap: 12px;
      justify-items: start;
    }
    h1 {
      margin: 0 0 8px;
      font-weight: 600;
    }
    p {
      margin: 0;
    }
    .muted {
      opacity: 0.65;
    }
    .small {
      font-size: 0.85em;
    }
    .error {
      color: #ff8a80;
    }
    .uid {
      font-family: 'JetBrains Mono', monospace;
      padding: 6px 10px;
      border-radius: 8px;
      background: rgb(255 255 255 / 0.08);
      user-select: all;
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button {
      font: inherit;
      padding: 10px 18px;
      border-radius: 999px;
      border: 0;
      cursor: pointer;
      background: #52e6a0;
      color: #0b0b0c;
      font-weight: 600;
    }
    button.ghost {
      background: transparent;
      color: inherit;
      border: 1px solid rgb(255 255 255 / 0.2);
    }
  `,
})
export class SignInPage {
  protected readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  /** `?next=` from the guard (route input binding). */
  readonly next = input<string | undefined>();

  protected readonly view = computed(() => {
    if (this.session.pending() || this.session.phase() === 'connecting') return 'busy';
    if (this.session.status() !== 'signed-in') return 'sign-in';
    const phase = this.session.phase();
    return phase === 'no-access' || phase === 'error' ? phase : 'busy';
  });

  constructor() {
    this.session.preload();
    // Opened while already signed in (bookmark, guard after an error): settle the connection.
    if (this.session.status() === 'signed-in') void this.session.connect();
    effect(() => {
      if (this.session.ready()) void this.router.navigateByUrl(safeNext(this.next()), { replaceUrl: true });
    });
  }

  protected signIn(switchAccount = false): void {
    void this.session.signIn({ switchAccount });
  }

  protected retry(): void {
    void this.session.retry();
  }

  protected signOut(): void {
    this.session.signOut();
  }
}
