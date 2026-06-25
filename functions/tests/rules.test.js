'use strict';

/**
 * Firestore security rules tests.
 *
 * Run with the emulator:
 *   firebase emulators:exec --only firestore 'npx jest tests/rules.test.js'
 *
 * Or start the emulator separately then:
 *   npx jest tests/rules.test.js
 */

const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');
const fs   = require('fs');
const path = require('path');

const PROJECT_ID  = 'rules-test-project';
const RULES_PATH  = path.join(__dirname, '../../firestore.rules');

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

// Seed documents that bypass security rules (simulates server-side writes).
async function seed(docsMap) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const [docPath, data] of Object.entries(docsMap)) {
      const parts = docPath.split('/');
      await setDoc(doc(db, ...parts), data);
    }
  });
}

// ── uid constants ─────────────────────────────────────────────────────────────
const OWNER_UID   = 'uid-owner';
const ADMIN_UID   = 'uid-admin';
const PLAYER_UID  = 'uid-player';
const PLAYER2_UID = 'uid-player2';
const ADMIN_EMAIL = 'admin@example.com';

// ── users/{uid} — READ ────────────────────────────────────────────────────────
describe('users/{uid} read', () => {
  beforeEach(() => seed({
    [`users/${OWNER_UID}`]:  { name: 'Owner',  roles: ['owner',  'player'] },
    [`users/${ADMIN_UID}`]:  { name: 'Admin',  roles: ['admin',  'player'] },
    [`users/${PLAYER_UID}`]: { name: 'Player', roles: ['player'] },
    [`admins/${ADMIN_EMAIL}`]: { email: ADMIN_EMAIL },
  }));

  test('unauthenticated user cannot read any user doc', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `users/${PLAYER_UID}`)));
  });

  test('user can read their own doc', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${PLAYER_UID}`)));
  });

  test('player cannot read another player\'s doc', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER_UID}`)));
  });

  test('admin (in admins collection) can read any user doc', async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL }).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${PLAYER_UID}`)));
  });

  test('owner (roles includes owner) can read any user doc', async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${PLAYER_UID}`)));
  });
});

// ── users/{uid} — UPDATE ─────────────────────────────────────────────────────
describe('users/{uid} update', () => {
  beforeEach(() => seed({
    [`users/${OWNER_UID}`]:   { name: 'Owner',  roles: ['owner',  'player'] },
    [`users/${ADMIN_UID}`]:   { name: 'Admin',  roles: ['admin',  'player'] },
    [`users/${PLAYER_UID}`]:  { name: 'Player', roles: ['player'] },
    [`users/${PLAYER2_UID}`]: { name: 'Player2', roles: ['player'] },
    [`admins/${ADMIN_EMAIL}`]: { email: ADMIN_EMAIL },
  }));

  // self-update
  test('user can update their own safe fields', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, `users/${PLAYER_UID}`), { name: 'New Name' }));
  });

  test('user cannot self-assign roles', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(updateDoc(doc(db, `users/${PLAYER_UID}`), { roles: ['admin'] }));
  });

  test('user cannot self-set adminRequest', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(updateDoc(doc(db, `users/${PLAYER_UID}`), { adminRequest: true }));
  });

  test('user cannot update another user\'s doc', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(updateDoc(doc(db, `users/${PLAYER2_UID}`), { name: 'Hacked' }));
  });

  // admin update
  test('admin can update another user\'s non-role fields (e.g. adminRequest)', async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL }).firestore();
    await assertSucceeds(updateDoc(doc(db, `users/${PLAYER_UID}`), { adminRequest: true }));
  });

  test('admin cannot directly change another user\'s roles', async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL }).firestore();
    await assertFails(updateDoc(doc(db, `users/${PLAYER_UID}`), { roles: ['admin'] }));
  });

  // owner update
  test('owner can update any field including roles on any user doc', async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, `users/${PLAYER_UID}`), { roles: ['admin', 'player'] }));
  });
});

