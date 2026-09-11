import { Router } from 'express';
import { searchShows } from '../lib/allanime-client.js';
import { HttpError } from '../lib/errors.js';

export const searchRouter = Router();

/**
 * `GET /api/search?q=&dub=` → `[{ entryId, title, episodes }]`
 * (README.md "Backend contract"). `dub` is any of "true"/"1" for dub,
 * anything else (including absent) means sub.
 */
searchRouter.get('/search', async (req, res) => {
  const rawQuery = req.query['q'];
  const q = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (!q) {
    throw new HttpError(400, 'Query parameter "q" is required.', 'bad_request');
  }

  const dubParam = req.query['dub'];
  const dub = dubParam === 'true' || dubParam === '1';

  const results = await searchShows(q, dub ? 'dub' : 'sub');
  res.json(results);
});
