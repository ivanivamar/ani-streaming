import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by middleware/auth.ts once the bearer token's owner is verified. */
    uid?: string;
  }
}
