import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { cors } from './middleware/cors.js';
import { requireOwner } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { apiRouter } from './routes/index.js';
import { openApiSpec } from './openapi.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors);
  app.use(express.json());

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Docs are unauthenticated on purpose — they describe request/response
  // *shapes*, not data, and Swagger UI needs to load before you have a
  // token to hand it via the Authorize button anyway.
  app.get('/openapi.json', (_req, res) => res.json(openApiSpec));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  // Every /api/* route is single-user gated (README.md "Backend contract").
  app.use('/api', requireOwner, apiRouter);

  app.use(errorHandler);
  return app;
}
