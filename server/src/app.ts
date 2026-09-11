import express from 'express';
import { cors } from './middleware/cors.js';
import { requireOwner } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { apiRouter } from './routes/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors);
  app.use(express.json());

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Every /api/* route is single-user gated (README.md "Backend contract").
  app.use('/api', requireOwner, apiRouter);

  app.use(errorHandler);
  return app;
}
