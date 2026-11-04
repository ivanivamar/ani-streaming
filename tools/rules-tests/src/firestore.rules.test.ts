/**
 * firestore.rules against the emulator. Run from the repo root: `npm run test:rules`
 * (starts the Firestore emulator for project `demo-ani`, runs these, stops it). Needs Java 21+.
 *
 * Writes use the same shapes as the app's Firestore repositories (library, identity, releases,
 * importing) so a rules change that would break the app fails here first.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

type Db = firebase.firestore.Firestore;
const { Timestamp } = firebase.firestore;

const ALICE = 'gAlice';
const BOB = 'gBob';
const MALLORY = 'gMallory'; // signed in, not on the allowlist

const now = () => Timestamp.fromMillis(Date.now());
const profile = (over: Record<string, unknown> = {}) => ({
  displayName: 'Alice',
  email: 'alice@example.com',
  photoURL: null,
  createdAt: Timestamp.fromMillis(1_790_000_000_000),
  prefs: { autoplayNext: true, autoSkipIntro: false, subtitles: 'full', resume: true, watchedThreshold: 0.9 },
  ...over,
});
const progress = (over: Record<string, unknown> = {}) => ({ position: 312.4, duration: 1420, updatedAt: now(), ...over });

let env: RulesTestEnvironment;
const as = (uid: string): Db => env.authenticatedContext(uid).firestore();
const anon = (): Db => env.unauthenticatedContext().firestore();

async function seed(write: (db: Db) => Promise<unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await write(ctx.firestore());
  });
}

beforeAll(async () => {
  const host = process.env['FIRESTORE_EMULATOR_HOST'] ?? '127.0.0.1:8085';
  const [h, p] = host.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-ani',
    firestore: {
      rules: readFileSync(fileURLToPath(new URL('../../../firestore.rules', import.meta.url)), 'utf8'),
      host: h,
      port: Number(p),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    await db.doc('config/access').set({ allowedUids: [ALICE, BOB] });
    await db.doc('series/aoashi').set({ title: 'Aoashi', searchTokens: ['aoashi'] });
    await db.doc('series/aoashi/seasons/s01').set({ number: 1 });
    await db.doc('series/aoashi/episodes/s01e01').set({ season: 1, number: 1 });
    await db.doc('importState/abc').set({ status: 'done' });
    await db.doc(`users/${BOB}`).set(profile({ displayName: 'Bob' }));
    await db.doc(`users/${BOB}/progress/aoashi_s01e01`).set(progress());
  });
});

describe('config/access', () => {
  it('is readable only by listed uids', async () => {
    await assertSucceeds(as(ALICE).doc('config/access').get());
    await assertFails(as(MALLORY).doc('config/access').get());
    await assertFails(anon().doc('config/access').get());
  });

  it('is never writable from the app', async () => {
    await assertFails(as(ALICE).doc('config/access').set({ allowedUids: [ALICE, MALLORY] }));
  });
});

describe('catalogue', () => {
  it('is readable by allowlisted users, series and sub-collections', async () => {
    const db = as(ALICE);
    await assertSucceeds(db.collection('series').get());
    await assertSucceeds(db.doc('series/aoashi/seasons/s01').get());
    await assertSucceeds(db.collection('series/aoashi/episodes').get());
    await assertSucceeds(db.collection('series').where('searchTokens', 'array-contains', 'aoashi').get());
  });

  it('is hidden from everyone else', async () => {
    await assertFails(as(MALLORY).doc('series/aoashi').get());
    await assertFails(as(MALLORY).collection('series/aoashi/episodes').get());
    await assertFails(anon().collection('series').get());
  });

  it('is written only by the importer', async () => {
    const db = as(ALICE);
    await assertFails(db.doc('series/aoashi').update({ title: 'x' }));
    await assertFails(db.doc('series/new').set({ title: 'x' }));
    await assertFails(db.doc('series/aoashi/episodes/s01e02').set({ season: 1, number: 2 }));
    await assertFails(db.doc('series/aoashi').delete());
  });

  it('keeps importState importer-only', async () => {
    await assertFails(as(ALICE).doc('importState/abc').get());
    await assertFails(as(ALICE).doc('importState/abc').set({ status: 'pending' }));
  });

  it('denies unknown collections', async () => {
    await assertFails(as(ALICE).doc('other/x').get());
    await assertFails(as(ALICE).doc('other/x').set({ a: 1 }));
  });
});

describe('users/{uid} profile', () => {
  it('owner creates, reads and updates prefs (Welcome, Settings)', async () => {
    const db = as(ALICE);
    await assertSucceeds(db.doc(`users/${ALICE}`).set(profile()));
    await assertSucceeds(db.doc(`users/${ALICE}`).get());
    await assertSucceeds(
      db.doc(`users/${ALICE}`).update({
        prefs: { autoplayNext: false, autoSkipIntro: true, subtitles: 'signs', resume: false, watchedThreshold: 0.95 },
      }),
    );
  });

  it('accepts partial prefs and null profile fields', async () => {
    await assertSucceeds(
      as(ALICE).doc(`users/${ALICE}`).set(profile({ displayName: null, email: null, prefs: { subtitles: 'off' } })),
    );
  });

  it('rejects bad shapes', async () => {
    const db = as(ALICE);
    await assertFails(db.doc(`users/${ALICE}`).set(profile({ admin: true })));
    await assertFails(db.doc(`users/${ALICE}`).set(profile({ createdAt: 123 })));
    await assertFails(db.doc(`users/${ALICE}`).set(profile({ prefs: { subtitles: 'dub' } })));
    await assertFails(db.doc(`users/${ALICE}`).set(profile({ prefs: { watchedThreshold: 0.5 } })));
    await assertFails(db.doc(`users/${ALICE}`).set(profile({ prefs: { autoplayNext: 'yes' } })));
    await assertFails(db.doc(`users/${ALICE}`).set(profile({ prefs: { quality: '1080p' } })));
    const { prefs: _p, ...noPrefs } = profile();
    await assertFails(db.doc(`users/${ALICE}`).set(noPrefs));
  });

  it('keeps createdAt fixed', async () => {
    await seed((db) => db.doc(`users/${ALICE}`).set(profile()));
    await assertFails(as(ALICE).doc(`users/${ALICE}`).update({ createdAt: now() }));
  });

  it("is private to its owner and to allowlisted users", async () => {
    await assertFails(as(ALICE).doc(`users/${BOB}`).get());
    await assertFails(as(ALICE).doc(`users/${BOB}`).set(profile()));
    await assertFails(as(ALICE).collection(`users/${BOB}/progress`).get());
    await assertFails(as(MALLORY).doc(`users/${MALLORY}`).set(profile()));
    await assertFails(anon().doc(`users/${BOB}`).get());
    await assertFails(as(ALICE).collection('users').get());
  });
});

describe('users/{uid}/progress', () => {
  const path = `users/${ALICE}/progress`;

  it('accepts what ProgressTracker and "Mark as watched" write', async () => {
    const db = as(ALICE);
    await assertSucceeds(db.doc(`${path}/aoashi_s01e01`).set(progress()));
    await assertSucceeds(db.doc(`${path}/attack-on-titan_s04e28`).set(progress({ position: 1420 })));
    await assertSucceeds(db.doc(`${path}/x_s01e100`).set(progress({ position: 0, duration: 1 })));
    await assertSucceeds(db.collection(path).get());
  });

  it('rejects bad ids and values', async () => {
    const db = as(ALICE);
    await assertFails(db.doc(`${path}/aoashi-s01e01`).set(progress()));
    await assertFails(db.doc(`${path}/Aoashi_s01e01`).set(progress()));
    await assertFails(db.doc(`${path}/aoashi_e01`).set(progress()));
    await assertFails(db.doc(`${path}/aoashi_s01e01`).set(progress({ position: -1 })));
    await assertFails(db.doc(`${path}/aoashi_s01e01`).set(progress({ duration: 0 })));
    await assertFails(db.doc(`${path}/aoashi_s01e01`).set(progress({ position: 5000 })));
    await assertFails(db.doc(`${path}/aoashi_s01e01`).set(progress({ position: '12' })));
    await assertFails(db.doc(`${path}/aoashi_s01e01`).set(progress({ updatedAt: Date.now() })));
    await assertFails(db.doc(`${path}/aoashi_s01e01`).set(progress({ extra: 1 })));
  });
});

describe('users/{uid}/library, favourites, recent, notify', () => {
  const u = `users/${ALICE}`;

  it('accept the app shapes', async () => {
    const db = as(ALICE);
    await assertSucceeds(db.doc(`${u}/library/aoashi`).set({ status: 'watching', watched: 3, updatedAt: now() }));
    await assertSucceeds(db.doc(`${u}/library/aoashi`).set({ status: 'paused', watched: 0, updatedAt: now() }));
    await assertSucceeds(db.doc(`${u}/favourites/aoashi`).set({ addedAt: now() }));
    await assertSucceeds(db.doc(`${u}/recent/r1abc`).set({ term: 'aoashi', at: now() }));
    await assertSucceeds(db.doc(`${u}/notify/a123e4`).set({ title: 'Aoashi', ep: 4, at: now() }));
    await assertSucceeds(db.doc(`${u}/notify/p999`).set({ title: 'New show', at: now() }));
  });

  it('reject bad shapes', async () => {
    const db = as(ALICE);
    await assertFails(db.doc(`${u}/library/aoashi`).set({ status: 'binging', watched: 3, updatedAt: now() }));
    await assertFails(db.doc(`${u}/library/aoashi`).set({ status: 'watching', watched: 1.5, updatedAt: now() }));
    await assertFails(db.doc(`${u}/library/aoashi`).set({ status: 'watching', watched: -1, updatedAt: now() }));
    await assertFails(db.doc(`${u}/favourites/aoashi`).set({ addedAt: now(), note: 'x' }));
    await assertFails(db.doc(`${u}/recent/r1`).set({ term: '', at: now() }));
    await assertFails(db.doc(`${u}/recent/r1`).set({ term: 'x'.repeat(201), at: now() }));
    await assertFails(db.doc(`${u}/notify/k`).set({ title: 'x', ep: 'four', at: now() }));
    await assertFails(db.doc(`${u}/notify/k`).set({ at: now() }));
  });

  it('deny other sub-collections under users/{uid}', async () => {
    await assertFails(as(ALICE).doc(`${u}/secrets/x`).set({ a: 1 }));
    await assertFails(as(ALICE).doc(`${u}/secrets/x`).get());
  });

  it('are private to their owner', async () => {
    await assertFails(as(BOB).doc(`${u}/library/aoashi`).set({ status: 'watching', watched: 0, updatedAt: now() }));
    await assertFails(as(MALLORY).doc(`users/${MALLORY}/favourites/aoashi`).set({ addedAt: now() }));
  });
});

describe('clear history / delete account data', () => {
  it('deletes many progress docs in one batch (450 per batch, as the app does)', async () => {
    await seed(async (db) => {
      const b = db.batch();
      for (let i = 1; i <= 450; i++) b.set(db.doc(`users/${ALICE}/progress/aoashi_s01e${String(i).padStart(3, '0')}`), progress());
      await b.commit();
    });
    const db = as(ALICE);
    const snap = await assertSucceeds(db.collection(`users/${ALICE}/progress`).get());
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await assertSucceeds(batch.commit());
  });

  it('deletes every sub-collection and the profile', async () => {
    const u = `users/${ALICE}`;
    await seed(async (db) => {
      await db.doc(u).set(profile());
      await db.doc(`${u}/library/aoashi`).set({ status: 'watching', watched: 1, updatedAt: now() });
      await db.doc(`${u}/favourites/aoashi`).set({ addedAt: now() });
      await db.doc(`${u}/recent/r1`).set({ term: 'a', at: now() });
      await db.doc(`${u}/notify/k`).set({ title: 'a', at: now() });
    });
    const db = as(ALICE);
    for (const c of ['library', 'favourites', 'progress', 'recent', 'notify']) {
      const snap = await assertSucceeds(db.collection(`${u}/${c}`).get());
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await assertSucceeds(batch.commit());
    }
    await assertSucceeds(db.doc(u).delete());
  });

  it("can't touch another user's data", async () => {
    await assertFails(as(ALICE).doc(`users/${BOB}/progress/aoashi_s01e01`).delete());
    await assertFails(as(ALICE).doc(`users/${BOB}`).delete());
  });
});

describe('import page', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await db.doc('importAgent/main').set({ state: 'idle', scanRequestedAt: null, lastSeen: now() });
      await db.doc('importScan/h1').set({ fileName: 'a.mkv', status: 'new' });
      await db.doc('importJobs/j1').set({ status: 'running', createdBy: ALICE, sources: ['h1'], cancelRequested: false });
    });
  });

  it('reads agent, scan and jobs only when allowlisted', async () => {
    await assertSucceeds(as(ALICE).doc('importAgent/main').get());
    await assertSucceeds(as(ALICE).collection('importScan').get());
    await assertSucceeds(as(ALICE).collection('importJobs').orderBy('createdAt', 'desc').limit(20).get());
    await assertFails(as(MALLORY).doc('importAgent/main').get());
    await assertFails(as(MALLORY).collection('importScan').get());
  });

  it('may only request a rescan on the agent doc', async () => {
    await assertSucceeds(as(ALICE).doc('importAgent/main').update({ scanRequestedAt: now() }));
    await assertFails(as(ALICE).doc('importAgent/main').update({ state: 'stopped' }));
    await assertFails(as(ALICE).doc('importScan/h1').update({ status: 'imported' }));
  });

  it('queues jobs for itself only, and may only cancel', async () => {
    const job = { status: 'queued', createdBy: ALICE, sources: ['h1'], labels: ['a'], createdAt: now(), cancelRequested: false };
    await assertSucceeds(as(ALICE).collection('importJobs').add(job));
    await assertFails(as(ALICE).collection('importJobs').add({ ...job, createdBy: BOB }));
    await assertFails(as(ALICE).collection('importJobs').add({ ...job, status: 'running' }));
    await assertFails(as(ALICE).collection('importJobs').add({ ...job, sources: [] }));
    await assertFails(as(MALLORY).collection('importJobs').add({ ...job, createdBy: MALLORY }));
    await assertSucceeds(as(ALICE).doc('importJobs/j1').update({ cancelRequested: true }));
    await assertFails(as(ALICE).doc('importJobs/j1').update({ status: 'done' }));
  });

  it('overrides are read/write for allowlisted users', async () => {
    await assertSucceeds(as(ALICE).doc('overrides/aoashi').set({ anilistId: 134732 }));
    await assertSucceeds(as(BOB).doc('overrides/aoashi').get());
    await assertFails(as(MALLORY).doc('overrides/aoashi').set({ anilistId: 1 }));
  });
});
