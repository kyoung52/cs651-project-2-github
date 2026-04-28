/**
 * Axios instance for the Roomify API.
 *
 * - Attaches the Firebase ID token automatically when set via `setAuthToken`.
 * - A response interceptor normalizes every error to a plain `Error` whose
 *   `.message` is safe to show in the UI (falls back to generic copy if the
 *   server returned nothing).
 * - Exposes `fetchConfig()` for /api/config.
 */
import axios from 'axios';
import ReactGA from 'react-ga4';

const baseURL = import.meta.env.APP_API_BASE_URL || '';

export const api = axios.create({
  baseURL,
  timeout: 120_000,
  headers: { 'Content-Type': 'application/json' },
});

/** Translate any axios error into a friendly `Error`. */
function friendlyErrorMessage(error) {
  if (error?.code === 'ECONNABORTED') {
    return 'The request took too long. Please try again.';
  }
  const status = error?.response?.status;
  const serverMsg = error?.response?.data?.error;
  const serverCode = error?.response?.data?.code;

  if (status === 401) return 'You need to sign in again.';
  if (status === 403) return serverMsg || 'You do not have access to that resource.';
  if (status === 404) return serverMsg || 'That resource was not found.';
  if (status === 413) return 'Upload is too large (max 10MB).';
  if (status === 429) return 'Too many requests — please wait a moment.';
  if (status === 503 && serverCode === 'SERVICE_NOT_CONFIGURED') {
    return serverMsg || 'This feature is not configured on the server.';
  }
  if (status >= 500) return serverMsg || 'The server had a problem. Please try again.';
  if (typeof serverMsg === 'string' && serverMsg.trim()) return serverMsg;
  if (error?.message === 'Network Error') return 'Network error — check your connection.';
  return 'Something went wrong. Please try again.';
}

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const message = friendlyErrorMessage(error);
    const code = error?.response?.data?.code || 'REQUEST_FAILED';
    const status = error?.response?.status || 0;

    const err = new Error(message);
    err.code = code;
    err.status = status;
    err.original = error;

    try {
      ReactGA.event('api_error', {
        category: 'api',
        action: `${status}:${code}`,
        label: String(error?.config?.url || '').slice(0, 120),
      });
    } catch {
      // analytics optional
    }
    return Promise.reject(err);
  }
);

/** @param {string | null} idToken */
export function setAuthToken(idToken) {
  if (idToken) {
    api.defaults.headers.common.Authorization = `Bearer ${idToken}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

/**
 * Fetch public config + service status. Safe to call at app boot — the
 * endpoint is unauthenticated. Returns a safe default on failure.
 */
export async function fetchConfig() {
  try {
    const { data } = await api.get('/api/config');
    return data;
  } catch (err) {
    console.warn('[config] fallback defaults:', err?.message);
    return {
      status: {
        firebase: { configured: false },
        gemini: { configured: false },
        pinterest: { configured: false },
        googleSearch: { configured: false },
        vertexFlashImage: { configured: false },
      },
    };
  }
}

export default api;
