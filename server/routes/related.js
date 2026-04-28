/**
 * POST /api/related — grounded "related items" suggestions for a concept.
 *
 * Calls Vertex Gemini with the googleSearch grounding tool to get a small
 * list of furniture/decor items with price ranges and citations. Items are
 * server-validated and filtered; malformed entries are dropped silently.
 *
 * Auth-gated and per-user-rate-limited (a single grounded call is roughly
 * as expensive as a concept generation). Returns `{ items, citations,
 * reason? }`. `reason: "grounding_unavailable"` means the project's region
 * doesn't support the grounding tool — the SPA shows a friendly empty
 * state instead of an error.
 */
import express from 'express';
import { body } from 'express-validator';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { sanitizeBodyStrings } from '../middleware/sanitize.js';
import { runValidators } from '../middleware/validate.js';
import { generationLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler, requireService, sendError } from '../utils/httpError.js';
import { isGroundingConfigured } from '../config/secrets.js';
import { suggestRelatedItems } from '../services/geminiGroundedService.js';

const router = express.Router();

const validateRelated = [
  body('concept').exists({ checkNull: true }).withMessage('concept is required'),
  // The concept payload is sanitized by sanitizeBodyStrings (deep). Don't
  // bother re-validating individual fields — the grounded service ignores
  // anything that isn't a string/array of strings.
];

router.post(
  '/',
  verifyFirebaseToken,
  requireService(isGroundingConfigured, 'Grounded suggestions are not configured on this server.'),
  generationLimiter,
  sanitizeBodyStrings,
  ...validateRelated,
  runValidators,
  asyncHandler(async (req, res) => {
    const concept = req.body.concept && typeof req.body.concept === 'object' ? req.body.concept : null;
    if (!concept) {
      return sendError(res, 400, 'BAD_REQUEST', 'concept must be an object.');
    }
    const { items, citations, reason } = await suggestRelatedItems(concept);
    res.json({ items, citations, reason: reason || null });
  })
);

export default router;
