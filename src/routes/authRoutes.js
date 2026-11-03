const express = require('express');
const authController = require('../controllers/authController');
const {
  validateLogin,
  validateRefreshToken,
  validateChangePassword
} = require('../validators/authValidator');
const {
  authenticate,
  loginRateLimiter
} = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate user (Admin or Staff) using mobile number and password
 * @access  Public
 */
router.post(
  '/login',
  loginRateLimiter,
  validateLogin,
  authController.login
);

/**
 * @route   POST /api/v1/auth/staff-login
 * @desc    Staff Sign In (Priests and Assistants Portal)
 * @access  Public
 */
router.post(
  '/staff-login',
  loginRateLimiter,
  validateLogin,
  authController.staffLogin
);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Exchange refresh token for a new token pair (Access + Refresh)
 * @access  Public (Requires valid refresh token)
 */
router.post(
  '/refresh',
  validateRefreshToken,
  authController.refresh
);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Revoke session / refresh token
 * @access  Public / Authenticated
 */
router.post(
  '/logout',
  authController.logout
);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get currently authenticated user details, role and permissions
 * @access  Private (Requires Bearer token)
 */
router.get(
  '/me',
  authenticate,
  authController.getMe
);

/**
 * @route   POST /api/v1/auth/change-password
 * @desc    Change password
 * @access  Private (Requires Bearer token)
 */
router.post(
  '/change-password',
  authenticate,
  validateChangePassword,
  authController.changePassword
);

module.exports = router;
