/**
 * Roomify Express app factory.
 *
 * Builds the API + SPA server without starting to listen. Kept separate from
 * the entrypoint so it can be unit-tested or embedded by other runtimes.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { apiLimiter } from './middleware/rateLimiter.js';
import { sendError } from './utils/httpError.js';

import authRoutes from './routes/auth.js';
import socialRoutes from './routes/social.js';
import mediaRoutes from './routes/media.js';
import geminiRoutes from './routes/gemini.js';
import searchRoutes from './routes/search.js';
import configRoutes from './routes/config.js';
import exploreRoutes from './routes/explore.js';
import { requestLoggingMiddleware } from './middleware/requestLogging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Parse `ALLOWED_ORIGINS` into an array.
 *  - Empty in production  -> same-origin only (Cloud Run URL).
 *  - Empty in development -> localhost defaults.
 */
function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (list.length > 0) return list;
  if (process.env.NODE_ENV === 'production') return [];
  return ['http://localhost:8080'];
}

function getRequestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim();
  const scheme = proto || (req.secure ? 'https' : 'http');
  const host = req.headers.host;
  if (!host) return '';
  return `${scheme}://${host}`;
}

function isAllowedOrigin(origin, req) {
  if (!origin) return true;
  const allowed = getAllowedOrigins();

  // Empty allow-list in production means same-origin only.
  // Browsers still send an Origin header for same-origin XHR/fetch, so we
  // explicitly allow the origin that matches this request's host.
  if (allowed.length === 0 && process.env.NODE_ENV === 'production') {
    const selfOrigin = getRequestOrigin(req);
    return Boolean(selfOrigin && origin === selfOrigin);
  }

  if (allowed.length === 0) return false;
  return allowed.includes(origin);
}

/**
 * Normalize file-upload errors (Multer) into our `{error,code}` shape so the
 * SPA can show friendly toasts instead of raw stack strings.
 */
function uploadErrorHandler(err, _req, res, next) {
  if (err?.message === 'INVALID_FILE_TYPE') {
    return sendError(
      res,
      400,
      'INVALID_FILE_TYPE',
      'Invalid file type. Use JPEG, PNG, or WebP for images; MP3 or WAV for audio.'
    );
  }
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return sendError(res, 400, 'FILE_TOO_LARGE', 'File too large (max 10MB).');
    }
    return sendError(res, 400, 'UPLOAD_ERROR', 'Unable to process upload.');
  }
  return next(err);
}

/** Final error sink — never leaks stack traces to clients. */
function finalErrorHandler(isProd) {
  return (err, _req, res, _next) => {
    if (err && typeof err.status === 'number' && err.code) {
      if (!isProd) console.error('[server:handled]', err);
      return sendError(res, err.status, err.code, err.message || 'Request failed.');
    }
    console.error('[server]', err);
    return sendError(
      res,
      500,
      'INTERNAL',
      'Something went wrong on our end. Please try again.'
    );
  };
}

/**
 * Build and return the Express app.
 * The app does NOT listen; callers wire up `app.listen(PORT)`.
 */
export function createApp({ isProd = process.env.NODE_ENV === 'production' } = {}) {
  const app = express();

  app.set('trust proxy', 1);

  const cspDirectives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    frameAncestors: ["'self'"],
    objectSrc: ["'none'"],
    // Room concepts load remote preview URLs (Custom Search, stock fallbacks, NanoBanana).
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'data:'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    scriptSrc: [
      "'self'",
      // Firebase Auth / Google sign-in scripts
      'https://apis.google.com',
      'https://www.gstatic.com',
    ],
    // Firebase Auth endpoints + Google APIs
    connectSrc: [
      "'self'",
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://www.googleapis.com',
      // Optional if you ever call Firestore directly from the browser
      'https://firestore.googleapis.com',
    ],
    frameSrc: [
      "'self'",
      'https://accounts.google.com',
      // Firebase Auth iframe (hosted on your Firebase authDomain)
      'https://*.firebaseapp.com',
    ],
  };

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: cspDirectives,
      },
      // Firebase Auth uses popups; COOP 'same-origin' can break window.opener
      // and surfaces as auth/popup-closed-by-user in some browsers (notably Firefox).
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    cors({
      // Note: `cors` does not provide the request object here, so we keep the
      // CORS layer permissive when `ALLOWED_ORIGINS` is empty (recommended on
      // Cloud Run same-origin deployments). The strict check happens in the
      // `/api` middleware below where we have access to `req`.
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowed = getAllowedOrigins();
        if (allowed.length === 0) return cb(null, true);
        return cb(null, allowed.includes(origin));
      },
      credentials: true,
    })
  );

  // Friendly structured 403 for cross-origin API calls that miss CORS.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    if (isAllowedOrigin(origin, req)) return next();
    return sendError(
      res,
      403,
      'ORIGIN_NOT_ALLOWED',
      'This origin is not allowed to use the Roomify API.'
    );
  });

  // Large saves include concept JSON + optional data: image URIs; keep under typical proxy limits.
  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use('/api', apiLimiter);
  app.use(requestLoggingMiddleware);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'roomify', ts: new Date().toISOString() });
  });

  app.use('/api/config', configRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/social', socialRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/gemini', geminiRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/explore', exploreRoutes);

  app.use(uploadErrorHandler);

  // Unknown /api/* should 404 rather than falling through to the SPA.
  app.use('/api', (_req, res) => {
    sendError(res, 404, 'NOT_FOUND', 'Endpoint not found.');
  });

  // Static SPA produced by client/build.mjs
  const publicDir = path.join(__dirname, 'public');
  app.use(
    express.static(publicDir, {
      index: false,
      maxAge: isProd ? '1h' : 0,
    })
  );

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) next(err);
    });
  });

  app.use(finalErrorHandler(isProd));

  return app;
}
