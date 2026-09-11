import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { config } from '../config.js';
import { browserFetch } from './browser-fetch.js';
import { UpstreamSourceError } from './errors.js';

/**
 * ============================================================================
 * CONFIRMED BROKEN as of 2026-09-11 — read before touching /api/sources.
 * ============================================================================
 * `deriveKey()` below fails every time right now: `config.allanime.referer`
 * (mkissa.to) is sitting behind a Cloudflare bot-verification wall, so the
 * "homepage" fetch() gets served a JS anti-tampering challenge page instead
 * of the real site — no `epoch`/`partB`/app-bundle markers to find, because
 * they're just not on that page. Confirmed independently: mkissa.to is
 * reported "Cloudflare protected" in a live community issue
 * (github.com/yuzono/anime-extensions/issues/607), and even Aniyomi (a real
 * Android app with a full in-app browser that executes JS) has multiple open
 * issues failing to bypass this same wall (aniyomiorg/aniyomi#2206, #826;
 * aniyomiorg/aniyomi-extensions#2669) — so this isn't specific to this
 * project's plain server-side fetch(), and isn't fixable by tweaking the
 * scraping patterns below.
 *
 * Already ruled out: swapping to allmanga.to (the newer community-reported
 * mirror front-end) as `ALLANIME_REFERER`. It loads fine (not Cloudflare
 * blocked), but it's a structurally different, much smaller Nuxt.js site —
 * no epoch/partB/app-bundle markers either, and community reports say its
 * episode/video pages redirect back to mkissa.to anyway. Not a productive
 * direction to keep pulling on.
 *
 * 2026-09-11, second attempt: the homepage fetch now goes through
 * lib/browser-fetch.ts — a real headless Chromium page load instead of a
 * plain fetch() — to give Cloudflare's JS challenge something that can
 * actually execute it. Deliberately not escalated further than that (no
 * stealth/anti-detection plugin, no CAPTCHA solver, no IP rotation); if a
 * real browser still gets walled off, treat that as this endpoint staying
 * broken rather than a reason to keep escalating. Requires Chromium to
 * actually be installed locally (`npx playwright install chromium` in
 * server/) — if it's missing, this fails fast with a clear message instead
 * of the generic marker-missing one.
 *
 * Below this note: everything ports ani-cli's `fetch_keys` / `get_aa_req` /
 * `process_tobeparsed` shell functions (which shell out to the `botan` CLI
 * for AES-256-GCM), transcribed from the bash source rather than verified
 * against a live run — this part was never confirmed correct or incorrect,
 * because execution never gets past the Cloudflare wall above to test it:
 *
 *   1. `botan hash --no-fsname` is called with no --algo flag. Assumed to
 *      mean SHA-256 (botan's documented default), used below for deriving
 *      the GCM IV — check this against a real botan install
 *      (`botan help hash`) if decryption ever fails *after* the wall above
 *      is cleared.
 *   2. The GCM ciphertext/tag byte layout (tag = trailing 16 bytes, no
 *      AAD) is inferred from how the script slices botan's output with
 *      `dd`, not from botan's own documentation.
 * ============================================================================
 */

/** The one GraphQL operation ani-cli resolves via Apollo persisted-query
 *  hash + a signed "aaReq" token instead of sending literal query text. */
export const EPISODE_SOURCES_QUERY_HASH =
  'f4662f4b7510b26795dd53ef824a0bf1740fbbc5d1273fab18222ac831bca8d0';

interface DerivedKey {
  key: Buffer;
  epoch: string;
}

let cachedKey: (DerivedKey & { fetchedAt: number }) | null = null;
const KEY_TTL_MS = 30 * 60 * 1000;

async function fetchText(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': config.allanime.userAgent, ...extraHeaders } });
  } catch (cause) {
    throw new UpstreamSourceError(`Could not reach ${url}.`, cause);
  }
  if (!response.ok) {
    throw new UpstreamSourceError(`${url} responded with HTTP ${response.status}.`);
  }
  return response.text();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reconstructs allanime's per-deploy AES-256 key (ani-cli's `fetch_keys`):
 * XOR a 32-byte mask baked into the site's current JS bundle against a
 * base64 value embedded in its homepage. Several HTTP round trips — cached
 * for KEY_TTL_MS since the mask only changes when allanime redeploys.
 */
