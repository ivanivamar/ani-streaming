import { chromium, type Browser } from 'playwright';
import { config } from '../config.js';
import { UpstreamSourceError } from './errors.js';

/**
 * A real headless-browser fetch — used only for the one step in
 * allanime-crypto.ts's `deriveKey()` that a plain `fetch()` can no longer
 * get past (see that file's "CONFIRMED BROKEN" note): allanime's homepage
 * is behind a Cloudflare bot-verification wall, and a JS-capable browser
 * with a real fingerprint has a shot at clearing its automatic challenge
 * where a plain HTTP client has none.
 *
 * Deliberately scoped to *just* "load the page for real": no stealth/
 * anti-detection plugin, no CAPTCHA-solving service, no IP rotation. If
 * Cloudflare still blocks a real browser, this returns whatever it actually
 * saw (a challenge page) exactly like a plain fetch would — the caller
 * treats that the same either way (see allanime-crypto.ts's marker check).
 *
 * One Chromium instance is kept warm across calls (launching it has real
 * latency) since `deriveKey()` itself is already rate-limited by the
 * 30-minute key cache in allanime-crypto.ts — this isn't invoked often. A
 * fresh browser context per call keeps cookies/state from leaking between
 * unrelated requests.
 */

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((err: unknown) => {
      browserPromise = null; // don't poison future attempts if this one failed to launch
      throw err;
    });
  }
  return browserPromise;
}

export interface BrowserFetchResult {
  html: string;
  /** `name=value; name2=value2`, suitable for a `Cookie` header — pass
   *  through to plain fetch() calls against the same site (notably
   *  Cloudflare's `cf_clearance`) so every follow-up request doesn't need
   *  its own browser page. */
  cookieHeader: string;
}

export async function browserFetch(url: string): Promise<BrowserFetchResult> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (cause) {
    throw new UpstreamSourceError(
      'Could not start the headless browser — is Chromium installed? Run `npx playwright install chromium` in server/.',
      cause,
    );
  }

  const context = await browser.newContext({ userAgent: config.allanime.userAgent });
  try {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (cause) {
      throw new UpstreamSourceError(`Could not reach ${url} via the headless browser.`, cause);
    }

    // Cloudflare's automatic JS challenge, when present, resolves and
    // redirects to the real page within a few seconds on its own — give it
    // room to do that instead of reading whatever loaded first. Not fatal
    // if the network never fully settles (trackers/analytics can keep a
    // tab "busy" indefinitely) — read whatever's there once this returns.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const html = await page.content();
    const cookies = await context.cookies(url);
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    return { html, cookieHeader };
  } finally {
    await context.close();
  }
}
