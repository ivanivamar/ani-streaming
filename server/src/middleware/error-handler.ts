import type { ErrorRequestHandler } from 'express';
import { HttpError } from '../lib/errors.js';

/**
 * Central error → HTTP response mapping. `HttpError` (and its
 * `UpstreamSourceError` subclass) carries the status/code to send;
 * anything else is an unexpected bug and comes back as a bare 500 so
 * internals never leak to the client.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    if (err.status >= 500) {
      console.error(`[${err.code}]`, err.message, 'cause' in err ? err.cause : '');
    }
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
};
