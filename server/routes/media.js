/**
 * Media upload + processing.
 *
 * - Accepts images / audio uploads or a public https image URL.
 * - Caches per-file Gemini analysis in Firestore, keyed by SHA-256.
 * - Generates a combined room concept and optionally fetches similar images.
 * - Returns partial results (similarInspiration: []) when Custom Search is
 *   not configured rather than failing the whole request.
 */
import express from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { sanitizeBodyStrings } from '../middleware/sanitize.js';
import {
  runValidators,
  validateProcessMedia,
  validateProcessUrl,
  validateProcessUrls,
  validateGooglePhotosSelection,
  validatePickerProcess,
  validateMediaRefine,
  assertSafePublicUrl,
} from '../middleware/validate.js';
import {
  ALLOWED_IMAGE_MIMES,
  ALLOWED_AUDIO_MIMES,
  MAX_UPLOAD_BYTES,
} from '../utils/validators.js';
import {
  hashContent,
  analyzeImage,
  analyzeAudio,
  generateRoomConcept,
  getVertexTextModelIds,
  refineConcept,
} from '../services/geminiService.js';
import { getMediaCache, setMediaCache } from '../services/firestoreService.js';
import { getUserDoc } from '../services/firestoreService.js';
import { searchSimilarImages } from '../services/imageSearchService.js';
import {
  asyncHandler,
  sendError,
  requireService,
} from '../utils/httpError.js';
import { registerJob, emit, end } from '../utils/jobStream.js';
import { isGeminiConfigured, isGoogleSearchConfigured, isVertexFlashImagePreviewEnabled, isGooglePhotosPickerConfigured } from '../config/secrets.js';
import * as googlePhotosPicker from '../services/googlePhotosPickerService.js';
import {
  buildFlashImagePrompt,
  buildFlashImageEditPrompt,
  generateRoomSceneDataUri,
  generateRoomSceneEditDataUri,
  getVertexFlashImageModelId,
} from '../services/geminiFlashImageService.js';

const router = express.Router();

router.use(uploadLimiter);

const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  const ok =
    ALLOWED_IMAGE_MIMES.has(file.mimetype) || ALLOWED_AUDIO_MIMES.has(file.mimetype);
  cb(ok ? null : new Error('INVALID_FILE_TYPE'), ok);
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 12 },
  fileFilter,
});

const DEFAULT_FEATURED =
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&q=80';

function tryJsonParse(value) {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch a remote URL and stream the body, bailing out if it exceeds maxBytes
 * or doesn't return within FETCH_TIMEOUT_MS. Throws an Error tagged with one
 * of: 'FETCH_FAILED' | 'NOT_OK' | 'TOO_LARGE' | 'NO_BODY'.
 */
async function safeFetchBytes(url, { headers, maxBytes = MAX_UPLOAD_BYTES } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const e = new Error(err?.message || 'fetch failed'); e.code = 'FETCH_FAILED'; throw e;
  }
  if (!response.ok) {
    const e = new Error(`status ${response.status}`); e.code = 'NOT_OK';
    e.status = response.status; e.response = response; throw e;
  }
  const len = Number(response.headers.get('content-length'));
  if (Number.isFinite(len) && len > maxBytes) {
    try { response.body?.cancel(); } catch {}
    const e = new Error('content-length over limit'); e.code = 'TOO_LARGE'; throw e;
  }
  if (!response.body) { const e = new Error('no body'); e.code = 'NO_BODY'; throw e; }
  const chunks = []; let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { reader.cancel(); } catch {}
        const e = new Error('body over limit'); e.code = 'TOO_LARGE'; throw e;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return { buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))), response };
}

/**
 * Best-effort similar-image search. Missing configuration or upstream
 * failures never bubble up — we just hand back an empty array.
 */
async function safeSimilarImages(keyword) {
  if (!isGoogleSearchConfigured()) return [];
  try {
    return await searchSimilarImages(String(keyword).slice(0, 200), 8);
  } catch (err) {
    console.warn('[media] similar image search skipped:', err.message);
    return [];
  }
}

/**
 * Vertex Gemini 2.5 Flash Image — hero preview. Never fails the whole request.
 */
async function safeVertexFlashImagePreview({
  concept,
  chatContext,
  referenceImages,
  audioAnalyses,
  regenSeed = '',
}) {
  if (!isVertexFlashImagePreviewEnabled()) return null;
  try {
    return await generateRoomSceneDataUri({
      concept,
      chatContext,
      referenceImages,
      audioAnalyses,
      regenSeed,
    });
  } catch (err) {
    console.warn('[media] vertex flash image preview skipped:', err.message);
    return null;
  }
}

/**
 * Vertex edit-mode preview: edits the previous render in place. Falls back
 * to null on any failure so the caller can decide what to render instead.
 */
