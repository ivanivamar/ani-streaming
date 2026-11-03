/**
 * identity / application — public API of the identity context.
 *
 * Other contexts and the shell may import only from this file, never from another
 * context's domain/, infrastructure/ or ui/.
 */
export { SessionStore } from './session.store';
export { requireAccess } from './guards';
export {
  AccessPort,
  AuthHelperError,
  AuthHelperPort,
  FirebaseSessionPort,
  GoogleIdentityPort,
  GoogleProfilePort,
  SessionPersistencePort,
  type GoogleTokens,
  type PopupOptions,
} from './ports';
export { safeNext, type AccessGate, type Account, type ConnectionPhase, type SessionStatus } from '../domain';
