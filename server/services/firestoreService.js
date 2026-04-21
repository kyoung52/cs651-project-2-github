/**
 * Firestore helpers wrapped in a safeDb() guard.
 *
 * When Firestore isn't reachable (missing credentials in dev, network error,
 * etc.) we return the caller's sensible default instead of throwing — this
 * keeps the SPA responsive and never surfaces 500s for optional analytics
 * or cache misses.
 */
import { getFirestore } from '../config/firebase.js';
import { isFirebaseAdminConfigured } from '../config/secrets.js';

/**
 * Run a Firestore operation safely. Logs the error server-side and returns
 * `fallback` on failure or when admin is not configured.
 *
 * @template T
 * @param {(db: FirebaseFirestore.Firestore) => Promise<T>} fn
 * @param {T} fallback
 * @param {string} [label]
 * @returns {Promise<T>}
 */
async function safeDb(fn, fallback, label = 'firestore') {
  if (!isFirebaseAdminConfigured()) {
    return fallback;
  }
  try {
    const db = getFirestore();
    return await fn(db);
  } catch (err) {
    console.warn(`[${label}]`, err?.message || err);
    return fallback;
  }
}

export async function getMediaCache(hash) {
  return safeDb(
    async (db) => {
      const snap = await db.collection('mediaCache').doc(hash).get();
      return snap.exists ? snap.data() : null;
    },
    null,
    'firestore:getMediaCache'
  );
}

export async function setMediaCache(hash, data) {
  return safeDb(
    async (db) => {
      await db
        .collection('mediaCache')
        .doc(hash)
        .set({ ...data, updatedAt: new Date().toISOString() });
      return true;
    },
    false,
    'firestore:setMediaCache'
  );
}

export async function saveGeneration(uid, data) {
  return safeDb(
    async (db) => {
      const ref = await db.collection('generations').add({
        uid,
        ...data,
        createdAt: new Date().toISOString(),
      });
      return ref.id;
    },
    null,
    'firestore:saveGeneration'
  );
}

export async function saveProject(uid, name, payload) {
  return safeDb(
    async (db) => {
      const ref = await db
        .collection('users')
        .doc(uid)
        .collection('projects')
        .add({
          name,
          payload,
          createdAt: new Date().toISOString(),
        });
      return ref.id;
    },
    null,
    'firestore:saveProject'
  );
}

export async function listProjects(uid) {
  return safeDb(
    async (db) => {
      const snap = await db
        .collection('users')
        .doc(uid)
        .collection('projects')
        .limit(50)
        .get();
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      );
      return list;
    },
    [],
    'firestore:listProjects'
  );
}

/**
 * Short-lived OAuth state (10 min window). Without Firestore we fall back to
 * an in-memory Map — fine for local dev where Pinterest callback hits the
 * same process.
 */
const memoryOAuthStates = new Map();
const OAUTH_TTL_MS = 10 * 60 * 1000;

export async function setOAuthState(stateId, uid) {
  const payload = { uid, createdAt: Date.now() };

  if (!isFirebaseAdminConfigured()) {
    memoryOAuthStates.set(stateId, payload);
    return true;
  }

  return safeDb(
    async (db) => {
      await db.collection('oauthStates').doc(stateId).set(payload);
      return true;
    },
    (memoryOAuthStates.set(stateId, payload), true),
    'firestore:setOAuthState'
  );
}

export async function getOAuthState(stateId) {
  if (!isFirebaseAdminConfigured()) {
    const entry = memoryOAuthStates.get(stateId);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > OAUTH_TTL_MS) {
      memoryOAuthStates.delete(stateId);
      return null;
    }
    return entry;
  }

  return safeDb(
    async (db) => {
      const snap = await db.collection('oauthStates').doc(stateId).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (data?.createdAt && Date.now() - data.createdAt > OAUTH_TTL_MS) {
        return null;
      }
      return data;
    },
    null,
    'firestore:getOAuthState'
  );
}

export async function deleteOAuthState(stateId) {
  memoryOAuthStates.delete(stateId);
  return safeDb(
    async (db) => {
      await db.collection('oauthStates').doc(stateId).delete();
      return true;
    },
    false,
    'firestore:deleteOAuthState'
  );
}

export async function updateUserSocialTokens(uid, tokens) {
  return safeDb(
    async (db) => {
      await db
        .collection('users')
        .doc(uid)
        .set(
          { ...tokens, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      return true;
    },
    false,
    'firestore:updateUserSocialTokens'
  );
}

export async function getUserDoc(uid) {
  return safeDb(
    async (db) => {
      const snap = await db.collection('users').doc(uid).get();
      return snap.exists ? snap.data() : null;
    },
    null,
    'firestore:getUserDoc'
  );
}
