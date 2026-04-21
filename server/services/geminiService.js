/**
 * Google Gemini API wrapper: image/audio analysis and room concept generation.
 * Uses @google/generative-ai with GEMINI_API_KEY (server-side only).
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import { HttpError } from '../utils/httpError.js';

const MODEL_ANALYSIS = process.env.GEMINI_MODEL_ANALYSIS || 'gemini-2.0-flash';
const MODEL_TEXT = process.env.GEMINI_MODEL_TEXT || 'gemini-2.0-flash';

function getGenAI() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  return new GoogleGenerativeAI(key);
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
      'GEMINI_BAD_RESPONSE',
      'AI returned an unexpected response. Please try again.'
    );
  }
}

/**
 * Analyze an image for interior design keywords, palette, style.
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
export async function analyzeImage(buffer, mimeType) {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: MODEL_ANALYSIS });

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

  let result;
  try {
    result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: buffer.toString('base64'),
        },
      },
    ]);
  } catch (err) {
    console.warn('[gemini:image]', err?.message || err);
    throw new HttpError(502, 'GEMINI_UPSTREAM', 'AI image analysis failed. Please try again.');
  }

  const text = result.response.text();
  return parseJsonFromResponse(text);
}

/**
 * Analyze audio for mood and design-relevant keywords.
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
export async function analyzeAudio(buffer, mimeType) {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: MODEL_ANALYSIS });

  const prompt = `Listen to this audio and infer mood/atmosphere relevant to interior design.
Return ONLY valid JSON (no markdown):
{
  "keywords": ["string", ...],
  "moodTags": ["string", ...],
  "styleAssociations": ["string", ...],
  "summary": "one sentence"
}`;

  let result;
  try {
    result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: mimeType || 'audio/mpeg',
          data: buffer.toString('base64'),
        },
      },
    ]);
  } catch (err) {
    console.warn('[gemini:audio]', err?.message || err);
    throw new HttpError(502, 'GEMINI_UPSTREAM', 'AI audio analysis failed. Please try again.');
  }

  const text = result.response.text();
  return parseJsonFromResponse(text);
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
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: MODEL_TEXT });

  const prompt = `You are Roomify, an AI interior design assistant.
Combine the following analyses into ONE cohesive room inspiration concept.

User preferences (sanitized): ${chatContext || '(none)'}
Use realistic furniture in visualization notes: ${useRealisticFurniture}

Image analyses (JSON): ${JSON.stringify(imageAnalyses)}
Audio analyses (JSON): ${JSON.stringify(audioAnalyses)}

Return ONLY valid JSON (no markdown):
{
  "title": "short project title",
  "conceptDescription": "2-4 sentences describing the room vision",
  "searchKeywords": ["keyword for image search", ...],
  "styleLabel": "e.g. Refined Brutalism",
  "colorPalette": ["#hex or name", ...],
  "analysisKeywords": ["tag", ...],
  "blueprintNotes": "brief note for a floor plan (furniture placement)"
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return parseJsonFromResponse(text);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.warn('[gemini:concept]', err?.message || err);
    throw new HttpError(502, 'GEMINI_UPSTREAM', 'AI concept generation failed. Please try again.');
  }
}

/**
 * Optional: short refinement text from user feedback.
 */
export async function refineConcept(previousConceptJson, userFeedback) {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: MODEL_TEXT });
  const prompt = `Previous concept: ${JSON.stringify(previousConceptJson)}
User refinement request: ${userFeedback.slice(0, 2000)}
Return the same JSON shape as generateRoomConcept with updated fields only. Valid JSON only, no markdown.`;
  try {
    const result = await model.generateContent(prompt);
    return parseJsonFromResponse(result.response.text());
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.warn('[gemini:refine]', err?.message || err);
    throw new HttpError(502, 'GEMINI_UPSTREAM', 'AI refinement failed. Please try again.');
  }
}
