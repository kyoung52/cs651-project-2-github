/**
 * Firebase Web SDK — Auth only on client; Firestore accessed via REST API through Express when needed.
 */
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.APP_FIREBASE_API_KEY,
  authDomain: import.meta.env.APP_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.APP_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.APP_FIREBASE_APP_ID,
};

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

let app;
export function getFirebaseApp() {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured. Set APP_FIREBASE_* in client/.env.');
  }
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  }
  return app || getApps()[0];
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

/**
 * Google provider.
 *
 * Important: requesting Google Photos / YouTube scopes during initial sign-in
 * can fail in production unless the OAuth consent screen + scopes are fully
 * configured in the Google Cloud project. We keep sign-in minimal (profile/email)
 * and request additional scopes only when the user connects those services.
 */
export function getGoogleProvider({ withMediaScopes = false } = {}) {
  const p = new GoogleAuthProvider();
  if (withMediaScopes) {
    p.addScope('https://www.googleapis.com/auth/photoslibrary.readonly');
    p.addScope('https://www.googleapis.com/auth/youtube.readonly');
    // Force account selection + re-consent so scopes actually apply.
    p.setCustomParameters({ prompt: 'consent select_account' });
  }
  return p;
}
