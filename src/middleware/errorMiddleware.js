const ApiError = require('../utils/ApiError');
const { sendError } = require('../utils/response');

/**
 * 404 Not Found handler for undefined routes
 */
const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

/**
 * Global centralized error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.details || null;

  // Handle malformed JSON body
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    message = 'Invalid JSON payload received';
  }

  // Handle MySQL Errors gracefully without leaking database internals
  if (err.code) {
    if (err.code === 'ER_DUP_ENTRY') {
      statusCode = 409;
      message = 'Duplicate entry. A record with this identifier already exists.';
    } else if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') {
      statusCode = 400;
      message = 'Database integrity constraint violation.';
    } else if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST') {
      statusCode = 503;
      message = 'Database service unavailable. Please try again later.';
    }
  }

  // Handle JWT verification errors that might have bypassed middleware
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token has expired';
  }

  // Log unexpected internal errors for diagnostics
  if (statusCode >= 500) {
    console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);
  }

  return sendError(res, message, statusCode, errors);
};

module.exports = {
  notFoundHandler,
  errorHandler
};
