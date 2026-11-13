const { messaging } = require('../config/firebase');
const deviceModel = require('../models/deviceModel');
const notificationModel = require('../models/notificationModel');
const {
  NOTIFICATION_EVENTS,
  ENTITY_TYPES,
  PRIORITIES,
  generateEventIdempotencyKey
} = require('../constants/notificationConstants');

/**
 * Mask token for safe logging
 * @param {string} token
 * @returns {string}
 */
const maskToken = (token) => {
  if (!token || typeof token !== 'string') return '[empty]';
  if (token.length <= 10) return '***';
  return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
};

/**
 * Send a push notification to a specific FCM device token (Phase 1 retained)
 *
 * @param {Object} params
 * @param {string} params.token - FCM device token
 * @param {string} params.title - Notification title
 * @param {string} params.body - Notification body
 * @param {Object} [params.data] - Custom data payload
 * @returns {Promise<Object>}
 */
const sendPushNotification = async ({ token, title, body, data = {} }) => {
  if (!token) {
    throw new Error('FCM token is required to send a push notification.');
  }

  const sanitizedData = {};
  for (const [key, value] of Object.entries(data)) {
    sanitizedData[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  const message = {
    token,
    notification: {
      title: title || 'Mandhiragiri Jothidam',
      body: body || 'Push notification test successful!'
    },
    data: sanitizedData
  };

  try {
    const messageId = await messaging.send(message);
    console.log(`[FCM SUCCESS] Message sent to ${maskToken(token)}: ${messageId}`);
    return {
      success: true,
      messageId,
      maskedToken: maskToken(token)
    };
  } catch (error) {
    console.error(`[FCM ERROR] Failed sending to ${maskToken(token)}:`, error.message);

    const errorCode = error.code || '';
    if (
      errorCode === 'messaging/registration-token-not-registered' ||
      errorCode === 'messaging/invalid-argument' ||
      errorCode === 'messaging/invalid-registration-token'
    ) {
      console.warn(`[FCM DEACTIVATE] Deactivating stale token: ${maskToken(token)}`);
      await deviceModel.deactivateStaleToken(token).catch(() => {});
    }

    throw error;
  }
};

/**
 * Resolve recipient user IDs following explicit event-specific business rules
 *
 * @param {string} eventType
 * @param {Object} context
 * @param {string|number} [context.priestId] - Booking assigned priest identifier
 * @param {string|number} [context.staffId] - Staff table ID
 * @param {Array<number|string>} [context.targetUserIds] - Explicit target user IDs override
 * @returns {Promise<Array<number>>}
 */
const resolveRecipientsForEvent = async (eventType, context = {}) => {
  if (Array.isArray(context.targetUserIds) && context.targetUserIds.length > 0) {
    return Array.from(new Set(context.targetUserIds.map(Number)));
  }

  const recipientSet = new Set();

  switch (eventType) {
    case NOTIFICATION_EVENTS.BOOKING_CREATED: {
      // Notify Administrators
      const adminIds = await notificationModel.resolveActiveAdminUserIds();
      adminIds.forEach((id) => recipientSet.add(id));

      // Notify the specific assigned Priest or Assistant if provided
      if (context.priestId) {
        const assignedUserId = await notificationModel.resolveBookingAssignedStaffUserId(context.priestId);
        if (assignedUserId) {
          recipientSet.add(assignedUserId);
        }
      }
      break;
    }

    case 'BOOKING_UPDATED':
    case NOTIFICATION_EVENTS.BOOKING_ASSIGNED:
    case NOTIFICATION_EVENTS.BOOKING_RESCHEDULED:
    case NOTIFICATION_EVENTS.BOOKING_CANCELLED:
    case NOTIFICATION_EVENTS.BOOKING_COMPLETED: {
      // Notify Administrators
      const adminIds = await notificationModel.resolveActiveAdminUserIds();
      adminIds.forEach((id) => recipientSet.add(id));

      // Notify the specific assigned Priest or Assistant
      if (context.priestId) {
        const assignedUserId = await notificationModel.resolveBookingAssignedStaffUserId(context.priestId);
        if (assignedUserId) {
          recipientSet.add(assignedUserId);
        }
      }
      break;
    }

    case 'BOOKING_24H_REMINDER':
    case 'BOOKING_1H_REMINDER':
    case 'BOOKING_5M_REMINDER': {
      // Notify Administrators
      const adminIds = await notificationModel.resolveActiveAdminUserIds();
      adminIds.forEach((id) => recipientSet.add(id));

      // Notify the specific assigned Priest or Assistant
      if (context.priestId) {
        const assignedUserId = await notificationModel.resolveBookingAssignedStaffUserId(context.priestId);
        if (assignedUserId) {
          recipientSet.add(assignedUserId);
        }
      }
      break;
    }

    case NOTIFICATION_EVENTS.BOOKING_REMINDER: {
      // Notify the assigned Priest or Assistant (or Admins if unassigned)
      if (context.priestId) {
        const assignedUserId = await notificationModel.resolveBookingAssignedStaffUserId(context.priestId);
        if (assignedUserId) {
          recipientSet.add(assignedUserId);
        } else {
          const adminIds = await notificationModel.resolveActiveAdminUserIds();
          adminIds.forEach((id) => recipientSet.add(id));
        }
      } else {
        const adminIds = await notificationModel.resolveActiveAdminUserIds();
        adminIds.forEach((id) => recipientSet.add(id));
      }
      break;
    }

    case NOTIFICATION_EVENTS.LEAVE_REQUESTED: {
      // Notify Administrators
      const adminIds = await notificationModel.resolveActiveAdminUserIds();
      adminIds.forEach((id) => recipientSet.add(id));
      break;
    }

    case NOTIFICATION_EVENTS.LEAVE_APPROVED:
    case NOTIFICATION_EVENTS.LEAVE_REJECTED: {
      // Notify only the staff member who applied for leave
      if (context.staffId) {
        const staffUserId = await notificationModel.resolveStaffUserIdByStaffId(context.staffId);
        if (staffUserId) {
          recipientSet.add(staffUserId);
        }
      }
      break;
    }

    case NOTIFICATION_EVENTS.ATTENDANCE_REMINDER: {
      // Notify all active Priests & Assistants
      const staffIds = await notificationModel.resolveAllActiveStaffUserIds();
      staffIds.forEach((id) => recipientSet.add(id));
      break;
    }

    case NOTIFICATION_EVENTS.ATTENDANCE_ALERT: {
      // Notify all active Administrators
      const adminIds = await notificationModel.resolveActiveAdminUserIds();
      adminIds.forEach((id) => recipientSet.add(id));
      break;
    }

    case 'CLIENT_ADVANCE_RECEIVED':
    case 'CLIENT_PAYMENT_UPDATED': {
      // Notify Administrators ONLY - Customers NEVER receive internal notifications, Staff does not see client finances
      const adminIds = await notificationModel.resolveActiveAdminUserIds();
      adminIds.forEach((id) => recipientSet.add(id));
      break;
    }

    case 'PRIEST_ADVANCE_PAID':
    case 'PRIEST_REMUNERATION_UPDATED':
    case NOTIFICATION_EVENTS.PAYMENT_UPDATED: {
      // Notify Administrators
      const adminIds = await notificationModel.resolveActiveAdminUserIds();
      adminIds.forEach((id) => recipientSet.add(id));

      // For Priest remuneration/advances, also notify assigned Priest. Customers NEVER receive notifications.
      if (context.party !== 'CLIENT' && context.priestId) {
        const assignedUserId = await notificationModel.resolveBookingAssignedStaffUserId(context.priestId);
        if (assignedUserId) {
          recipientSet.add(assignedUserId);
        }
      }
      break;
    }

    case NOTIFICATION_EVENTS.SYSTEM_ANNOUNCEMENT:
    default: {
      // Both Admins and all active Priests & Assistants
      const adminIds = await notificationModel.resolveActiveAdminUserIds();
      adminIds.forEach((id) => recipientSet.add(id));
      const staffIds = await notificationModel.resolveAllActiveStaffUserIds();
      staffIds.forEach((id) => recipientSet.add(id));
      break;
    }
  }

  return Array.from(recipientSet);
};

/**
 * Process a durable PUSH_DELIVERY job with atomic lease claiming and multi-device aggregation
 *
 * @param {Object} job - notification_jobs row
 * @returns {Promise<{ success: boolean, deliveryStatus: string }>}
 */
const processPushDeliveryJob = async (job) => {
  // 1. Claim job atomically with lease
  const claimed = await notificationModel.claimDeliveryJob(job.id, 5);
  if (!claimed) {
    return { success: false, deliveryStatus: 'CLAIM_FAILED' };
  }

  const userId = job.recipient_user_id;

  try {
    // 2. Fetch active registered devices for this user
    const activeDevices = await deviceModel.getActiveDevicesForUser(userId);

    if (!activeDevices || activeDevices.length === 0) {
      await notificationModel.completeDeliveryJob({
        jobId: job.id,
        notificationId: job.notification_id,
        recipientUserId: userId,
        success: false,
        error: 'No active registered devices',
        isSkipped: true
      });
      return { success: false, deliveryStatus: 'SKIPPED' };
    }

    // 3. Attempt FCM delivery to all active devices
    let successfulSendCount = 0;
    const errors = [];
    let allErrorsPermanent = true;

    for (const device of activeDevices) {
      try {
        const notificationPayload = {
          token: device.fcm_token,
          title: job.title_ta || job.title_en || 'Mandhiragiri Jothidam',
          body: job.body_ta || job.body_en || 'New notification',
          data: {
            eventType: job.event_type || '',
            entityType: job.entity_type || '',
            entityId: String(job.entity_id || ''),
            notificationId: String(job.notification_id)
          }
        };

        await sendPushNotification(notificationPayload);
        successfulSendCount++;
      } catch (sendErr) {
        const errCode = sendErr.code || '';
        const isPermanent =
          errCode === 'messaging/registration-token-not-registered' ||
          errCode === 'messaging/invalid-argument' ||
          errCode === 'messaging/invalid-registration-token';

        if (!isPermanent) {
          allErrorsPermanent = false;
        }

        errors.push(`[${maskToken(device.fcm_token)}]: ${sendErr.message}`);
      }
    }

    // 4. Multi-device aggregate status:
    // If at least one device receives a successful FCM send -> aggregate recipient status is SENT.
    // If all fail -> FAILED.
    const overallSuccess = successfulSendCount > 0;
    const errorMessage = errors.length > 0 ? errors.join('; ') : null;

    await notificationModel.completeDeliveryJob({
      jobId: job.id,
      notificationId: job.notification_id,
      recipientUserId: userId,
      success: overallSuccess,
      error: errorMessage,
      attempts: job.attempts || 1,
      isPermanentError: !overallSuccess && allErrorsPermanent
    });

    return {
      success: overallSuccess,
      deliveryStatus: overallSuccess ? 'SENT' : 'FAILED'
    };
  } catch (unexpectedErr) {
    console.error(`[JOB ERROR] Unexpected error processing job ${job.id}:`, unexpectedErr);
    await notificationModel.completeDeliveryJob({
      jobId: job.id,
      notificationId: job.notification_id,
      recipientUserId: userId,
      success: false,
      error: unexpectedErr.message,
      attempts: job.attempts || 1,
      isPermanentError: false
    });
    return { success: false, deliveryStatus: 'FAILED' };
  }
};

/**
 * Create a business notification event, persist transactionally, and trigger durable push queue
 *
 * @param {Object} params
 * @param {string} params.eventType
 * @param {string} params.titleEn
 * @param {string} params.bodyEn
 * @param {string} params.titleTa
 * @param {string} params.bodyTa
 * @param {string} params.entityType
 * @param {string|number} [params.entityId]
 * @param {Object|null} [params.data]
 * @param {string} [params.priority='normal']
 * @param {number|string|null} [params.createdBy]
 * @param {string|null} [params.idempotencyKey]
 * @param {string|number} [params.priestId]
 * @param {string|number} [params.staffId]
 * @param {Array<number|string>} [params.targetUserIds]
 * @returns {Promise<Object>}
 */
const createNotificationEvent = async (params) => {
  const {
    eventType,
    titleEn,
    bodyEn,
    titleTa,
    bodyTa,
    entityType = ENTITY_TYPES.SYSTEM,
    entityId = null,
    data = null,
    priority = PRIORITIES.NORMAL,
    createdBy = null,
    idempotencyKey = null,
    priestId = null,
    staffId = null,
    targetUserIds = null
  } = params;

  // 1. Resolve eligible recipient user IDs
  const resolvedUserIds = await resolveRecipientsForEvent(eventType, {
    priestId,
    staffId,
    targetUserIds
  });

  if (resolvedUserIds.length === 0) {
    console.log(`[NOTIFICATION SKIP] No active recipients found for event ${eventType}`);
    return { notification: null, recipientCount: 0, isSkipped: true };
  }

  // 2. Evaluate channel preferences for each recipient
  const preparedRecipients = [];

  for (const userId of resolvedUserIds) {
    const preferences = await notificationModel.getUserPreferences(userId);
    const pref = preferences.find((p) => p.eventType === eventType) || {
      pushEnabled: true,
      inAppEnabled: true
    };

    // If both channels are disabled, skip this user completely
    if (!pref.pushEnabled && !pref.inAppEnabled) {
      continue;
    }

    preparedRecipients.push({
      userId,
      inAppVisible: Boolean(pref.inAppEnabled),
      pushEnabled: Boolean(pref.pushEnabled)
    });
  }

  if (preparedRecipients.length === 0) {
    console.log(`[NOTIFICATION SKIP] All recipients have disabled channels for event ${eventType}`);
    return { notification: null, recipientCount: 0, isSkipped: true };
  }

  // 3. Persist notification, recipients, and durable delivery jobs in a single transaction
  const result = await notificationModel.createNotificationTransaction({
    eventType,
    idempotencyKey,
    titleEn,
    bodyEn,
    titleTa,
    bodyTa,
    entityType,
    entityId,
    data,
    priority,
    createdBy,
    recipients: preparedRecipients
  });

  if (result.isDuplicate) {
    console.log(`[NOTIFICATION IDEMPOTENT] Duplicate event detected (${idempotencyKey}); returned existing.`);
    return result;
  }

  // 4. Asynchronously process immediate PUSH_DELIVERY jobs post-commit
  // Does not block the database transaction or caller response
  setImmediate(async () => {
    try {
      const jobs = await notificationModel.getPendingOrExpiredJobs(20, 5);
      for (const job of jobs) {
        if (job.notification_id === result.notification.id) {
          await processPushDeliveryJob(job);
        }
      }
    } catch (pushErr) {
      console.warn('[NOTIFICATION BACKGROUND DISPATCH] Immediate push delivery error:', pushErr.message);
    }
  });

  return result;
};

/**
 * Recover and re-process pending or expired push delivery jobs (e.g. on server startup)
 *
 * @param {number} [limit=50]
 * @returns {Promise<number>} Number of processed jobs
 */
const recoverPendingDeliveryJobs = async (limit = 50) => {
  try {
    const jobs = await notificationModel.getPendingOrExpiredJobs(limit, 5);
    if (jobs.length === 0) {
      return 0;
    }

    console.log(`[JOB RECOVERY] Found ${jobs.length} pending or expired push delivery jobs. Re-processing...`);
    let processedCount = 0;

    for (const job of jobs) {
      try {
        await processPushDeliveryJob(job);
        processedCount++;
      } catch (err) {
        console.error(`[JOB RECOVERY ERROR] Failed recovering job ${job.id}:`, err.message);
      }
    }

    console.log(`[JOB RECOVERY COMPLETE] Successfully processed ${processedCount} delivery jobs.`);
    return processedCount;
  } catch (error) {
    console.error('[JOB RECOVERY FAILED] Error scanning pending delivery jobs:', error.message);
    return 0;
  }
};

module.exports = {
  sendPushNotification,
  maskToken,
  resolveRecipientsForEvent,
  processPushDeliveryJob,
  createNotificationEvent,
  recoverPendingDeliveryJobs,
  generateEventIdempotencyKey
};
