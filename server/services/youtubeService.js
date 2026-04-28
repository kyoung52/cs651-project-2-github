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

  // Use the channel's uploads playlist instead of search.list?forMine=true,
  // which historically required the broader 'youtube' scope. playlistItems +
  // channels.list?mine=true work under youtube.readonly.
  const ch = await yt.channels.list({ part: ['contentDetails'], mine: true });
  const uploadsId = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];
  const res = await yt.playlistItems.list({
    part: ['snippet'],
    playlistId: uploadsId,
    maxResults: Math.min(maxResults, 50),
  });

  return (res.data.items || []).map((it) => ({
    videoId: it.snippet?.resourceId?.videoId,
    title: it.snippet?.title || '',
    description: it.snippet?.description || '',
    thumbnails: it.snippet?.thumbnails || {},
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
