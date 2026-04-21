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
import multer from 'multer';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { sanitizeBodyStrings } from '../middleware/sanitize.js';
import {
  runValidators,
  validateProcessMedia,
  validateProcessUrl,
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
} from '../services/geminiService.js';
import { getMediaCache, setMediaCache } from '../services/firestoreService.js';
import { searchSimilarImages } from '../services/imageSearchService.js';
import {
  asyncHandler,
  sendError,
  requireService,
} from '../utils/httpError.js';
import { isGeminiConfigured, isGoogleSearchConfigured } from '../config/secrets.js';

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

    const imageAnalyses = [];
    const audioAnalyses = [];

    for (const file of files) {
      const buf = file.buffer;
      const mime = file.mimetype;
      const hash = hashContent(buf);

      const cached = await getMediaCache(hash);
      let analysis = cached?.analysis;

      if (!analysis) {
        if (ALLOWED_IMAGE_MIMES.has(mime)) {
          analysis = await analyzeImage(buf, mime);
          await setMediaCache(hash, { type: 'image', mimeType: mime, analysis });
        } else if (ALLOWED_AUDIO_MIMES.has(mime)) {
          analysis = await analyzeAudio(buf, mime);
          await setMediaCache(hash, { type: 'audio', mimeType: mime, analysis });
        } else {
          continue;
        }
      }

      if (ALLOWED_IMAGE_MIMES.has(mime)) {
        imageAnalyses.push(analysis);
      } else {
        audioAnalyses.push(analysis);
      }
    }

    if (imageAnalyses.length === 0 && audioAnalyses.length === 0) {
      return sendError(
        res,
        400,
        'NO_VALID_MEDIA',
        'No analyzable image or audio files were found.'
      );
    }

    const concept = await generateRoomConcept({
      imageAnalyses,
      audioAnalyses,
      chatContext,
      useRealisticFurniture,
    });

    const firstKeyword =
      concept.searchKeywords?.[0] || concept.styleLabel || 'modern interior';
    const similar = await safeSimilarImages(firstKeyword);
    const featuredImage = similar[0]?.link || DEFAULT_FEATURED;

    res.json({
      concept: { ...concept, featuredImage },
      similarInspiration: similar,
      imageAnalyses,
      audioAnalyses,
      searchConfigured: isGoogleSearchConfigured(),
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

    let response;
    try {
      response = await fetch(url, { method: 'GET', redirect: 'follow' });
    } catch (err) {
      console.warn('[media:process-url] fetch failed:', err.message);
      return sendError(res, 400, 'FETCH_FAILED', 'Unable to fetch the provided URL.');
    }
    if (!response.ok) {
      return sendError(res, 400, 'FETCH_FAILED', 'The remote URL did not respond with an image.');
    }

    const rawType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!ALLOWED_IMAGE_MIMES.has(rawType)) {
      return sendError(res, 400, 'NOT_IMAGE', 'URL must point to a JPEG, PNG, or WebP image.');
    }

    const arrayBuf = Buffer.from(await response.arrayBuffer());
    if (arrayBuf.length > MAX_UPLOAD_BYTES) {
      return sendError(res, 400, 'TOO_LARGE', 'Image is too large (max 10MB).');
    }

    const hash = hashContent(arrayBuf);
    const cached = await getMediaCache(hash);
    let analysis = cached?.analysis;
    if (!analysis) {
      analysis = await analyzeImage(arrayBuf, rawType);
      await setMediaCache(hash, { type: 'image', mimeType: rawType, analysis });
    }

    const concept = await generateRoomConcept({
      imageAnalyses: [analysis],
      audioAnalyses: [],
      chatContext,
      useRealisticFurniture: true,
    });

    const kw = concept.searchKeywords?.[0] || 'interior design';
    const similar = await safeSimilarImages(kw);
    const featuredImage = similar[0]?.link || url;

    res.json({
      concept: { ...concept, featuredImage },
      similarInspiration: similar,
      imageAnalyses: [analysis],
      audioAnalyses: [],
      searchConfigured: isGoogleSearchConfigured(),
    });
  })
);

export default router;
