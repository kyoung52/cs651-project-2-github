/**
 * Explore feed — published projects across users.
 *
 * Note: This is an app-level "public feed". We only return projects marked
 * `published: true`.
 */
import express from 'express';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { sanitizeBodyStrings } from '../middleware/sanitize.js';
import { runValidators } from '../middleware/validate.js';
import { asyncHandler, sendError } from '../utils/httpError.js';
import { getPublishedProject, listPublishedProjects } from '../services/firestoreService.js';
import { generateRoomSceneDataUri } from '../services/geminiFlashImageService.js';

const router = express.Router();

router.get(
  '/feed',
  verifyFirebaseToken,
  asyncHandler(async (_req, res) => {
    const list = await listPublishedProjects(24);
    const items = list.map((p) => {
      const concept = p?.payload?.concept || {};
      return {
        id: p.id,
        ownerUid: p.ownerUid,
        name: p.name,
        createdAt: p.createdAt,
        publishedAt: p.publishedAt,
        concept: {
          title: concept.title || '',
          styleLabel: concept.styleLabel || '',
          conceptDescription: concept.conceptDescription || '',
          colorPalette: concept.colorPalette || [],
          searchKeywords: concept.searchKeywords || [],
          blueprintNotes: concept.blueprintNotes || '',
          blueprint: concept.blueprint || null,
        },
        regen: p?.payload?.regen || null,
      };
    });
    res.json({ projects: items });
  })
);

/**
 * Render a preview image for a published project using its saved regen context.
 * Returns a data: URI (same format as Dashboard).
 */
router.post(
  '/render',
  verifyFirebaseToken,
  sanitizeBodyStrings,
  runValidators,
  asyncHandler(async (req, res) => {
    const ownerUid = String(req.body?.ownerUid || '').trim();
    const projectId = String(req.body?.projectId || '').trim();
    if (!ownerUid || !projectId) {
      return sendError(res, 400, 'VALIDATION_FAILED', 'ownerUid and projectId are required.');
    }

    // We render from the published feed snapshot to avoid cross-user reads
    // that can require additional Firestore rules complexity.
    const published = await getPublishedProject(ownerUid, projectId);
    if (!published) {
      return sendError(res, 404, 'NOT_FOUND', 'Project not found.');
    }

    const concept = published?.payload?.concept || null;
    const regen = published?.payload?.regen || null;
    const chatContext = regen?.conceptGenInput?.chatContext || '';
    const audioAnalyses = regen?.conceptGenInput?.audioAnalyses || [];

    const uri = await generateRoomSceneDataUri({
      concept,
      chatContext,
      referenceImages: [],
      audioAnalyses,
      regenSeed: regen?.regenSeed || '',
    });

    if (!uri) {
      return sendError(res, 502, 'RENDER_FAILED', 'Unable to render a preview right now.');
    }
    res.json({ image: uri });
  })
);

export default router;

