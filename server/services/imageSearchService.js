/**
 * Google Custom Search JSON API — image results with relevance-based confidence scores.
 */
import { google } from 'googleapis';

function getCx() {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
  if (!key || !cx) {
    throw new Error('GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID must be set');
  }
  return { key, cx };
}

/**
 * Search images; map rank to a confidence score (higher rank = higher score).
 * @param {string} query — sanitized, short
 * @param {number} limit — 1–10
 */
export async function searchSimilarImages(query, limit = 8) {
  const { key, cx } = getCx();
  const customsearch = google.customsearch('v1');

  const res = await customsearch.cse.list({
    auth: key,
    cx,
    q: query,
    searchType: 'image',
    num: Math.min(Math.max(limit, 1), 10),
    safe: 'active',
  });

  const items = res.data.items || [];
  const n = items.length || 1;

  return items.map((item, index) => {
    // Decay confidence from top result (~95%) downward
    const confidence = Math.round(95 - (index / Math.max(n, 1)) * 40);
    return {
      title: item.title || '',
      link: item.link || '',
      displayLink: item.displayLink || '',
      snippet: item.snippet || '',
      confidence: Math.max(50, Math.min(99, confidence)),
    };
  });
}
