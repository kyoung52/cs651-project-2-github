/**
 * Google Gemini API wrapper: image/audio analysis and room concept generation.
 * Uses Vertex AI Gemini on Google Cloud (service account / ADC).
 *
 * Cloud Run: set VERTEX_PROJECT_ID (optional; defaults to GOOGLE_CLOUD_PROJECT)
 * and VERTEX_LOCATION (default us-central1). Ensure the runtime service account
 * has `roles/aiplatform.user`.
 */
import crypto from 'crypto';
import { HttpError } from '../utils/httpError.js';
import { VertexAI } from '@google-cloud/vertexai';
import { logExternalApiCall } from '../utils/logger.js';

// Vertex model availability changes over time (models retire / IDs change).
// Defaults follow current Vertex docs for Gemini 2.5 Flash in `us-central1`.
// Override via:
//   VERTEX_MODEL_ANALYSIS / VERTEX_MODEL_TEXT (or GEMINI_MODEL_* aliases)
// Optional CSV fallbacks if your primary 404s:
//   VERTEX_MODEL_ANALYSIS_FALLBACKS / VERTEX_MODEL_TEXT_FALLBACKS
//
// See: https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash
const MODEL_ANALYSIS =
  process.env.GEMINI_MODEL_ANALYSIS ||
  process.env.VERTEX_MODEL_ANALYSIS ||
  'gemini-2.5-flash';
const MODEL_TEXT =
  process.env.GEMINI_MODEL_TEXT || process.env.VERTEX_MODEL_TEXT || 'gemini-2.5-flash';

const DEFAULT_ANALYSIS_FALLBACKS = ['gemini-2.0-flash-001', 'gemini-2.0-flash', 'gemini-1.5-flash-002'];
const DEFAULT_TEXT_FALLBACKS = ['gemini-2.0-flash-001', 'gemini-2.0-flash', 'gemini-1.5-flash-002'];

export function getVertexTextModelIds() {
  return { analysis: MODEL_ANALYSIS, text: MODEL_TEXT };
}

