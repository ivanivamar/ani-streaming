import { Component, computed, inject, input, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { DEFAULT_PREFS, PrefsStore, safeNext, SessionStore, type SubtitleMode } from '@identity/application';
import { Avatar, Segmented, Toggle } from '@shared/ui';
import { AuthLayout } from './auth-layout';
import { SUBTITLE_OPTIONS } from './prefs-options';

interface WelcomeModel {
  subtitles: SubtitleMode;
  autoplayNext: boolean;
}


/**
 * Welcome (first sign-in, v3 adapted): account chip, then the defaults. Audio and Quality are
 * gone (Japanese audio only, one 1080p copy); Subtitles and Autoplay take their place.
 * "Start watching" creates `users/{uid}`. Signal Forms.
 */
@Component({
  selector: 'app-welcome-page',
  imports: [AuthLayout, Avatar, FormField, Segmented, Toggle],
  template: `
    <app-auth-layout>
      <div class="acct">
        <app-avatar [name]="account()?.name || account()?.email" [photo]="account()?.photo" [size]="52" badge />
        <div class="who">
          <div class="name">{{ account()?.name || account()?.email }}</div>
          <div class="email">{{ account()?.email }}</div>
        </div>
      </div>
      <h1>Welcome, {{ firstName() }}</h1>
      <p class="lead">Pick your defaults. You can change them later in Settings.</p>

      <form class="fields" (submit)="$event.preventDefault(); start()">
        <div>
          <div class="label" id="subs-label">Subtitles</div>
          <app-segmented [formField]="f.subtitles" [options]="subtitleOptions" fill aria-labelledby="subs-label" />
        </div>
        <div class="toggle-row">
          <div>
            <div class="t-label">Autoplay next episode</div>
            <div class="t-desc">Starts the next one when an episode ends.</div>
          </div>
          <app-toggle [formField]="f.autoplayNext" label="Autoplay next episode" />
        </div>
        @if (error()) {
          <div class="notice-error" role="alert">{{ error() }}</div>
        }
        <button type="submit" class="btn btn-primary start" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Start watching' }}</button>
        <button type="button" class="btn-link" (click)="switchAccount()">Not you? Use another account</button>
      </form>
    </app-auth-layout>
  `,
  styles: `
    .acct {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 26px;
    }
    .who {
      min-width: 0;
    }
    .name {
      font-size: 14.5px;
      font-weight: 500;
    }
    .email {
      font-size: 12.5px;
      color: var(--text-5);
      margin-top: 2px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(24px, 2.6vw, 30px);
      font-weight: 600;
      letter-spacing: -0.025em;
    }
    .lead {
      margin: 0 0 28px;
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-4);
    }
    .fields {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .label {
      font-size: 12.5px;
      color: var(--text-3);
      margin-bottom: 9px;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--line-3);
      background: var(--surface);
    }
    .toggle-row > div {
      flex: 1;
    }
    .t-label {
      font-size: 14px;
      font-weight: 500;
    }
    .t-desc {
      font-size: 12px;
      color: var(--text-5);
      margin-top: 3px;
    }
    .start {
      margin-top: 6px;
      height: 50px;
      border-radius: 12px;
      font-size: 15px;
    }
  `,
})
export class WelcomePage {
  private readonly session = inject(SessionStore);
  private readonly prefs = inject(PrefsStore);
  private readonly router = inject(Router);

  readonly next = input<string | undefined>();

  protected readonly account = this.session.account;
  protected readonly subtitleOptions = SUBTITLE_OPTIONS;
  protected readonly model = signal<WelcomeModel>({ subtitles: DEFAULT_PREFS.subtitles, autoplayNext: DEFAULT_PREFS.autoplayNext });
  protected readonly f = form(this.model);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly firstName = computed(() => {
    const a = this.account();
    return a?.name?.split(' ')[0] || a?.email?.split('@')[0] || 'there';
  });

  constructor() {
    // already has a profile (reload, back button): skip ahead
    void this.prefs
      .load()
      .then((exists) => exists && this.router.navigateByUrl(safeNext(this.next()), { replaceUrl: true }))
      .catch(() => undefined);
  }

  protected async start(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.prefs.create(this.model());
      await this.router.navigateByUrl(safeNext(this.next()), { replaceUrl: true });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.saving.set(false);
    }
  }

  /** Google's account chooser (must open inside the click); the new account starts over at sign-in. */
  protected switchAccount(): void {
    void this.session.signIn({ switchAccount: true }).then(() => this.router.navigateByUrl('/auth', { replaceUrl: true }));
  }
}
