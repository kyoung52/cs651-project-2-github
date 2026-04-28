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

export function getVertexConfig() {
  return {
    projectId:
      trimmed(process.env.VERTEX_PROJECT_ID) ||
      trimmed(process.env.GOOGLE_CLOUD_PROJECT) ||
      trimmed(process.env.GCLOUD_PROJECT),
    location: trimmed(process.env.VERTEX_LOCATION) || 'us-central1',
  };
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
  // Server-side Gemini calls use Vertex AI only (`geminiService.js` + Flash Image).
  const vx = getVertexConfig();
  return Boolean(vx.projectId && vx.location);
}

export function isPinterestConfigured() {
  const { appId, appSecret } = getPinterestConfig();
  const devToken = trimmed(process.env.PINTEREST_DEV_ACCESS_TOKEN);
  return Boolean((appId && appSecret) || devToken);
}

export function isGoogleSearchConfigured() {
  const { apiKey, engineId } = getGoogleSearchConfig();
  return Boolean(apiKey && engineId);
}

/**
 * Vertex Gemini Flash Image preview (same GCP project as Vertex text).
 * Set VERTEX_IMAGE_GENERATION=false to skip and fall back to search/stock only.
 */
export function isVertexFlashImagePreviewEnabled() {
  if (trimmed(process.env.VERTEX_IMAGE_GENERATION).toLowerCase() === 'false') {
    return false;
  }
  const vx = getVertexConfig();
  return Boolean(vx.projectId && vx.location);
}

/**
 * Vertex Gemini grounded search ("googleSearch" tool) for related-items
 * suggestions with live price context. Disabled if VERTEX_GROUNDING=false
 * or if Vertex isn't configured at all. Region support varies — the route
 * also catches per-call failures and returns an empty result with a reason.
 */
export function isGroundingConfigured() {
  if (trimmed(process.env.VERTEX_GROUNDING).toLowerCase() === 'false') return false;
  const vx = getVertexConfig();
  return Boolean(vx.projectId && vx.location);
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
      : 'Vertex AI is not configured. Set VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) and VERTEX_LOCATION.',
  };

  const pinterest = {
    configured: isPinterestConfigured(),
    reason: isPinterestConfigured()
      ? undefined
      : 'Pinterest is not configured. Set PINTEREST_APP_ID + PINTEREST_APP_SECRET, or PINTEREST_DEV_ACCESS_TOKEN for read-only dev.',
  };

  const googleSearch = {
    configured: isGoogleSearchConfigured(),
    reason: isGoogleSearchConfigured()
      ? undefined
      : 'Google Custom Search is not configured. Similar inspiration results will be hidden.',
  };

  const vertexFlashImageEnabled = isVertexFlashImagePreviewEnabled();
  const vertexFlashImage = {
    configured: vertexFlashImageEnabled,
    reason: vertexFlashImageEnabled
      ? undefined
      : trimmed(process.env.VERTEX_IMAGE_GENERATION).toLowerCase() === 'false'
        ? 'Vertex image preview is disabled (VERTEX_IMAGE_GENERATION=false).'
        : 'Vertex project/location is not set, so Gemini Flash Image preview is unavailable.',
  };

  const groundedEnabled = isGroundingConfigured();
  const grounding = {
    configured: groundedEnabled,
    reason: groundedEnabled
      ? undefined
      : trimmed(process.env.VERTEX_GROUNDING).toLowerCase() === 'false'
        ? 'Grounded suggestions disabled (VERTEX_GROUNDING=false).'
        : 'Vertex project/location is not set, so grounded suggestions are unavailable.',
  };

  return {
    firebase,
    gemini,
    pinterest,
    googleSearch,
    vertexFlashImage,
    grounding,
  };
}
