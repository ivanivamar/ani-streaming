/**
 * ani.stream's only server code: one Cloud Function, `api`, behind Firebase Hosting (`/api/**`).
 * Ported from the music app (D:\material-music\firebase\functions), keeping only the sign-in parts:
 *
 *   /api/auth/*            sign-in helper: keeps the Google refresh token in a cookie (./api/auth.ts)
 *   /api/firebase/token    Google access token → Firebase custom token (./api/firebase-token.ts)
 *
 * The handlers are plain Web Request → Response functions; this file adapts Firebase's
 * request/response to them. build.mjs bundles everything into lib/index.js.
 *
 * Two Firebase specifics:
 * - Firebase Hosting forwards only ONE cookie to functions, and it must be named `__session`.
 *   The handlers use `__Host-ani_rt`, so the name is swapped on the way in and out
 *   (still HttpOnly, Secure, SameSite=Strict).
 * - The function runs on its own host behind Hosting; the site's address comes from
 *   `x-forwarded-host`, so the handlers' same-origin (CSRF) check compares against the site.
 *
 * Secrets (once, from the repo root; values from the "ani.stream Web" OAuth client):
 *   firebase functions:secrets:set GOOGLE_CLIENT_ID
 *   firebase functions:secrets:set GOOGLE_CLIENT_SECRET
 * A new secret needs one deploy from the PC (`firebase deploy --only functions`): the CLI grants the
 * function access to it, which a CI account can't do.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as auth from './api/auth.ts';
import * as firebase from './api/firebase-token.ts';

const GOOGLE_CLIENT_ID = defineSecret('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');

const APP_COOKIE = '__Host-ani_rt';
const FB_COOKIE = '__session';

const handlers = { auth, firebase } as const;

type HeaderValue = string | string[] | undefined;

/** The site's own host (what the browser sees), not the function's. */
function siteHost(headers: Record<string, HeaderValue>): string {
  const first = (v: HeaderValue) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() || '';
  const fwd = first(headers['x-forwarded-host']);
  if (fwd) return fwd;
  // fallback: trust the Origin only when it is a Firebase Hosting address
  const origin = first(headers['origin']);
  if (origin) {
    try {
      const h = new URL(origin).host;
      if (/\.(web\.app|firebaseapp\.com)$/.test(h)) return h;
    } catch {
      /* ignore */
    }
  }
  return first(headers['host']);
}

export const api = onRequest(
  {
    region: 'europe-west1',
    secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET],
    memory: '256MiB',
    maxInstances: 3,
    invoker: 'public',
  },
  async (req, res) => {
    const url = new URL(req.originalUrl || req.url, `https://${siteHost(req.headers)}`);
    const m = /^\/api\/(auth|firebase)\/([^/]+)\/?$/.exec(url.pathname);
    if (!m) {
      res.status(404).set('cache-control', 'no-store').json({ error: 'not_found' });
      return;
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      if (k === 'cookie') {
        // __session=<token>  →  __Host-ani_rt=<token>
        const val = (Array.isArray(v) ? v.join('; ') : v)
          .split(/;\s*/)
          .map((p) => (p.startsWith(`${FB_COOKIE}=`) ? APP_COOKIE + p.slice(FB_COOKIE.length) : p))
          .join('; ');
        headers.set('cookie', val);
      } else {
        headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      }
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? new Uint8Array(req.rawBody ?? []) : undefined,
    });
    const env = {
      GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID.value().trim() || undefined,
      GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT_SECRET.value().trim() || undefined,
    };

    const handler = handlers[m[1] as keyof typeof handlers];
    let response: Response;
    try {
      response = await handler.onRequest({ request, env, params: { action: decodeURIComponent(m[2]) } });
    } catch (e) {
      console.error('api handler failed', e);
      res.status(500).set('cache-control', 'no-store').json({ error: 'internal' });
      return;
    }

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') res.setHeader(key, value);
    });
    const cookies = response.headers
      .getSetCookie()
      .map((c) => (c.startsWith(`${APP_COOKIE}=`) ? FB_COOKIE + c.slice(APP_COOKIE.length) : c));
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.send(Buffer.from(await response.arrayBuffer()));
  },
);
