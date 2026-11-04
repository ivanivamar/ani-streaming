/**
 * identity / application — public API of the identity context.
 *
 * Other contexts and the shell may import only from this file, never from another
 * context's domain/, infrastructure/ or ui/.
 */
export { SessionStore } from './session.store';
export { PrefsStore } from './prefs.store';
export { requireAccess, requireProfile } from './guards';
export {
  AccessPort,
  AuthHelperError,
  AuthHelperPort,
  FirebaseSessionPort,
  GoogleIdentityPort,
  GoogleProfilePort,
  SessionPersistencePort,
  UserProfilePort,
  type GoogleTokens,
  type PopupOptions,
} from './ports';
export { DEFAULT_PREFS, withDefaults, type Prefs, type UserDoc, type SubtitleMode, type WatchedThreshold } from '../domain';
export { safeNext, type AccessGate, type Account, type ConnectionPhase, type SessionStatus } from '../domain';
