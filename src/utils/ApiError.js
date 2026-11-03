/**
 * Custom application error class for operational errors
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code
   * @param {string} message - Error description
   * @param {boolean} isOperational - Whether error is expected operational error
   * @param {Array|Object} details - Optional extra error details (e.g. validation issues)
   */
  constructor(statusCode, message, isOperational = true, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad Request', details = null) {
    return new ApiError(400, message, true, details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message, true);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message, true);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message, true);
  }

  static unprocessable(message = 'Validation failed', details = null) {
    return new ApiError(422, message, true, details);
  }

  static tooManyRequests(message = 'Too many requests. Please try again later.') {
    return new ApiError(429, message, true);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, message, false);
  }
}

module.exports = ApiError;
