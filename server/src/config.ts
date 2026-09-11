import 'dotenv/config';

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(env('PORT', '8080')),
  allowedOrigin: env('ALLOWED_ORIGIN', 'http://localhost:4200'),

  /** Firebase Auth uid of the single account allowed to use this instance
   *  (README.md "Backend contract": "reject any uid but yours"). Empty
   *  means nothing will ever authenticate — see middleware/auth.ts. */
  ownerUid: env('OWNER_UID'),

  allanime: {
    // ani-cli's allanime domain rotates periodically; these are its
    // current values (pystardust/ani-cli "ani-cli" script) as of this
    // writing. Override via env if they've moved on.
    apiBase: env('ALLANIME_API_BASE', 'https://api.mkissa.net'),
    referer: env('ALLANIME_REFERER', 'https://mkissa.to'),
    userAgent: env(
      'ALLANIME_USER_AGENT',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
    ),
  },
} as const;
