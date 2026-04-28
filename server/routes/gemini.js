/**
 * Refine/save endpoints for generated room concepts.
 * Firestore calls are wrapped in safeDb(), so they degrade gracefully when
 * Firebase Admin is not configured.
 */
import express from 'express';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { sanitizeBodyStrings } from '../middleware/sanitize.js';
import {
  runValidators,
  validateRefine,
  validateSaveProject,
  validateLogGeneration,
  validateProjectId,
} from '../middleware/validate.js';
import { refineConcept } from '../services/geminiService.js';
import {
  saveProject,
  saveGeneration,
  listProjects,
  getProject,
  deleteProject,
  setProjectPublished,
} from '../services/firestoreService.js';
import {
  asyncHandler,
  sendError,
  requireService,
} from '../utils/httpError.js';
import { isGeminiConfigured, isVertexFlashImagePreviewEnabled } from '../config/secrets.js';
import { sanitizeProjectPayloadForStorage } from '../utils/projectPayload.js';
import { generateRoomSceneDataUri } from '../services/geminiFlashImageService.js';
import { generationLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post(
  '/refine',
  verifyFirebaseToken,
  requireService(isGeminiConfigured, 'AI refinement is not configured on this server.'),
  sanitizeBodyStrings,
  ...validateRefine,
  runValidators,
  asyncHandler(async (req, res) => {
    const refined = await refineConcept(req.body.previousConcept, req.body.feedback);
    res.json({ concept: refined });
  })
);

router.post(
  '/save-project',
  verifyFirebaseToken,
  sanitizeBodyStrings,
  ...validateSaveProject,
  runValidators,
  asyncHandler(async (req, res) => {
    const payload = sanitizeProjectPayloadForStorage(req.body.payload || {});
    const id = await saveProject(req.user.uid, req.body.name, payload);
    if (!id) {
      return sendError(
        res,
        503,
        'STORAGE_UNAVAILABLE',
        'Project storage is not available right now.'
      );
    }
    res.json({ projectId: id });
  })
);

router.get(
  '/projects',
  verifyFirebaseToken,
  asyncHandler(async (req, res) => {
    const projects = await listProjects(req.user.uid);
    res.json({ projects });
  })
);

router.get(
  '/projects/:id',
  verifyFirebaseToken,
  ...validateProjectId,
  runValidators,
  asyncHandler(async (req, res) => {
    const project = await getProject(req.user.uid, req.params.id);
    if (!project) {
      return sendError(res, 404, 'NOT_FOUND', 'Project not found.');
    }
    res.json({ project });
  })
);

router.delete(
  '/projects/:id',
  verifyFirebaseToken,
  ...validateProjectId,
  runValidators,
  asyncHandler(async (req, res) => {
    const ok = await deleteProject(req.user.uid, req.params.id);
    if (!ok) {
      return sendError(
        res,
        503,
        'STORAGE_UNAVAILABLE',
        'Project storage is not available right now.'
      );
    }
    res.json({ ok: true });
  })
);

/**
 * Re-render the hero image for a saved project. Saved payloads have their
 * `data:` featuredImage stripped (Firestore size limits), so the dashboard
 * needs a way to regenerate it from the saved `regen` context.
 */
router.post(
  '/projects/:id/render',
  verifyFirebaseToken,
  requireService(isVertexFlashImagePreviewEnabled, 'Image preview is not configured.'),
  generationLimiter,
  ...validateProjectId,
  runValidators,
  asyncHandler(async (req, res) => {
    const project = await getProject(req.user.uid, req.params.id);
    if (!project) return sendError(res, 404, 'NOT_FOUND', 'Project not found.');
    const concept = project?.payload?.concept || null;
    const regen = project?.payload?.regen || null;
    const chatContext = regen?.conceptGenInput?.chatContext || '';
    const audioAnalyses = regen?.conceptGenInput?.audioAnalyses || [];
    const uri = await generateRoomSceneDataUri({
      concept,
      chatContext,
      referenceImages: [],
      audioAnalyses,
      regenSeed: regen?.regenSeed || '',
    });
    if (!uri) return sendError(res, 502, 'RENDER_FAILED', 'Unable to render preview right now.');
    res.json({ image: uri });
  })
);

router.post(
  '/projects/:id/publish',
  verifyFirebaseToken,
  ...validateProjectId,
  sanitizeBodyStrings,
  runValidators,
  asyncHandler(async (req, res) => {
    const published =
      req.body?.published === true || req.body?.published === 'true' || req.body?.published === 1;
    const ok = await setProjectPublished(req.user.uid, req.params.id, published);
    if (!ok) {
      return sendError(res, 404, 'NOT_FOUND', 'Project not found.');
    }
    res.json({ ok: true, published });
  })
);

/**
 * Optional analytics endpoint — never errors out, just silently drops when
 * Firestore is unavailable.
 */
router.post(
  '/log-generation',
  verifyFirebaseToken,
  sanitizeBodyStrings,
  ...validateLogGeneration,
  runValidators,
  asyncHandler(async (req, res) => {
    const id = await saveGeneration(req.user.uid, { concept: req.body.concept });
    res.json({ generationId: id });
  })
);

export default router;
