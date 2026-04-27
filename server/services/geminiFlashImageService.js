/**
 * Room preview images via Vertex — Gemini 2.5 Flash Image (multimodal: text + images).
 * Audio is summarized in text (Flash Image accepts Text + Images only per model card).
 *
 * Uses @google/genai with Vertex (same project/region as VERTEX_*).
 * https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-image
 * https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal-response-generation
 */
import {
  GoogleGenAI,
  Modality,
  createUserContent,
  createPartFromText,
  createPartFromBase64,
} from '@google/genai';

export const DEFAULT_VERTEX_FLASH_IMAGE_MODEL = 'gemini-2.5-flash-image';

export function getVertexFlashImageModelId() {
  return (
    process.env.VERTEX_MODEL_IMAGE ||
    process.env.GEMINI_MODEL_IMAGE ||
    DEFAULT_VERTEX_FLASH_IMAGE_MODEL
  );
}

function vertexProjectAndLocation() {
  const project =
    process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  if (!project) return null;
  return { project, location };
}

export function buildFlashImagePrompt({
  concept,
  chatContext = '',
  audioAnalyses = [],
  regenSeed = '',
} = {}) {
  const conceptBlock = JSON.stringify({
    title: concept?.title,
    styleLabel: concept?.styleLabel,
    conceptDescription: concept?.conceptDescription,
    colorPalette: concept?.colorPalette,
    blueprintNotes: concept?.blueprintNotes,
    blueprint: concept?.blueprint,
    searchKeywords: concept?.searchKeywords,
    analysisKeywords: concept?.analysisKeywords,
  }).slice(0, 12_000);

  const audioBlock =
    Array.isArray(audioAnalyses) && audioAnalyses.length
      ? `AUDIO_BRIEF (equal weight to USER_NOTES + IMAGE_REFERENCES; map to lighting, palette, materials, and styling):\n${JSON.stringify(audioAnalyses).slice(0, 8000)}`
      : 'AUDIO_BRIEF: (none)';

  return `You are Roomify's interior visualization model.
Generate exactly ONE photorealistic interior design render matching the brief below.

IMPORTANT: Weight USER_NOTES + STRUCTURED_CONCEPT + AUDIO_BRIEF + any IMAGE_REFERENCES equally. The render should reflect all of them.

Regen seed: ${String(regenSeed || '').slice(0, 200)}

User notes (may be empty):
${String(chatContext || '').slice(0, 4000)}

Structured room concept (JSON):
${conceptBlock}

${audioBlock}

When reference photos are attached, keep layout, materials, and mood coherent with them while applying the style direction above.
Requirements: wide-angle editorial photo, soft natural light, staged empty room, no people, no text, no logos, no watermarks.`;
}

function extractImageDataUri(response) {
  const root = response?.response ?? response;
  const parts = root?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const id = p?.inlineData;
    if (!id?.data) continue;
    const mime = id.mimeType || 'image/png';
    const data = id.data;
    if (typeof data === 'string') {
      return `data:${mime};base64,${data}`;
    }
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      return `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
    }
  }
  return null;
}

/**
 * @param {object} params
 * @param {object} params.concept — JSON from generateRoomConcept
 * @param {string} params.chatContext
 * @param {{ buffer: Buffer, mimeType: string }[]} params.referenceImages — max 3 (model limit)
 * @param {object[]} params.audioAnalyses — passed as text (no raw audio in Flash Image)
 * @returns {Promise<string|null>} data: URI for <img src> or null
 */
export async function generateRoomSceneDataUri({
  concept,
  chatContext = '',
  referenceImages = [],
  audioAnalyses = [],
  regenSeed = '',
}) {
  const pl = vertexProjectAndLocation();
  if (!pl) return null;

  const client = new GoogleGenAI({
    vertexai: true,
    project: pl.project,
    location: pl.location,
  });

  const textPrompt = buildFlashImagePrompt({
    concept,
    chatContext,
    audioAnalyses,
    regenSeed,
  });

  const parts = [createPartFromText(textPrompt)];
  for (const img of referenceImages.slice(0, 3)) {
    if (!img?.buffer || !img?.mimeType) continue;
    const b64 = Buffer.isBuffer(img.buffer) ? img.buffer.toString('base64') : Buffer.from(img.buffer).toString('base64');
    parts.push(createPartFromBase64(b64, img.mimeType));
  }

  const contents = createUserContent(parts);

  let response;
  try {
    response = await client.models.generateContent({
      model: getVertexFlashImageModelId(),
      contents,
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });
  } catch (err) {
    console.warn('[vertex:flash-image] generateContent failed:', err?.message || err);
    return null;
  }

  const uri = extractImageDataUri(response);
  if (!uri) {
    console.warn('[vertex:flash-image] no image in response');
  }
  return uri;
}
