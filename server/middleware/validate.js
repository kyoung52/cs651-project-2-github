/**
 * Reusable express-validator chains and a small runValidators() helper that
 * collapses errors into the unified { error, code } response shape.
 *
 * SSRF hardening for remote URL inputs lives here (see validateProcessUrl)
 * because we must block private/link-local addresses before fetching.
 */
import { body, param, query, validationResult } from 'express-validator';
import { sendError } from '../utils/httpError.js';

/**
 * Express middleware that short-circuits with 400 if any prior chain
 * produced errors.
 */
export function runValidators(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const first = errors.array()[0];
  const message =
    first?.msg && first.msg !== 'Invalid value'
      ? String(first.msg)
      : 'One or more fields are invalid.';
  return sendError(res, 400, 'VALIDATION_FAILED', message);
}

/** Reject URLs that target private / link-local / metadata addresses (SSRF). */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./, // link-local
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0–172.31.255.255
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /\.internal$/i,
  /^metadata\.google\.internal$/i,
];

export function isSafePublicUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname;
    if (!host) return false;
    for (const rx of PRIVATE_HOST_PATTERNS) {
      if (rx.test(host)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------- Route chains ------------------------------ */

export const validateProcessMedia = [
  body('chatContext')
    .optional()
    .isString()
    .withMessage('chatContext must be a string')
    .isLength({ max: 8000 })
    .withMessage('chatContext is too long'),
  body('useRealisticFurniture')
    .optional()
    .custom((v) => v === true || v === false || v === 'true' || v === 'false')
    .withMessage('useRealisticFurniture must be boolean'),
];

export const validateProcessUrl = [
  body('url')
    .isString()
    .withMessage('url is required')
    .isLength({ min: 8, max: 2048 })
    .withMessage('url is too long')
    .custom(isSafePublicUrl)
    .withMessage('url must be a public https URL'),
  body('chatContext').optional().isString().isLength({ max: 8000 }),
];

export const validateRefine = [
  body('previousConcept').isObject().withMessage('previousConcept is required'),
  body('feedback')
    .isString()
    .withMessage('feedback is required')
    .isLength({ min: 1, max: 2000 })
    .withMessage('feedback must be 1–2000 characters'),
];

export const validateSaveProject = [
  body('name')
    .isString()
    .withMessage('name is required')
    .isLength({ min: 1, max: 120 })
    .withMessage('name must be 1–120 characters'),
  body('payload').optional().isObject().withMessage('payload must be an object'),
];

export const validateLogGeneration = [
  body('concept').isObject().withMessage('concept is required'),
];

export const validateSearch = [
  query('q')
    .isString()
    .withMessage('q is required')
    .trim()
    .notEmpty()
    .withMessage('q is required')
    .isLength({ max: 200 })
    .withMessage('q is too long'),
  query('limit').optional().isInt({ min: 1, max: 10 }).withMessage('limit must be 1–10'),
];

export const validateBoardId = [
  param('boardId')
    .isString()
    .trim()
    .isLength({ min: 1, max: 64 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('invalid boardId'),
];

export const validateAlbumId = [
  param('albumId')
    .isString()
    .trim()
    .isLength({ min: 1, max: 256 })
    .withMessage('invalid albumId'),
];

export const validateGoogleToken = [
  body('accessToken')
    .isString()
    .withMessage('accessToken is required')
    .isLength({ min: 10, max: 4096 })
    .withMessage('accessToken is invalid'),
];

export const validateOptionalAccessToken = [
  query('accessToken').optional().isString().isLength({ max: 4096 }),
];

export const validateOptionalLimit = [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1–50'),
];
