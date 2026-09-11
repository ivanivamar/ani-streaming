/** A request-facing error with a specific HTTP status and stable code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * The upstream anime source (allanime, via ani-cli's approach) failed or
 * is unreachable. Kept distinct from other errors so the API can report a
 * stable status code the frontend maps to its "Source unavailable" state
 * (README.md "Backend contract": "Surface upstream failures as a distinct
 * status the UI maps to the 'Source unavailable' state rather than to an
 * empty result").
 */
export class UpstreamSourceError extends HttpError {
  constructor(message: string, readonly cause?: unknown) {
    super(502, message, 'source_unavailable');
    this.name = 'UpstreamSourceError';
  }
}