async function deriveKey(): Promise<DerivedKey> {
  const { html: homepage, cookieHeader } = await browserFetch(config.allanime.referer);

  const epochMatch = homepage.match(/"epoch":(\d+)/);
  const partBMatch = homepage.match(/"partB":"([^"]*)"/);
  const appUrlMatch = homepage.match(new RegExp(`${escapeRegExp(config.allanime.cdn)}/entry/app\\.[A-Za-z0-9_.-]+\\.js`));

  if (!epochMatch || !partBMatch || !appUrlMatch) {
    // Unverified scraping logic (see file-level note) — when this trips,
    // dump *which* marker(s) are missing plus a homepage snippet so the
    // next failure is diagnosable from server logs alone: is this really a
    // frontend-shape change, or did we get served something else entirely
    // (a bot-check/Cloudflare challenge page, a redirect, an error page)?
    console.error('[allanime-crypto] homepage marker(s) missing:', {
      epoch: !!epochMatch,
      partB: !!partBMatch,
      appBundle: !!appUrlMatch,
      homepageLength: homepage.length,
      homepageSnippet: homepage.slice(0, 800),
    });
    throw new UpstreamSourceError(
      "Could not find epoch/partB/app-bundle markers on allanime's homepage — its frontend shape may have changed.",
    );
  }

  const epoch = epochMatch[1]!;
  const partBHex = Buffer.from(partBMatch[1]!, 'base64').toString('hex');

  // Reuse the browser's cookies (notably Cloudflare's `cf_clearance`, when
  // present) on these follow-up fetches instead of opening another browser
  // page for each one — a plain fetch() carrying a valid clearance cookie
  // is enough to pass, without needing JS execution a second time.
  const cookieHeaders = cookieHeader ? { Cookie: cookieHeader } : {};
  const appJs = await fetchText(appUrlMatch[0], cookieHeaders);
  const chunkNames = [...appJs.matchAll(/"\.\.\/chunks\/([A-Za-z0-9_.-]+\.js)"/g)].slice(0, 5).map((m) => m[1]!);

  if (chunkNames.length === 0) {
    throw new UpstreamSourceError("Could not find any JS chunk references in allanime's app bundle.");
  }

  const chunkTexts = await Promise.all(
    chunkNames.map((name) => fetchText(`${config.allanime.cdn}/${name}`, cookieHeaders)),
  );
  const maskMatch = chunkTexts.join('\n').match(/[0-9a-f]{64}/);
  if (!maskMatch) {
    throw new UpstreamSourceError("Could not find the 64-hex-char key mask in allanime's JS bundle.");
  }
  const maskHex = maskMatch[0];

  const key = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    const maskByte = parseInt(maskHex.slice(i * 2, i * 2 + 2), 16);
    const partByte = parseInt(partBHex.slice(i * 2, i * 2 + 2), 16) || 0;
    key[i] = maskByte ^ partByte;
  }

  return { key, epoch };
}

async function getKey(forceRefresh = false): Promise<DerivedKey> {
  if (!forceRefresh && cachedKey && Date.now() - cachedKey.fetchedAt < KEY_TTL_MS) {
    return cachedKey;
  }
  const derived = await deriveKey();
  cachedKey = { ...derived, fetchedAt: Date.now() };
  return derived;
}

/**
 * Builds the signed "aaReq" token every episode-sources request needs
 * (ani-cli's `get_aa_req`): a 5-minute-bucketed timestamp + the query hash,
 * AES-256-GCM encrypted and framed as `0x01 || iv(12) || ciphertext || tag(16)`,
 * base64-encoded.
 */
export async function buildAaReq(): Promise<string> {
  const { key, epoch } = await getKey();

  const ts = Math.floor(Date.now() / 1000 / 300) * 300 * 1000;
  const ivSeed = `${epoch}:${EPISODE_SOURCES_QUERY_HASH}:${ts}`;
  // See the file-level note: SHA-256 here is an assumption, not confirmed.
  const iv = createHash('sha256').update(ivSeed).digest().subarray(0, 12);

  const payload = `{"v":1,"ts":${ts},"epoch":${epoch},"qh":"${EPISODE_SOURCES_QUERY_HASH}"}`;

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([Buffer.from([0x01]), iv, ciphertext, tag]).toString('base64');
}

/**
 * Decrypts a GraphQL response's `"tobeparsed":"<base64>"` field (ani-cli's
 * `process_tobeparsed`). Responses that don't carry that field are assumed
 * unencrypted and passed through unchanged, mirroring the original's
 * fallback. On decrypt failure, retries once against a freshly re-derived
 * key (the cached key may simply be stale) before giving up.
 */
export async function decryptTobeparsed(raw: string): Promise<string> {
  const match = raw.match(/"tobeparsed":"([^"]*)"/);
  if (!match) return raw;

  const attempt = async (forceRefresh: boolean): Promise<string> => {
    const { key } = await getKey(forceRefresh);
    const blob = Buffer.from(match[1]!, 'base64');
    const iv = blob.subarray(1, 13);
    const rest = blob.subarray(13);
    const tag = rest.subarray(rest.length - 16);
    const ciphertext = rest.subarray(0, rest.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  };

  try {
    return await attempt(false);
  } catch {
    try {
      return await attempt(true);
    } catch (cause) {
      throw new UpstreamSourceError('Could not decrypt allanime response (key derivation likely out of date).', cause);
    }
  }
}

/**
 * Ports `provider_init`'s hex-substitution decode. Verified: every one of
 * ani-cli's ~78 table entries checks out as exactly `char = byte ^ 0x38`,
 * so that's what this does instead of a literal lookup table.
 */
export function decodeProviderId(raw: string): string {
  if (!raw.startsWith('--')) return raw;

  let out = '';
  for (let i = 0; i < raw.length; i += 2) {
    const chunk = raw.slice(i, i + 2);
    if (chunk === '--') continue; // separator marker in the original, dropped
    const byte = parseInt(chunk, 16);
    if (Number.isNaN(byte)) continue;
    out += String.fromCharCode(byte ^ 0x38);
  }
  return out.replace('/clock', '/clock.json'); // first occurrence only, matches the original sed
}
