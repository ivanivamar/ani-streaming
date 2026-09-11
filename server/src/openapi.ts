/**
 * Hand-written OpenAPI 3.0 description of the /api/* surface (README.md
 * "Backend contract"). Kept as a plain object rather than generated from
 * JSDoc comments on the routes — with only four endpoints, this is easier
 * to keep accurate than a comment-parsing step, and it's the single
 * source of truth both Swagger UI and /openapi.json serve.
 *
 * Update this alongside any route change in src/routes/*.ts.
 */

const errorResponse = {
  description: 'Error — see the `code` field for the specific failure.',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      examples: {
        default: { value: { error: { code: 'bad_request', message: 'Query parameter "q" is required.' } } },
      },
    },
  },
};

const unauthenticated = {
  description: 'Missing or invalid bearer token.',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      examples: { default: { value: { error: { code: 'unauthenticated', message: 'Missing bearer token.' } } } },
    },
  },
};

const forbidden = {
  description: 'Token is valid but not for the account this instance is locked to.',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      examples: { default: { value: { error: { code: 'forbidden', message: 'This instance is single-user.' } } } },
    },
  },
};

const sourceUnavailable = {
  description:
    'The upstream anime source (allanime) failed or is unreachable — maps to the frontend\'s "Source unavailable" state rather than an empty result.',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      examples: {
        default: { value: { error: { code: 'source_unavailable', message: 'allanime API responded with HTTP 503.' } } },
      },
    },
  },
};

const dubParam = {
  name: 'dub',
  in: 'query',
  description: 'Any of "true"/"1" selects the dub audio track; anything else (including absent) means sub.',
  schema: { type: 'string', example: 'true' },
};