async function safeVertexFlashImageEdit({
  previousRender,
  concept,
  feedback,
  audioAnalyses,
  extraReferences,
  regenSeed = '',
}) {
  if (!isVertexFlashImagePreviewEnabled()) return null;
  if (!previousRender?.buffer || !previousRender?.mimeType) return null;
  try {
    return await generateRoomSceneEditDataUri({
      previousRender,
      concept,
      feedback,
      audioAnalyses,
      extraReferences,
      regenSeed,
    });
  } catch (err) {
    console.warn('[media] vertex flash image edit skipped:', err.message);
    return null;
  }
}

/**
 * POST /api/media/process — multipart upload.
 */
router.post(
  '/process',
  verifyFirebaseToken,
  requireService(isGeminiConfigured, 'AI analysis is not configured on this server.'),
  upload.array('files', 10),
  sanitizeBodyStrings,
  ...validateProcessMedia,
  runValidators,
  asyncHandler(async (req, res) => {
    const files = req.files;
    if (!files || !Array.isArray(files) || files.length === 0) {
      return sendError(res, 400, 'NO_FILES', 'Please upload at least one file.');
    }

    const chatContext = typeof req.body.chatContext === 'string' ? req.body.chatContext : '';
    const useRealisticFurniture = req.body.useRealisticFurniture !== 'false';
    const regenSeed = crypto.randomUUID();
    const jobId = typeof req.body.jobId === 'string' ? req.body.jobId : null;
    if (jobId) {
      registerJob(jobId, req.user?.uid);
      // Belt-and-suspenders: always emit a final `done` once the response
      // resolves, even on uncaught errors. end() is idempotent.
      res.once('finish', () => end(jobId, { ok: res.statusCode < 400 }));
      res.once('close', () => end(jobId, { ok: false, reason: 'closed' }));
    }

    const imageAnalyses = [];
    const audioAnalyses = [];
    const referenceImages = [];

    let imageIndex = 0;
    let audioIndex = 0;
    const totalImages = files.filter((f) => ALLOWED_IMAGE_MIMES.has(f.mimetype)).length;
    const totalAudio = files.filter((f) => ALLOWED_AUDIO_MIMES.has(f.mimetype)).length;

    for (const file of files) {
      const buf = file.buffer;
      const mime = file.mimetype;
      const hash = hashContent(buf);

      const cached = await getMediaCache(req.user?.uid, hash);
      let analysis = cached?.analysis;

      if (!analysis) {
        if (ALLOWED_IMAGE_MIMES.has(mime)) {
          if (jobId) emit(jobId, 'analyzing_image', { index: imageIndex + 1, total: totalImages });
          analysis = await analyzeImage(buf, mime);
          await setMediaCache(req.user?.uid, hash, { type: 'image', mimeType: mime, analysis });
        } else if (ALLOWED_AUDIO_MIMES.has(mime)) {
          if (jobId) emit(jobId, 'analyzing_audio', { index: audioIndex + 1, total: totalAudio });
          analysis = await analyzeAudio(buf, mime);
          await setMediaCache(req.user?.uid, hash, { type: 'audio', mimeType: mime, analysis });
        } else {
          continue;
        }
      } else if (jobId) {
        if (ALLOWED_IMAGE_MIMES.has(mime)) emit(jobId, 'cache_hit_image', { index: imageIndex + 1, total: totalImages });
        else if (ALLOWED_AUDIO_MIMES.has(mime)) emit(jobId, 'cache_hit_audio', { index: audioIndex + 1, total: totalAudio });
      }

      if (ALLOWED_IMAGE_MIMES.has(mime)) {
        imageAnalyses.push(analysis);
        imageIndex += 1;
        if (referenceImages.length < 3) {
          referenceImages.push({ buffer: buf, mimeType: mime });
        }
      } else {
        audioAnalyses.push(analysis);
        audioIndex += 1;
      }
    }

    if (imageAnalyses.length === 0 && audioAnalyses.length === 0) {
      if (jobId) end(jobId, { ok: false, code: 'NO_VALID_MEDIA' });
      return sendError(
        res,
        400,
        'NO_VALID_MEDIA',
        'No analyzable image or audio files were found.'
      );
    }

    if (jobId) emit(jobId, 'generating_concept');
    const concept = await generateRoomConcept({
      imageAnalyses,
      audioAnalyses,
      chatContext,
      useRealisticFurniture,
    });

    const flashImagePrompt = buildFlashImagePrompt({ concept, chatContext, audioAnalyses, regenSeed });

    const firstKeyword =
      concept.searchKeywords?.[0] || concept.styleLabel || 'modern interior';
    if (jobId) emit(jobId, 'fetching_similar');
    const similar = await safeSimilarImages(firstKeyword);
    let featuredImage = similar[0]?.link || DEFAULT_FEATURED;
    if (jobId && isVertexFlashImagePreviewEnabled()) emit(jobId, 'rendering_hero');
    const vertexImageUri = await safeVertexFlashImagePreview({
      concept,
      chatContext,
      referenceImages,
      audioAnalyses,
      regenSeed,
    });
    if (vertexImageUri) featuredImage = vertexImageUri;

    if (jobId) end(jobId, { ok: true });
    res.json({
      jobId,
      concept: { ...concept, featuredImage },
      similarInspiration: similar,
      imageAnalyses,
      audioAnalyses,
      regen: {
        regenSeed,
        conceptGenInput: {
          chatContext,
          useRealisticFurniture,
          imageAnalyses,
          audioAnalyses,
          blueprint: concept?.blueprint || null,
        },
        flashImagePrompt,
        modelsUsed: {
          analysisModel: getVertexTextModelIds().analysis,
          textModel: getVertexTextModelIds().text,
          imageModel: getVertexFlashImageModelId(),
          vertexProjectId:
            process.env.VERTEX_PROJECT_ID ||
            process.env.GOOGLE_CLOUD_PROJECT ||
            process.env.GCLOUD_PROJECT ||
            null,
          vertexLocation: process.env.VERTEX_LOCATION || 'us-central1',
        },
        createdAt: new Date().toISOString(),
      },
      searchConfigured: isGoogleSearchConfigured(),
      vertexFlashImageConfigured: isVertexFlashImagePreviewEnabled(),
    });
  })
);

