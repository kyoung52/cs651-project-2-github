/**
 * Express middleware that deep-sanitizes string values in req.body.
 *
 * - All string leaves in req.body are passed through sanitizePlainText.
 * - Known free-text fields are always sanitized; unknown fields get the
 *   same strict sanitizer as a safety net (no rich text is expected).
 * - Depth-bounded to prevent prototype-pollution style attacks.
 */
import { sanitizePlainText } from '../utils/sanitizer.js';

const MAX_DEPTH = 6;
const MAX_STRING_LEN = 20_000;

/** Keys we know contain free text — always sanitized. */
const KNOWN_TEXT_FIELDS = new Set([
  'message',
  'projectName',
  'description',
  'chatMessage',
  'chatContext',
  'theme',
  'feedback',
  'name',
  'title',
  'label',
  'summary',
  'conceptDescription',
  'styleLabel',
  'blueprintNotes',
  'roomType',
]);

function sanitizeValue(value, depth) {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return undefined;

  if (typeof value === 'string') {
    const truncated = value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) : value;
    return sanitizePlainText(truncated);
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // Ignore prototype-pollution vectors
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = sanitizeValue(v, depth + 1);
    }
    return out;
  }

  return value;
}

/**
 * Deep-sanitize the entire request body. Strings everywhere become safe
 * plain text; non-string primitives pass through unchanged.
 */
export function sanitizeBodyStrings(req, _res, next) {
  if (!req.body || typeof req.body !== 'object') return next();
  req.body = sanitizeValue(req.body, 0);
  return next();
}

/**
 * Exported so routes can also sanitize a single value explicitly.
 */
export function deepSanitize(value) {
  return sanitizeValue(value, 0);
}

export { KNOWN_TEXT_FIELDS };
