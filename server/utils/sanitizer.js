/**
 * Server-side HTML/text sanitization for user-provided strings.
 * Uses sanitize-html with a strict allowlist (no tags by default).
 */
import sanitizeHtml from 'sanitize-html';

const strictOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

/**
 * @param {string} input
 * @returns {string}
 */
export function sanitizePlainText(input) {
  if (typeof input !== 'string') return '';
  return sanitizeHtml(input.trim(), strictOptions);
}

/**
 * Allow a small set of tags for rich chat (optional future use).
 * @param {string} input
 * @returns {string}
 */
export function sanitizeChatMessage(input) {
  if (typeof input !== 'string') return '';
  return sanitizeHtml(input.trim(), {
    allowedTags: ['b', 'i', 'em', 'strong'],
    allowedAttributes: {},
  });
}
