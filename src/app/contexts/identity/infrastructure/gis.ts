import { DOCUMENT, inject, Injectable } from '@angular/core';
import { APP_ENV, missingEnv } from '@shared/infrastructure';
import { GoogleIdentityPort, type GoogleTokens, type PopupOptions } from '../application/ports';
import { DRIVE_READONLY_SCOPE } from '../domain';

/** The slice of Google Identity Services (accounts.google.com/gsi/client) the app uses. */
interface GisError {
  type: 'popup_failed_to_open' | 'popup_closed' | 'unknown';
  message?: string;
}
interface GisTokenResponse {
  access_token: string;
  expires_in: number | string;
  scope: string;
  error?: string;
  error_description?: string;
}
interface GisCodeResponse {
  code?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes?: boolean;
    callback: (r: GisTokenResponse) => void;
    error_callback?: (e: GisError) => void;
  }): { requestAccessToken(o?: { prompt?: string; login_hint?: string }): void };
  initCodeClient(config: {
    client_id: string;
    scope: string;
    ux_mode?: 'popup' | 'redirect';
    include_granted_scopes?: boolean;
    select_account?: boolean;
    login_hint?: string;
    callback: (r: GisCodeResponse) => void;
    error_callback?: (e: GisError) => void;
  }): { requestCode(): void };
  revoke(token: string, done?: () => void): void;
}
type GisWindow = Window & { google?: { accounts?: { oauth2?: GisOAuth2 } } };

function popupError(err: GisError): string {
  if (err.type === 'popup_closed') return 'The Google window was closed before signing in.';
  if (err.type === 'popup_failed_to_open') return 'The browser blocked the Google window. Allow pop-ups for this site.';
  return err.message || 'Sign-in failed.';
}

/** Google Identity Services popup flows (ported from the music app's `state/session.ts`). */
@Injectable()
export class GisGoogleIdentity extends GoogleIdentityPort {
  private readonly doc = inject(DOCUMENT);
  private readonly env = inject(APP_ENV);
  private loading: Promise<GisOAuth2> | null = null;

  private get win(): GisWindow {
    return this.doc.defaultView as GisWindow;
  }

  private load(): Promise<GisOAuth2> {
    const ready = this.win.google?.accounts?.oauth2;
    if (ready) return Promise.resolve(ready);
    this.loading ??= new Promise<GisOAuth2>((resolve, reject) => {
      const s = this.doc.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => {
        const oauth2 = this.win.google?.accounts?.oauth2;
        if (oauth2) resolve(oauth2);
        else reject(new Error('Google sign-in did not load.'));
      };
      s.onerror = () => {
        this.loading = null;
        reject(new Error('Could not reach Google. Check the connection and try again.'));
      };
      this.doc.head.appendChild(s);
    });
    return this.loading;
  }

  private clientId(): string {
    if (missingEnv(this.env).includes('googleClientId')) {
      throw new Error('The Web OAuth client id is missing: set googleClientId in src/app/app.env.ts.');
    }
    return this.env.googleClientId;
  }

  preload(): void {
    void this.load().catch(() => undefined);
  }

  async requestCode(opts: PopupOptions): Promise<string> {
    const client_id = this.clientId();
    const oauth2 = await this.load();
    return new Promise<string>((resolve, reject) => {
      oauth2
        .initCodeClient({
          client_id,
          scope: DRIVE_READONLY_SCOPE,
          ux_mode: 'popup',
          include_granted_scopes: false,
          select_account: !!opts.selectAccount,
          ...(opts.hint ? { login_hint: opts.hint } : {}),
          callback: (r) =>
            r.error || !r.code ? reject(new Error(r.error_description || r.error || 'Sign-in failed.')) : resolve(r.code),
          error_callback: (e) => reject(new Error(popupError(e))),
        })
        .requestCode();
    });
  }

  async requestToken(opts: PopupOptions): Promise<GoogleTokens> {
    const client_id = this.clientId();
    const oauth2 = await this.load();
    const r = await new Promise<GisTokenResponse>((resolve, reject) => {
      oauth2
        .initTokenClient({
          client_id,
          scope: DRIVE_READONLY_SCOPE,
          include_granted_scopes: false,
          callback: (resp) => (resp.error ? reject(new Error(resp.error_description || resp.error)) : resolve(resp)),
          error_callback: (e) => reject(new Error(popupError(e))),
        })
        .requestAccessToken({
          prompt: opts.selectAccount ? 'select_account' : '',
          ...(opts.hint ? { login_hint: opts.hint } : {}),
        });
    });
    return { accessToken: r.access_token, expiresInSec: Number(r.expires_in) || 3600, scope: r.scope };
  }

  revoke(accessToken: string): void {
    const oauth2 = this.win.google?.accounts?.oauth2;
    if (oauth2) oauth2.revoke(accessToken);
    else {
      // fire-and-forget; works from any origin
      void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        mode: 'no-cors',
      }).catch(() => undefined);
    }
  }
}
