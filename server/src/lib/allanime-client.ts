import { config } from '../config.js';
import { UpstreamSourceError } from './errors.js';
import { EPISODE_SOURCES_QUERY_HASH, buildAaReq, decodeProviderId, decryptTobeparsed } from './allanime-crypto.js';

export type AudioMode = 'sub' | 'dub';

/**
 * Thin client for the GraphQL API ani-cli scrapes (data-sources.md
 * "ani-cli (pystardust/ani-cli, scrapes allanime)"; README.md "Backend
 * contract": "Prefer porting allanime scraping into Node over shelling
 * out to the ani-cli script"). Ported from that script's `search_anime`/
 * `episodes_list` functions rather than reverse-engineered from scratch —
 * see config.ts for the base URL/referer this depends on, and why it's
 * configurable rather than hardcoded.
 */

const SEARCH_QUERY = `query(
  $search: SearchInput
  $limit: Int
  $page: Int
  $translationType: VaildTranslationTypeEnumType
  $countryOrigin: VaildCountryOriginEnumType
) {
  shows(
    search: $search
    limit: $limit
    page: $page
    translationType: $translationType
    countryOrigin: $countryOrigin
  ) {
    edges {
      _id
      name
      availableEpisodes
      airedStart
      __typename
    }
  }
}`;

interface AllanimeShowEdge {
  _id: string;
  name: string;
  /** Episode counts per audio track, e.g. `{ sub: 25, dub: 25 }`. Missing
   *  or zero for a track means that dub/sub doesn't exist for this entry. */
  availableEpisodes?: Partial<Record<AudioMode | 'raw', number>>;
}

interface AllanimeSearchResponse {
  data?: { shows?: { edges?: AllanimeShowEdge[] } };
  errors?: { message: string }[];
}

/** POSTs one GraphQL request against the allanime API ani-cli uses. */
async function allanimeGql<T>(query: string, variables: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.allanime.apiBase}/api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: config.allanime.referer,
        Origin: config.allanime.referer,
        'User-Agent': config.allanime.userAgent,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (cause) {
    throw new UpstreamSourceError('Could not reach the allanime API.', cause);
  }

  if (!response.ok) {
    throw new UpstreamSourceError(`allanime API responded with HTTP ${response.status}.`);
  }

  let json: T & { errors?: { message: string }[] };
  try {
    json = (await response.json()) as T & { errors?: { message: string }[] };
  } catch (cause) {
    throw new UpstreamSourceError('allanime API returned a non-JSON response.', cause);
  }

  if (json.errors?.length) {
    throw new UpstreamSourceError(`allanime API returned an error: ${json.errors[0]?.message}`);
  }

  return json;
}

export interface SearchEntry {
  entryId: string;
  title: string;
  episodes: number;
}

/**
 * `GET /api/search?q=&dub=` (README.md "Backend contract"). One row per
 * season entry — allanime lists every season of a show as its own search
 * result (data-sources.md "Seasons as a grouping"), so no client-side
 * grouping happens here; the frontend already treats each entry as a
 * distinct card (see CatalogService.toCard in the Angular app).
 */
export async function searchShows(query: string, audio: AudioMode): Promise<SearchEntry[]> {
  const response = await allanimeGql<AllanimeSearchResponse>(SEARCH_QUERY, {
    search: { allowAdult: false, allowUnknown: false, query },
    limit: 40,
    page: 1,
    translationType: audio,
    countryOrigin: 'ALL',
  });

  const edges = response.data?.shows?.edges ?? [];
  return edges
    .map((edge): SearchEntry => ({
      entryId: edge._id,
      title: edge.name,
      episodes: edge.availableEpisodes?.[audio] ?? 0,
    }))
    .filter((entry) => entry.episodes > 0); // no episodes in this audio track = not a real result
}

const EPISODES_QUERY = `query ($showId: String!) {
  show(_id: $showId) {
    _id
    availableEpisodesDetail
  }
}`;

interface AllanimeEpisodesResponse {
  data?: {
    show?: {
      _id: string;
      /** Episode identifiers per audio track, as strings — allanime uses
       *  decimal numbers like "12.5" for specials slotted between two
       *  regular episodes, so these aren't always consecutive integers. */
      availableEpisodesDetail?: Partial<Record<AudioMode | 'raw', string[]>>;
    };
  };
  errors?: { message: string }[];
}

/**
 * `GET /api/episodes?entryId=&dub=` (README.md "Backend contract").
 * Returns the episode numbers available for one audio track, ascending.
 */
