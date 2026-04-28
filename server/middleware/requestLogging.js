import { logEvent } from '../utils/logger.js';

export function requestLoggingMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api')) return;
    const durationMs = Date.now() - start;
    logEvent('INFO', 'api_request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
    });
  });
  next();
}

