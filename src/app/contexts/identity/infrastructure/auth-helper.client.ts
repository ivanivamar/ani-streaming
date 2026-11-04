import { inject, Injectable } from '@angular/core';
import { APP_ENV } from '@shared/infrastructure';
import { AuthHelperError, AuthHelperPort, type GoogleTokens } from '../application/ports';

interface HelperTokens {
  access_token: string;
  expires_in: number;
  scope: string;
  refresh?: boolean;
}

const toTokens = (t: HelperTokens): GoogleTokens => ({
  accessToken: t.access_token,
  expiresInSec: Number(t.expires_in) || 3600,
  scope: t.scope ?? '',
});

/** Client of the sign-in helper function (`/api/auth/*`, firebase/functions/src/api/auth.ts). */
@Injectable()
export class AuthHelperClient extends AuthHelperPort {
  private readonly base = `${inject(APP_ENV).apiBase}api/auth/`;
  private probe: Promise<boolean> | null = null;

  available(): Promise<boolean> {
    // ng serve without the proxy answers index.html here, so check for JSON
    this.probe ??= this.status()
      .then((s) => !!s?.configured)
      .catch(() => false);
    // a network failure shouldn't stick for the whole session
    void this.probe.then((ok) => ok || (this.probe = null));
    return this.probe;
  }

  async hasSession(): Promise<boolean> {
    return !!(await this.status().catch(() => null))?.session;
  }

  async exchange(code: string): Promise<GoogleTokens & { refresh: boolean }> {
    const t = await this.post<HelperTokens>('exchange', { code });
    return { ...toTokens(t), refresh: !!t.refresh };
  }

  async refresh(): Promise<GoogleTokens> {
    return toTokens(await this.post<HelperTokens>('refresh'));
  }

  async logout(): Promise<void> {
    await this.post('logout');
  }

  private async status(): Promise<{ configured?: boolean; session?: boolean } | null> {
    const r = await fetch(`${this.base}status`, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('application/json')) return null;
    return (await r.json()) as { configured?: boolean; session?: boolean };
  }

  private async post<T>(action: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Ani': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (!res.ok) throw new AuthHelperError(res.status, j.message || j.error || `Sign-in helper answered ${res.status}`);
    return j;
  }
}
