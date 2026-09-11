import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { config } from '../config.js';
import { UpstreamSourceError } from './errors.js';

/**
 * ============================================================================
 * UNVERIFIED — read before touching /api/sources.
 * ============================================================================
 * Everything in this file ports ani-cli's `fetch_keys` / `get_aa_req` /
 * `process_tobeparsed` shell functions, which shell out to the `botan` CLI
 * for AES-256-GCM. This project has no network path to allanime and no
 * `botan` binary to diff against, so it was ported by reading the bash
 * source, not by running it. Two things in particular are assumptions
 * rather than confirmed facts:
 *
 *   1. `botan hash --no-fsname` is called with no --algo flag. This is
 *      assumed to mean SHA-256 (botan's documented default), used below
 *      for deriving the GCM IV. If decryption fails outright, this is the
 *      first thing to check against a real botan install (`botan help hash`).
 *   2. The GCM ciphertext/tag byte layout (tag = trailing 16 bytes, no
 *      AAD) is inferred from how the script slices botan's output with
 *      `dd`, not from botan's own documentation.
 *
 * Everything else here (the key-derivation steps, the aaReq payload shape,
 * the "tobeparsed" framing: 1 version byte + 12-byte IV + ciphertext+tag)
 * is a direct, faithful transcription of the shell source.
 *
 * If this endpoint starts failing, enable request logging and compare
 * against a real `ani-cli` run with `set -x` before assuming the *approach*
 * is wrong — it may just be a rotated constant (the mask lives in
 * allanime's JS bundle, so it changes whenever their frontend redeploys).
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
  const homepage = await fetchText(config.allanime.referer);

  const epochMatch = homepage.match(/"epoch":(\d+)/);
  const partBMatch = homepage.match(/"partB":"([^"]*)"/);
  const appUrlMatch = homepage.match(new RegExp(`${escapeRegExp(config.allanime.cdn)}/entry/app\\.[A-Za-z0-9_.-]+\\.js`));

  if (!epochMatch || !partBMatch || !appUrlMatch) {
    throw new UpstreamSourceError(
      "Could not find epoch/partB/app-bundle markers on allanime's homepage — its frontend shape may have changed.",
    );
  }

  const epoch = epochMatch[1]!;
  const partBHex = Buffer.from(partBMatch[1]!, 'base64').toString('hex');

  const appJs = await fetchText(appUrlMatch[0]);
  const chunkNames = [...appJs.matchAll(/"\.\.\/chunks\/([A-Za-z0-9_.-]+\.js)"/g)].slice(0, 5).map((m) => m[1]!);

  if (chunkNames.length === 0) {
    throw new UpstreamSourceError("Could not find any JS chunk references in allanime's app bundle.");
  }

  const chunkTexts = await Promise.all(chunkNames.map((name) => fetchText(`${config.allanime.cdn}/${name}`)));
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
