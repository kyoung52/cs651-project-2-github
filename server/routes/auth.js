/**
 * Auth bridge routes: accept a short-lived Google OAuth token so we can
 * call Photos/YouTube APIs on the user's behalf, and drive the Pinterest
 * OAuth connect flow with a server-generated state token.
 */
import express from 'express';
import crypto from 'crypto';
import { verifyFirebaseToken } from '../middleware/auth.js';
import {
  getPinterestAuthUrl,
  exchangePinterestCode,
} from '../services/pinterestService.js';
import {
  setOAuthState,
  getOAuthState,
  deleteOAuthState,
  updateUserSocialTokens,
} from '../services/firestoreService.js';
import { sanitizeBodyStrings } from '../middleware/sanitize.js';
import {
  runValidators,
  validateGoogleToken,
} from '../middleware/validate.js';
import { asyncHandler, requireService, sendError } from '../utils/httpError.js';
import { isPinterestConfigured } from '../config/secrets.js';

const router = express.Router();

/**
 * Store Google OAuth access token (Photos / YouTube) for the signed-in user.
 */
router.post(
  '/google-token',
  verifyFirebaseToken,
  sanitizeBodyStrings,
  ...validateGoogleToken,
  runValidators,
  asyncHandler(async (req, res) => {
    const accessToken = req.body.accessToken;
    let scopes = [];
    let info = null;
    try {
      const infoRes = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(
          accessToken
        )}`
      );
      if (infoRes.ok) {
        info = await infoRes.json();
        scopes = String(info?.scope || '')
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } catch {
      // Best-effort only; token can still be stored and used.
    }

    // Opt-in audience check: only enforced when GOOGLE_OAUTH_CLIENT_ID is set.
    const expectedAud = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
    if (expectedAud) {
      if (!info || String(info.aud || '') !== expectedAud) {
        return sendError(
          res,
          400,
          'TOKEN_AUD_MISMATCH',
          'Access token was not issued for this application.'
        );
      }
    }

    await updateUserSocialTokens(req.user.uid, {
      googleAccessToken: accessToken,
      googleAccessTokenScopes: scopes,
      googleAccessTokenAud: info?.aud || null,
      googleAccessTokenSub: info?.sub || null,
    });
    res.json({
      ok: true,
      scopes,
      hasPhotosScope: scopes.includes('https://www.googleapis.com/auth/photoslibrary.readonly'),
    });
  })
);

/**
 * Start Pinterest OAuth — returns authorization URL for the client to open.
 */
router.get(
  '/pinterest/url',
  verifyFirebaseToken,
  requireService(isPinterestConfigured, 'Pinterest is not configured on this server.'),
  asyncHandler(async (req, res) => {
    const stateId = crypto.randomBytes(24).toString('hex');
    await setOAuthState(stateId, req.user.uid);
    const url = getPinterestAuthUrl(stateId);
    res.json({ url, state: stateId });
  })
);

/**
 * Pinterest redirect target. Exchanges the code, stores the token for the
 * original user, and redirects to /settings with a status query param.
 */
router.get(
  '/pinterest/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    const appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:8080';

    if (error) {
      return res.redirect(`${appUrl}/settings?pinterest=error`);
    }
    if (!code || !state || typeof state !== 'string') {
      return res.redirect(`${appUrl}/settings?pinterest=invalid`);
    }
    if (!isPinterestConfigured()) {
      return res.redirect(`${appUrl}/settings?pinterest=not_configured`);
    }

    try {
      const pending = await getOAuthState(state);
      if (!pending?.uid) {
        return res.redirect(`${appUrl}/settings?pinterest=expired`);
      }

      const tokenData = await exchangePinterestCode(String(code));
      await updateUserSocialTokens(pending.uid, {
        pinterestAccessToken: tokenData.access_token,
        pinterestRefreshToken: tokenData.refresh_token || null,
        pinterestExpiresIn: tokenData.expires_in || null,
      });
      await deleteOAuthState(state);

      return res.redirect(`${appUrl}/settings?pinterest=connected`);
    } catch (err) {
      console.error('[pinterest:callback]', err.message);
      return res.redirect(`${appUrl}/settings?pinterest=error`);
    }
  })
);

export default router;
