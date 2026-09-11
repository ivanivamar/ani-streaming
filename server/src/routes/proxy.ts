import { Router } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { config } from '../config.js';
import { HttpError, UpstreamSourceError } from '../lib/errors.js';
import { isSafeProxyTarget, looksLikeM3u8, rewritePlaylist } from '../lib/media-proxy.js';

export const proxyRouter = Router();

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * `GET /api/proxy?url=&referer=` (README.md "Backend contract": "streams
 * m3u8 + segments with Referer/Origin re-added"). `referer` is optional —
 * the contract only documents `url` — but different providers need
 * different referers (see /api/sources's `headers.Referer`), so it
 * defaults to the standard allanime referer and the frontend is expected
 * to pass /api/sources's value straight through here.
 *
 * m3u8 playlists are buffered and rewritten so every URL they reference
 * (segments, sub-playlists, key/media URIs) also routes back through this
 * endpoint — otherwise hls.js would hit the CDN directly for those and
 * get rejected for missing headers. Everything else streams through
 * without buffering.
 */
proxyRouter.get('/proxy', async (req, res) => {
  const rawUrl = asString(req.query['url']);
  if (!rawUrl) {
    throw new HttpError(400, 'Query parameter "url" is required.', 'bad_request');
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new HttpError(400, 'Query parameter "url" is not a valid URL.', 'bad_request');
  }
  if (!isSafeProxyTarget(target)) {
    throw new HttpError(400, 'That URL is not allowed.', 'bad_request');
  }

  const rawReferer = asString(req.query['referer']) || config.allanime.referer;
  let referer: string;
  let origin: string;
  try {
    origin = new URL(rawReferer).origin;
    referer = rawReferer;
  } catch {
    throw new HttpError(400, 'Query parameter "referer" is not a valid URL.', 'bad_request');
  }

  const upstreamHeaders: Record<string, string> = {
    Referer: referer,
    Origin: origin,
    'User-Agent': config.allanime.userAgent,
  };
  const range = req.header('range');
  if (range) upstreamHeaders['Range'] = range;

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers: upstreamHeaders });
  } catch (cause) {
    throw new UpstreamSourceError('Could not reach the video source.', cause);
  }
  if (!upstream.ok) {
    throw new UpstreamSourceError(`Video source responded with HTTP ${upstream.status}.`);
  }

  const contentType = upstream.headers.get('content-type');
  const mightBePlaylist =
    (contentType !== null && /mpegurl/i.test(contentType)) || /\.m3u8(\?|$)/i.test(target.pathname + target.search);

  if (mightBePlaylist) {
    const body = await upstream.text();
    if (looksLikeM3u8(contentType, target.toString(), body)) {
      res.status(200);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewritePlaylist(body, target.toString(), referer));
      return;
    }
    // Looked like a playlist (content-type or .m3u8 extension) but wasn't
    // one once we actually checked — relay it unmodified rather than guess.
    res.status(upstream.status);
    if (contentType) res.setHeader('Content-Type', contentType);
    res.send(body);
    return;
  }

  // Segments and direct media files: stream through without buffering the
  // whole thing in memory, and relay the headers a <video>/hls.js needs
  // for range requests and seeking to work.
  res.status(upstream.status);
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }

  if (!upstream.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(upstream.body as unknown as NodeWebReadableStream);
  nodeStream.on('error', (err) => {
    console.error('[proxy] upstream stream error:', err);
    res.destroy(err);
  });
  nodeStream.pipe(res);
});
