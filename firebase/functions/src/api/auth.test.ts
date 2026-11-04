/** `npm test` (Node ≥ 22.18 type stripping): the sign-in helper with Google's token endpoint mocked. */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { onRequest } from './auth.ts';

const env = { GOOGLE_CLIENT_ID: '259000610793-web.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 's' };
const SITE = 'https://myanime-streaming.web.app';
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const post = (action: string, init: { body?: unknown; cookie?: string; origin?: string; header?: boolean } = {}) =>
  onRequest({
    env,
    params: { action },
    request: new Request(`${SITE}/api/auth/${action}`, {
      method: 'POST',
      headers: {
        ...(init.header === false ? {} : { 'x-ani': '1' }),
        origin: init.origin ?? SITE,
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    }),
  });

function mockGoogle(body: Record<string, unknown>, status = 200) {
  const calls: URLSearchParams[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(new URLSearchParams(String(init?.body ?? '')));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

test('status reports configuration and cookie presence', async () => {
  const res = await onRequest({
    env,
    params: { action: 'status' },
    request: new Request(`${SITE}/api/auth/status`, { headers: { cookie: '__Host-ani_rt=abc' } }),
  });
  assert.deepEqual(await res.json(), { configured: true, session: true });
});

test('POSTs without the X-Ani header or from another origin are refused', async () => {
  assert.equal((await post('refresh', { header: false })).status, 403);
  assert.equal((await post('refresh', { origin: 'https://evil.example' })).status, 403);
});

test('exchange stores the refresh token in an HttpOnly cookie', async () => {
  const calls = mockGoogle({ access_token: 'at', expires_in: 3599, refresh_token: 'rt/1', scope: 'drive.readonly' });
  const res = await post('exchange', { body: { code: 'c0de' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { access_token: 'at', expires_in: 3599, scope: 'drive.readonly', refresh: true });
  assert.equal(calls[0]?.get('redirect_uri'), 'postmessage');
  const cookie = res.headers.get('set-cookie') ?? '';
  assert.match(cookie, /^__Host-ani_rt=rt%2F1;/);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
});

test('refresh uses the cookie; invalid_grant clears it', async () => {
  const calls = mockGoogle({ access_token: 'at2', expires_in: 3599, scope: 's' });
  const ok = await post('refresh', { cookie: '__Host-ani_rt=rt%2F1' });
  assert.equal(ok.status, 200);
  assert.equal(calls[0]?.get('refresh_token'), 'rt/1');

  mockGoogle({ error: 'invalid_grant' }, 400);
  const gone = await post('refresh', { cookie: '__Host-ani_rt=rt%2F1' });
  assert.equal(gone.status, 401);
  assert.match(gone.headers.get('set-cookie') ?? '', /Max-Age=0/);

  assert.equal((await post('refresh')).status, 401);
});

test('not configured → 501 so the app falls back to hourly tokens', async () => {
  const res = await onRequest({
    env: {},
    params: { action: 'refresh' },
    request: new Request(`${SITE}/api/auth/refresh`, { method: 'POST', headers: { 'x-ani': '1', origin: SITE } }),
  });
  assert.equal(res.status, 501);
});
