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
} from '../middleware/validate.js';
import { refineConcept } from '../services/geminiService.js';
import {
  saveProject,
  saveGeneration,
  listProjects,
} from '../services/firestoreService.js';
import {
  asyncHandler,
  sendError,
  requireService,
} from '../utils/httpError.js';
import { isGeminiConfigured } from '../config/secrets.js';

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
    const id = await saveProject(req.user.uid, req.body.name, req.body.payload || {});
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
