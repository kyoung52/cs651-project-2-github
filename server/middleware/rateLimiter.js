import rateLimit from 'express-rate-limit';

/** General API rate limit */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', code: 'RATE_LIMIT' },
});

/** Stricter limit for upload-heavy routes */
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads', code: 'RATE_LIMIT_UPLOAD' },
});

/** Per-user limiter for paid generation endpoints (e.g. Vertex image renders). */
export const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.uid || req.ip,
  message: { error: 'Too many generations — please wait a moment.', code: 'RATE_LIMIT_GENERATION' },
});
