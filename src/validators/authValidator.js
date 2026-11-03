const { body, validationResult } = require('express-validator');
const { sendError } = require('../utils/response');

/**
 * Middleware to evaluate express-validator results with bilingual error formatting
 */
const validate = (validations) => {
  return async (req, res, next) => {
    // Gracefully normalize payload: support mobileNumber, mobile, phone, and countryCode
    if (req.body) {
      if (!req.body.mobileNumber && req.body.mobile) {
        req.body.mobileNumber = req.body.mobile;
      } else if (!req.body.mobileNumber && req.body.phone) {
        req.body.mobileNumber = req.body.phone;
      }
      if (!req.body.mobile && req.body.mobileNumber) {
        req.body.mobile = req.body.mobileNumber;
      }
    }

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
    let primaryMessage = 'Validation failed for the submitted fields.';

    for (const err of errorList) {
      const fieldKey = err.path === 'mobile' ? 'mobileNumber' : err.path;
      if (!errorsMap[fieldKey]) {
        errorsMap[fieldKey] = err.msg;
      }
      if (fieldKey === 'mobileNumber') {
        primaryMessage = 'சரியான 10 இலக்க இந்திய மொபைல் எண்ணை உள்ளிடவும்.';
      }
    }

    return sendError(res, primaryMessage, 400, errorsMap);
  };
};

/**
 * Validation rules for user login (Admin / Staff)
 */
const loginRules = [
  body('mobileNumber')
    .trim()
    .notEmpty()
    .withMessage('Enter a valid 10-digit Indian mobile number.')
    .customSanitizer((val) => {
      // Strip any whitespace, dashes, or leading +91
      const digits = String(val).replace(/\D/g, '');
      return digits.length > 10 && digits.startsWith('91') ? digits.slice(-10) : digits;
    })
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Enter a valid 10-digit Indian mobile number.'),
  body('password')
    .notEmpty()
    .withMessage('Password is required.')
];

/**
 * Validation rules for token refresh
 */
const refreshRules = [
  body('refreshToken')
    .trim()
    .notEmpty()
    .withMessage('Refresh token is required.')
];

/**
 * Validation rules for password change
 */
const changePasswordRules = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required.'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long.')
];

module.exports = {
  validateLogin: validate(loginRules),
  validateRefreshToken: validate(refreshRules),
  validateChangePassword: validate(changePasswordRules)
};
