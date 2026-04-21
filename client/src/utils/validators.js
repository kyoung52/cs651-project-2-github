/**
 * Client-side validation helpers (defense in depth; server validates again).
 */

export function isValidEmail(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) && t.length <= 254;
}

export function isReasonablePassword(s) {
  if (typeof s !== 'string') return false;
  return s.length >= 8 && s.length <= 128;
}

export function sanitizeChatInput(s) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, 8000);
}
