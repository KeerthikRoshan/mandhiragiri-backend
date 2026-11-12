const notificationModel = require('../models/notificationModel');
const outboxModel = require('../models/outboxModel');
const { getQueueHealthData } = require('../../scripts/monitorNotificationQueues');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');


/**
 * List in-app notifications for authenticated user
 * GET /api/v1/notifications
 */
const listNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { page, limit, unreadOnly, eventType, startDate, endDate } = req.query;
  const lang = req.headers['accept-language'] || req.query.lang || 'ta';

  const result = await notificationModel.listNotificationsForUser(userId, {
    page,
    limit,
    unreadOnly,
    eventType,
    startDate,
    endDate,
    lang
  });

  return sendSuccess(res, 'Notifications retrieved successfully.', result, 200);
});

/**
 * Get total unread in-app notification count
 * GET /api/v1/notifications/unread-count
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const unreadCount = await notificationModel.getUnreadCountForUser(userId);

  return sendSuccess(
    res,
    'Unread notification count retrieved.',
    { unreadCount },
    200
  );
});

/**
 * Mark a single notification as read
 * PATCH /api/v1/notifications/:id/read
 */
const markNotificationAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const notificationId = req.params.id;

  const result = await notificationModel.markAsRead(notificationId, userId);

  return sendSuccess(res, 'Notification marked as read.', result, 200);
});

/**
 * Mark all notifications as read for authenticated user
 * PATCH /api/v1/notifications/read-all
 */
const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const markedCount = await notificationModel.markAllAsRead(userId);

  return sendSuccess(
    res,
    'All notifications marked as read.',
    { markedCount },
    200
  );
});

/**
 * Soft-delete / hide notification for authenticated user
 * DELETE /api/v1/notifications/:id
 */
const deleteNotification = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const notificationId = req.params.id;

  const deleted = await notificationModel.softDeleteNotification(notificationId, userId);

  return sendSuccess(
    res,
    'Notification deleted successfully.',
    {
      id: Number(notificationId),
      deleted: Boolean(deleted)
    },
    200
  );
});

/**
 * Get notification preferences for authenticated user
 * GET /api/v1/notifications/preferences
 */
const getPreferences = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const preferences = await notificationModel.getUserPreferences(userId);

  return sendSuccess(
    res,
    'Notification preferences retrieved.',
    { preferences },
    200
  );
});

/**
 * Update notification preferences for authenticated user
 * PUT /api/v1/notifications/preferences
 */
const updatePreferences = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const preferences = req.body.preferences;

  const updatedCount = await notificationModel.upsertUserPreferences(userId, preferences);

  return sendSuccess(
    res,
    'Notification preferences updated successfully.',
    { updatedCount },
    200
  );
});

/**
 * Get notification queue health and heartbeat metrics (Admin only)
 * GET /api/v1/notifications/admin/queue-health
 */
const getQueueHealth = asyncHandler(async (req, res) => {
  const healthData = await getQueueHealthData();
  return sendSuccess(res, 'Queue health retrieved successfully.', healthData, 200);
});

/**
 * Retry failed notification push job (Admin only)
 * POST /api/v1/notifications/admin/retry-job/:jobId
 */
const retryFailedJob = asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const adminUserId = req.user.id;
  const { reason } = req.body || {};

  const result = await notificationModel.retryFailedPushJob({
    jobId,
    adminUserId,
    reason
  });

  if (result.notFound) {
    throw new ApiError(404, `Notification job with ID ${jobId} not found.`);
  }
  if (result.isCancelled) {
    throw new ApiError(400, 'Cannot retry CANCELLED notification job.');
  }
  if (result.invalidStatus) {
    throw new ApiError(400, `Cannot retry notification job with status ${result.currentStatus}. Only FAILED jobs can be retried.`);
  }

  return sendSuccess(res, 'Notification job reset for retry successfully.', result, 200);
});

/**
 * Retry failed outbox event (Admin only)
 * POST /api/v1/notifications/admin/retry-outbox/:eventId
 */
const retryFailedOutbox = asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const adminUserId = req.user.id;
  const { reason } = req.body || {};

  const result = await outboxModel.retryFailedOutboxEvent({
    eventId,
    adminUserId,
    reason
  });

  if (result.notFound) {
    throw new ApiError(404, `Outbox event with ID ${eventId} not found.`);
  }
  if (result.invalidStatus) {
    throw new ApiError(400, `Cannot retry outbox event with status ${result.currentStatus}. Only FAILED events can be retried.`);
  }

  return sendSuccess(res, 'Outbox event reset for retry successfully.', result, 200);
});

module.exports = {
  listNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  getPreferences,
  updatePreferences,
  getQueueHealth,
  retryFailedJob,
  retryFailedOutbox
};

