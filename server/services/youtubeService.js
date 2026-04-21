/**
 * YouTube Data API v3 — list videos uploaded by the authenticated user.
 */
import { google } from 'googleapis';

/**
 * @param {string} accessToken — OAuth access token with youtube.readonly or youtube scope
 * @param {number} maxResults
 */
export async function listMyVideos(accessToken, maxResults = 25) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });

  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  const res = await yt.search.list({
    part: ['snippet'],
    forMine: true,
    type: ['video'],
    maxResults: Math.min(maxResults, 50),
  });

  const items = res.data.items || [];
  return items.map((item) => ({
    videoId: item.id?.videoId,
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    thumbnails: item.snippet?.thumbnails || {},
  }));
}

/**
 * Video metadata by ID.
 */
export async function getVideoById(accessToken, videoId) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });

  const yt = google.youtube({ version: 'v3', auth: oauth2 });
  const res = await yt.videos.list({
    part: ['snippet', 'contentDetails'],
    id: [videoId],
  });

  const v = res.data.items?.[0];
  if (!v) return null;
  return {
    videoId: v.id,
    title: v.snippet?.title,
    description: v.snippet?.description,
  };
}
