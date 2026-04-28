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
import { sanitizeProjectPayloadForStorage } from '../utils/projectPayload.js';

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

function mediaCacheDocId(uid, hash) {
  // Per-user namespacing keeps analyses (which describe private content) from
  // leaking across users who happen to upload the same file. Falls back to a
  // shared key when uid is absent for backward compatibility.
  return uid ? `${uid}_${hash}` : hash;
}

export async function getMediaCache(uid, hash) {
  return safeDb(
    async (db) => {
      const snap = await db.collection('mediaCache').doc(mediaCacheDocId(uid, hash)).get();
      return snap.exists ? snap.data() : null;
    },
    null,
    'firestore:getMediaCache'
  );
}

export async function setMediaCache(uid, hash, data) {
  return safeDb(
    async (db) => {
      await db
        .collection('mediaCache')
        .doc(mediaCacheDocId(uid, hash))
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
          ownerUid: uid,
          ownerName: null,
          published: false,
          publishedAt: null,
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

export async function getProject(uid, projectId) {
  return safeDb(
    async (db) => {
      const snap = await db
        .collection('users')
        .doc(uid)
        .collection('projects')
        .doc(projectId)
        .get();
      if (!snap.exists) return null;
      return { id: snap.id, ...snap.data() };
    },
    null,
    'firestore:getProject'
  );
}

export async function deleteProject(uid, projectId) {
  return safeDb(
    async (db) => {
      await db
        .collection('users')
        .doc(uid)
        .collection('projects')
        .doc(projectId)
        .delete();
      // Best-effort: remove from public feed too.
      await db.collection('publishedProjects').doc(`${uid}_${projectId}`).delete().catch(() => {});
      return true;
    },
    false,
    'firestore:deleteProject'
  );
}

export async function setProjectPublished(uid, projectId, published) {
  return safeDb(
    async (db) => {
      const ref = db.collection('users').doc(uid).collection('projects').doc(projectId);
      const snap = await ref.get();
      if (!snap.exists) return false;
      const data = snap.data() || {};
      const publishedAt = published ? new Date().toISOString() : null;
      await ref.set(
        {
          published: Boolean(published),
          publishedAt,
        },
        { merge: true }
      );

      const feedRef = db.collection('publishedProjects').doc(`${uid}_${projectId}`);
      if (published) {
        await feedRef.set(
          {
            ownerUid: uid,
            projectId,
            name: data.name || null,
            createdAt: data.createdAt || null,
            publishedAt,
            payload: sanitizeProjectPayloadForStorage(data.payload || {}),
          },
          { merge: true }
        );
      } else {
        await feedRef.delete().catch(() => {});
      }

      return true;
    },
    false,
    'firestore:setProjectPublished'
  );
}

export async function listPublishedProjects(limit = 20) {
  return safeDb(
    async (db) => {
      const snap = await db
        .collection('publishedProjects')
        .orderBy('publishedAt', 'desc')
        .limit(limit)
        .get();

      return snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: data.projectId || d.id,
          ownerUid: data.ownerUid || null,
          name: data.name,
          createdAt: data.createdAt,
          publishedAt: data.publishedAt,
          payload: data.payload || {},
        };
      });
    },
    [],
    'firestore:listPublishedProjects'
  );
}

export async function getPublishedProject(ownerUid, projectId) {
  return safeDb(
    async (db) => {
      const snap = await db
        .collection('publishedProjects')
        .doc(`${ownerUid}_${projectId}`)
        .get();
      if (!snap.exists) return null;
      return snap.data() || null;
    },
    null,
    'firestore:getPublishedProject'
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

  // Periodic prune so the in-memory fallback stays bounded.
  for (const [k, v] of memoryOAuthStates) {
    if (Date.now() - v.createdAt > OAUTH_TTL_MS) memoryOAuthStates.delete(k);
  }

  if (!isFirebaseAdminConfigured()) {
    memoryOAuthStates.set(stateId, payload);
    return true;
  }

  try {
    const db = getFirestore();
    await db.collection('oauthStates').doc(stateId).set(payload);
    return true;
  } catch (err) {
    console.warn('[firestore:setOAuthState]', err?.message || err);
    memoryOAuthStates.set(stateId, payload);
    return true;
  }
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
