/**
 * Vertex Gemini grounded-search wrapper for "related items + price estimates".
 *
 * Uses the 2.5 grounding tool `tools: [{ googleSearch: {} }]` so the model
 * fetches live retailer pages while answering. The response is required to
 * be a JSON list; we sanitize and validate every item server-side and drop
 * malformed entries rather than failing the whole request.
 *
 * If grounding isn't available in the project's region (Vertex returns 404
 * or 400 on the tool param), the helper returns an empty result with a
 * `reason` and the route surfaces a graceful empty state instead of an
 * error. AI Studio fallback (with GEMINI_API_KEY) can be added later — left
 * out here because we don't want to ship unverified network paths.
 */
import { VertexAI } from '@google-cloud/vertexai';
import { HttpError } from '../utils/httpError.js';
import { logExternalApiCall } from '../utils/logger.js';

const DEFAULT_GROUNDED_MODEL =
  process.env.VERTEX_MODEL_GROUNDED ||
  process.env.VERTEX_MODEL_TEXT ||
  process.env.GEMINI_MODEL_TEXT ||
  'gemini-2.5-flash';

const ALLOWED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD']);
const ALLOWED_CONFIDENCE = new Set(['low', 'medium', 'high']);
const MAX_ITEMS = 6;

function vertexProjectAndLocation() {
  const project =
    process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  if (!project) return null;
  return { project, location };
}

export function isGroundingEnabled() {
  if (String(process.env.VERTEX_GROUNDING || '').toLowerCase() === 'false') return false;
  return Boolean(vertexProjectAndLocation());
}

function sanitizeString(s, maxLen = 240) {
  return typeof s === 'string' ? s.trim().slice(0, maxLen) : '';
}

function sanitizeNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/**
 * Reduce the raw model output to a clean list. Drops items that:
 *   - lack a name or category
 *   - have non-finite or non-positive prices
 *   - have priceLow > priceHigh (model often inverts these)
 *   - have an unexpected currency or confidence value
 */
function sanitizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const out = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const name = sanitizeString(raw.name, 120);
    const category = sanitizeString(raw.category, 60);
    if (!name || !category) continue;

    const priceLow = sanitizeNumber(raw.priceLow);
    const priceHigh = sanitizeNumber(raw.priceHigh);
    if (priceLow == null || priceHigh == null) continue;
    if (priceLow <= 0 || priceHigh <= 0) continue;
    if (priceLow > priceHigh) continue;

    const currency = String(raw.currency || 'USD').toUpperCase();
    if (!ALLOWED_CURRENCIES.has(currency)) continue;

    const confidence = ALLOWED_CONFIDENCE.has(raw.confidence) ? raw.confidence : 'low';
    const note = sanitizeString(raw.note, 240);

    out.push({ name, category, priceLow, priceHigh, currency, confidence, note });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/**
 * Pull citation entries (name + uri) from groundingMetadata.groundingChunks
 * if present. Resilient to the field being absent, an array, or nested.
 */
