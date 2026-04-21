/**
 * Google Photos Library API — requires OAuth2 access token with photoslibrary.readonly scope.
 */

/**
 * List albums.
 * @param {string} accessToken
 */
export async function listAlbums(accessToken) {
  const res = await fetch('https://photoslibrary.googleapis.com/v1/albums?pageSize=50', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Photos albums: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.albums || [];
}

/**
 * List media items in an album.
 * @param {string} accessToken
 * @param {string} albumId
 */
export async function listMediaInAlbum(accessToken, albumId) {
  const res = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
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
    throw new Error(`Google Photos media: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.mediaItems || [];
}

/**
 * Resize helper for display URLs.
 */
export function getMediaBaseUrl(mediaItem) {
  return mediaItem?.baseUrl ? `${mediaItem.baseUrl}=w800` : null;
}