function parseCsvEnv(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildModelCandidates(primary, csvFallbacks, defaults) {
  const out = [];
  const seen = new Set();
  const push = (m) => {
    const id = String(m || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  push(primary);
  for (const m of csvFallbacks) push(m);
  for (const m of defaults) push(m);
  return out;
}

function vertexHttpStatus(err) {
  return (
    err?.status ||
    err?.code ||
    err?.response?.status ||
    (String(err?.message || err || '').includes('status: 404') ? 404 : undefined) ||
    (String(err?.message || err || '').includes('status: 403') ? 403 : undefined) ||
    (String(err?.message || err || '').includes('status: 401') ? 401 : undefined) ||
    (String(err?.message || err || '').includes('[429') ? 429 : undefined)
  );
}

function isVertexPublisherModelNotFound(err) {
  const status = vertexHttpStatus(err);
  if (status === 404) return true;
  const raw = String(err?.message || err || '');
  return (
    raw.includes('NOT_FOUND') &&
    (raw.includes('Publisher Model') || raw.includes('publishers/google/models'))
  );
}

async function generateContentWithModelFallback({
  client,
  label,
  primaryModel,
  csvFallbacks,
  defaultFallbacks,
  request,
}) {
  const candidates = buildModelCandidates(primaryModel, csvFallbacks, defaultFallbacks);
  let lastErr;

  for (let i = 0; i < candidates.length; i += 1) {
    const modelId = candidates[i];
    const start = Date.now();
    try {
      const model = client.getGenerativeModel({ model: modelId });
      const out = await model.generateContent(request);
      logExternalApiCall({
        service: 'vertex_ai',
        operation: `gemini_${label}_generate`,
        method: 'POST',
        url: `vertex:${modelId}`,
        status: 200,
        ok: true,
        durationMs: Date.now() - start,
      });
      return out;
    } catch (err) {
      lastErr = err;
      const status = vertexHttpStatus(err);
      logExternalApiCall({
        service: 'vertex_ai',
        operation: `gemini_${label}_generate`,
        method: 'POST',
        url: `vertex:${modelId}`,
        status: typeof status === 'number' ? status : undefined,
        ok: false,
        durationMs: Date.now() - start,
        errorMessage: err?.message || String(err),
      });
      if (status === 429 || status === 401 || status === 403) {
        throw err;
      }
      if (isVertexPublisherModelNotFound(err) && i < candidates.length - 1) {
        console.warn(`[vertex:${label}] model not found; retrying`, { from: modelId, next: candidates[i + 1] });
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('Vertex model fallback exhausted');
}

function getVertex() {
  const project =
    process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  if (!project) {
    throw new HttpError(
      503,
      'VERTEX_NOT_CONFIGURED',
      'Vertex AI is not configured on this server.'
    );
  }
  return { project, location, client: new VertexAI({ project, location }) };
}

function normalizeUpstreamError(err, fallbackMessage) {
  const raw = String(err?.message || err || '');
  const status = vertexHttpStatus(err);
  if (status === 429) {
    throw new HttpError(
      429,
      'AI_RATE_LIMITED',
      'AI is rate-limited right now. Please wait a bit and try again.'
    );
  }
  if (status === 401 || status === 403) {
    throw new HttpError(
      502,
      'AI_AUTH_FAILED',
      'AI credentials are not authorized. Check Vertex AI permissions.'
    );
  }
  if (status === 404 && isVertexPublisherModelNotFound(err)) {
    throw new HttpError(
      502,
      'AI_VERTEX_MODEL_NOT_FOUND',
      'The configured Vertex Gemini model was not found for this project/region. Update VERTEX_MODEL_* env vars to a model your project can access.'
    );
  }
  throw new HttpError(502, 'AI_UPSTREAM', fallbackMessage);
}

/**
 * SHA-256 hash of buffer for cache keys.
 * @param {Buffer} buffer
 */
export function hashContent(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Parse JSON from model response text (strips markdown fences if present).
 * @param {string} text
 */
function parseJsonFromResponse(text) {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(t);
  } catch (_err) {
    // The model sometimes returns non-JSON or extra prose despite instructions.
    // Never return raw model output to clients.
    throw new HttpError(
      502,
      'AI_BAD_RESPONSE',
      'AI returned an unexpected response. Please try again.'
    );
  }
}

function extractTextFromVertexResponse(result) {
  const candidate = result?.response?.candidates?.[0];
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('')
    : '';
  return String(text || '').trim();
}

/**
 * Analyze an image for interior design keywords, palette, style.
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
export async function analyzeImage(buffer, mimeType) {
  const { client } = getVertex();

  const prompt = `You are an interior design assistant. Analyze this image.
Return ONLY valid JSON with this exact shape (no markdown):
{
  "keywords": ["string", ...],
  "colorPalette": ["#hex or color name", ...],
  "styleTags": ["string", ...],
  "materials": ["string", ...],
  "roomType": "string or unknown",
  "summary": "one sentence"
}`;

  try {
    const result = await generateContentWithModelFallback({
      client,
      label: 'image',
      primaryModel: MODEL_ANALYSIS,
      csvFallbacks: parseCsvEnv('VERTEX_MODEL_ANALYSIS_FALLBACKS'),
      defaultFallbacks: DEFAULT_ANALYSIS_FALLBACKS,
      request: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: buffer.toString('base64'),
                },
              },
            ],
          },
        ],
      },
    });
    const text = extractTextFromVertexResponse(result);
    return parseJsonFromResponse(text);
  } catch (err) {
    console.warn('[vertex:image]', err?.message || err);
    normalizeUpstreamError(err, 'AI image analysis failed. Please try again.');
  }
}

/**
 * Analyze audio for mood and design-relevant keywords.
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
export async function analyzeAudio(buffer, mimeType) {
  const { client } = getVertex();

  const prompt = `You are an interior design assistant. Listen to this audio and extract design-driving signals.

Treat the audio as a primary creative brief (equal weight to images and user text). Infer the vibe and translate it into concrete interior design direction.

Return ONLY valid JSON (no markdown) with this exact shape:
{
  "keywords": ["string", ...],
  "moodTags": ["string", ...],
  "energy": "low|medium|high",
  "tempo": "slow|mid|fast|unknown",
  "genreHints": ["string", ...],
  "instrumentation": ["string", ...],
  "eraOrReference": ["string", ...],
  "lightingMood": ["string", ...],
  "colorPaletteHints": ["#hex or color name", ...],
  "materialMood": ["string", ...],
  "styleAssociations": ["string", ...],
  "spatialFeel": ["cozy|open|minimal|maximal|warm|cool|dramatic|serene|other", ...],
  "summary": "one sentence describing the room vibe this audio suggests"
}`;

  try {
    const result = await generateContentWithModelFallback({
      client,
      label: 'audio',
      primaryModel: MODEL_ANALYSIS,
      csvFallbacks: parseCsvEnv('VERTEX_MODEL_ANALYSIS_FALLBACKS'),
      defaultFallbacks: DEFAULT_ANALYSIS_FALLBACKS,
      request: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType || 'audio/mpeg',
                  data: buffer.toString('base64'),
                },
              },
            ],
          },
        ],
      },
    });
    const text = extractTextFromVertexResponse(result);
    return parseJsonFromResponse(text);
  } catch (err) {
    console.warn('[vertex:audio]', err?.message || err);
    normalizeUpstreamError(err, 'AI audio analysis failed. Please try again.');
  }
}

/**
 * Combined room inspiration from prior analyses + optional user chat.
 * @param {object} params
 * @param {object[]} params.imageAnalyses
 * @param {object[]} params.audioAnalyses
 * @param {string} [params.chatContext]
 * @param {boolean} [params.useRealisticFurniture]
 */
export async function generateRoomConcept({
  imageAnalyses = [],
  audioAnalyses = [],
  chatContext = '',
  useRealisticFurniture = true,
}) {
  const { client } = getVertex();

  const prompt = `You are Roomify, an AI interior design assistant.
Combine the following signals into ONE cohesive room inspiration concept.

IMPORTANT: Weight ALL THREE inputs equally:
1) User text (explicit preferences/constraints)
2) Image analyses (concrete visual cues)
3) Audio analyses (mood/energy/tempo/instrumentation)

Your output MUST visibly incorporate each input category. If one category is missing, lean more on the other two.

User preferences (sanitized): ${chatContext || '(none)'}
Use realistic furniture in visualization notes: ${useRealisticFurniture}

Audio analyses (JSON): ${JSON.stringify(audioAnalyses)}
Image analyses (JSON): ${JSON.stringify(imageAnalyses)}

Blueprint requirements:
- Provide an estimated room size in blueprint.room.width and blueprint.room.height (in cm).
- Provide estimated dimensions for each placed element in elements[].w and elements[].h (in cm).
- Use plausible real-world sizes; keep all x/y/w/h within the room bounds.

Return ONLY valid JSON (no markdown):
{
  "title": "short project title",
  "conceptDescription": "2-4 sentences describing the room vision",
  "searchKeywords": ["keyword for image search", ...],
  "styleLabel": "e.g. Refined Brutalism",
  "colorPalette": ["#hex or name", ...],
  "analysisKeywords": ["tag", ...],
  "blueprintNotes": "1-2 sentence summary of the floor plan intent",
  "blueprint": {
    "room": { "shape": "rect", "width": 200, "height": 140, "unit": "cm" },
    "north": "top",
    "elements": [
      {
        "type": "sofa|bed|table|chair|rug|lamp|plant|tv|desk|shelf|coffeeTable|sideTable|window|door|dresser|nightstand|other",
        "label": "short label",
        "x": 0,
        "y": 0,
        "w": 10,
        "h": 10,
        "rotation": 0
      }
    ]
  }
}`;

  try {
    const result = await generateContentWithModelFallback({
      client,
      label: 'concept',
      primaryModel: MODEL_TEXT,
      csvFallbacks: parseCsvEnv('VERTEX_MODEL_TEXT_FALLBACKS'),
      defaultFallbacks: DEFAULT_TEXT_FALLBACKS,
      request: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      },
    });
    const text = extractTextFromVertexResponse(result);
    return parseJsonFromResponse(text);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.warn('[vertex:concept]', err?.message || err);
    normalizeUpstreamError(err, 'AI concept generation failed. Please try again.');
  }
}

/**
 * Optional: short refinement text from user feedback.
 */
export async function refineConcept(previousConceptJson, userFeedback) {
  const { client } = getVertex();
  const prompt = `Previous concept: ${JSON.stringify(previousConceptJson)}
User refinement request: ${userFeedback.slice(0, 2000)}
Return the same JSON shape as generateRoomConcept with updated fields. Ensure blueprintNotes and blueprint (including element positions/sizes) are updated if the changes affect layout. Valid JSON only, no markdown.`;
  try {
    const result = await generateContentWithModelFallback({
      client,
      label: 'refine',
      primaryModel: MODEL_TEXT,
      csvFallbacks: parseCsvEnv('VERTEX_MODEL_TEXT_FALLBACKS'),
      defaultFallbacks: DEFAULT_TEXT_FALLBACKS,
      request: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      },
    });
    const text = extractTextFromVertexResponse(result);
    return parseJsonFromResponse(text);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.warn('[vertex:refine]', err?.message || err);
    normalizeUpstreamError(err, 'AI refinement failed. Please try again.');
  }
}
