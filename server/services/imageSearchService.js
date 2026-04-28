/**
 * Google Custom Search JSON API — image results with relevance-based confidence scores.
 */
import { google } from 'googleapis';
import { logExternalApiCall } from '../utils/logger.js';

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

  const start = Date.now();
  let res;
  try {
    res = await customsearch.cse.list({
      auth: key,
      cx,
      q: query,
      searchType: 'image',
      num: Math.min(Math.max(limit, 1), 10),
      safe: 'active',
    });
  } catch (err) {
    logExternalApiCall({
      service: 'google_custom_search',
      operation: 'image_search',
      method: 'GET',
      url: 'googleapis.customsearch.cse.list',
      status: err?.code ? Number(err.code) : undefined,
      ok: false,
      durationMs: Date.now() - start,
      errorMessage: err?.message || String(err),
      extra: { q: String(query).slice(0, 200) },
    });
    throw err;
  }

  logExternalApiCall({
    service: 'google_custom_search',
    operation: 'image_search',
    method: 'GET',
    url: 'googleapis.customsearch.cse.list',
    status: 200,
    ok: true,
    durationMs: Date.now() - start,
    extra: { q: String(query).slice(0, 200) },
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
