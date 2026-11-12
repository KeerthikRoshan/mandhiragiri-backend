const express = require('express');
const notificationController = require('../controllers/notificationController');
const {
  validateListNotifications,
  validateNotificationId,
  validateUpdatePreferences
} = require('../validators/notificationValidator');
const { authenticate, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

const adminOnly = [authenticate, authorizeRoles('SUPER_ADMIN', 'ADMIN')];

/**
 * @route   GET /api/v1/notifications/admin/queue-health
 * @route   GET /api/v1/notifications/admin/diagnostics
 * @desc    Get notification queue and worker heartbeat health metrics & FCM diagnostics
 * @access  Private (Admin / Super Admin only)
 */
router.get(
  '/admin/queue-health',
  adminOnly,
  notificationController.getQueueHealth
);

router.get(
  '/admin/diagnostics',
  adminOnly,
  notificationController.getQueueHealth
);

/**
 * @route   POST /api/v1/notifications/admin/retry-job/:jobId
 * @desc    Retry failed notification push job
 * @access  Private (Admin / Super Admin only)
 */
router.post(
  '/admin/retry-job/:jobId',
  adminOnly,
  notificationController.retryFailedJob
);

/**
 * @route   POST /api/v1/notifications/admin/retry-outbox/:eventId
 * @desc    Retry failed notification outbox event
 * @access  Private (Admin / Super Admin only)
 */
router.post(
  '/admin/retry-outbox/:eventId',
  adminOnly,
  notificationController.retryFailedOutbox
);


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