/**
 * POST /api/media/process-url — remote https image URL.
 * SSRF guarded via isSafePublicUrl in validateProcessUrl.
 */
router.post(
  '/process-url',
  verifyFirebaseToken,
  requireService(isGeminiConfigured, 'AI analysis is not configured on this server.'),
  sanitizeBodyStrings,
  ...validateProcessUrl,
  runValidators,
  asyncHandler(async (req, res) => {
    const url = String(req.body.url).slice(0, 2048);
    const chatContext = typeof req.body.chatContext === 'string' ? req.body.chatContext : '';
    const regenSeed = crypto.randomUUID();

    try { await assertSafePublicUrl(url); }
    catch { return sendError(res, 400, 'FETCH_BLOCKED', 'Refusing to fetch from a non-public address.'); }
    let arrayBuf, response;
    try {
      ({ buffer: arrayBuf, response } = await safeFetchBytes(url));
    } catch (err) {
      if (err.code === 'TOO_LARGE') return sendError(res, 400, 'TOO_LARGE', 'Image is too large (max 10MB).');
      console.warn('[media:process-url] fetch failed:', err.message);
      return sendError(res, 400, 'FETCH_FAILED', err.code === 'NOT_OK'
        ? 'The remote URL did not respond with an image.'
        : 'Unable to fetch the provided URL.');
    }

    const ctHeader = response.headers.get('content-type');
    if (!ctHeader) {
      return sendError(res, 400, 'NOT_IMAGE', 'URL did not return a content type.');
    }
    const rawType = ctHeader.split(';')[0].trim();
    if (!ALLOWED_IMAGE_MIMES.has(rawType)) {
      return sendError(res, 400, 'NOT_IMAGE', 'URL must point to a JPEG, PNG, or WebP image.');
    }

    const hash = hashContent(arrayBuf);
    const cached = await getMediaCache(req.user?.uid, hash);
    let analysis = cached?.analysis;
    if (!analysis) {
      analysis = await analyzeImage(arrayBuf, rawType);
      await setMediaCache(req.user?.uid, hash, { type: 'image', mimeType: rawType, analysis });
    }

    const concept = await generateRoomConcept({
      imageAnalyses: [analysis],
      audioAnalyses: [],
      chatContext,
      useRealisticFurniture: true,
    });

    const flashImagePrompt = buildFlashImagePrompt({ concept, chatContext, audioAnalyses: [], regenSeed });

    const kw = concept.searchKeywords?.[0] || 'interior design';
    const similar = await safeSimilarImages(kw);
    let featuredImage = similar[0]?.link || url;
    const vertexImageUri = await safeVertexFlashImagePreview({
      concept,
      chatContext,
      referenceImages: [{ buffer: arrayBuf, mimeType: rawType }],
      audioAnalyses: [],
      regenSeed,
    });
    if (vertexImageUri) featuredImage = vertexImageUri;

    res.json({
      concept: { ...concept, featuredImage },
      similarInspiration: similar,
      imageAnalyses: [analysis],
      audioAnalyses: [],
      regen: {
        regenSeed,
        conceptGenInput: {
          chatContext,
          useRealisticFurniture: true,
          imageAnalyses: [analysis],
          audioAnalyses: [],
          blueprint: concept?.blueprint || null,
        },
        flashImagePrompt,
        modelsUsed: {
          analysisModel: getVertexTextModelIds().analysis,
          textModel: getVertexTextModelIds().text,
          imageModel: getVertexFlashImageModelId(),
          vertexProjectId:
            process.env.VERTEX_PROJECT_ID ||
            process.env.GOOGLE_CLOUD_PROJECT ||
            process.env.GCLOUD_PROJECT ||
            null,
          vertexLocation: process.env.VERTEX_LOCATION || 'us-central1',
        },
        createdAt: new Date().toISOString(),
      },
      searchConfigured: isGoogleSearchConfigured(),
      vertexFlashImageConfigured: isVertexFlashImagePreviewEnabled(),
    });
  })
);

/**
 * POST /api/media/process-urls — multiple remote https image URLs.
 * SSRF guarded via isSafePublicUrl in validateProcessUrls.
 */
