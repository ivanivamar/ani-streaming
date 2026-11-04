/**
 * Firebase sign-in — `/api/firebase/token` (ported from the music app's `/api/sync/token`).
 *
 * The app signs in with Google for Drive only (drive.readonly, no profile/email scopes and no Firebase
 * Google provider), so it can't sign in to Firebase directly. This turns the Drive access token it
 * already has into a Firebase custom token; the app signs in to Firebase Auth with it once and
 * Firebase keeps that session fresh by itself. One Google sign-in covers Drive and Firestore.
 *
 *   POST /api/firebase/token   Authorization: Bearer <Google access token>   X-Ani: 1
 *        → { token: <Firebase custom token>, uid }
 *
 * The access token must belong to one of the app's own OAuth clients (same Google Cloud project
 * number as GOOGLE_CLIENT_ID — the Web and the Android client both are) and be able to read
 * Drive's `about` (who the user is). uid = "g" + the Drive permission id (stable per account).
 * Whether that uid may read the catalogue is decided by Firestore rules (`config/access`).
 *
 * The runtime service account needs "Service Account Token Creator" on itself to sign custom
 * tokens (README "Step 3 setup"). Nothing is stored here.
 *
 * The Android app (Step 8) calls this on https://myanime-streaming.web.app from https://localhost,
 * so those origins get CORS headers.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Ctx } from './auth.ts';

const NATIVE_ORIGINS = new Set(['https://localhost', 'http://localhost', 'capacitor://localhost']);

function cors(origin: string | null): Record<string, string> {
  if (!origin || !NATIVE_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'x-ani, authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

const jsonFor =
  (origin: string | null) =>
  (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin) },
    });

interface TokenInfo {
  aud?: string;
  azp?: string;
  scope?: string;
  error?: string;
}

/** Google Cloud project number of the app's OAuth clients ("259000610793-….apps.googleusercontent.com"). */
const projectNumberOf = (clientId: string | undefined) => (clientId ?? '').trim().split('-')[0] || null;

export async function onRequest({ request, env, params }: Ctx): Promise<Response> {
  const origin = request.headers.get('origin');
  const json = jsonFor(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  const action = Array.isArray(params.action) ? params.action[0] : params.action;
  if (action !== 'token') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (request.headers.get('x-ani') !== '1') return json({ error: 'forbidden' }, 403);

  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!m) return json({ error: 'unauthorized', message: 'Missing Google access token.' }, 401);
  const accessToken = m[1];

  const project = projectNumberOf(env.GOOGLE_CLIENT_ID);
  if (!project) {
    return json({ error: 'not_configured', message: 'GOOGLE_CLIENT_ID is not set on the server.' }, 503);
  }

  // 1. the token is live and was issued to one of our OAuth clients
  let info: TokenInfo;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    info = (await r.json()) as TokenInfo;
    if (!r.ok || info.error) {
      return json({ error: 'unauthorized', message: 'Google did not accept the access token.' }, 401);
    }
  } catch {
    return json({ error: 'upstream', message: 'Could not reach Google.' }, 502);
  }
  const client = info.azp || info.aud || '';
  if (projectNumberOf(client) !== project) {
    return json({ error: 'forbidden', message: 'Token is from another app.' }, 403);
  }

  // 2. who it is (the Drive scope is enough for this)
  let user: { permissionId?: string; emailAddress?: string; displayName?: string };
  try {
    const r = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,displayName)',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!r.ok) return json({ error: 'unauthorized', message: `Drive answered ${r.status}.` }, 401);
    user = ((await r.json()) as { user?: typeof user }).user ?? {};
  } catch {
    return json({ error: 'upstream', message: 'Could not reach Google Drive.' }, 502);
  }
  if (!user.permissionId) {
    return json({ error: 'unauthorized', message: 'Drive did not say who this is.' }, 401);
  }

  // 3. a Firebase custom token for that user
  if (!getApps().length) initializeApp();
  const uid = `g${user.permissionId}`;
  try {
    const token = await getAuth().createCustomToken(uid, user.emailAddress ? { email: user.emailAddress } : undefined);
    return json({ token, uid });
  } catch (e) {
    console.error('createCustomToken failed', e);
    return json(
      {
        error: 'sign_failed',
        message:
          'Could not sign a Firebase token. Give the function’s service account the "Service Account Token Creator" role.',
      },
      500,
    );
  }
}
