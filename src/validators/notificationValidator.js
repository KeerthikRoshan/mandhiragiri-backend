const { query, param, body, validationResult } = require('express-validator');
const { sendError } = require('../utils/response');
const { ALL_EVENT_TYPES } = require('../constants/notificationConstants');

/**
 * Middleware to evaluate express-validator results
 */
const validate = (validations) => {
  return async (req, res, next) => {
    for (const validation of validations) {
      const result = await validation.run(req);
      if (result.errors.length) break;
    }

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    const errorList = errors.array();
    const errorsMap = {};
    for (const err of errorList) {
      if (!errorsMap[err.path]) {
        errorsMap[err.path] = err.msg;
      }
    }

    return sendError(res, 'Validation failed for the submitted fields.', 400, errorsMap);
  };
};

/**
 * Validation rules for GET /notifications
 */
const validateListNotifications = validate([
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be an integer greater than or equal to 1.'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('limit must be an integer between 1 and 50.'),
  query('unreadOnly')
    .optional()
    .customSanitizer((val) => val === true || val === 'true' || val === '1' || val === 1),
  query('eventType')
    .optional()
    .trim()
    .isIn(ALL_EVENT_TYPES)
    .withMessage(`eventType must be one of: ${ALL_EVENT_TYPES.join(', ')}.`),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate must be a valid ISO8601 date string (YYYY-MM-DD).'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate must be a valid ISO8601 date string (YYYY-MM-DD).')
]);

/**
 * Validation rules for /notifications/:id routes
 */
const validateNotificationId = validate([
  param('id')
    .trim()
    .notEmpty()
    .isInt({ min: 1 })
    .withMessage('Valid numeric notification id parameter is required.')
]);

/**
 * Validation rules for PUT /notifications/preferences
 */
const validateUpdatePreferences = validate([
  body('preferences')
    .isArray({ min: 1 })
    .withMessage('preferences array is required with at least one preference item.'),
  body('preferences.*.eventType')
    .trim()
    .notEmpty()
    .withMessage('eventType is required for each preference.')
    .isIn(ALL_EVENT_TYPES)
    .withMessage(`eventType must be one of: ${ALL_EVENT_TYPES.join(', ')}.`),
  body('preferences.*.pushEnabled')
    .optional()
    .isBoolean()
    .withMessage('pushEnabled must be a boolean.'),
  body('preferences.*.inAppEnabled')
    .optional()
    .isBoolean()
    .withMessage('inAppEnabled must be a boolean.')
]);

module.exports = {
  validateListNotifications,
  validateNotificationId,
  validateUpdatePreferences
};
