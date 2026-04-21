/**
 * Unified HTTP error shape for API responses: { error, code }.
 * Never exposes raw err.message to clients.
 */

export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code SCREAMING_SNAKE code
   * @param {string} message Friendly user-facing message
   */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Send a consistent error response.
 */
export function sendError(res, status, code, message) {
  return res.status(status).json({ error: message, code });
}

/**
 * Express wrapper that converts thrown HttpError into a response and
 * forwards other errors to the final handler.
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Require a service to be configured before calling a handler.
 * Returns 503 with a friendly message otherwise.
 *
 * @param {() => boolean} isConfigured
 * @param {string} friendlyMessage
 */
export function requireService(isConfigured, friendlyMessage) {
  return (_req, res, next) => {
    if (!isConfigured()) {
      return sendError(res, 503, 'SERVICE_NOT_CONFIGURED', friendlyMessage);
    }
    return next();
  };
}
