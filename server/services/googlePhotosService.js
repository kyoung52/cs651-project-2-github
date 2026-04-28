/**
 * Google Photos Library API — requires OAuth2 access token with photoslibrary.readonly scope.
 */

/**
 * List albums.
 * @param {string} accessToken
 */
export async function listAlbums(accessToken) {
  const url = 'https://photoslibrary.googleapis.com/v1/albums?pageSize=50';
  const start = Date.now();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const err = await res.text();
    const { logExternalApiCall } = await import('../utils/logger.js');
    logExternalApiCall({
      service: 'google_photos',
      operation: 'list_albums',
      method: 'GET',
      url,
      status: res.status,
      ok: false,
      durationMs: Date.now() - start,
      errorMessage: err,
    });
    throw new Error(`Google Photos albums: ${res.status} ${err}`);
  }
  const data = await res.json();
  const { logExternalApiCall } = await import('../utils/logger.js');
  logExternalApiCall({
    service: 'google_photos',
    operation: 'list_albums',
    method: 'GET',
    url,
    status: res.status,
    ok: true,
    durationMs: Date.now() - start,
  });
  return data.albums || [];
}

/**
 * List media items in an album.
 * @param {string} accessToken
 * @param {string} albumId
 */
export async function listMediaInAlbum(accessToken, albumId) {
  const url = 'https://photoslibrary.googleapis.com/v1/mediaItems:search';
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      albumId,
      pageSize: 50,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    const { logExternalApiCall } = await import('../utils/logger.js');
    logExternalApiCall({
      service: 'google_photos',
      operation: 'list_media_in_album',
      method: 'POST',
      url,
      status: res.status,
      ok: false,
      durationMs: Date.now() - start,
      errorMessage: err,
      extra: { albumId: String(albumId).slice(0, 64) },
    });
    throw new Error(`Google Photos media: ${res.status} ${err}`);
  }
  const data = await res.json();
  const { logExternalApiCall } = await import('../utils/logger.js');
  logExternalApiCall({
    service: 'google_photos',
    operation: 'list_media_in_album',
    method: 'POST',
    url,
    status: res.status,
    ok: true,
    durationMs: Date.now() - start,
    extra: { albumId: String(albumId).slice(0, 64) },
  });
  return data.mediaItems || [];
}

/**
 * Resize helper for display URLs.
 */
export function getMediaBaseUrl(mediaItem) {
  return mediaItem?.baseUrl ? `${mediaItem.baseUrl}=w800` : null;
}
