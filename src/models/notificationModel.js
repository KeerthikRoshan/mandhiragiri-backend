const { pool } = require('../config/database');
const { ALL_EVENT_TYPES, JOB_TYPES, JOB_STATUS, DELIVERY_STATUS } = require('../constants/notificationConstants');

/**
 * Notification Model for Mandhiragiri Jothidam (Phase 2)
 * Manages database persistence, durable job queueing, and independent recipient statuses.
 */

/**
 * Check if notification exists by idempotency key
 * @param {string} idempotencyKey
 * @param {import('mysql2/promise').Connection} [conn]
 * @returns {Promise<Object|null>}
 */
const findNotificationByIdempotencyKey = async (idempotencyKey, conn = null) => {
  if (!idempotencyKey) return null;
  const client = conn || pool;
  const [rows] = await client.execute(
    'SELECT * FROM notifications WHERE idempotency_key = ? LIMIT 1;',
    [idempotencyKey]
  );
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Transactionally insert notification, recipient records, and PUSH_DELIVERY jobs
 *
 * @param {Object} params
 * @param {string} params.eventType
 * @param {string|null} [params.idempotencyKey]
 * @param {string} params.titleEn
 * @param {string} params.bodyEn
 * @param {string} params.titleTa
 * @param {string} params.bodyTa
 * @param {string} params.entityType
 * @param {string|null} [params.entityId]
 * @param {Object|null} [params.data]
 * @param {string} [params.priority='normal']
 * @param {number|string|null} [params.createdBy]
 * @param {Array<{ userId: number|string, inAppVisible: boolean, pushEnabled: boolean }>} params.recipients
 * @returns {Promise<{ notification: Object, recipientCount: number, jobCount: number }>}
 */
const createNotificationTransaction = async ({
  eventType,
  idempotencyKey = null,
  titleEn,
  bodyEn,
  titleTa,
  bodyTa,
  entityType,
  entityId = null,
  data = null,
  priority = 'normal',
  createdBy = null,
  recipients = []
}) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Idempotency check: if key already exists, return existing record
    if (idempotencyKey) {
      const existing = await findNotificationByIdempotencyKey(idempotencyKey, connection);
      if (existing) {
        await connection.commit();
        return {
          notification: existing,
          recipientCount: 0,
          jobCount: 0,
          isDuplicate: true
        };
      }
    }

    // 2. Insert notification row
    const insertNotificationSql = `
      INSERT INTO notifications (
        event_type,
        idempotency_key,
        title_en,
        body_en,
        title_ta,
        body_ta,
        entity_type,
        entity_id,
        data,
        priority,
        created_by,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW());
    `;

    const jsonData = data ? JSON.stringify(data) : null;
    const [notifResult] = await connection.execute(insertNotificationSql, [
      eventType,
      idempotencyKey || null,
      titleEn,
      bodyEn,
      titleTa,
      bodyTa,
      entityType,
      entityId ? String(entityId) : null,
      jsonData,
      priority || 'normal',
      createdBy ? Number(createdBy) : null
    ]);

    const notificationId = notifResult.insertId;

    let recipientCount = 0;
    let jobCount = 0;

    // 3. Insert recipient records and delivery jobs
    for (const recipient of recipients) {
      const userId = Number(recipient.userId);
      const inAppVisible = recipient.inAppVisible ? 1 : 0;
      const pushEnabled = Boolean(recipient.pushEnabled);
      const deliveryStatus = pushEnabled ? DELIVERY_STATUS.PENDING : DELIVERY_STATUS.SKIPPED;

      // Insert recipient row
      const insertRecipientSql = `
        INSERT INTO notification_recipients (
          notification_id,
          user_id,
          delivery_status,
          is_deleted,
          in_app_visible,
          created_at
        )
        VALUES (?, ?, ?, 0, ?, NOW())
        ON DUPLICATE KEY UPDATE
          delivery_status = VALUES(delivery_status),
          in_app_visible = VALUES(in_app_visible);
      `;

      await connection.execute(insertRecipientSql, [
        notificationId,
        userId,
        deliveryStatus,
        inAppVisible
      ]);
      recipientCount++;

      // If push is enabled, queue durable PUSH_DELIVERY job
      if (pushEnabled) {
        const jobKey = `push_${notificationId}_${userId}`;
        const insertJobSql = `
          INSERT INTO notification_jobs (
            job_type,
            notification_id,
            recipient_user_id,
            entity_type,
            entity_id,
            scheduled_at,
            status,
            attempts,
            idempotency_key,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, NOW(), ?, 0, ?, NOW())
          ON DUPLICATE KEY UPDATE status = VALUES(status);
        `;

        await connection.execute(insertJobSql, [
          JOB_TYPES.PUSH_DELIVERY,
          notificationId,
          userId,
          entityType,
          entityId ? String(entityId) : 'N/A',
          JOB_STATUS.PENDING,
          jobKey
        ]);
        jobCount++;
      }
    }

    await connection.commit();

    const [rows] = await pool.execute('SELECT * FROM notifications WHERE id = ?;', [notificationId]);
    return {
      notification: rows[0],
      recipientCount,
      jobCount,
      isDuplicate: false
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

/**
 * Claim a delivery job atomically with a processing lease
 * Prevents multiple workers/threads from executing the same job simultaneously.
 *
 * @param {number|string} jobId
 * @param {number} [leaseMinutes=5]
 * @returns {Promise<boolean>} True if claimed, false if already claimed by another worker
 */
const claimDeliveryJob = async (jobId, leaseMinutes = 5) => {
  const sql = `
    UPDATE notification_jobs 
    SET status = 'PROCESSING', attempts = attempts + 1, updated_at = NOW() 
    WHERE id = ? 
      AND (status = 'PENDING' OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL ? MINUTE));
  `;
  const [result] = await pool.execute(sql, [jobId, leaseMinutes]);
  return result.affectedRows > 0;
};

/**
 * Mark a delivery job as completed or failed and update recipient status
 *
 * @param {Object} params
 * @param {number|string} params.jobId
 * @param {number|string} params.notificationId
 * @param {number|string} params.recipientUserId
 * @param {boolean} params.success
 * @param {string|null} [params.error]
 * @param {number} [params.attempts=1]
 * @param {boolean} [params.isPermanentError=false]
 * @param {boolean} [params.isSkipped=false]
 * @returns {Promise<void>}
 */
const completeDeliveryJob = async ({
  jobId,
  notificationId,
  recipientUserId,
  success,
  error = null,
  attempts = 1,
  isPermanentError = false,
  isSkipped = false
}) => {
  let jobFinalStatus;
  let recipientStatus;

  if (isSkipped) {
    jobFinalStatus = JOB_STATUS.COMPLETED;
    recipientStatus = DELIVERY_STATUS.SKIPPED;
  } else if (success) {
    jobFinalStatus = JOB_STATUS.COMPLETED;
    recipientStatus = DELIVERY_STATUS.SENT;
  } else if (isPermanentError || attempts >= 3) {
    jobFinalStatus = JOB_STATUS.FAILED;
    recipientStatus = DELIVERY_STATUS.FAILED;
  } else {
    // Retryable failure: schedule backoff retry
    jobFinalStatus = JOB_STATUS.PENDING;
    recipientStatus = DELIVERY_STATUS.PENDING;
  }

  // Calculate backoff if retrying (attempts * 2 minutes)
  const backoffMinutes = attempts * 2;
  const updateJobSql = success || isSkipped || isPermanentError || attempts >= 3
    ? `
      UPDATE notification_jobs 
      SET status = ?, processed_at = NOW(), last_error = ?, updated_at = NOW()
      WHERE id = ?;
    `
    : `
      UPDATE notification_jobs 
      SET status = ?, scheduled_at = NOW() + INTERVAL ? MINUTE, last_error = ?, updated_at = NOW()
      WHERE id = ?;
    `;

  const jobParams = success || isSkipped || isPermanentError || attempts >= 3
    ? [jobFinalStatus, error || null, jobId]
    : [jobFinalStatus, backoffMinutes, error || null, jobId];

  await pool.execute(updateJobSql, jobParams);

  // Update recipient delivery status
  const updateRecipientSql = `
    UPDATE notification_recipients 
    SET 
      delivery_status = ?,
      push_sent_at = ${success ? 'NOW()' : 'push_sent_at'},
      delivery_error = ?,
      updated_at = NOW()
    WHERE notification_id = ? AND user_id = ?;
  `;

  await pool.execute(updateRecipientSql, [
    recipientStatus,
    error || null,
    notificationId,
    recipientUserId
  ]);
};

/**
 * Get pending or expired delivery jobs for recovery or processing
 *
 * @param {number} [limit=50]
 * @param {number} [leaseMinutes=5]
 * @returns {Promise<Array<Object>>}
 */
const getPendingOrExpiredJobs = async (limit = 50, leaseMinutes = 5) => {
  const sql = `
    SELECT 
      j.id,
      j.job_type,
      j.notification_id,
      j.recipient_user_id,
      j.entity_type,
      j.entity_id,
      j.attempts,
      n.event_type,
      n.title_en,
      n.body_en,
      n.title_ta,
      n.body_ta,
      n.data
    FROM notification_jobs j
    INNER JOIN notifications n ON n.id = j.notification_id
    WHERE j.job_type = 'PUSH_DELIVERY'
      AND (
        (j.status = 'PENDING' AND j.scheduled_at <= NOW())
        OR (j.status = 'PROCESSING' AND j.updated_at < NOW() - INTERVAL ? MINUTE)
      )
      AND j.attempts < 3
    ORDER BY j.scheduled_at ASC
    LIMIT ?;
  `;
  const [rows] = await pool.execute(sql, [leaseMinutes, limit]);
  return rows;
};

/**
 * List in-app notifications for authenticated user with filters and pagination
 *
 * @param {number|string} userId
 * @param {Object} options
 * @param {number} [options.page=1]
 * @param {number} [options.limit=20]
 * @param {boolean} [options.unreadOnly=false]
 * @param {string|null} [options.eventType]
 * @param {string|null} [options.startDate]
 * @param {string|null} [options.endDate]
 * @param {string} [options.lang='ta']
 * @returns {Promise<{ notifications: Array<Object>, pagination: Object }>}
 */
const listNotificationsForUser = async (userId, options = {}) => {
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(options.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const isTa = (options.lang || 'ta').startsWith('ta');

  const conditions = ['nr.user_id = ?', 'nr.is_deleted = 0', 'nr.in_app_visible = 1'];
  const params = [userId];

  if (options.unreadOnly) {
    conditions.push('nr.read_at IS NULL');
  }

  if (options.eventType) {
    conditions.push('n.event_type = ?');
    params.push(options.eventType);
  }

  if (options.startDate) {
    conditions.push('n.created_at >= ?');
    params.push(`${options.startDate} 00:00:00`);
  }

  if (options.endDate) {
    conditions.push('n.created_at <= ?');
    params.push(`${options.endDate} 23:59:59`);
  }

  const whereClause = conditions.join(' AND ');

  // 1. Total matching count for this query
  const countSql = `
    SELECT COUNT(*) AS total
    FROM notification_recipients nr
    INNER JOIN notifications n ON n.id = nr.notification_id
    WHERE ${whereClause};
  `;
  const [countRows] = await pool.execute(countSql, params);
  const total = countRows[0]?.total || 0;

  // 2. Total unread count across ALL non-deleted in-app visible notifications for this user
  const unreadSql = `
    SELECT COUNT(*) AS unreadCount
    FROM notification_recipients
    WHERE user_id = ? AND is_deleted = 0 AND in_app_visible = 1 AND read_at IS NULL;
  `;
  const [unreadRows] = await pool.execute(unreadSql, [userId]);
  const unreadCount = unreadRows[0]?.unreadCount || 0;

  // 3. Paginated notifications query
  const listSql = `
    SELECT 
      n.id,
      nr.id AS recipient_id,
      n.event_type,
      n.title_en,
      n.body_en,
      n.title_ta,
      n.body_ta,
      n.entity_type,
      n.entity_id,
      n.data,
      n.priority,
      nr.delivery_status,
      nr.read_at,
      nr.created_at
    FROM notification_recipients nr
    INNER JOIN notifications n ON n.id = nr.notification_id
    WHERE ${whereClause}
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?;
  `;

  // Use pool.query for integer LIMIT and OFFSET parameters to avoid mysql2 prepared statement issues
  const [rows] = await pool.query(listSql, [...params, limit, offset]);

  const mapped = rows.map((row) => ({
    id: row.id,
    recipientId: row.recipient_id,
    eventType: row.event_type,
    title: isTa ? row.title_ta : (row.title_en || row.title_ta),
    body: isTa ? row.body_ta : (row.body_en || row.body_ta),
    titleEn: row.title_en,
    bodyEn: row.body_en,
    titleTa: row.title_ta,
    bodyTa: row.body_ta,
    entityType: row.entity_type,
    entityId: row.entity_id,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {},
    priority: row.priority,
    isRead: Boolean(row.read_at),
    readAt: row.read_at,
    deliveryStatus: row.delivery_status,
    createdAt: row.created_at
  }));

  return {
    notifications: mapped,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      unreadCount
    }
  };
};

/**
 * Get total unread count for user
 * @param {number|string} userId
 * @returns {Promise<number>}
 */
const getUnreadCountForUser = async (userId) => {
  const sql = `
    SELECT COUNT(*) AS count
    FROM notification_recipients
    WHERE user_id = ? AND is_deleted = 0 AND in_app_visible = 1 AND read_at IS NULL;
  `;
  const [rows] = await pool.execute(sql, [userId]);
  return rows[0]?.count || 0;
};

/**
 * Mark a single notification as read for user
 * @param {number|string} notificationId
 * @param {number|string} userId
 * @returns {Promise<Object>}
 */
const markAsRead = async (notificationId, userId) => {
  const sql = `
    UPDATE notification_recipients 
    SET read_at = COALESCE(read_at, NOW()), updated_at = NOW() 
    WHERE notification_id = ? AND user_id = ? AND is_deleted = 0;
  `;
  const [result] = await pool.execute(sql, [notificationId, userId]);

  const [rows] = await pool.execute(
    'SELECT read_at FROM notification_recipients WHERE notification_id = ? AND user_id = ? LIMIT 1;',
    [notificationId, userId]
  );

  return {
    id: Number(notificationId),
    isRead: true,
    readAt: rows[0]?.read_at || new Date().toISOString(),
    affected: result.affectedRows > 0
  };
};

/**
 * Mark all notifications as read for user
 * @param {number|string} userId
 * @returns {Promise<number>} Number of newly marked notifications
 */
const markAllAsRead = async (userId) => {
  const sql = `
    UPDATE notification_recipients 
    SET read_at = NOW(), updated_at = NOW() 
    WHERE user_id = ? AND is_deleted = 0 AND in_app_visible = 1 AND read_at IS NULL;
  `;
  const [result] = await pool.execute(sql, [userId]);
  return result.affectedRows;
};

/**
 * Soft delete a notification for user
 * @param {number|string} notificationId
 * @param {number|string} userId
 * @returns {Promise<boolean>}
 */
const softDeleteNotification = async (notificationId, userId) => {
  const sql = `
    UPDATE notification_recipients 
    SET is_deleted = 1, updated_at = NOW() 
    WHERE notification_id = ? AND user_id = ?;
  `;
  const [result] = await pool.execute(sql, [notificationId, userId]);
  return result.affectedRows > 0;
};

/**
 * Get notification preferences for user
 * Returns stored preferences or standard defaults for all supported event types
 *
 * @param {number|string} userId
 * @returns {Promise<Array<Object>>}
 */
const getUserPreferences = async (userId) => {
  const [rows] = await pool.execute(
    'SELECT event_type, push_enabled, in_app_enabled FROM notification_preferences WHERE user_id = ?;',
    [userId]
  );

  const storedMap = new Map();
  for (const row of rows) {
    storedMap.set(row.event_type, {
      pushEnabled: Boolean(row.push_enabled),
      inAppEnabled: Boolean(row.in_app_enabled)
    });
  }

  // Populate all supported event types with defaults if not explicitly configured
  return ALL_EVENT_TYPES.map((eventType) => {
    const stored = storedMap.get(eventType);
    return {
      eventType,
      pushEnabled: stored ? stored.pushEnabled : true,
      inAppEnabled: stored ? stored.inAppEnabled : true
    };
  });
};

/**
 * Upsert user notification preferences
 *
 * @param {number|string} userId
 * @param {Array<{ eventType: string, pushEnabled?: boolean, inAppEnabled?: boolean }>} preferences
 * @returns {Promise<number>}
 */
const upsertUserPreferences = async (userId, preferences) => {
  let updatedCount = 0;
  for (const pref of preferences) {
    if (!ALL_EVENT_TYPES.includes(pref.eventType)) continue;

    const push = pref.pushEnabled !== undefined ? (pref.pushEnabled ? 1 : 0) : 1;
    const inApp = pref.inAppEnabled !== undefined ? (pref.inAppEnabled ? 1 : 0) : 1;

    const sql = `
      INSERT INTO notification_preferences (user_id, event_type, push_enabled, in_app_enabled, created_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        push_enabled = VALUES(push_enabled),
        in_app_enabled = VALUES(in_app_enabled),
        updated_at = NOW();
    `;
    await pool.execute(sql, [userId, pref.eventType, push, inApp]);
    updatedCount++;
  }
  return updatedCount;
};

/**
 * Resolve active admin user IDs
 * Checks both users status and soft-delete condition
 *
 * @returns {Promise<Array<number>>}
 */
const resolveActiveAdminUserIds = async () => {
  const sql = `
    SELECT u.id 
    FROM users u
    INNER JOIN roles r ON r.id = u.role_id
    WHERE r.name IN ('SUPER_ADMIN', 'ADMIN')
      AND UPPER(u.status) = 'ACTIVE'
      AND UPPER(u.status) != 'DELETED';
  `;
  const [rows] = await pool.execute(sql);
  return rows.map((r) => r.id);
};

/**
 * Resolve all active Priests & Assistants user IDs
 * Checks users status and staff status (including soft-delete condition)
 *
 * @returns {Promise<Array<number>>}
 */
const resolveAllActiveStaffUserIds = async () => {
  const sql = `
    SELECT u.id 
    FROM users u
    INNER JOIN staff s ON s.user_id = u.id
    WHERE UPPER(u.status) = 'ACTIVE' 
      AND UPPER(u.status) != 'DELETED'
      AND UPPER(s.status) = 'ACTIVE'
      AND s.status != 'Inactive'
      AND s.status != 'Deleted';
  `;
  const [rows] = await pool.execute(sql);
  return rows.map((r) => r.id);
};

/**
 * Resolve assigned priest/assistant user ID from booking priest_id
 *
 * @param {string|number} priestId
 * @returns {Promise<number|null>}
 */
const resolveBookingAssignedStaffUserId = async (priestId) => {
  if (!priestId) return null;
  const sql = `
    SELECT s.user_id 
    FROM staff s
    INNER JOIN users u ON u.id = s.user_id
    WHERE (s.staff_id = ? OR s.id = ? OR s.user_id = ? OR s.name_english = ?)
      AND UPPER(u.status) = 'ACTIVE'
      AND UPPER(u.status) != 'DELETED'
      AND UPPER(s.status) = 'ACTIVE'
      AND s.status != 'Inactive'
      AND s.status != 'Deleted'
    LIMIT 1;
  `;
  const [rows] = await pool.execute(sql, [String(priestId), String(priestId), String(priestId), String(priestId)]);
  return rows.length > 0 ? rows[0].user_id : null;
};

/**
 * Resolve staff user ID from staff table ID
 *
 * @param {string|number} staffId
 * @returns {Promise<number|null>}
 */
const resolveStaffUserIdByStaffId = async (staffId) => {
  if (!staffId) return null;
  const sql = `
    SELECT s.user_id 
    FROM staff s
    INNER JOIN users u ON u.id = s.user_id
    WHERE (s.id = ? OR s.staff_id = ?)
      AND UPPER(u.status) = 'ACTIVE'
      AND UPPER(u.status) != 'DELETED'
      AND UPPER(s.status) = 'ACTIVE'
      AND s.status != 'Inactive'
      AND s.status != 'Deleted'
    LIMIT 1;
  `;
  const [rows] = await pool.execute(sql, [String(staffId), String(staffId)]);
  return rows.length > 0 ? rows[0].user_id : null;
};

module.exports = {
  findNotificationByIdempotencyKey,
  createNotificationTransaction,
  claimDeliveryJob,
  completeDeliveryJob,
  getPendingOrExpiredJobs,
  listNotificationsForUser,
  getUnreadCountForUser,
  markAsRead,
  markAllAsRead,
  softDeleteNotification,
  getUserPreferences,
  upsertUserPreferences,
  resolveActiveAdminUserIds,
  resolveAllActiveStaffUserIds,
  resolveBookingAssignedStaffUserId,
  resolveStaffUserIdByStaffId
};
