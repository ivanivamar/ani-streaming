/**
 * identity / domain — Account, session status, token rules, access allowlist.
 *
 * Pure TypeScript: no Angular, Firebase or RxJS imports (enforced by eslint-plugin-boundaries).
 * Ports (repository interfaces) are declared here or in application/ and implemented in
 * infrastructure/.
 */
export * from './account';
export * from './token-policy';
export * from './access-policy';
export * from './prefs';
