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
  validateOptionalAccessToken,
  validateOptionalLimit,
} from '../middleware/validate.js';
import * as googlePhotos from '../services/googlePhotosService.js';
import * as pinterest from '../services/pinterestService.js';
import * as youtube from '../services/youtubeService.js';
import { getUserDoc } from '../services/firestoreService.js';
import {
  asyncHandler,
  sendError,
  requireService,
} from '../utils/httpError.js';
import { isPinterestConfigured } from '../config/secrets.js';

const router = express.Router();

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
      return sendError(
        res,
        502,
        'GOOGLE_PHOTOS_FAILED',
        'Unable to fetch Google Photos media.'
      );
    }
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
    const user = await getUserDoc(req.user.uid);
    const token = user?.pinterestAccessToken;
    if (!token) {
      return res.json({ configured: true, connected: false, boards: [] });
    }
    try {
      const boards = await pinterest.listBoards(token);
      res.json({ configured: true, connected: true, boards });
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
    const user = await getUserDoc(req.user.uid);
    const token = user?.pinterestAccessToken;
    if (!token) {
      return res.json({ configured: true, connected: false, pins: [] });
    }
    try {
      const pins = await pinterest.listPins(token, req.params.boardId);
      res.json({ configured: true, connected: true, pins });
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
