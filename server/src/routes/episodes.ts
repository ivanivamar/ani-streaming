import { Router } from 'express';
import { listEpisodes } from '../lib/allanime-client.js';
import { HttpError } from '../lib/errors.js';

export const episodesRouter = Router();

/**
 * `GET /api/episodes?entryId=&dub=` → `{ title, episodes: [episodeNumber] }`
 * (README.md "Backend contract" — see listEpisodes in the allanime client
 * for why `title` is included beyond the literal documented shape).
 */
episodesRouter.get('/episodes', async (req, res) => {
  const rawEntryId = req.query['entryId'];
  const entryId = typeof rawEntryId === 'string' ? rawEntryId.trim() : '';
  if (!entryId) {
    throw new HttpError(400, 'Query parameter "entryId" is required.', 'bad_request');
  }

  const dubParam = req.query['dub'];
  const dub = dubParam === 'true' || dubParam === '1';

  const result = await listEpisodes(entryId, dub ? 'dub' : 'sub');
  res.json(result);
});
