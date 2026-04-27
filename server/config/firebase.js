/**
 * Firebase Admin SDK initialization.
 * Supports GOOGLE_APPLICATION_CREDENTIALS or inline env vars (Cloud Run / Secret Manager).
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

let initialized = false;
let firestoreInstance = null;

export function initFirebase() {
  if (initialized) return admin;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey && privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (credPath) {
    try {
      const json = JSON.parse(readFileSync(credPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(json),
        projectId: json.project_id || projectId,
      });
      initialized = true;
      return admin;
    } catch (e) {
      console.warn('[firebase] GOOGLE_APPLICATION_CREDENTIALS read failed:', e.message);
    }
  }

  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
    initialized = true;
    return admin;
  }

  // Dev mode: app runs without Firestore if Firebase not configured
  console.warn(
    '[firebase] No credentials — Firestore/auth verification may be limited. Set FIREBASE_* or GOOGLE_APPLICATION_CREDENTIALS.'
  );
  try {
    admin.initializeApp({ projectId: projectId || 'demo-roomify' });
  } catch {
    // already initialized
  }
  initialized = true;
  return admin;
}

export function getFirestore() {
  initFirebase();
  // Firestore settings() can only be called once and before any other use.
  // Cache the Firestore instance so we configure it exactly once per process.
  if (firestoreInstance) return firestoreInstance;
  const db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  firestoreInstance = db;
  return firestoreInstance;
}

export { admin };
