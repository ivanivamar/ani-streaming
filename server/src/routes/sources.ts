import { Router } from 'express';
import { fetchSources, pickSource } from '../lib/allanime-client.js';
import { HttpError } from '../lib/errors.js';

export const sourcesRouter = Router();

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * `GET /api/sources?entryId=&ep=&dub=&q=` → `{ url, headers }` for the
 * chosen quality (README.md "Backend contract"). See
 * lib/allanime-crypto.ts's file-level note — this endpoint is the least
 * certain of the four, untestable from this environment.
 *
 * `headers` is what the *next* hop, `/api/proxy` (not built yet), needs to
 * re-attach when it actually fetches this url's bytes — a browser can't
 * set Referer/Origin itself (README.md: "streams m3u8 + segments with
 * Referer/Origin re-added").
 */
sourcesRouter.get('/sources', async (req, res) => {
  const entryId = asString(req.query['entryId']);
  const episode = asString(req.query['ep']);
  if (!entryId || !episode) {
    throw new HttpError(400, 'Query parameters "entryId" and "ep" are required.', 'bad_request');
  }

  const dubParam = req.query['dub'];
  const dub = dubParam === 'true' || dubParam === '1';
  const quality = asString(req.query['q']) || 'best';

  const candidates = await fetchSources(entryId, dub ? 'dub' : 'sub', episode);
  const picked = pickSource(candidates, quality);
  if (!picked) {
    throw new HttpError(404, 'No playable source found for this episode.', 'not_found');
  }

  res.json({
    url: picked.url,
    headers: {
      Referer: picked.referer,
      Origin: new URL(picked.referer).origin,
    },
  });
});
