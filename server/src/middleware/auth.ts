import type { RequestHandler } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

/**
 * Guards every route (README.md "Backend contract": "Guard every route
 * with a firebase-admin ID-token check; the instance is single-user, so
 * reject any uid but yours"). Expects `Authorization: Bearer <ID token>`.
 *
 * Falls back to a `?token=` query param when there's no Authorization
 * header — a deliberate extension for `/api/proxy` specifically: it's
 * loaded by `<video>`/hls.js, which issue their own requests and can't
 * attach a custom header the way the Angular app's HttpClient interceptor
 * does for every other call. The header always wins when both are present.
 * (The token can end up in server access logs this way; acceptable given
 * this is a private, single-user instance already gated by Firebase Auth +
 * OWNER_UID below — not a materially larger exposure than the header.)
 *
 * Express 5 forwards a thrown/rejected error from an async handler to the
 * error middleware automatically, so there's no manual try/catch + next()
 * here — see middleware/error-handler.ts for how these become responses.
 */
export const requireOwner: RequestHandler = async (req, _res, next) => {
  const [scheme, headerToken] = (req.header('authorization') ?? '').split(' ');
  const queryToken = typeof req.query['token'] === 'string' ? req.query['token'] : '';
  const token = scheme === 'Bearer' && headerToken ? headerToken : queryToken;
  if (!token) {
    throw new HttpError(401, 'Missing bearer token.', 'unauthenticated');
  }

  if (!config.ownerUid) {
    // Fails closed: an unset OWNER_UID must never accidentally admit anyone.
    throw new HttpError(500, 'OWNER_UID is not configured.', 'misconfigured');
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    throw new HttpError(401, 'Invalid or expired token.', 'unauthenticated');
  }

  if (decoded.uid !== config.ownerUid) {
    // This is a single-user instance — anyone else's valid token is still a reject.
    throw new HttpError(403, 'This instance is single-user.', 'forbidden');
  }

  req.uid = decoded.uid;
  next();
};