router.post(
  '/process-urls',
  verifyFirebaseToken,
  requireService(isGeminiConfigured, 'AI analysis is not configured on this server.'),
  sanitizeBodyStrings,
  ...validateProcessUrls,
  runValidators,
  asyncHandler(async (req, res) => {
    const urls = Array.isArray(req.body.urls) ? req.body.urls : [];
    const chatContext = typeof req.body.chatContext === 'string' ? req.body.chatContext : '';
    const useRealisticFurniture = req.body.useRealisticFurniture !== 'false';
    const regenSeed = crypto.randomUUID();

    const imageAnalyses = [];
    const referenceImages = [];

    for (const u of urls.slice(0, 6)) {
      const url = String(u).slice(0, 2048);

      try { await assertSafePublicUrl(url); }
      catch { return sendError(res, 400, 'FETCH_BLOCKED', 'Refusing to fetch from a non-public address.'); }
      let arrayBuf, response;
      try {
        ({ buffer: arrayBuf, response } = await safeFetchBytes(url));
      } catch (err) {
        if (err.code === 'TOO_LARGE') return sendError(res, 400, 'TOO_LARGE', 'One of the images is too large (max 10MB).');
        console.warn('[media:process-urls] fetch failed:', err.message);
        return sendError(res, 400, 'FETCH_FAILED', err.code === 'NOT_OK'
          ? 'One of the remote URLs did not respond with an image.'
          : 'Unable to fetch one of the provided URLs.');
      }

      const ctHeader = response.headers.get('content-type');
      if (!ctHeader) {
        return sendError(res, 400, 'NOT_IMAGE', 'A URL did not return a content type.');
      }
      const rawType = ctHeader.split(';')[0].trim();
      if (!ALLOWED_IMAGE_MIMES.has(rawType)) {
        return sendError(res, 400, 'NOT_IMAGE', 'All URLs must point to JPEG, PNG, or WebP images.');
      }

      const hash = hashContent(arrayBuf);
      const cached = await getMediaCache(req.user?.uid, hash);
      let analysis = cached?.analysis;
      if (!analysis) {
        analysis = await analyzeImage(arrayBuf, rawType);
        await setMediaCache(req.user?.uid, hash, { type: 'image', mimeType: rawType, analysis });
      }
      imageAnalyses.push(analysis);
      if (referenceImages.length < 3) referenceImages.push({ buffer: arrayBuf, mimeType: rawType });
    }

    const concept = await generateRoomConcept({
      imageAnalyses,
      audioAnalyses: [],
      chatContext,
      useRealisticFurniture,
    });

    const flashImagePrompt = buildFlashImagePrompt({
      concept,
      chatContext,
      audioAnalyses: [],
      regenSeed,
    });

    const kw = concept.searchKeywords?.[0] || concept.styleLabel || 'interior design';
    const similar = await safeSimilarImages(kw);
    let featuredImage = similar[0]?.link || DEFAULT_FEATURED;
    const vertexImageUri = await safeVertexFlashImagePreview({
      concept,
      chatContext,
      referenceImages,
      audioAnalyses: [],
      regenSeed,
    });
    if (vertexImageUri) featuredImage = vertexImageUri;

    res.json({
      concept: { ...concept, featuredImage },
      similarInspiration: similar,
      imageAnalyses,
      audioAnalyses: [],
      regen: {
        regenSeed,
        conceptGenInput: {
          chatContext,
          useRealisticFurniture,
          imageAnalyses,
          audioAnalyses: [],
          blueprint: concept?.blueprint || null,
        },
        flashImagePrompt,
        modelsUsed: {
          analysisModel: getVertexTextModelIds().analysis,
          textModel: getVertexTextModelIds().text,
          imageModel: getVertexFlashImageModelId(),
          vertexProjectId:
            process.env.VERTEX_PROJECT_ID ||
            process.env.GOOGLE_CLOUD_PROJECT ||
            process.env.GCLOUD_PROJECT ||
            null,
          vertexLocation: process.env.VERTEX_LOCATION || 'us-central1',
        },
        createdAt: new Date().toISOString(),
      },
      searchConfigured: isGoogleSearchConfigured(),
      vertexFlashImageConfigured: isVertexFlashImagePreviewEnabled(),
    });
  })
);

function toGoogleDownloadUrl(baseUrl) {
  const u = String(baseUrl || '').trim();
  if (!u) return '';
  const root = u.split('=')[0];
  return `${root}=d`;
}

// Strict host allowlist for Google Photos download URLs. Without this the
// caller could supply any public https URL and have the server send the
// user's Google OAuth bearer token to it.
const GOOGLE_PHOTOS_HOST_ALLOWLIST = [
  /^lh[3-9]\.googleusercontent\.com$/i,
  /^([a-z0-9-]+\.)?googleusercontent\.com$/i,
  /^photoslibrary\.googleapis\.com$/i,
];
function isGooglePhotosHost(urlString) {
  try {
    const h = new URL(urlString).hostname;
    return GOOGLE_PHOTOS_HOST_ALLOWLIST.some((r) => r.test(h));
  } catch {
    return false;
  }
}

