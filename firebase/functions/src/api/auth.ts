/**
 * Sign-in helper — `/api/auth/*` on the app's own origin (Firebase Hosting → the `api` function,
 * see ../index.ts). Ported from the music app.
 *
 * Why: in the browser, Google's token model only hands out 1-hour access tokens and can't renew them
 * without a popup. The authorization-code flow gives a long-lived refresh token, but swapping a code
 * for tokens needs the OAuth client secret, which must not ship in the app. This function holds the
 * secret and the refresh token:
 *
 *   POST /api/auth/exchange  { code }   → { access_token, expires_in, scope, refresh }   + sets the cookie
 *   POST /api/auth/refresh              → { access_token, expires_in, scope }             (401 = sign in again)
 *   POST /api/auth/logout               → revokes the refresh token, clears the cookie
 *   GET  /api/auth/status               → { configured, session }
 *
 * The refresh token lives only in an HttpOnly, Secure, SameSite=Strict cookie on this origin
 * (`__Host-ani_rt`, `__session` on the wire), so page scripts can never read it. POSTs need the
 * `X-Ani: 1` header and a same-origin `Origin` (CSRF guard). Nothing else is stored anywhere.
 *
 * Secrets GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET = the "ani.stream Web" OAuth client.
 * Without them every call answers 501 and the app falls back to the hourly token sign-in.
 */

export interface Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export interface Ctx {
  request: Request;
  env: Env;
  params: { action?: string | string[] };
}

const COOKIE = '__Host-ani_rt';
const MAX_AGE = 180 * 24 * 3600; // Google keeps an unused refresh token for 6 months
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

const setCookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

function readCookie(req: Request): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === COOKIE) return decodeURIComponent(part.slice(i + 1)) || null;
  }
  return null;
}

async function google(env: Env, params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  return { ok: res.ok && !!body.access_token, status: res.status, body };
}

export async function onRequest({ request, env, params }: Ctx): Promise<Response> {
  const action = Array.isArray(params.action) ? params.action[0] : params.action;
  const configured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  if (action === 'status' && request.method === 'GET') {
    return json({ configured, session: !!readCookie(request) });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // CSRF: same-origin fetches only (the cookie is SameSite=Strict as well)
  const origin = request.headers.get('origin');
  if (request.headers.get('x-ani') !== '1' || (origin && origin !== new URL(request.url).origin)) {
    return json({ error: 'forbidden' }, 403);
  }
  if (!configured) return json({ error: 'not_configured' }, 501);

  if (action === 'exchange') {
    const { code } = (await request.json().catch(() => ({}))) as { code?: string };
    if (!code) return json({ error: 'missing_code' }, 400);
    // GIS popup code flow: the redirect URI is the literal "postmessage"
    const r = await google(env, { code, grant_type: 'authorization_code', redirect_uri: 'postmessage' });
    if (!r.ok) {
      return json({ error: r.body.error ?? 'exchange_failed', message: r.body.error_description }, 400);
    }
    const out = {
      access_token: r.body.access_token,
      expires_in: r.body.expires_in ?? 3600,
      scope: r.body.scope ?? '',
      refresh: !!r.body.refresh_token,
    };
    // Google only sends a refresh token when the user grants offline access; keep the old one otherwise
    return json(
      out,
      200,
      r.body.refresh_token ? { 'set-cookie': setCookie(encodeURIComponent(r.body.refresh_token), MAX_AGE) } : {},
    );
  }

  if (action === 'refresh') {
    const rt = readCookie(request);
    if (!rt) return json({ error: 'no_session' }, 401);
    const r = await google(env, { refresh_token: rt, grant_type: 'refresh_token' });
    if (!r.ok) {
      // revoked / expired grant → forget it; anything else (Google hiccup) → let the app retry
      if (r.body.error === 'invalid_grant') {
        return json({ error: 'invalid_grant' }, 401, { 'set-cookie': setCookie('', 0) });
      }
      return json({ error: r.body.error ?? 'refresh_failed' }, 502);
    }
    // slide the cookie's lifetime forward on every use
    return json(
      { access_token: r.body.access_token, expires_in: r.body.expires_in ?? 3600, scope: r.body.scope ?? '' },
      200,
      { 'set-cookie': setCookie(encodeURIComponent(rt), MAX_AGE) },
    );
  }

  if (action === 'logout') {
    const rt = readCookie(request);
    if (rt) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rt)}`, { method: 'POST' }).catch(
        () => undefined,
      );
    }
    return json({ ok: true }, 200, { 'set-cookie': setCookie('', 0) });
  }

  return json({ error: 'not_found' }, 404);
}
