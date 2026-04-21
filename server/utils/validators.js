/**
 * Shared validation helpers for IDs, lengths, and safe strings.
 */

const UUID_LIKE = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFE_FILENAME = /^[a-zA-Z0-9._-]{1,255}$/;

export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

export function maxLength(max) {
  return (v) => typeof v === 'string' && v.length <= max;
}

export function isUuidLike(v) {
  return typeof v === 'string' && UUID_LIKE.test(v);
}

export function isSafeFilename(v) {
  return typeof v === 'string' && SAFE_FILENAME.test(v);
}

/** Allowed MIME types for media uploads */
export const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp3',
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