/**
 * POST /api/media/process-google-photos — process selected Google Photos media items.
 * Uses the user's stored Google OAuth access token to download bytes.
 */
router.post(
  '/process-google-photos',
  verifyFirebaseToken,
  requireService(isGeminiConfigured, 'AI analysis is not configured on this server.'),
  sanitizeBodyStrings,
  ...validateGooglePhotosSelection,
  runValidators,
  asyncHandler(async (req, res) => {
    const user = await getUserDoc(req.user.uid);
    const accessToken = user?.googleAccessToken;
    if (!accessToken) {
      return sendError(res, 403, 'NOT_CONNECTED', 'Google Photos is not connected for this account.');
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const chatContext = typeof req.body.chatContext === 'string' ? req.body.chatContext : '';
    const useRealisticFurniture = req.body.useRealisticFurniture !== 'false';
    const regenSeed = crypto.randomUUID();

    const imageAnalyses = [];
    const referenceImages = [];

    for (const it of items.slice(0, 6)) {
      const downloadUrl = toGoogleDownloadUrl(it?.baseUrl);
      if (!downloadUrl) continue;
      if (!isGooglePhotosHost(downloadUrl)) {
        return sendError(
          res,
          400,
          'INVALID_PHOTO_HOST',
          'Selected items must come from Google Photos.'
        );
      }
      try { await assertSafePublicUrl(downloadUrl); }
      catch { return sendError(res, 400, 'FETCH_BLOCKED', 'Refusing to fetch from a non-public address.'); }

      let arrayBuf, response;
      try {
        ({ buffer: arrayBuf, response } = await safeFetchBytes(downloadUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }));
      } catch (err) {
        if (err.code === 'TOO_LARGE') return sendError(res, 400, 'TOO_LARGE', 'One of the selected photos is too large (max 10MB).');
        console.warn('[media:process-google-photos] fetch failed:', err.message);
        return sendError(res, 400, 'FETCH_FAILED', 'Unable to fetch one of the selected Google Photos items.');
      }

      const ctHeader = response.headers.get('content-type');
      if (!ctHeader) {
        return sendError(res, 400, 'NOT_IMAGE', 'A selected photo did not return a content type.');
      }
      const rawType = ctHeader.split(';')[0].trim();
      if (!ALLOWED_IMAGE_MIMES.has(rawType)) {
        return sendError(res, 400, 'NOT_IMAGE', 'Selected items must be JPEG, PNG, or WebP images.');
      }

      const hash = hashContent(arrayBuf);
      const cached = await getMediaCache(req.user?.uid, hash);
      let analysis = cached?.analysis;
      if (!analysis) {
        analysis = await analyzeImage(arrayBuf, rawType);
        await setMediaCache(req.user?.uid, hash, { type: 'image', mimeType: rawType, analysis });
      }
      imageAnalyses.push(analysis);
      if (referenceImages.length < 3) referenceImages.push({ buffer: arrayBuf, mimeType: rawType });
    }

    if (imageAnalyses.length === 0) {
      return sendError(res, 400, 'NO_IMAGES', 'No valid images were selected.');
    }

    const concept = await generateRoomConcept({
      imageAnalyses,
      audioAnalyses: [],
      chatContext,
      useRealisticFurniture,
    });

    const flashImagePrompt = buildFlashImagePrompt({
      concept,
      chatContext,
      audioAnalyses: [],
      regenSeed,
    });

    const kw = concept.searchKeywords?.[0] || concept.styleLabel || 'interior design';
    const similar = await safeSimilarImages(kw);
    let featuredImage = similar[0]?.link || DEFAULT_FEATURED;
    const vertexImageUri = await safeVertexFlashImagePreview({
      concept,
      chatContext,
      referenceImages,
      audioAnalyses: [],
      regenSeed,
    });
    if (vertexImageUri) featuredImage = vertexImageUri;

    res.json({
      concept: { ...concept, featuredImage },
      similarInspiration: similar,
      imageAnalyses,
      audioAnalyses: [],
      regen: {
        regenSeed,
        conceptGenInput: {
          chatContext,
          useRealisticFurniture,
          imageAnalyses,
          audioAnalyses: [],
          blueprint: concept?.blueprint || null,
        },
        flashImagePrompt,
        modelsUsed: {
          analysisModel: getVertexTextModelIds().analysis,
          textModel: getVertexTextModelIds().text,
          imageModel: getVertexFlashImageModelId(),
          vertexProjectId:
            process.env.VERTEX_PROJECT_ID ||
            process.env.GOOGLE_CLOUD_PROJECT ||
            process.env.GCLOUD_PROJECT ||
            null,
          vertexLocation: process.env.VERTEX_LOCATION || 'us-central1',
        },
        createdAt: new Date().toISOString(),
      },
      searchConfigured: isGoogleSearchConfigured(),
      vertexFlashImageConfigured: isVertexFlashImagePreviewEnabled(),
    });
  })
);

