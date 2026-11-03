/**
 * `npm run allow -w @ani/import -- <uid> [more uids…] [--remove]`
 *
 * Edits the app's allowlist `config/access.allowedUids` (Firestore rules let only listed uids read
 * the catalogue). The uid ("g" + Drive permission id) is shown on the app's sign-in screen after
 * the first Google sign-in. Uses the same service account as the importer.
 */
import fs from 'node:fs/promises';
import { COLLECTIONS, type AccessConfigDoc } from '@ani/contracts';
import { FIREBASE_PROJECT_ID, SERVICE_ACCOUNT_FILE } from './config.ts';

export async function allow(argv: string[]): Promise<void> {
  const remove = argv.includes('--remove');
  const uids = argv.filter((a) => !a.startsWith('--'));
  for (const uid of uids) {
    if (!/^g[\w-]+$/.test(uid)) throw new Error(`"${uid}" doesn't look like an ani.stream uid (they start with "g").`);
  }

  try {
    await fs.access(SERVICE_ACCOUNT_FILE);
  } catch {
    throw new Error(`Missing ${SERVICE_ACCOUNT_FILE} (Firebase → Project settings → Service accounts → Generate new private key).`);
  }
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const app = getApps()[0] ?? initializeApp({ credential: cert(SERVICE_ACCOUNT_FILE), projectId: FIREBASE_PROJECT_ID });
  const ref = getFirestore(app).collection(COLLECTIONS.config).doc('access');

  if (uids.length) {
    await ref.set(
      { allowedUids: remove ? FieldValue.arrayRemove(...uids) : FieldValue.arrayUnion(...uids) },
      { merge: true },
    );
  }
  const list = ((await ref.get()).data() as AccessConfigDoc | undefined)?.allowedUids ?? [];
  console.log(`config/access.allowedUids (${list.length}):${list.map((u) => `\n  ${u}`).join('') || ' (empty)'}`);
}
