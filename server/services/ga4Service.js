import { logExternalApiCall } from '../utils/logger.js';

function trimmed(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function cfg() {
  return {
    measurementId: trimmed(process.env.GA_MEASUREMENT_ID),
    apiSecret: trimmed(process.env.GA_API_SECRET),
    clientId: trimmed(process.env.GA_CLIENT_ID) || 'server',
  };
}

export function isServerAnalyticsConfigured() {
  const c = cfg();
  return Boolean(c.measurementId && c.apiSecret);
}

export async function trackServerEvent(name, params = {}) {
  const c = cfg();
  if (!c.measurementId || !c.apiSecret) return false;
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
    c.measurementId
  )}&api_secret=${encodeURIComponent(c.apiSecret)}`;

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: c.clientId,
        events: [{ name, params }],
      }),
    });

    logExternalApiCall({
      service: 'google_analytics',
      operation: 'measurement_protocol_collect',
      method: 'POST',
      url: 'ga4:mp/collect',
      status: res.status,
      ok: res.ok,
      durationMs: Date.now() - start,
      errorMessage: res.ok ? undefined : await res.text().catch(() => ''),
    });

    return res.ok;
  } catch (err) {
    logExternalApiCall({
      service: 'google_analytics',
      operation: 'measurement_protocol_collect',
      method: 'POST',
      url: 'ga4:mp/collect',
      ok: false,
      durationMs: Date.now() - start,
      errorMessage: err?.message || String(err),
    });
    return false;
  }
}

