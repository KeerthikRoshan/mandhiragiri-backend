const { body, validationResult } = require('express-validator');
const { sendError } = require('../utils/response');

/**
 * Middleware to evaluate express-validator results
 */
const validate = (validations) => {
  return async (req, res, next) => {
    // Gracefully normalize mobileNumber alias to mobile if provided
    if (req.body && !req.body.mobile && req.body.mobileNumber) {
      req.body.mobile = req.body.mobileNumber;
    }

    for (const validation of validations) {
      const result = await validation.run(req);
      if (result.errors.length) break;
    }

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    const formattedErrors = errors.array().map((err) => ({
      field: err.path,
      message: err.msg
    }));

    return sendError(res, 'Validation failed', 422, formattedErrors);
  };
};

/**
 * Validation rules for user login
 */
const loginRules = [
  body('mobile')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required')
    .matches(/^[0-9]{10,15}$/)
    .withMessage('Invalid mobile number format. Please provide 10 to 15 digits.'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

/**
 * Validation rules for token refresh
 */
const refreshRules = [
  body('refreshToken')
    .trim()
    .notEmpty()
    .withMessage('Refresh token is required')
];

/**
 * Validation rules for password change
 */
const changePasswordRules = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number')
];

module.exports = {
  validateLogin: validate(loginRules),
  validateRefreshToken: validate(refreshRules),
  validateChangePassword: validate(changePasswordRules)
};
