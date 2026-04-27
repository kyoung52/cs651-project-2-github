/**
 * Prepare client project payloads for Firestore (~1 MiB/doc) and sane API limits.
 * Generated hero images use data: URIs that must not be persisted as giant strings.
 */

function sanitizeFirestoreValue(value, depth = 0) {
  if (depth > 10) return value;
  if (value === undefined) return null;
  if (value == null) return value;

  if (typeof value === 'string') {
    // Inline images (data: URLs) are too large for Firestore; user can re-generate in the app.
    if (value.startsWith('data:')) return null;
    return value;
  }

  if (Array.isArray(value)) {
    // Firestore rejects `undefined` in arrays too; normalize to null.
    return value.map((v) => sanitizeFirestoreValue(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const next = sanitizeFirestoreValue(v, depth + 1);
      // Avoid writing undefined anywhere (Firestore rejects it).
      out[k] = next === undefined ? null : next;
    }
    return out;
  }

  return value;
}

/**
 * Clone payload and remove inline image data URIs so Firestore saves stay under limits.
 * @param {object} payload
 */
export function sanitizeProjectPayloadForStorage(payload) {
  if (!payload || typeof payload !== 'object') return {};
  try {
    return sanitizeFirestoreValue(
      typeof structuredClone === 'function'
        ? structuredClone(payload)
        : JSON.parse(JSON.stringify(payload))
    );
  } catch {
    return {};
  }
}
