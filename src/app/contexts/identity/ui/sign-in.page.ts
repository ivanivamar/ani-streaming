import { Component, computed, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { PrefsStore, safeNext, SessionStore } from '@identity/application';
import { GoogleG } from '@shared/ui';
import { AuthLayout } from './auth-layout';

/**
 * Sign in (v3): one white "Continue with Google" button. Also explains the states a guard sends
 * people here for: expired, not on the allowlist, connection errors. A first sign-in (no
 * `users/{uid}` doc yet) continues to Welcome.
 */
@Component({
  selector: 'app-sign-in-page',
  imports: [AuthLayout, GoogleG],
  template: `
    <app-auth-layout>
      @switch (view()) {
        @case ('no-access') {
          <h1>Not on the list yet</h1>
          <p class="lead">
            <strong>{{ session.account()?.email }}</strong> isn't approved for this library. Add this account's id, then try again:
          </p>
          <code class="uid mono">{{ session.uid() }}</code>
          <p class="hint mono">npm run allow -w &#64;ani/import -- {{ session.uid() }}</p>
          <div class="actions">
            <button type="button" class="btn btn-primary" (click)="retry()">Try again</button>
            <button type="button" class="btn-link" (click)="signIn(true)">Use another account</button>
          </div>
        }
        @case ('error') {
          <h1>Couldn't connect</h1>
          <div class="notice-error" role="alert">{{ session.error() }}</div>
          <div class="actions">
            <button type="button" class="btn btn-primary" (click)="retry()">Try again</button>
            <button type="button" class="btn-link" (click)="signOut()">Sign out</button>
          </div>
        }
        @default {
          <h1>Sign in</h1>
          @if (session.status() === 'expired' && session.account(); as account) {
            <p class="lead">Your Google session ended. Sign in again as {{ account.email }}.</p>
          } @else {
            <p class="lead">Use the Google account that holds the AniStream folder on Drive to sync your library and watch progress across devices.</p>
          }
          <button type="button" class="google" [disabled]="busy()" (click)="signIn()">
            @if (busy()) {
              <span class="spinner"></span>{{ session.pending() ? 'Waiting for Google…' : 'Connecting to your library…' }}
            } @else {
              <app-google-g [size]="18" />Continue with Google
            }
          </button>
          @if (session.status() === 'expired' && !busy()) {
            <button type="button" class="btn-link other" (click)="signIn(true)">Use another account</button>
          }
          @if (session.error(); as error) {
            <div class="notice-error err" role="alert">{{ error }}</div>
          }
          <div class="foot">
            <span>The app reads your Drive (read-only) to stream episodes, and your name, email and photo.</span>
            <span>Access is limited to accounts approved for this library.</span>
          </div>
        }
      }
    </app-auth-layout>
  `,
  styles: `
    h1 {
      margin: 0 0 10px;
      font-size: clamp(24px, 2.6vw, 30px);
      font-weight: 600;
      letter-spacing: -0.025em;
    }
    .lead {
      margin: 0 0 32px;
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-4);
      text-wrap: pretty;
    }
    .lead strong {
      color: var(--text);
      font-weight: 500;
    }
    .google {
      width: 100%;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      border: none;
      border-radius: 12px;
      background: #fff;
      color: #1f1f1f;
      font-size: 15px;
      font-weight: 500;
      box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.6);
      transition: transform 0.15s;
    }
    .google:not(:disabled):hover {
      transform: translateY(-1px);
    }
    .google:disabled {
      cursor: default;
    }
    .other {
      width: 100%;
      margin-top: 10px;
      padding: 8px;
    }
    .err {
      margin-top: 14px;
    }
    .foot {
      margin-top: 36px;
      padding-top: 20px;
      border-top: 1px solid var(--line-2);
      display: flex;
      flex-direction: column;
      gap: 10px;
      font-size: 12.5px;
      line-height: 1.55;
      color: #6c6c74;
    }
    .uid {
      display: block;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--surface);
      border: 1px solid var(--line-2);
      font-size: 12.5px;
      user-select: all;
      word-break: break-all;
    }
    .hint {
      margin: 10px 0 0;
      font-size: 11.5px;
      color: var(--text-6);
      word-break: break-all;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 14px;
      margin-top: 26px;
    }
    .notice-error {
      line-height: 1.5;
    }
  `,
})
export class SignInPage {
  protected readonly session = inject(SessionStore);
  private readonly prefs = inject(PrefsStore);
  private readonly router = inject(Router);

  /** `?next=` from the guard (route input binding). */
  readonly next = input<string | undefined>();

  protected readonly busy = computed(() => this.session.pending() || this.session.phase() === 'connecting' || this.session.ready());

  protected readonly view = computed(() => {
    if (this.session.status() !== 'signed-in' || this.session.pending()) return 'sign-in';
    const phase = this.session.phase();
    return phase === 'no-access' || phase === 'error' ? phase : 'sign-in';
  });

  constructor() {
    this.session.preload();
    // Opened while already signed in (bookmark, guard after an error): settle the connection.
    if (this.session.status() === 'signed-in') void this.session.connect();
    effect(() => {
      if (this.session.ready()) void this.continue();
    });
  }

  private async continue(): Promise<void> {
    const next = safeNext(this.next());
    const exists = await this.prefs.load().catch(() => true);
    if (exists) await this.router.navigateByUrl(next, { replaceUrl: true });
    else await this.router.navigate(['/welcome'], { replaceUrl: true, queryParams: next !== '/' ? { next } : {} });
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