export async function listEpisodes(entryId: string, audio: AudioMode): Promise<number[]> {
  const response = await allanimeGql<AllanimeEpisodesResponse>(EPISODES_QUERY, { showId: entryId });

  const raw = response.data?.show?.availableEpisodesDetail?.[audio] ?? [];
  return raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

// ============================================================================
// /api/sources — see lib/allanime-crypto.ts's file-level note first. This
// endpoint is a faithful-as-possible port of ani-cli's get_episode_url /
// generate_link / get_links / select_quality, but it's the one piece of
// this backend that could not be exercised against the real service from
// here. Treat it as a first draft to debug against a live run.
// ============================================================================

interface RawSourcePair {
  sourceName: string;
  sourceUrl: string;
}

/** allanime's literal `sourceName` values → the provider each names, in
 *  ani-cli's own priority order (its `generate_link` cases 1-4). */
const PROVIDER_LABELS: [label: string, provider: string][] = [
  ['Default', 'wixmp'],
  ['Yt-mp4', 'youtube'],
  ['S-mp4', 'sharepoint'],
  ['Mp4', 'mp4upload'],
];

export interface SourceCandidate {
  /** A resolution ("1080"), a provider tag ("hls", "Yt", "Mp4Upload") —
   *  whatever ani-cli would have printed to the left of ">" in its list. */
  quality: string;
  url: string;
  /** Referer the *next* hop (the /api/proxy endpoint, once it exists)
   *  needs to re-attach when actually fetching this url's bytes. */
  referer: string;
}

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

/** The signed, persisted-query-hash GraphQL call for one episode's raw
 *  source list (ani-cli's `get_episode_url`, minus the provider fan-out). */
async function fetchEpisodeSourcePairs(showId: string, audio: AudioMode, episodeString: string): Promise<RawSourcePair[]> {
  const aaReq = await buildAaReq();
  const variables = `{"showId":"${showId}","translationType":"${audio}","episodeString":"${episodeString}"}`;
  const extensions = `{"persistedQuery":{"version":1,"sha256Hash":"${EPISODE_SOURCES_QUERY_HASH}"},"aaReq":"${aaReq}"}`;

  const url = new URL(`${config.allanime.apiBase}/api`);
  url.searchParams.set('variables', variables);
  url.searchParams.set('extensions', extensions);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Referer: config.allanime.referer,
        Origin: config.allanime.referer,
        'User-Agent': config.allanime.userAgent,
      },
    });
  } catch (cause) {
    throw new UpstreamSourceError('Could not reach the allanime API.', cause);
  }
  if (!response.ok) {
    throw new UpstreamSourceError(`allanime API responded with HTTP ${response.status}.`);
  }

  const decrypted = await decryptTobeparsed(await response.text());
  return extractSourcePairs(decrypted);
}

/** Parses whatever JSON shape carries sourceUrl/sourceName pairs. ani-cli
 *  itself uses a generic brace-splitting regex here rather than structural
 *  parsing — read as a signal the exact shape isn't fixed/documented — so
 *  this does the same generically: try real JSON.parse + a recursive walk
 *  for the two keys, and only fall back to regex scanning if that yields
 *  nothing (e.g. the payload isn't strictly valid JSON). */
