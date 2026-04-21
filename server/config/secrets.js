/**
 * Centralized access to server-side secrets and public config.
 * All values read from env vars; never commit real keys.
 *
 * Also exposes getServiceStatus() — used by GET /api/config to let the SPA
 * show friendly "not configured" UI instead of crashing on missing keys.
 */

function trimmed(v) {
  return typeof v === 'string' ? v.trim() : '';
}

export function getGeminiApiKey() {
  return trimmed(process.env.GEMINI_API_KEY) || null;
}

export function getPinterestConfig() {
  return {
    appId: trimmed(process.env.PINTEREST_APP_ID),
    appSecret: trimmed(process.env.PINTEREST_APP_SECRET),
    publicAppUrl: trimmed(process.env.PUBLIC_APP_URL) || 'http://localhost:8080',
  };
}

export function getGoogleSearchConfig() {
  return {
    apiKey: trimmed(process.env.GOOGLE_SEARCH_API_KEY),
    engineId: trimmed(process.env.GOOGLE_SEARCH_ENGINE_ID),
  };
}

export function isGeminiConfigured() {
  return Boolean(getGeminiApiKey());
}

export function isPinterestConfigured() {
  const { appId, appSecret } = getPinterestConfig();
  return Boolean(appId && appSecret);
}

export function isGoogleSearchConfigured() {
  const { apiKey, engineId } = getGoogleSearchConfig();
  return Boolean(apiKey && engineId);
}

export function isFirebaseAdminConfigured() {
  if (trimmed(process.env.GOOGLE_APPLICATION_CREDENTIALS)) return true;
  return Boolean(
    trimmed(process.env.FIREBASE_PROJECT_ID) &&
      trimmed(process.env.FIREBASE_CLIENT_EMAIL) &&
      trimmed(process.env.FIREBASE_PRIVATE_KEY)
  );
}

/**
 * Public config snapshot — safe to send to the browser.
 * Never includes secret values, only booleans + friendly reasons.
 */
export function getServiceStatus() {
  const firebase = {
    configured: isFirebaseAdminConfigured(),
    reason: isFirebaseAdminConfigured()
      ? undefined
      : 'Firebase Admin credentials not set on the server.',
  };

  const gemini = {
    configured: isGeminiConfigured(),
    reason: isGeminiConfigured()
      ? undefined
      : 'GEMINI_API_KEY is not set. AI analysis and generation are disabled.',
  };

  const pinterest = {
    configured: isPinterestConfigured(),
    reason: isPinterestConfigured()
      ? undefined
      : 'Pinterest OAuth app is not configured.',
  };

  const googleSearch = {
    configured: isGoogleSearchConfigured(),
    reason: isGoogleSearchConfigured()
      ? undefined
      : 'Google Custom Search is not configured. Similar inspiration results will be hidden.',
  };

  return {
    firebase,
    gemini,
    pinterest,
    googleSearch,
  };
}
