import { Injectable } from '@angular/core';
import { SessionPersistencePort } from '../application/ports';
import type { StoredSession } from '../domain';

const KEY = 'ani.session.v1';

/**
 * The Google session in localStorage, so a reload stays signed in. Holds the 1-hour access token
 * only; the refresh token never leaves the helper's HttpOnly cookie.
 */
@Injectable()
export class LocalSessionPersistence extends SessionPersistencePort {
  read(): StoredSession | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      return null;
    }
  }

  write(session: StoredSession | null): void {
    try {
      if (session) localStorage.setItem(KEY, JSON.stringify(session));
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode: the session lasts until reload */
    }
  }
}
