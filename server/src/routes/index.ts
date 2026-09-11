import { Router } from 'express';
import { searchRouter } from './search.js';
import { episodesRouter } from './episodes.js';
import { sourcesRouter } from './sources.js';
import { proxyRouter } from './proxy.js';

/**
 * Combines every /api/* endpoint. Built one at a time (README.md
 * "Backend contract" — see the companion frontend build for the same
 * approach applied screen by screen); add each new router here as it
 * ships so app.ts doesn't need to change.
 */
export const apiRouter = Router();
apiRouter.use(searchRouter);
apiRouter.use(episodesRouter);
apiRouter.use(sourcesRouter);
apiRouter.use(proxyRouter);
