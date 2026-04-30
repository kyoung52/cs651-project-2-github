/**
 * Social-integration routes.
 *
 * Responses include a `configured` flag so the client can show an inline
 * "connect" CTA instead of an error toast when a user just hasn't linked
 * their account yet.
 */
import express from 'express';
import { verifyFirebaseToken } from '../middleware/auth.js';
import {
  runValidators,
  validateBoardId,
  validateAlbumId,
  validateSessionId,
  validateOptionalAccessToken,
  validateOptionalLimit,
} from '../middleware/validate.js';
import * as googlePhotos from '../services/googlePhotosService.js';
import * as googlePhotosPicker from '../services/googlePhotosPickerService.js';
import * as pinterest from '../services/pinterestService.js';
import * as youtube from '../services/youtubeService.js';
import { getUserDoc } from '../services/firestoreService.js';
import {
  asyncHandler,
  sendError,
  requireService,
} from '../utils/httpError.js';
import { isPinterestConfigured, isGooglePhotosPickerConfigured } from '../config/secrets.js';

const router = express.Router();

function choosePinterestImageUrl(pin) {
  const images = pin?.media?.images;
  if (!images || typeof images !== 'object') return '';

  const preferred = ['1200x', '600x', '400x300', '150x150'];
  for (const k of preferred) {
    const url = images?.[k]?.url;
    if (typeof url === 'string' && url.startsWith('https://')) return url;
  }

  // Fallback: any https URL in the images map
  for (const v of Object.values(images)) {
    const url = v?.url;
    if (typeof url === 'string' && url.startsWith('https://')) return url;
  }
  return '';
}

function extractPinterestImageUrls(pin) {
  const images = pin?.media?.images;
  if (!images || typeof images !== 'object') return [];
  const urls = Object.values(images)
    .map((v) => v?.url)
    .filter((u) => typeof u === 'string' && u.startsWith('https://'));
  return Array.from(new Set(urls));
}

function mapPinterestPin(pin, boardId) {
  const imageUrl = choosePinterestImageUrl(pin);
  const imageUrls = extractPinterestImageUrls(pin);
  return {
    id: pin?.id ? String(pin.id) : '',
    boardId: boardId ? String(boardId) : String(pin?.board_id || ''),
    title: typeof pin?.title === 'string' ? pin.title : '',
    description: typeof pin?.description === 'string' ? pin.description : '',
    link: typeof pin?.link === 'string' ? pin.link : '',
    imageUrl,
    imageUrls,
  };
}

/**
 * Resolve a Google OAuth access token from (in order): query param,
 * user's stored token, dev env fallback.
 */
async function resolveGoogleToken(req) {
  const user = await getUserDoc(req.user.uid);
  return (
    req.query.accessToken ||
    user?.googleAccessToken ||
    process.env.DEV_GOOGLE_OAUTH_TOKEN ||
    null
  );
}

async function resolvePinterestToken(req) {
  const user = await getUserDoc(req.user.uid);
  const token = user?.pinterestAccessToken || process.env.PINTEREST_DEV_ACCESS_TOKEN || null;
  return {
    token,
    connected: Boolean(user?.pinterestAccessToken),
    dev: Boolean(!user?.pinterestAccessToken && process.env.PINTEREST_DEV_ACCESS_TOKEN),
  };
}

/* --------------------------- Google Photos --------------------------- */

router.get(
  '/google-photos/albums',
  verifyFirebaseToken,
  ...validateOptionalAccessToken,
  runValidators,
  asyncHandler(async (req, res) => {
    const token = await resolveGoogleToken(req);
    if (!token) {
      return res.json({ configured: false, albums: [], reason: 'Google account not connected.' });
    }
    try {
      const albums = await googlePhotos.listAlbums(String(token));
      res.json({ configured: true, albums });
    } catch (err) {
      console.warn('[google-photos]', err.message);
      if (String(err.message || '').includes('insufficient authentication scopes')) {
        return sendError(
          res,
          403,
          'GOOGLE_SCOPE_MISSING',
          'Google Photos permission is missing. Go to Settings and reconnect Google Photos.'
        );
      }
      return sendError(
        res,
        502,
        'GOOGLE_PHOTOS_FAILED',
        'Unable to fetch Google Photos albums.'
      );
    }
  })
);

