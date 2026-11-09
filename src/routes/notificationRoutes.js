const express = require('express');
const notificationController = require('../controllers/notificationController');
const {
  validateListNotifications,
  validateNotificationId,
  validateUpdatePreferences
} = require('../validators/notificationValidator');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * @route   GET /api/v1/notifications
 * @desc    Get paginated, filtered in-app notifications for authenticated user
 * @access  Private (Admin or Staff)
 */
router.get(
  '/',
  authenticate,
  validateListNotifications,
  notificationController.listNotifications
);

/**
 * @route   GET /api/v1/notifications/unread-count
 * @desc    Get total unread in-app notification count for authenticated user
 * @access  Private (Admin or Staff)
 */
router.get(
  '/unread-count',
  authenticate,
  notificationController.getUnreadCount
);

/**
 * @route   PATCH /api/v1/notifications/read-all
 * @desc    Mark all unread in-app notifications as read for authenticated user
 * @access  Private (Admin or Staff)
 * (Note: Defined before /:id/read to prevent route parameter collision)
 */
router.patch(
  '/read-all',
  authenticate,
  notificationController.markAllNotificationsAsRead
);

/**
 * @route   PATCH /api/v1/notifications/:id/read
 * @desc    Mark single notification as read for authenticated user
 * @access  Private (Admin or Staff)
 */
router.patch(
  '/:id/read',
  authenticate,
  validateNotificationId,
  notificationController.markNotificationAsRead
);

/**
 * @route   DELETE /api/v1/notifications/:id
 * @desc    Soft-delete / hide notification for authenticated user
 * @access  Private (Admin or Staff)
 */
router.delete(
  '/:id',
  authenticate,
  validateNotificationId,
  notificationController.deleteNotification
);

/**
 * @route   GET /api/v1/notifications/preferences
 * @desc    Get notification preferences for authenticated user
 * @access  Private (Admin or Staff)
 */
router.get(
  '/preferences',
  authenticate,
  notificationController.getPreferences
);

/**
 * @route   PUT /api/v1/notifications/preferences
 * @desc    Update notification preferences for authenticated user
 * @access  Private (Admin or Staff)
 */
router.put(
  '/preferences',
  authenticate,
  validateUpdatePreferences,
  notificationController.updatePreferences
);

module.exports = router;
