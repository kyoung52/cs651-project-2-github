/**
 * Verifies Firebase ID token from Authorization: Bearer <token>.
 * Attaches req.user = { uid, email } on success.
 */
import { initFirebase, admin } from '../config/firebase.js';

const DEV_SKIP_AUTH = process.env.DEV_SKIP_AUTH === 'true';

export async function verifyFirebaseToken(req, res, next) {
  if (DEV_SKIP_AUTH) {
    req.user = { uid: 'dev-user', email: 'dev@localhost' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'AUTH_REQUIRED' });
  }

  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    return res.status(401).json({ error: 'Empty token', code: 'AUTH_REQUIRED' });
  }

  try {
    initFirebase();
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
    };
    return next();
  } catch (err) {
    console.error('[auth] verifyIdToken failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token', code: 'AUTH_INVALID' });
  }
}