router.get(
  '/google-photos/albums/:albumId/media',
  verifyFirebaseToken,
  ...validateAlbumId,
  ...validateOptionalAccessToken,
  runValidators,
  asyncHandler(async (req, res) => {
    const token = await resolveGoogleToken(req);
    if (!token) {
      return res.json({ configured: false, media: [], reason: 'Google account not connected.' });
    }
    try {
      const media = await googlePhotos.listMediaInAlbum(String(token), req.params.albumId);
      res.json({
        configured: true,
        media: media.map((m) => ({
          id: m.id,
          mimeType: m.mimeType,
          filename: m.filename,
          baseUrl: googlePhotos.getMediaBaseUrl(m),
        })),
      });
    } catch (err) {
      console.warn('[google-photos:media]', err.message);
      if (String(err.message || '').includes('insufficient authentication scopes')) {
        return sendError(
          res,
          403,
          'GOOGLE_SCOPE_MISSING',
          'Google Photos permission is missing. Go to Settings and reconnect Google Photos.'
        );
      }
      return sendError(
        res,
        502,
        'GOOGLE_PHOTOS_FAILED',
        'Unable to fetch Google Photos media.'
      );
    }
  })
);

/* ----------------------- Google Photos Picker ----------------------- */
//
// The Picker API is the post-2025 replacement for the deprecated Library
// read scopes. The flow is:
//
//   1. Client POSTs /picker/session — server creates a session with the
//      user's stored Google access token and returns the pickerUri the
//      client opens in a new tab.
//   2. Client polls GET /picker/session/:id every few seconds (using the
//      server's pollingConfig) until `mediaItemsSet === true`.
//   3. Client POSTs /api/media/process-picker-items with the sessionId to
//      run analysis + concept generation against the picked items.
//   4. Best-effort DELETE /picker/session/:id to clean up.

function isPickerScopeError(err) {
  if (!err) return false;
  const status = err.status || err.code;
  if (status === 401 || status === 403) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('insufficient') || msg.includes('scope') || msg.includes('permission');
}

router.post(
  '/google-photos/picker/session',
  verifyFirebaseToken,
  requireService(
    isGooglePhotosPickerConfigured,
    'Google Photos Picker is not enabled on this server.'
  ),
  asyncHandler(async (req, res) => {
    const token = await resolveGoogleToken(req);
    if (!token) {
      return sendError(
        res,
        403,
        'NOT_CONNECTED',
        'Connect your Google account in Settings to use Google Photos.'
      );
    }
    try {
      const session = await googlePhotosPicker.createSession(String(token));
      res.json({
        ok: true,
        sessionId: session.id,
        pickerUri: session.pickerUri,
        expireTime: session.expireTime || null,
        pollingConfig: session.pollingConfig || null,
        mediaItemsSet: Boolean(session.mediaItemsSet),
      });
    } catch (err) {
      console.warn('[picker:create_session]', err.message);
      if (isPickerScopeError(err)) {
        return sendError(
          res,
          403,
          'GOOGLE_SCOPE_MISSING',
          'Google Photos Picker permission is missing. Reconnect Google in Settings and grant access.'
        );
      }
      return sendError(res, 502, 'PICKER_FAILED', 'Unable to start a Google Photos session.');
    }
  })
);

