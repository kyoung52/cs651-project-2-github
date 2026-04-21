/**
 * Proxied Google Custom Search (images) — keeps API key server-side and
 * returns 503 with a friendly message when search is not configured.
 */
import express from 'express';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { searchSimilarImages } from '../services/imageSearchService.js';
import {
  asyncHandler,
  requireService,
  sendError,
} from '../utils/httpError.js';
import { runValidators, validateSearch } from '../middleware/validate.js';
import { isGoogleSearchConfigured } from '../config/secrets.js';

const router = express.Router();

router.get(
  '/',
  verifyFirebaseToken,
  requireService(
    isGoogleSearchConfigured,
    'Image search is not configured on this server.'
  ),
  ...validateSearch,
  runValidators,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q).trim();
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 8;
    try {
      const results = await searchSimilarImages(q, limit);
      res.json({ query: q, results });
    } catch (err) {
      console.warn('[search]', err.message);
      return sendError(
        res,
        502,
        'SEARCH_FAILED',
        'Image search is temporarily unavailable.'
      );
    }
  })
);

export default router;
