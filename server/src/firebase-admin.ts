import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';

/**
 * Initializes firebase-admin once. Locally, point
 * `GOOGLE_APPLICATION_CREDENTIALS` at a service account key (see
 * .env.example); on Cloud Run, `applicationDefault()` picks up the
 * attached service account automatically — nothing else to configure.
 */
export function initFirebaseAdmin(): void {
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault() });
  }
}
