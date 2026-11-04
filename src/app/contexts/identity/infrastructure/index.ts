/**
 * identity / infrastructure — Google Identity Services, sign-in helper client, Firebase custom-token
 * sign-in, `config/access` check.
 *
 * Implements the ports declared in domain/ and application/; wired through `provideIdentity()`
 * in app.config.ts. Never imported by ui/.
 */
export { provideIdentity } from './identity.providers';