export const openApiSpec: Record<string, unknown> = {
  openapi: '3.0.3',
  info: {
    title: 'ani.stream API',
    version: '0.1.0',
    description:
      'Backend for the ani.stream Angular app (README.md "Backend contract"). Scrapes allanime the way ' +
      'ani-cli does, ported into Node rather than shelling out to the script. Every /api/* route requires a ' +
      'Firebase ID token for the single account this instance is locked to.',
  },
  servers: [{ url: '/api', description: 'Same-origin (via a Hosting rewrite in production, or ALLOWED_ORIGIN in dev)' }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'search', description: 'GET /api/search' },
    { name: 'episodes', description: 'GET /api/episodes' },
    { name: 'sources', description: 'GET /api/sources' },
    { name: 'proxy', description: 'GET /api/proxy' },
  ],
  paths: {
    '/search': {
      get: {
        tags: ['search'],
        summary: 'Search allanime, one row per season entry',
        description:
          'allanime lists every season of a show as its own search result (data-sources.md "Seasons as a ' +
          'grouping"); no client-side grouping happens server-side.',
        parameters: [
          { name: 'q', in: 'query', required: true, description: 'Search text.', schema: { type: 'string', example: 'frieren' } },
          dubParam,
        ],
        responses: {
          '200': {
            description: 'Matching entries.',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/SearchEntry' } },
                examples: {
                  default: {
                    value: [{ entryId: 'aBcD123', title: 'Frieren: Beyond Journey’s End', episodes: 28 }],
                  },
                },
              },
            },
          },
          '400': errorResponse,
          '401': unauthenticated,
          '403': forbidden,
          '502': sourceUnavailable,
        },
      },
    },
    '/episodes': {
      get: {
        tags: ['episodes'],
        summary: 'Title + available episode numbers for one entry',
        description:
          '`title` is a deliberate extension beyond the README\'s literal `[episodeNumber]` shape — the ' +
          'anime-detail and watch screens are reachable by direct URL (refresh, a shared link, back-navigation ' +
          "from the player) with no title already in hand, and there's no separate \"get one show by id\" " +
          'endpoint. `episodes` is ascending but not necessarily consecutive integers — allanime encodes ' +
          'specials as decimals (e.g. 12.5) slotted between two regular episodes.',
        parameters: [
          { name: 'entryId', in: 'query', required: true, schema: { type: 'string', example: 'aBcD123' } },
          dubParam,
        ],
        responses: {
          '200': {
            description: 'Title and ascending episode numbers.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EpisodeList' },
                examples: {
                  default: { value: { title: 'Frieren: Beyond Journey’s End', episodes: [1, 2, 3, 4, 5, 6, 7, 12.5, 13] } },
                },
              },
            },
          },
          '400': errorResponse,
          '401': unauthenticated,
          '403': forbidden,
          '502': sourceUnavailable,
        },
      },
    },
    '/sources': {
      get: {
        tags: ['sources'],
        summary: 'Resolve a playable URL for one episode at a chosen quality',
        description:
          'UNVERIFIED against a live run — see src/lib/allanime-crypto.ts. `headers` is metadata the caller ' +
          'must pass along to /api/proxy (as `referer`) so it can re-attach it when actually fetching bytes; a ' +
          "browser can't set Referer/Origin itself.",
        parameters: [
          { name: 'entryId', in: 'query', required: true, schema: { type: 'string', example: 'aBcD123' } },
          { name: 'ep', in: 'query', required: true, description: 'Episode number, as a string.', schema: { type: 'string', example: '7' } },
          dubParam,
          {
            name: 'q',
            in: 'query',
            description: '"best" (default), "worst", or a substring match against a quality label (e.g. "720").',
            schema: { type: 'string', default: 'best', example: '1080' },
          },
        ],
        responses: {
          '200': {
            description: 'The resolved source for the requested quality.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SourcesResponse' },
                examples: {
                  default: {
                    value: {
                      url: 'https://example-cdn.invalid/aBcD123/1080/mp4/file.mp4',
                      headers: { Referer: 'https://mkissa.to', Origin: 'https://mkissa.to' },
                    },
                  },
                },
              },
            },
          },
          '400': errorResponse,
          '401': unauthenticated,
          '403': forbidden,
          '404': { description: 'No playable source found for this episode.', content: errorResponse.content },
          '502': sourceUnavailable,
        },
      },
    },
    '/proxy': {
      get: {
        tags: ['proxy'],
        summary: 'Stream a video source with Referer/Origin re-added',
        description:
          'm3u8 playlists are rewritten so every URL they reference (segments, sub-playlists, key/media URIs) ' +
          'also routes back through this endpoint — otherwise hls.js would hit the CDN directly and get ' +
          'rejected for missing headers. Everything else streams through unmodified. Supports Range requests.',
        parameters: [
          { name: 'url', in: 'query', required: true, description: 'Target URL — typically /api/sources’s `url`.', schema: { type: 'string', format: 'uri' } },
          {
            name: 'referer',
            in: 'query',
            description: 'Defaults to the standard allanime referer. Pass /api/sources’s `headers.Referer` through here.',
            schema: { type: 'string', format: 'uri' },
          },
          {
            name: 'token',
            in: 'query',
            description:
              'Alternative to the Authorization header, for <video>/hls.js requests that can\'t set one ' +
              '(see server/src/middleware/auth.ts). Not needed when calling this with a bearer token instead.',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'The proxied playlist or media, unmodified except for m3u8 URL rewriting.',
            content: {
              'application/vnd.apple.mpegurl': { schema: { type: 'string' } },
              'video/mp2t': { schema: { type: 'string', format: 'binary' } },
              'video/mp4': { schema: { type: 'string', format: 'binary' } },
            },
          },
          '206': { description: 'Partial content — returned when the request includes a Range header.' },
          '400': errorResponse,
          '401': unauthenticated,
          '403': forbidden,
          '502': sourceUnavailable,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Firebase ID token',
        description:
          'A Firebase Authentication ID token for the single account this instance is locked to (OWNER_UID). ' +
          'Any other valid token is rejected with 403.',
      },
    },
    schemas: {
      SearchEntry: {
        type: 'object',
        required: ['entryId', 'title', 'episodes'],
        properties: {
          entryId: { type: 'string' },
          title: { type: 'string' },
          episodes: { type: 'integer', description: 'Episode count for the requested audio track.' },
        },
      },
      EpisodeList: {
        type: 'object',
        required: ['title', 'episodes'],
        properties: {
          title: { type: 'string' },
          episodes: { type: 'array', items: { type: 'number' }, description: 'Ascending; may include decimals.' },
        },
      },
      SourcesResponse: {
        type: 'object',
        required: ['url', 'headers'],
        properties: {
          url: { type: 'string', format: 'uri' },
          headers: {
            type: 'object',
            required: ['Referer', 'Origin'],
            properties: { Referer: { type: 'string' }, Origin: { type: 'string' } },
          },
        },
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: { code: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
  },
};
