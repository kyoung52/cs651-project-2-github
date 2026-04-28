/**
 * Google Photos Picker API wrapper.
 *
 * The Picker API (https://photospicker.googleapis.com/v1/) is Google's
 * replacement for the deprecated photoslibrary read scopes. Each user
 * picks photos in a Google-hosted dialog, then the app reads only the
 * picked items via a session token. Different scope:
 *   https://www.googleapis.com/auth/photospicker.mediaitems.readonly
 *
 * No app verification is required while the OAuth consent screen is in
 * Testing mode (the user explicitly confirms each session — Google's UI
 * is the consent gate).
 *
 * Reference docs:
 *   https://developers.google.com/photos/picker/reference/rest/v1/sessions
 *   https://developers.google.com/photos/picker/reference/rest/v1/mediaItems
 *
 * Each call:
 *   - Returns parsed JSON on 2xx.
 *   - Throws an Error tagged with .status (HTTP code) on non-2xx.
 *   - Logs once via logExternalApiCall.
 */
import { logExternalApiCall } from '../utils/logger.js';

const PICKER_BASE = 'https://photospicker.googleapis.com/v1';

async function pickerFetch({ method, path, accessToken, body, operation }) {
  const url = `${PICKER_BASE}${path}`;
  const start = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    logExternalApiCall({
      service: 'google_photos_picker',
      operation,
      method,
      url,
      ok: false,
      durationMs: Date.now() - start,
      errorMessage: err?.message || String(err),
    });
    const e = new Error(err?.message || 'fetch failed');
    e.status = 0;
    throw e;
  }

  let payload = null;
  // 204 No Content is valid for DELETE; everything else carries a JSON body.
  if (res.status !== 204) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  }

  logExternalApiCall({
    service: 'google_photos_picker',
    operation,
    method,
    url,
    status: res.status,
    ok: res.ok,
    durationMs: Date.now() - start,
    errorMessage: res.ok ? undefined : payload?.error?.message || `status ${res.status}`,
  });

  if (!res.ok) {
    const e = new Error(payload?.error?.message || `Picker ${operation} failed (${res.status})`);
    e.status = res.status;
    e.body = payload;
    throw e;
  }
  return payload || {};
}

/**
 * Create a new picker session. Returns the full session object, including:
 *   id            — session id (also embedded in pickerUri)
 *   pickerUri     — the URL the user opens to choose photos
 *   expireTime    — RFC 3339 timestamp; sessions expire after ~30 minutes
 *   pollingConfig — { pollInterval, timeoutIn } durations
 *   mediaItemsSet — false until the user finishes picking
 */
export async function createSession(accessToken) {
  return pickerFetch({
    method: 'POST',
    path: '/sessions',
    accessToken,
    body: {},
    operation: 'create_session',
  });
}

/**
 * Read session state. The interesting field is `mediaItemsSet` — true once
 * the user has confirmed their selection. The session also exposes
 * `pickingConfig` (selection limits) and may include an updated
 * `pollingConfig`.
 */
export async function pollSession(accessToken, sessionId) {
  return pickerFetch({
    method: 'GET',
    path: `/sessions/${encodeURIComponent(sessionId)}`,
    accessToken,
    operation: 'poll_session',
  });
}

/**
 * List the picked items for a session. Each item carries:
 *   id, createTime, type ("PHOTO"|"VIDEO"|"TYPE_UNSPECIFIED"),
 *   mediaFile: { baseUrl, mimeType, filename, mediaFileMetadata: {...} }
 * The baseUrl works the same way as Library: append "=d" for download or
 * "=w<width>" for a thumbnail. Bytes still require the user's bearer token.
 */
export async function listPickedItems(accessToken, sessionId) {
  const params = new URLSearchParams({ sessionId, pageSize: '50' });
  return pickerFetch({
    method: 'GET',
    path: `/mediaItems?${params.toString()}`,
    accessToken,
    operation: 'list_picked_items',
  });
}

/**
 * Delete a session once we're done with it. Best-effort — the API also
 * cleans up automatically after expiry, so swallowing errors is fine.
 */
export async function deleteSession(accessToken, sessionId) {
  return pickerFetch({
    method: 'DELETE',
    path: `/sessions/${encodeURIComponent(sessionId)}`,
    accessToken,
    operation: 'delete_session',
  });
}