function extractSourcePairs(text: string): RawSourcePair[] {
  try {
    const parsed: unknown = JSON.parse(text);
    const pairs: RawSourcePair[] = [];
    collectSourcePairs(parsed, pairs);
    if (pairs.length > 0) return pairs;
  } catch {
    // fall through to regex
  }

  const pairs: RawSourcePair[] = [];
  const pattern = /"sourceUrl":"([^"]*)"[^}]*"sourceName":"([^"]*)"/g;
  for (const match of text.matchAll(pattern)) {
    pairs.push({ sourceUrl: unescapeSourceUrl(match[1]!), sourceName: match[2]! });
  }
  return pairs;
}

function collectSourcePairs(value: unknown, out: RawSourcePair[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSourcePairs(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const obj = value as Record<string, unknown>;
  if (typeof obj['sourceUrl'] === 'string' && typeof obj['sourceName'] === 'string') {
    out.push({ sourceUrl: unescapeSourceUrl(obj['sourceUrl']), sourceName: obj['sourceName'] });
  }
  for (const v of Object.values(obj)) collectSourcePairs(v, out);
}

function unescapeSourceUrl(value: string): string {
  return value.replace(/\\u002F/g, '/').replace(/\\/g, '');
}

/** wixmp's "repackager" CDN encodes every available resolution as one
 *  templated URL, e.g. `.../,360,480,720,1080,p,/mp4/file.mp4.urlset` —
 *  expand it into one concrete URL per resolution (ani-cli's inline sed
 *  in get_links's `*repackager.wixmp.com*` case). */
function expandWixmpQualities(sourceUrl: string, referer: string): SourceCandidate[] {
  const withoutHost = sourceUrl.replace(/^https?:\/\/repackager\.wixmp\.com\//, '');
  const withoutSuffix = withoutHost.replace(/\.urlset.*$/, '');
  const listMatch = withoutSuffix.match(/\/,([^/]*),\/mp4/);
  if (!listMatch) return [];

  const resolutions = listMatch[1]!.split(',').filter((token) => /^\d+$/.test(token));
  return resolutions.map((quality) => ({
    quality,
    url: withoutSuffix.replace(/,[^/]*/, quality),
    referer,
  }));
}

/** Depth-first search for a `"Referer": "..."` field anywhere in the
 *  clock.json response, alongside an m3u8 master playlist (ani-cli reads
 *  this out for its own m3u8_refr). Falls back to the standard allanime
 *  referer when absent. */
function findRefererField(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRefererField(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj['Referer'] === 'string') return obj['Referer'];
    for (const v of Object.values(obj)) {
      const found = findRefererField(v);
      if (found) return found;
    }
  }
  return null;
}

function collectQualityLinks(value: unknown, out: SourceCandidate[], referer: string): void {
  if (Array.isArray(value)) {
    for (const item of value) collectQualityLinks(item, out, referer);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const obj = value as Record<string, unknown>;

  if (typeof obj['link'] === 'string' && typeof obj['resolutionStr'] === 'string') {
    if (obj['link'].includes('repackager.wixmp.com')) {
      out.push(...expandWixmpQualities(obj['link'], referer));
    } else {
      out.push({ quality: obj['resolutionStr'], url: obj['link'], referer });
    }
  }

  if (typeof obj['url'] === 'string' && obj['hardsub_lang'] === 'en-US' && obj['url'].includes('.m3u8')) {
    // Hand the master playlist straight to hls.js on the frontend rather
    // than parsing #EXT-X-STREAM-INF variants ourselves — hls.js already
    // does ABR/quality switching from a master playlist natively, which
    // is most of what that extra parsing step in ani-cli exists for.
    out.push({ quality: 'hls', url: obj['url'], referer });
  }

  for (const v of Object.values(obj)) collectQualityLinks(v, out, referer);
}

/** youtube/sharepoint/wixmp's shared "default" resolution path: the
 *  decoded provider id is a path on `clockBase` returning JSON with
 *  resolution/link pairs (ani-cli's get_links default case). */
async function resolveClockJson(path: string): Promise<SourceCandidate[]> {
  const url = /^https?:\/\//.test(path) ? path : `${config.allanime.clockBase}${path}`;
  const raw = await fetchText(url, { Referer: config.allanime.referer });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const referer = findRefererField(parsed) ?? config.allanime.referer;
  const candidates: SourceCandidate[] = [];
  collectQualityLinks(parsed, candidates, referer);
  return candidates;
}

/** mp4upload embeds its file URL in a `src: "..."` JS assignment on its
 *  embed page rather than exposing an API (ani-cli's `*mp4upload*` case). */
async function resolveMp4upload(url: string): Promise<SourceCandidate[]> {
  const html = await fetchText(url, { Referer: config.allanime.referer });
  const match = html.match(/src:\s*"([^"]*)"/);
  if (!match) return [];
  return [{ quality: 'Mp4Upload', url: match[1]!, referer: 'https://www.mp4upload.com' }];
}

async function resolveProvider(decoded: string): Promise<SourceCandidate[]> {
  if (decoded.includes('mp4upload')) return resolveMp4upload(decoded);
  if (decoded.includes('tools.fast4speed.rsvp')) {
    return [{ quality: 'Yt', url: decoded, referer: config.allanime.referer }];
  }
  return resolveClockJson(decoded);
}

/**
 * All playable source candidates for one episode, across every provider
 * allanime offers (ani-cli's `generate_link` fan-out). One provider
 * failing doesn't sink the others, matching the original running all four
 * in parallel and merging whatever came back.
 */
export async function fetchSources(entryId: string, audio: AudioMode, episode: string): Promise<SourceCandidate[]> {
  const pairs = await fetchEpisodeSourcePairs(entryId, audio, episode);

  const byLabel = new Map<string, RawSourcePair>();
  for (const pair of pairs) {
    if (!byLabel.has(pair.sourceName)) byLabel.set(pair.sourceName, pair); // first match wins, mirrors ani-cli's `head -1`
  }

  const results: SourceCandidate[] = [];
  for (const [label, provider] of PROVIDER_LABELS) {
    const pair = byLabel.get(label);
    if (!pair) continue;

    try {
      const decoded = decodeProviderId(pair.sourceUrl);
      results.push(...(await resolveProvider(decoded)));
    } catch (err) {
      console.warn(`[sources] provider "${provider}" failed:`, err);
    }
  }
  return results;
}

/**
 * Picks one candidate for the requested quality (ani-cli's
 * `select_quality`): "best" = highest numeric resolution, "worst" =
 * lowest numeric resolution, anything else = first candidate whose
 * quality label contains it, falling back to best when nothing matches.
 */
export function pickSource(candidates: SourceCandidate[], quality: string): SourceCandidate | null {
  if (candidates.length === 0) return null;

  const numeric = (c: SourceCandidate): number => {
    const n = Number(c.quality);
    return Number.isFinite(n) ? n : -1;
  };
  const sortedDesc = [...candidates].sort((a, b) => numeric(b) - numeric(a));
  const best = sortedDesc[0]!;

  if (quality === 'best' || !quality) return best;
  if (quality === 'worst') {
    const numericOnly = sortedDesc.filter((c) => /^\d{3,4}$/.test(c.quality));
    return numericOnly.at(-1) ?? best;
  }
  return sortedDesc.find((c) => c.quality.includes(quality)) ?? best;
}
