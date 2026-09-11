/**
 * Pure helpers for `/api/proxy` (README.md "Backend contract": "streams
 * m3u8 + segments with Referer/Origin re-added"). Kept side-effect-free
 * and separate from routes/proxy.ts so the playlist-rewriting logic (the
 * part actually worth getting right) can be reasoned about without the
 * HTTP plumbing around it.
 */

const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local — includes the cloud metadata endpoint
  /^::1$/,
  /^\[::1\]$/,
];

/**
 * Lightweight SSRF guard: rejects obviously loopback/private/metadata
 * hosts and anything that isn't plain http(s). Doesn't resolve DNS, so a
 * hostname that *resolves* to a private address slips through — accepted
 * here since this route sits behind the single-owner auth guard already;
 * this is defense in depth, not a substitute for it.
 */
export function isSafeProxyTarget(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return !PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(url.hostname));
}

export function looksLikeM3u8(contentType: string | null, url: string, bodyPreview: string): boolean {
  if (contentType && /mpegurl/i.test(contentType)) return true;
  if (/\.m3u8(\?|$)/i.test(url)) return true;
  return bodyPreview.startsWith('#EXTM3U');
}

function toProxyUrl(url: string, referer: string): string {
  const params = new URLSearchParams({ url, referer });
  return `/api/proxy?${params.toString()}`;
}

/**
 * Rewrites every URL an m3u8 playlist references — bare segment/sub-
 * playlist lines, and `URI="..."` attributes on tags like #EXT-X-KEY,
 * #EXT-X-MEDIA and #EXT-X-STREAM-INF's I-FRAME variant — to route back
 * through `/api/proxy`, carrying the same referer along.
 *
 * This isn't optional polish: without it, hls.js would resolve those
 * (often relative) URLs against the CDN directly and get rejected for
 * missing Referer/Origin, since only requests that come back through this
 * endpoint get those headers re-added.
 */
export function rewritePlaylist(playlist: string, playlistUrl: string, referer: string): string {
  const base = new URL(playlistUrl);
  const resolve = (raw: string): string => new URL(raw, base).toString();
  const proxied = (raw: string): string => toProxyUrl(resolve(raw), referer);

  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/, (_match, uri: string) => `URI="${proxied(uri)}"`);
      }

      // A non-empty, non-tag line is a segment or sub-playlist URL.
      return proxied(trimmed);
    })
    .join('\n');
}
