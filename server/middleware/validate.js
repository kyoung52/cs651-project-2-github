/**
 * Reusable express-validator chains and a small runValidators() helper that
 * collapses errors into the unified { error, code } response shape.
 *
 * SSRF hardening for remote URL inputs lives here (see validateProcessUrl)
 * because we must block private/link-local addresses before fetching.
 */
import { body, param, query, validationResult } from 'express-validator';
import dns from 'node:dns/promises';
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

// DNS-resolved follow-up to isSafePublicUrl: rejects hostnames that resolve
// into private/loopback/link-local ranges (e.g. DNS rebinding, Cloud Run
// metadata server). Throws an Error with .code='BLOCKED_HOST' on rejection.
function ipv4InCidr(ip, cidr) {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const toInt = (a) => a.split('.').reduce((n, p) => ((n << 8) | Number(p)) >>> 0, 0);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(base) & mask);
}
const BLOCKED_V4_CIDRS = [
  '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.168.0.0/16', '100.64.0.0/10', '0.0.0.0/8', '224.0.0.0/4', '240.0.0.0/4',
];
function isPrivateV4(ip) { return BLOCKED_V4_CIDRS.some((c) => ipv4InCidr(ip, c)); }
function isPrivateV6(ip) {
  const lc = ip.toLowerCase();
  return (
    lc === '::1' ||
    lc.startsWith('fc') || lc.startsWith('fd') || lc.startsWith('fe80') ||
    lc.startsWith('::ffff:127.') || lc.startsWith('::ffff:10.') ||
    lc.startsWith('::ffff:169.254.') || lc.startsWith('::ffff:192.168.') ||
    lc.startsWith('::ffff:172.')
  );
}

export async function assertSafePublicUrl(value) {
  if (!isSafePublicUrl(value)) {
    const e = new Error('blocked host'); e.code = 'BLOCKED_HOST'; throw e;
  }
  const host = new URL(value).hostname;
  let answers = [];
  try {
    answers = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    const e = new Error('dns lookup failed'); e.code = 'BLOCKED_HOST'; throw e;
  }
  for (const a of answers) {
    if (a.family === 4 && isPrivateV4(a.address)) {
      const e = new Error(`private ipv4 ${a.address}`); e.code = 'BLOCKED_HOST'; throw e;
    }
    if (a.family === 6 && isPrivateV6(a.address)) {
      const e = new Error(`private ipv6 ${a.address}`); e.code = 'BLOCKED_HOST'; throw e;
    }
  }
}

/* ----------------------------- Route chains ------------------------------ */

// jobId is optional and arrives as a string over multipart. We validate the
// shape (UUID-ish) so a hostile client can't poison the in-memory map with
// huge keys or non-strings.
const JOB_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

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
  body('jobId')
    .optional()
    .isString()
    .matches(JOB_ID_REGEX)
    .withMessage('jobId must be 8–128 url-safe characters'),
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

export const validateProcessUrls = [
  body('urls')
    .isArray({ min: 1, max: 6 })
    .withMessage('urls must be an array of 1–6 https URLs'),
  body('urls.*')
    .isString()
    .isLength({ min: 8, max: 2048 })
    .custom(isSafePublicUrl)
    .withMessage('each url must be a public https URL'),
  body('chatContext').optional().isString().isLength({ max: 8000 }),
  body('useRealisticFurniture')
    .optional()
    .custom((v) => v === true || v === false || v === 'true' || v === 'false')
    .withMessage('useRealisticFurniture must be boolean'),
];

export const validateGooglePhotosSelection = [
  body('items')
    .isArray({ min: 1, max: 6 })
    .withMessage('items must be an array of 1–6 Google Photos items'),
  body('items.*.id').isString().isLength({ min: 1, max: 256 }).withMessage('each item must include an id'),
  body('items.*.baseUrl')
    .isString()
    .isLength({ min: 8, max: 2048 })
    .custom(isSafePublicUrl)
    .withMessage('each item must include a public https baseUrl'),
  body('items.*.mimeType').optional().isString().isLength({ max: 80 }),
  body('items.*.filename').optional().isString().isLength({ max: 256 }),
  body('chatContext').optional().isString().isLength({ max: 8000 }),
  body('useRealisticFurniture')
    .optional()
    .custom((v) => v === true || v === false || v === 'true' || v === 'false')
    .withMessage('useRealisticFurniture must be boolean'),
];

export const validateRefine = [
  body('previousConcept').isObject().withMessage('previousConcept is required'),
  body('feedback')
    .isString()
    .withMessage('feedback is required')
    .isLength({ min: 1, max: 2000 })
    .withMessage('feedback must be 1–2000 characters'),
];

export const validateMediaRefine = [
  // previousConcept and regen arrive as JSON strings over multipart/form-data
  // and are parsed in the handler. Only require previousConcept's presence here.
  body('previousConcept').exists({ checkNull: true }).withMessage('previousConcept is required'),
  body('feedback')
    .isString()
    .withMessage('feedback is required')
    .isLength({ min: 1, max: 2000 })
    .withMessage('feedback must be 1–2000 characters'),
  body('chatContext').optional().isString().isLength({ max: 8000 }),
  body('jobId')
    .optional()
    .isString()
    .matches(JOB_ID_REGEX)
    .withMessage('jobId must be 8–128 url-safe characters'),
];

export const validateSaveProject = [
  body('name')
    .isString()
    .withMessage('name is required')
    .isLength({ min: 1, max: 120 })
    .withMessage('name must be 1–120 characters'),
  body('payload').optional().isObject().withMessage('payload must be an object'),
];

export const validateProjectId = [
  param('id')
    .isString()
    .withMessage('id is required')
    .isLength({ min: 3, max: 128 })
    .withMessage('id is invalid'),
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
