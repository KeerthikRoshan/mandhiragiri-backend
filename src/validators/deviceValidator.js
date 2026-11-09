const { body, validationResult } = require('express-validator');
const { sendError } = require('../utils/response');

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
 * Validation rules for POST /devices/register
 */
const validateRegisterDevice = validate([
  body('fcmToken')
    .trim()
    .notEmpty()
    .withMessage('fcmToken is required.')
    .isLength({ min: 20 })
    .withMessage('fcmToken must be a valid FCM registration token.'),
  body('platform')
    .optional()
    .trim()
    .toLowerCase()
    .isIn(['android', 'ios', 'web'])
    .withMessage('platform must be one of: android, ios, web.'),
  body('deviceId')
    .optional()
    .trim()
    .isLength({ max: 150 })
    .withMessage('deviceId must not exceed 150 characters.'),
  body('appVersion')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('appVersion must not exceed 50 characters.')
]);

/**
 * Validation rules for PUT /devices/token
 */
const validateUpdateToken = validate([
  body('fcmToken')
    .trim()
    .notEmpty()
    .withMessage('fcmToken is required.')
    .isLength({ min: 20 })
    .withMessage('fcmToken must be a valid FCM registration token.'),
  body('oldToken')
    .optional()
    .trim()
    .isLength({ min: 20 })
    .withMessage('oldToken must be a valid FCM registration token.'),
  body('deviceId')
    .optional()
    .trim()
    .isLength({ max: 150 })
    .withMessage('deviceId must not exceed 150 characters.'),
  body('platform')
    .optional()
    .trim()
    .toLowerCase()
    .isIn(['android', 'ios', 'web'])
    .withMessage('platform must be one of: android, ios, web.'),
  body('appVersion')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('appVersion must not exceed 50 characters.')
]);

/**
 * Validation rules for POST /devices/unregister
 * Requires either fcmToken OR deviceId
 */
const validateUnregisterDevice = validate([
  body().custom((value, { req }) => {
    const hasFcmToken = req.body && req.body.fcmToken && String(req.body.fcmToken).trim().length > 0;
    const hasDeviceId = req.body && req.body.deviceId && String(req.body.deviceId).trim().length > 0;
    if (!hasFcmToken && !hasDeviceId) {
      throw new Error('Either fcmToken or deviceId is required to unregister device.');
    }
    return true;
  }),
  body('fcmToken')
    .optional()
    .trim()
    .isLength({ min: 10 })
    .withMessage('fcmToken must be a valid token string.'),
  body('deviceId')
    .optional()
    .trim()
    .isLength({ max: 150 })
    .withMessage('deviceId must not exceed 150 characters.')
]);

/**
 * Validation rules for POST /devices/test-notification
 */
const validateTestNotification = validate([
  body('title')
    .optional()
    .trim()
    .isLength({ max: 150 })
    .withMessage('title must not exceed 150 characters.'),
  body('body')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('body must not exceed 500 characters.'),
  body('fcmToken')
    .optional()
    .trim()
    .isLength({ min: 20 })
    .withMessage('fcmToken must be a valid FCM token.')
]);

module.exports = {
  validateRegisterDevice,
  validateUpdateToken,
  validateUnregisterDevice,
  validateTestNotification
};
