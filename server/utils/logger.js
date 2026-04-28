import { Logging } from '@google-cloud/logging';

function envBool(name, def = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return def;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

const ENABLE_CLOUD_LOGGING = envBool('CLOUD_LOGGING', true);

let loggingClient = null;
let apiLog = null;

function getApiLog() {
  if (!ENABLE_CLOUD_LOGGING) return null;
  if (apiLog) return apiLog;
  try {
    loggingClient = new Logging();
    apiLog = loggingClient.log('roomify_api_calls');
    return apiLog;
  } catch {
    // Fall back to stdout JSON logs (Cloud Run ingests these into Cloud Logging).
    return null;
  }
}

export function logEvent(severity, message, meta = {}) {
  const payload = {
    message,
    ...meta,
  };

  // Always emit a structured log line (Cloud Run -> Cloud Logging).
  const line = JSON.stringify({
    severity: severity || 'INFO',
    ...payload,
  });
  // eslint-disable-next-line no-console
  console.log(line);

  const log = getApiLog();
  if (!log) return;

  try {
    const entry = log.entry(
      {
        severity: severity || 'INFO',
        resource: { type: 'cloud_run_revision' },
      },
      payload
    );
    log.write(entry).catch(() => {});
  } catch {
    // Ignore logging failures.
  }
}

export function logExternalApiCall({
  service,
  operation,
  method,
  url,
  status,
  ok,
  durationMs,
  errorMessage,
  extra,
} = {}) {
  const sev = ok ? 'INFO' : status >= 500 ? 'ERROR' : 'WARNING';
  logEvent(sev, 'external_api_call', {
    service: service || 'unknown',
    operation: operation || 'unknown',
    method: method || undefined,
    url: url ? String(url).slice(0, 300) : undefined,
    status: typeof status === 'number' ? status : undefined,
    ok: Boolean(ok),
    durationMs: typeof durationMs === 'number' ? Math.round(durationMs) : undefined,
    errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : undefined,
    ...(extra && typeof extra === 'object' ? { extra } : {}),
  });
}

export async function timed(label, fn) {
  const start = Date.now();
  try {
    const out = await fn();
    return { out, durationMs: Date.now() - start, error: null };
  } catch (error) {
    return { out: null, durationMs: Date.now() - start, error };
  }
}