function extractCitations(response) {
  const root = response?.response ?? response;
  const cand = root?.candidates?.[0];
  const meta = cand?.groundingMetadata || cand?.grounding_metadata;
  const chunks = meta?.groundingChunks || meta?.grounding_chunks;
  if (!Array.isArray(chunks)) return [];
  const out = [];
  for (const c of chunks) {
    const web = c?.web;
    if (!web) continue;
    const title = sanitizeString(web.title, 120);
    const uri = sanitizeString(web.uri, 1024);
    if (!uri || !/^https?:\/\//i.test(uri)) continue;
    out.push({ title: title || uri, uri });
    if (out.length >= 8) break;
  }
  return out;
}

function extractText(response) {
  const root = response?.response ?? response;
  const parts = root?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
}

function tryParseJson(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  if (!(t.startsWith('{') || t.startsWith('['))) {
    const candidates = ['{', '['].map((c) => t.indexOf(c)).filter((i) => i >= 0);
    const first = candidates.length ? Math.min(...candidates) : -1;
    const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (first >= 0 && last > first) t = t.slice(first, last + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function buildPrompt(concept) {
  // Pull the small number of fields the model actually needs — keeps the
  // grounded query tight and gives consistent prices.
  const snapshot = {
    title: concept?.title || '',
    styleLabel: concept?.styleLabel || '',
    colorPalette: Array.isArray(concept?.colorPalette) ? concept.colorPalette.slice(0, 6) : [],
    keywords: Array.isArray(concept?.searchKeywords) ? concept.searchKeywords.slice(0, 8) : [],
    materials: Array.isArray(concept?.analysisKeywords) ? concept.analysisKeywords.slice(0, 8) : [],
    blueprintNotes: typeof concept?.blueprintNotes === 'string' ? concept.blueprintNotes.slice(0, 240) : '',
  };

  return `You are recommending real, currently-purchasable furniture and decor items
that fit this room concept. Use Google Search to find typical retail prices and
ground every item in a real-world product page.

Return ONLY valid JSON (no markdown):
{
  "items": [
    {
      "name": "short product name (no brand if uncertain)",
      "category": "sofa|chair|rug|lamp|side table|coffee table|shelving|art|planter|bed|dresser|other",
      "priceLow": 199,
      "priceHigh": 349,
      "currency": "USD",
      "confidence": "low|medium|high",
      "note": "1 sentence: what role this serves in the concept"
    }
  ]
}

Constraints:
- Provide 4-6 items.
- priceLow and priceHigh in whole-dollar (or whole-currency) units, USD by default.
- Prices must be plausible retail estimates. priceLow <= priceHigh, both > 0.
- "confidence" reflects how grounded the price estimate is in the search results.
- Items must complement the concept's palette, style, and materials.

Concept context (JSON):
${JSON.stringify(snapshot)}`;
}

/**
 * Fetch grounded related items for a concept. Never throws on the happy
 * path — returns `{ items, citations, reason? }`. `reason` is set when no
 * items came back (e.g. grounding tool not supported in this region).
 */
export async function suggestRelatedItems(concept) {
  const pl = vertexProjectAndLocation();
  if (!pl) {
    throw new HttpError(503, 'SERVICE_NOT_CONFIGURED', 'Grounded suggestions require Vertex configuration.');
  }

  const client = new VertexAI({ project: pl.project, location: pl.location });
  const model = client.getGenerativeModel({ model: DEFAULT_GROUNDED_MODEL });
  const prompt = buildPrompt(concept);

  const start = Date.now();
  let result;
  try {
    result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // 2.5-series grounding tool. Older 1.x models would use
      // { googleSearchRetrieval: {} } — we don't fall back to that here.
      tools: [{ googleSearch: {} }],
    });
    logExternalApiCall({
      service: 'vertex_ai',
      operation: 'gemini_grounded_related',
      method: 'POST',
      url: `vertex:${DEFAULT_GROUNDED_MODEL}`,
      status: 200,
      ok: true,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    logExternalApiCall({
      service: 'vertex_ai',
      operation: 'gemini_grounded_related',
      method: 'POST',
      url: `vertex:${DEFAULT_GROUNDED_MODEL}`,
      ok: false,
      durationMs: Date.now() - start,
      errorMessage: msg,
    });
    // Region/tool support: return empty rather than 500. Surface a reason
    // so the SPA can render a friendly note.
    if (/tool|grounding|googleSearch|404|NOT_FOUND|INVALID_ARGUMENT/i.test(msg)) {
      return { items: [], citations: [], reason: 'grounding_unavailable' };
    }
    throw new HttpError(502, 'AI_UPSTREAM', 'Grounded suggestions failed. Please try again.');
  }

  const text = extractText(result);
  const parsed = tryParseJson(text);
  const items = sanitizeItems(parsed?.items);
  const citations = extractCitations(result);
  return { items, citations };
}
