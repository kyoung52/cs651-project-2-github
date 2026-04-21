/**
 * Pinterest API v5 helpers (OAuth token required per user).
 * Docs: https://developers.pinterest.com/
 */

const BASE = 'https://api.pinterest.com/v5';

/**
 * @param {string} accessToken
 */
export async function listBoards(accessToken) {
  const res = await fetch(`${BASE}/boards`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pinterest boards: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.items || data.data || [];
}

/**
 * @param {string} accessToken
 * @param {string} boardId
 */
export async function listPins(accessToken, boardId) {
  const id = encodeURIComponent(boardId);
  const res = await fetch(`${BASE}/boards/${id}/pins`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pinterest pins: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.items || data.data || [];
}

/**
 * Build Pinterest OAuth authorization URL.
 */
export function getPinterestAuthUrl(state) {
  const appId = process.env.PINTEREST_APP_ID;
  const redirectUri = `${process.env.PUBLIC_APP_URL || 'http://localhost:8080'}/api/auth/pinterest/callback`;
  if (!appId) throw new Error('PINTEREST_APP_ID not set');

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'boards:read,pins:read,user_accounts:read',
    state: state || 'state',
  });

  return `https://www.pinterest.com/oauth/?${params.toString()}`;
}

/**
 * Exchange code for access token.
 */
export async function exchangePinterestCode(code) {
  const appId = process.env.PINTEREST_APP_ID;
  const secret = process.env.PINTEREST_APP_SECRET;
  const redirectUri = `${process.env.PUBLIC_APP_URL || 'http://localhost:8080'}/api/auth/pinterest/callback`;
  if (!appId || !secret) throw new Error('Pinterest OAuth not configured');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const basic = Buffer.from(`${appId}:${secret}`).toString('base64');
  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pinterest token: ${res.status} ${err}`);
  }
  return res.json();
}