/**
 * POST /api/media/process-picker-items — generate from a Picker session.
 *
 * After the user finishes picking in Google's hosted dialog, the client
 * passes the sessionId here. We list the picked items via the Picker API,
 * download each (host-allowlisted to googleusercontent.com so the user's
 * bearer token can't be sent to a hostile redirect), analyze + cache, then
 * run the same generation pipeline as /process-google-photos.
 *
 * Best-effort session cleanup runs after the response is sent so a slow
 * delete never delays the user's render.
 */
router.post(
  '/process-picker-items',
  verifyFirebaseToken,
  requireService(isGeminiConfigured, 'AI analysis is not configured on this server.'),
  requireService(
    isGooglePhotosPickerConfigured,
    'Google Photos Picker is not enabled on this server.'
  ),
  sanitizeBodyStrings,
  ...validatePickerProcess,
  runValidators,
  asyncHandler(async (req, res) => {
    const user = await getUserDoc(req.user.uid);
    const accessToken = user?.googleAccessToken || process.env.DEV_GOOGLE_OAUTH_TOKEN || null;
    if (!accessToken) {
      return sendError(res, 403, 'NOT_CONNECTED', 'Google Photos is not connected for this account.');
    }

    const sessionId = String(req.body.sessionId || '').trim();
    const chatContext = typeof req.body.chatContext === 'string' ? req.body.chatContext : '';
    const useRealisticFurniture = req.body.useRealisticFurniture !== 'false';
    const regenSeed = crypto.randomUUID();

    let listed;
    try {
      listed = await googlePhotosPicker.listPickedItems(accessToken, sessionId);
    } catch (err) {
      console.warn('[picker:list_items]', err.message);
      if (err.status === 404) {
        return sendError(res, 404, 'SESSION_NOT_FOUND', 'That picker session expired. Pick photos again.');
      }
      if (err.status === 401 || err.status === 403) {
        return sendError(
          res,
          403,
          'GOOGLE_SCOPE_MISSING',
          'Google Photos Picker permission is missing. Reconnect Google in Settings.'
        );
      }
      return sendError(res, 502, 'PICKER_FAILED', 'Unable to read your selected Google Photos.');
    }

    const rawItems = Array.isArray(listed?.mediaItems) ? listed.mediaItems : [];
    if (rawItems.length === 0) {
      return sendError(
        res,
        400,
        'NO_ITEMS',
        'No photos in the picker session. Reopen the picker and select at least one photo.'
      );
    }

    const imageAnalyses = [];
    const referenceImages = [];

    for (const item of rawItems.slice(0, 6)) {
      // Picker's mediaFile shape mirrors Library: { baseUrl, mimeType, filename, ... }.
      const baseUrl = item?.mediaFile?.baseUrl || item?.baseUrl || '';
      if (!baseUrl) continue;
      const downloadUrl = toGoogleDownloadUrl(baseUrl);
      if (!isGooglePhotosHost(downloadUrl)) {
        return sendError(
          res,
          400,
          'INVALID_PHOTO_HOST',
          'Selected items must come from Google Photos.'
        );
      }
      try { await assertSafePublicUrl(downloadUrl); }
      catch { return sendError(res, 400, 'FETCH_BLOCKED', 'Refusing to fetch from a non-public address.'); }

      let arrayBuf, response;
      try {
        ({ buffer: arrayBuf, response } = await safeFetchBytes(downloadUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }));
      } catch (err) {
        if (err.code === 'TOO_LARGE') return sendError(res, 400, 'TOO_LARGE', 'One of the selected photos is too large (max 10MB).');
        console.warn('[media:process-picker-items] fetch failed:', err.message);
        return sendError(res, 400, 'FETCH_FAILED', 'Unable to fetch one of the selected Google Photos items.');
      }

      const ctHeader = response.headers.get('content-type');
      if (!ctHeader) {
        return sendError(res, 400, 'NOT_IMAGE', 'A selected photo did not return a content type.');
      }
      const rawType = ctHeader.split(';')[0].trim();
      if (!ALLOWED_IMAGE_MIMES.has(rawType)) {
        return sendError(res, 400, 'NOT_IMAGE', 'Selected items must be JPEG, PNG, or WebP images.');
      }

      const hash = hashContent(arrayBuf);
      const cached = await getMediaCache(req.user?.uid, hash);
      let analysis = cached?.analysis;
      if (!analysis) {
        analysis = await analyzeImage(arrayBuf, rawType);
        await setMediaCache(req.user?.uid, hash, { type: 'image', mimeType: rawType, analysis });
      }
      imageAnalyses.push(analysis);
      if (referenceImages.length < 3) referenceImages.push({ buffer: arrayBuf, mimeType: rawType });
    }

    if (imageAnalyses.length === 0) {
      return sendError(res, 400, 'NO_VALID_MEDIA', 'No analyzable photos were found in the picker session.');
    }

    const concept = await generateRoomConcept({
      imageAnalyses,
      audioAnalyses: [],
      chatContext,
      useRealisticFurniture,
    });

    const flashImagePrompt = buildFlashImagePrompt({
      concept,
      chatContext,
      audioAnalyses: [],
      regenSeed,
    });

    const kw = concept.searchKeywords?.[0] || concept.styleLabel || 'interior design';
    const similar = await safeSimilarImages(kw);
    let featuredImage = similar[0]?.link || DEFAULT_FEATURED;
    const vertexImageUri = await safeVertexFlashImagePreview({
      concept,
      chatContext,
      referenceImages,
      audioAnalyses: [],
      regenSeed,
    });
    if (vertexImageUri) featuredImage = vertexImageUri;

    res.json({
      concept: { ...concept, featuredImage },
      similarInspiration: similar,
      imageAnalyses,
      audioAnalyses: [],
      regen: {
        regenSeed,
        conceptGenInput: {
          chatContext,
          useRealisticFurniture,
          imageAnalyses,
          audioAnalyses: [],
          blueprint: concept?.blueprint || null,
        },
        flashImagePrompt,
        modelsUsed: {
          analysisModel: getVertexTextModelIds().analysis,
          textModel: getVertexTextModelIds().text,
          imageModel: getVertexFlashImageModelId(),
          vertexProjectId:
            process.env.VERTEX_PROJECT_ID ||
            process.env.GOOGLE_CLOUD_PROJECT ||
            process.env.GCLOUD_PROJECT ||
            null,
          vertexLocation: process.env.VERTEX_LOCATION || 'us-central1',
        },
        createdAt: new Date().toISOString(),
      },
      searchConfigured: isGoogleSearchConfigured(),
      vertexFlashImageConfigured: isVertexFlashImagePreviewEnabled(),
    });

    // Best-effort cleanup. Sessions auto-expire after ~30 min; we kick the
    // delete after responding so it never blocks the render.
    googlePhotosPicker
      .deleteSession(accessToken, sessionId)
      .catch((err) => console.warn('[picker:cleanup_failed]', err?.message || err));
  })
);

