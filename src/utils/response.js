/**
 * Standard API Response Handlers
 * Aligned with Manthiragiri Jothidam Mobile Client Specifications
 */

/**
 * Send standard success response
 * @param {import('express').Response} res
 * @param {string} message
 * @param {any} data
 * @param {number} statusCode
 */
const sendSuccess = (res, message = 'Operation completed successfully.', data = null, statusCode = 200) => {
  return res.status(statusCode).json({
    status: 1,
    success: true,
    message,
    data,
    errors: null,
    timestamp: new Date().toISOString()
  });
};

/**
 * Send standard error response
 * @param {import('express').Response} res
 * @param {string} message
 * @param {number} statusCode
 * @param {any} errors
 */
const sendError = (res, message = 'An error occurred', statusCode = 500, errors = null) => {
  return res.status(statusCode).json({
    status: 0,
    success: false,
    message,
    data: null,
    errors: errors || null,
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  sendSuccess,
  sendError
};