// ── publicProfiles/{uid} — READ / WRITE ──────────────────────────────────────
describe('publicProfiles', () => {
  beforeEach(() => seed({
    [`publicProfiles/${PLAYER_UID}`]: { name: 'Player', isProvider: false },
  }));

  test('authenticated user can read public profiles', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertSucceeds(getDoc(doc(db, `publicProfiles/${PLAYER_UID}`)));
  });

  test('unauthenticated user cannot read public profiles', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `publicProfiles/${PLAYER_UID}`)));
  });

  test('authenticated user cannot write to publicProfiles (Cloud Functions only)', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(setDoc(doc(db, `publicProfiles/${PLAYER_UID}`), { name: 'Hacked' }));
  });

  test('owner cannot write to publicProfiles (Cloud Functions only)', async () => {
    await seed({ [`users/${OWNER_UID}`]: { roles: ['owner', 'player'] } });
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(setDoc(doc(db, `publicProfiles/${PLAYER_UID}`), { name: 'Hacked' }));
  });
});

// ── sessions/{sessionId} — PROVIDER rules ────────────────────────────────────
describe('sessions provider rules', () => {
  const PROVIDER_UID  = 'uid-provider';
  const PROVIDER2_UID = 'uid-provider2';
  const SESSION_ID    = 'session-1';

  beforeEach(() => seed({
    [`users/${PROVIDER_UID}`]:  { name: 'Provider', roles: ['provider', 'player'] },
    [`users/${PROVIDER2_UID}`]: { name: 'Provider2', roles: ['provider', 'player'] },
    [`users/${PLAYER_UID}`]:    { name: 'Player', roles: ['player'] },
    [`sessions/${SESSION_ID}`]: {
      venue: 'Gym', date: '2026-01-01', providerUid: PROVIDER_UID, status: 'open',
      attendeeCount: 0, capacity: 20,
    },
  }));

  test('provider can create a session with their own providerUid', async () => {
    const db = testEnv.authenticatedContext(PROVIDER_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'sessions/new-session'), {
      date: '2026-02-01', time: '18:00', venue: 'Hall', level: 'all', gender: 'mixed',
      type: 'open', capacity: 20, cost: 10, coachFee: 0, status: 'open',
      attendeeCount: 0, waitingListCount: 0, cancellationCount: 0,
      providerUid: PROVIDER_UID,
    }));
  });

  test('provider cannot create a session with a different providerUid', async () => {
    const db = testEnv.authenticatedContext(PROVIDER_UID).firestore();
    await assertFails(setDoc(doc(db, 'sessions/spoof-session'), {
      date: '2026-02-01', time: '18:00', venue: 'Hall', level: 'all', gender: 'mixed',
      type: 'open', capacity: 20, cost: 10, coachFee: 0, status: 'open',
      attendeeCount: 0, waitingListCount: 0, cancellationCount: 0,
      providerUid: PROVIDER2_UID,
    }));
  });

  test('provider can update their own session', async () => {
    const db = testEnv.authenticatedContext(PROVIDER_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, `sessions/${SESSION_ID}`), { venue: 'New Gym' }));
  });

  test('provider cannot update another provider\'s session', async () => {
    const db = testEnv.authenticatedContext(PROVIDER2_UID).firestore();
    await assertFails(updateDoc(doc(db, `sessions/${SESSION_ID}`), { venue: 'Hacked' }));
  });

  test('player cannot create a session', async () => {
    const db = testEnv.authenticatedContext(PLAYER_UID).firestore();
    await assertFails(setDoc(doc(db, 'sessions/player-session'), {
      date: '2026-02-01', venue: 'Hall', providerUid: PLAYER_UID, status: 'open',
    }));
  });

  test('provider can delete their own session', async () => {
    const db = testEnv.authenticatedContext(PROVIDER_UID).firestore();
    await assertSucceeds(deleteDoc(doc(db, `sessions/${SESSION_ID}`)));
  });

  test('provider cannot delete another provider\'s session', async () => {
    const db = testEnv.authenticatedContext(PROVIDER2_UID).firestore();
    await assertFails(deleteDoc(doc(db, `sessions/${SESSION_ID}`)));
  });
});