/**
 * POST /api/media/refine — regenerate concept + rerender hero image.
 *
 * Accepts:
 * - previousConcept (JSON; client must strip data: URIs to stay under the 1MB
 *   multer field-size limit)
 * - feedback (string)
 * - optional chatContext (string)
 * - optional regen (object) from prior /process response
 * - optional `files` uploads (images/audio) — analyzed and merged
 * - optional single `previousRender` file — the prior generated image, used
 *   only as a visual reference for the new render (NOT analyzed, so we don't
 *   pay a Gemini call for our own output and we don't pollute regen analyses)
 */
const refineUpload = multer({
  storage,
  // fieldSize default is 1MB. The client now strips featuredImage data URIs
  // from previousConcept before stringifying, but unusually long blueprints +
  // analyses can still grow. Keep it generous.
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 12, fieldSize: MAX_UPLOAD_BYTES },
  fileFilter,
});

router.post(
  '/refine',
  verifyFirebaseToken,
  requireService(isGeminiConfigured, 'AI refinement is not configured on this server.'),
  refineUpload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'previousRender', maxCount: 1 },
  ]),
  sanitizeBodyStrings,
  ...validateMediaRefine,
  runValidators,
  asyncHandler(async (req, res) => {
    const previousConcept =
      typeof req.body.previousConcept === 'string'
        ? tryJsonParse(req.body.previousConcept)
        : req.body.previousConcept;
    const feedback = String(req.body.feedback || '').trim();
    const regen = typeof req.body.regen === 'string' ? tryJsonParse(req.body.regen) : req.body.regen;
    const chatContext = typeof req.body.chatContext === 'string' ? req.body.chatContext : '';
    const jobId = typeof req.body.jobId === 'string' ? req.body.jobId : null;
    if (jobId) {
      registerJob(jobId, req.user?.uid);
      res.once('finish', () => end(jobId, { ok: res.statusCode < 400 }));
      res.once('close', () => end(jobId, { ok: false, reason: 'closed' }));
    }

    const regenSeed = crypto.randomUUID();

    const baseImageAnalyses = Array.isArray(regen?.conceptGenInput?.imageAnalyses)
      ? regen.conceptGenInput.imageAnalyses
      : [];
    const baseAudioAnalyses = Array.isArray(regen?.conceptGenInput?.audioAnalyses)
      ? regen.conceptGenInput.audioAnalyses
      : [];
    const baseUseRealisticFurniture =
      typeof regen?.conceptGenInput?.useRealisticFurniture === 'boolean'
        ? regen.conceptGenInput.useRealisticFurniture
        : true;

    // upload.fields() returns { files: [], previousRender: [] }
    const files = Array.isArray(req.files?.files) ? req.files.files : [];
    const previousRenderFile = Array.isArray(req.files?.previousRender)
      ? req.files.previousRender[0]
      : null;
    const hasUsablePreviousRender =
      previousRenderFile && ALLOWED_IMAGE_MIMES.has(previousRenderFile.mimetype);

    const addedImageAnalyses = [];
    const addedAudioAnalyses = [];
    const referenceImages = [];
    const editExtraReferences = [];

    // Visual continuity: prior generated image becomes the FIRST reference,
    // skipping analysis (it's our own output — no need to pay Vertex again).
    if (hasUsablePreviousRender) {
      referenceImages.push({
        buffer: previousRenderFile.buffer,
        mimeType: previousRenderFile.mimetype,
      });
    }

    for (const file of files) {
      const buf = file.buffer;
      const mime = file.mimetype;
      const hash = hashContent(buf);

      const cached = await getMediaCache(req.user?.uid, hash);
      let analysis = cached?.analysis;

      if (!analysis) {
        if (ALLOWED_IMAGE_MIMES.has(mime)) {
          if (jobId) emit(jobId, 'analyzing_image');
          analysis = await analyzeImage(buf, mime);
          await setMediaCache(req.user?.uid, hash, { type: 'image', mimeType: mime, analysis });
        } else if (ALLOWED_AUDIO_MIMES.has(mime)) {
          if (jobId) emit(jobId, 'analyzing_audio');
          analysis = await analyzeAudio(buf, mime);
          await setMediaCache(req.user?.uid, hash, { type: 'audio', mimeType: mime, analysis });
        } else {
          continue;
        }
      }

      if (ALLOWED_IMAGE_MIMES.has(mime)) {
        addedImageAnalyses.push(analysis);
        if (referenceImages.length < 3) referenceImages.push({ buffer: buf, mimeType: mime });
        if (editExtraReferences.length < 2) editExtraReferences.push({ buffer: buf, mimeType: mime });
      } else {
        addedAudioAnalyses.push(analysis);
      }
    }

    // 1) Update concept JSON using the refinement text (and previous concept).
    if (jobId) emit(jobId, 'refining_concept');
    const refinedPatch = await refineConcept(previousConcept, feedback);
    const concept = { ...(previousConcept || {}), ...(refinedPatch || {}) };

    // 2) Rerender hero image using merged context + optional new media.
    const imageAnalyses = [...baseImageAnalyses, ...addedImageAnalyses];
    const audioAnalyses = [...baseAudioAnalyses, ...addedAudioAnalyses];

    const effectiveChat =
      chatContext || (typeof regen?.conceptGenInput?.chatContext === 'string' ? regen.conceptGenInput.chatContext : '');
    const chatWithFeedback = `${effectiveChat}\n${feedback}`.trim();

    // Edit mode (preferred): if the client sent the prior render, use the
    // edit prompt + previousRender as the base image. The model preserves
    // composition, layout, and identifiable furniture, applying only the
    // user's requested change. Falls back to fresh generation when the
    // previous render is missing (older clients) or when edit fails.
    const flashImagePrompt = hasUsablePreviousRender
      ? buildFlashImageEditPrompt({ concept, feedback, audioAnalyses, regenSeed })
      : buildFlashImagePrompt({ concept, chatContext: chatWithFeedback, audioAnalyses, regenSeed });

    let featuredImage = DEFAULT_FEATURED;
    let vertexImageUri = null;
    if (hasUsablePreviousRender) {
      if (jobId) emit(jobId, 'editing_render');
      vertexImageUri = await safeVertexFlashImageEdit({
        previousRender: {
          buffer: previousRenderFile.buffer,
          mimeType: previousRenderFile.mimetype,
        },
        concept,
        feedback,
        audioAnalyses,
        extraReferences: editExtraReferences,
        regenSeed,
      });
    }
    if (!vertexImageUri) {
      if (jobId && isVertexFlashImagePreviewEnabled()) emit(jobId, 'rendering_hero');
      vertexImageUri = await safeVertexFlashImagePreview({
        concept,
        chatContext: chatWithFeedback,
        referenceImages,
        audioAnalyses,
        regenSeed,
      });
    }
    if (vertexImageUri) featuredImage = vertexImageUri;

    const firstKeyword = concept.searchKeywords?.[0] || concept.styleLabel || 'modern interior';
    if (jobId) emit(jobId, 'fetching_similar');
    const similar = await safeSimilarImages(firstKeyword);

    if (jobId) end(jobId, { ok: true });
    res.json({
      jobId,
      concept: { ...concept, featuredImage },
      similarInspiration: similar,
      regen: {
        regenSeed,
        conceptGenInput: {
          chatContext: chatWithFeedback,
          useRealisticFurniture: baseUseRealisticFurniture,
          imageAnalyses,
          audioAnalyses,
          blueprint: concept?.blueprint || null,
        },
        flashImagePrompt,
        modelsUsed: {
          analysisModel: getVertexTextModelIds().analysis,
          textModel: getVertexTextModelIds().text,
          imageModel: getVertexFlashImageModelId(),
          vertexProjectId:
            process.env.VERTEX_PROJECT_ID ||
            process.env.GOOGLE_CLOUD_PROJECT ||
            process.env.GCLOUD_PROJECT ||
            null,
          vertexLocation: process.env.VERTEX_LOCATION || 'us-central1',
        },
        createdAt: new Date().toISOString(),
      },
      vertexFlashImageConfigured: isVertexFlashImagePreviewEnabled(),
      searchConfigured: isGoogleSearchConfigured(),
    });
  })
);

export default router;
