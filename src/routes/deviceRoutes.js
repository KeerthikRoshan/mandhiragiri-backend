const express = require('express');
const deviceController = require('../controllers/deviceController');
const {
  validateRegisterDevice,
  validateUpdateToken,
  validateUnregisterDevice,
  validateTestNotification
} = require('../validators/deviceValidator');
const { authenticate, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * @route   POST /api/v1/devices/register
 * @desc    Register or reactivate device FCM token for authenticated user
 * @access  Private (Admin or Staff)
 */
router.post(
  '/register',
  authenticate,
  validateRegisterDevice,
  deviceController.registerDevice
);

/**
 * @route   PUT /api/v1/devices/token
 * @desc    Update FCM token upon refresh for authenticated user
 * @access  Private (Admin or Staff)
 */
router.put(
  '/token',
  authenticate,
  validateUpdateToken,
  deviceController.updateToken
);

/**
 * @route   POST /api/v1/devices/unregister
 * @desc    Deactivate device token on logout
 * @access  Private (Admin or Staff)
 */
router.post(
  '/unregister',
  authenticate,
  validateUnregisterDevice,
  deviceController.unregisterDevice
);

/**
 * @route   POST /api/v1/devices/test-notification
 * @desc    Send a test push notification to admin's own active device
 * @access  Private (Super Admin or Admin only)
 */
router.post(
  '/test-notification',
  authenticate,
  authorizeRoles('SUPER_ADMIN', 'ADMIN'),
  validateTestNotification,
  deviceController.sendTestNotification
);

module.exports = router;