router.get(
  '/google-photos/picker/session/:sessionId',
  verifyFirebaseToken,
  requireService(
    isGooglePhotosPickerConfigured,
    'Google Photos Picker is not enabled on this server.'
  ),
  ...validateSessionId,
  runValidators,
  asyncHandler(async (req, res) => {
    const token = await resolveGoogleToken(req);
    if (!token) {
      return sendError(res, 403, 'NOT_CONNECTED', 'Google account not connected.');
    }
    try {
      const session = await googlePhotosPicker.pollSession(String(token), req.params.sessionId);
      res.json({
        ok: true,
        sessionId: session.id,
        mediaItemsSet: Boolean(session.mediaItemsSet),
        pickerUri: session.pickerUri || null,
        expireTime: session.expireTime || null,
        pollingConfig: session.pollingConfig || null,
      });
    } catch (err) {
      console.warn('[picker:poll_session]', err.message);
      if (err.status === 404) {
        return sendError(res, 404, 'SESSION_NOT_FOUND', 'That picker session expired or was not found.');
      }
      if (isPickerScopeError(err)) {
        return sendError(res, 403, 'GOOGLE_SCOPE_MISSING', 'Google Photos Picker permission is missing.');
      }
      return sendError(res, 502, 'PICKER_FAILED', 'Unable to read picker session state.');
    }
  })
);

router.delete(
  '/google-photos/picker/session/:sessionId',
  verifyFirebaseToken,
  requireService(
    isGooglePhotosPickerConfigured,
    'Google Photos Picker is not enabled on this server.'
  ),
  ...validateSessionId,
  runValidators,
  asyncHandler(async (req, res) => {
    const token = await resolveGoogleToken(req);
    if (!token) {
      // Nothing to clean up server-side. Return 200 so the client can
      // continue without surfacing a permission error.
      return res.json({ ok: true });
    }
    try {
      await googlePhotosPicker.deleteSession(String(token), req.params.sessionId);
    } catch (err) {
      console.warn('[picker:delete_session]', err.message);
      // Sessions auto-expire — non-fatal.
    }
    res.json({ ok: true });
  })
);

/* ------------------------------ Pinterest ---------------------------- */

router.get(
  '/pinterest/boards',
  verifyFirebaseToken,
  requireService(
    isPinterestConfigured,
    'Pinterest is not configured on this server.'
  ),
  asyncHandler(async (req, res) => {
    const { token, connected, dev } = await resolvePinterestToken(req);
    if (!token) {
      return res.json({ configured: true, connected: false, boards: [] });
    }
    try {
      const boards = await pinterest.listBoards(token);
      res.json({ configured: true, connected, dev, boards });
    } catch (err) {
      console.warn('[pinterest:boards]', err.message);
      return sendError(res, 502, 'PINTEREST_FAILED', 'Unable to fetch Pinterest boards.');
    }
  })
);

router.get(
  '/pinterest/boards/:boardId/pins',
  verifyFirebaseToken,
  requireService(
    isPinterestConfigured,
    'Pinterest is not configured on this server.'
  ),
  ...validateBoardId,
  runValidators,
  asyncHandler(async (req, res) => {
    const { token, connected, dev } = await resolvePinterestToken(req);
    if (!token) {
      return res.json({ configured: true, connected: false, pins: [] });
    }
    try {
      const pins = await pinterest.listPins(token, req.params.boardId);
      const mapped = Array.isArray(pins)
        ? pins.map((p) => mapPinterestPin(p, req.params.boardId)).filter((p) => p.id && p.imageUrl)
        : [];
      res.json({ configured: true, connected, dev, pins: mapped });
    } catch (err) {
      console.warn('[pinterest:pins]', err.message);
      return sendError(res, 502, 'PINTEREST_FAILED', 'Unable to fetch Pinterest pins.');
    }
  })
);

/* ------------------------------- YouTube ----------------------------- */

router.get(
  '/youtube/videos',
  verifyFirebaseToken,
  ...validateOptionalAccessToken,
  ...validateOptionalLimit,
  runValidators,
  asyncHandler(async (req, res) => {
    const token = await resolveGoogleToken(req);
    if (!token) {
      return res.json({ configured: false, videos: [], reason: 'Google account not connected.' });
    }
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 25;
    try {
      const videos = await youtube.listMyVideos(String(token), limit);
      res.json({ configured: true, videos });
    } catch (err) {
      console.warn('[youtube]', err.message);
      return sendError(res, 502, 'YOUTUBE_FAILED', 'Unable to fetch YouTube videos.');
    }
  })
);

export default router;
