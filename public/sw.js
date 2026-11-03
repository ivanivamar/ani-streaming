/**
 * ani.stream service worker (ported from the music app's `app/public/sw.js`). Angular's own
 * @angular/service-worker isn't used: it can't proxy range requests.
 *
 * 1. Drive streaming proxy. <video src> can't send an Authorization header, so the player points it at
 *      /__drive/<fileId>?size=<bytes>&type=<mime>
 *    and this worker forwards each (range) request to the Drive API with the page's OAuth token.
 *    The token is asked from the page on every request (MessageChannel), so it's never stale and
 *    nothing is stored here. Seeking = a new range request = instant.
 *
 * 2. Offline app shell. `scripts/build-sw.mjs` (runs after `ng build`) fills BUILD, PRECACHE and
 *    ASSETS below in dist/. index.html, JS and CSS are cached on install; navigations get the cached
 *    index.html (SPA). A new deploy installs alongside and WAITS until the page sends
 *    `ani:skip-waiting` (the "New version · Reload" prompt, Step 7). The very first install
 *    activates immediately. On `ng serve` BUILD is null and none of this runs.
 *
 * `/api/` (the sign-in function), the Drive API, Google sign-in and other cross-origin requests
 * always go to the network.
 */
const BUILD = /*BUILD*/ null;
const PRECACHE = /*PRECACHE*/ [];
const ASSETS = /*ASSETS*/ [];

const MARK = '/__drive/';
const API = 'https://www.googleapis.com/drive/v3/files/';
const SHELL = `ani-shell-${BUILD}`;
const RUNTIME = 'ani-runtime';
const SCOPE = new URL(self.registration.scope);
const at = (path) => new URL(path, SCOPE).href;
/** Angular's hashed output: main-ABCD1234.js, chunk-….js, styles-….css, media/… */
const HASHED = /(^|\/)(main|chunk|polyfills|styles)-[A-Za-z0-9_-]{8}\.(js|css)$|^media\//;

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      if (BUILD) {
        const cache = await caches.open(SHELL);
        // cache: 'reload' skips the HTTP cache so a deploy never precaches a stale file
        await cache.addAll(PRECACHE.map((p) => new Request(at(p), { cache: 'reload' })));
      }
      // First install (nothing to replace) or dev: take over now. Updates wait for the page.
      if (!BUILD || !self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      if (BUILD) {
        for (const key of await caches.keys()) {
          if (key.startsWith('ani-shell-') && key !== SHELL) await caches.delete(key);
        }
        // drop runtime copies of files the current build no longer ships
        const known = new Set(ASSETS.map(at));
        const runtime = await caches.open(RUNTIME);
        for (const req of await runtime.keys()) if (!known.has(req.url)) await runtime.delete(req);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  const type = e.data && e.data.type;
  // a hard reload leaves the page uncontrolled; the page asks us to take it over
  if (type === 'ani:claim') e.waitUntil(self.clients.claim());
  // the user pressed "Reload" on the update prompt
  else if (type === 'ani:skip-waiting') e.waitUntil(self.skipWaiting());
  else if (type === 'ani:build' && e.ports[0]) e.ports[0].postMessage({ build: BUILD });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const mark = url.pathname.indexOf(MARK);
  if (mark >= 0) {
    e.respondWith(stream(e, decodeURIComponent(url.pathname.slice(mark + MARK.length)), url.searchParams));
    return;
  }
  if (!BUILD || req.method !== 'GET' || !url.href.startsWith(SCOPE.href)) return;
  // /api/ (the sign-in function) always goes to the network
  if (url.pathname.startsWith(`${SCOPE.pathname}api/`)) return;
  if (req.mode === 'navigate') e.respondWith(appShell(req));
  else e.respondWith(cacheFirst(req, url));
});

/** Navigations get this build's index.html (path routes: every page is index.html). */
async function appShell(req) {
  try {
    const cached = await caches.match(at('index.html'), { cacheName: SHELL });
    if (cached) return cached;
  } catch {
    /* fall through */
  }
  return fetch(req);
}

/** Hashed files never change: cache first, network once, keep it. */
async function cacheFirst(req, url) {
  const hit = (await caches.match(req, { cacheName: SHELL })) || (await caches.match(req, { cacheName: RUNTIME }));
  if (hit) return hit;
  const res = await fetch(req);
  const rel = url.pathname.slice(SCOPE.pathname.length);
  if (res.ok && HASHED.test(rel)) {
    const copy = res.clone();
    caches.open(RUNTIME).then((c) => c.put(req, copy));
  }
  return res;
}

async function askToken(clientId) {
  let clients = [];
  if (clientId) {
    const c = await self.clients.get(clientId);
    if (c) clients = [c];
  }
  if (!clients.length) clients = await self.clients.matchAll({ type: 'window' });
  for (const c of clients) {
    const token = await new Promise((resolve) => {
      const ch = new MessageChannel();
      // the page may renew the token first (sign-in helper), so allow a few seconds
      const timer = setTimeout(() => resolve(null), 8000);
      ch.port1.onmessage = (m) => {
        clearTimeout(timer);
        resolve((m.data && m.data.token) || null);
      };
      c.postMessage({ type: 'ani:token' }, [ch.port2]);
    });
    if (token) return token;
  }
  return null;
}

async function broadcast(msg) {
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage(msg);
}

/** Parse a single `bytes=a-b` / `bytes=a-` / `bytes=-n` range against a known size. */
function parseRange(header, size) {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return { start: 0, end: size - 1, partial: false };
  if (!m[1]) {
    const n = Math.min(Number(m[2]), size);
    return { start: size - n, end: size - 1, partial: true };
  }
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return { start, end, partial: true };
}

async function stream(e, fileId, params) {
  const size = Number(params.get('size')) || 0;
  const type = params.get('type') || 'video/mp4';
  const token = await askToken(e.clientId || e.resultingClientId);
  if (!token) {
    await broadcast({ type: 'ani:drive-401' });
    return new Response(null, { status: 401 });
  }

  const range = size ? parseRange(e.request.headers.get('range'), size) : null;
  if (range && range.start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const headers = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = `bytes=${range.start}-${range.end}`;
  else if (e.request.headers.get('range')) headers.Range = e.request.headers.get('range');

  let res;
  try {
    res = await fetch(`${API}${encodeURIComponent(fileId)}?alt=media`, { headers, signal: e.request.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    return new Response(null, { status: 502, statusText: 'Drive unreachable' });
  }
  if (res.status === 401) {
    await broadcast({ type: 'ani:drive-401' });
    return new Response(null, { status: 401 });
  }
  if (!res.ok) return new Response(null, { status: res.status, statusText: res.statusText });

  // Rebuild the response as a same-origin one with headers we control (Drive's CORS doesn't
  // necessarily expose Content-Range, and media elements need it to seek).
  const out = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  if (res.status === 206 && range) {
    const upstream = res.headers.get('content-range');
    const total = (upstream && Number(upstream.split('/')[1])) || size;
    out.set('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
    out.set('Content-Length', String(range.end - range.start + 1));
    return new Response(res.body, { status: 206, headers: out });
  }
  // Range ignored upstream: hand over the whole file
  if (size) out.set('Content-Length', String(size));
  return new Response(res.body, { status: 200, headers: out });
}
