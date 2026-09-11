import type { RequestHandler } from 'express';
import { config } from '../config.js';

/**
 * Minimal CORS for local dev (`ng serve` on :4200 calling this server on
 * :8080 directly). In production, put a Firebase Hosting rewrite in front
 * of this service so the Angular app calls `/api/*` same-origin — at that
 * point this middleware simply never triggers a preflight and can stay.
 */
export const cors: RequestHandler = (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', config.allowedOrigin);
  res.setHeader('Vary', 'Origin');
  // Range: hls.js and <video> send it for seeking (/api/proxy). Not a
  // CORS-safelisted header, so it has to be explicitly allowed or
  // cross-origin range requests fail before they even reach the route.
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Same idea in the response direction: these aren't in the default
  // exposed set, so JS (hls.js) can't read them from a cross-origin
  // response unless listed here.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
};
