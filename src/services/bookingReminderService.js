const crypto = require('crypto');
const { pool } = require('../config/database');
const notificationModel = require('../models/notificationModel');
const outboxModel = require('../models/outboxModel');

/**
 * Booking Reminder Service for Mandhiragiri Jothidam (Phase 4)
 * Manages 24-hour and 1-hour automated booking reminders, schedule versioning,
 * authoritative in-transaction re-reads, stale reminder invalidation,
 * confirmed recipient resolution (All active Admins + assigned Priest/Staff; Never customers),
 * and durable transactional handoff to notification_outbox.
 */

/**
 * Parse booking date_key and start_time into a JavaScript Date object
 *
 * @param {string|Date} dateKey - 'YYYY-MM-DD'
 * @param {string} startTime - 'HH:MM:SS' or 'HH:MM'
 * @returns {Date}
 */
const parseBookingStartDateTime = (dateKey, startTime) => {
  const dateStr = dateKey instanceof Date
    ? dateKey.toISOString().slice(0, 10)
    : String(dateKey).slice(0, 10);

  const timeStr = String(startTime || '00:00:00').trim();
  const parts = timeStr.split(':');
  const pad = (n) => String(n || '00').padStart(2, '0');
  const h = pad(parts[0]);
  const m = pad(parts[1]);
  const s = pad(parts[2] || '00');

  // Booking schedules are specified in Asia/Kolkata wall-clock time (+05:30)
  const istIso = `${dateStr}T${h}:${m}:${s}+05:30`;
  const parsed = new Date(istIso);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid booking date/time: ${dateKey} ${startTime}`);
  }
  return parsed;
};

/**
 * Format a Date object to MySQL UTC DATETIME string: 'YYYY-MM-DD HH:MM:SS'
 *
 * @param {Date} date
 * @returns {string}
 */
const toSqlDateTime = (date) => {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('Invalid Date passed to toSqlDateTime');
  }
  // Database connection runs with SET time_zone = '+00:00'.
  // Format as UTC SQL DATETIME string: 'YYYY-MM-DD HH:MM:SS'
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

/**
 * Calculate 24h, 1h, and 5m reminder scheduled timestamps and eligibility based on current time
 *
 * @param {Object} params
 * @param {string|Date} params.dateKey
 * @param {string} params.startTime
 * @param {Date} [params.now=new Date()]
 * @returns {{
 *   eventStart: Date,
 *   scheduledAt24h: Date,
 *   scheduledAt1h: Date,
 *   scheduledAt5m: Date,
 *   shouldSchedule24h: boolean,
 *   shouldSchedule1h: boolean,
 *   shouldSchedule5m: boolean
 * }}
 */
const calculateReminderSchedule = ({ dateKey, startTime, now = new Date() }) => {
  const eventStart = parseBookingStartDateTime(dateKey, startTime);
  const scheduledAt24h = new Date(eventStart.getTime() - 24 * 60 * 60 * 1000);
  const scheduledAt1h = new Date(eventStart.getTime() - 1 * 60 * 60 * 1000);
  const scheduledAt5m = new Date(eventStart.getTime() - 5 * 60 * 1000);

  return {
    eventStart,
    scheduledAt24h,
    scheduledAt1h,
    scheduledAt5m,
    shouldSchedule24h: scheduledAt24h.getTime() > now.getTime(),
    shouldSchedule1h: scheduledAt1h.getTime() > now.getTime(),
    shouldSchedule5m: scheduledAt5m.getTime() > now.getTime()
  };
};

/**
 * Schedule 24H, 1H, and 5M reminder jobs for a booking in notification_jobs
 * Idempotent: keyed by bookingId, scheduleVersion, and reminder type.
 *
 * @param {import('mysql2/promise').Connection|import('mysql2/promise').Pool} client
 * @param {Object} params
 * @param {number|string} params.bookingId
 * @param {string|Date} params.dateKey
 * @param {string} params.startTime
 * @param {number} [params.scheduleVersion=1]
 * @param {number} [params.placeholderUserId=1] - Valid user ID satisfying recipient_user_id FK
 * @param {Date} [params.now=new Date()]
 * @returns {Promise<Array<Object>>} Scheduled jobs summary
 */
const scheduleBookingReminders = async (client, {
  bookingId,
  dateKey,
  startTime,
  scheduleVersion = 1,
  placeholderUserId = 1,
  now = new Date()
}) => {
  const schedule = calculateReminderSchedule({ dateKey, startTime, now });
  const scheduledJobs = [];

  // 1. Schedule 24H Reminder if event start is more than 24 hours in the future
  if (schedule.shouldSchedule24h) {
    const key24h = `booking_${bookingId}_version_${scheduleVersion}_24H`;
    const sql24h = toSqlDateTime(schedule.scheduledAt24h);

    await client.execute(
      `INSERT INTO notification_jobs (
        job_type, notification_id, recipient_user_id, entity_type, entity_id,
        schedule_version, scheduled_at, status, attempts, idempotency_key, created_at
      ) VALUES (
        'BOOKING_24H_REMINDER', NULL, ?, 'booking', ?,
        ?, ?, 'PENDING', 0, ?, NOW()
      ) ON DUPLICATE KEY UPDATE
        scheduled_at = IF(status = 'PENDING', VALUES(scheduled_at), scheduled_at),
        status = status;`,
      [placeholderUserId, String(bookingId), scheduleVersion, sql24h, key24h]
    );

    scheduledJobs.push({ jobType: 'BOOKING_24H_REMINDER', scheduledAt: sql24h, idempotencyKey: key24h });
  }

  // 2. Schedule 1H Reminder if event start is more than 1 hour in the future
  if (schedule.shouldSchedule1h) {
    const key1h = `booking_${bookingId}_version_${scheduleVersion}_1H`;
    const sql1h = toSqlDateTime(schedule.scheduledAt1h);

    await client.execute(
      `INSERT INTO notification_jobs (
        job_type, notification_id, recipient_user_id, entity_type, entity_id,
        schedule_version, scheduled_at, status, attempts, idempotency_key, created_at
      ) VALUES (
        'BOOKING_1H_REMINDER', NULL, ?, 'booking', ?,
        ?, ?, 'PENDING', 0, ?, NOW()
      ) ON DUPLICATE KEY UPDATE
        scheduled_at = IF(status = 'PENDING', VALUES(scheduled_at), scheduled_at),
        status = status;`,
      [placeholderUserId, String(bookingId), scheduleVersion, sql1h, key1h]
    );

    scheduledJobs.push({ jobType: 'BOOKING_1H_REMINDER', scheduledAt: sql1h, idempotencyKey: key1h });
  }

  // 3. Schedule 5M Reminder if event start is more than 5 minutes in the future
  if (schedule.shouldSchedule5m) {
    const key5m = `booking_${bookingId}_version_${scheduleVersion}_5M`;
    const sql5m = toSqlDateTime(schedule.scheduledAt5m);

    await client.execute(
      `INSERT INTO notification_jobs (
        job_type, notification_id, recipient_user_id, entity_type, entity_id,
        schedule_version, scheduled_at, status, attempts, idempotency_key, created_at
      ) VALUES (
        'BOOKING_5M_REMINDER', NULL, ?, 'booking', ?,
        ?, ?, 'PENDING', 0, ?, NOW()
      ) ON DUPLICATE KEY UPDATE
        scheduled_at = IF(status = 'PENDING', VALUES(scheduled_at), scheduled_at),
        status = status;`,
      [placeholderUserId, String(bookingId), scheduleVersion, sql5m, key5m]
    );

    scheduledJobs.push({ jobType: 'BOOKING_5M_REMINDER', scheduledAt: sql5m, idempotencyKey: key5m });
  }

  return scheduledJobs;
};

/**
 * Cancel pending reminder jobs for a specific booking (e.g. on rescheduling or cancellation)
 *
 * @param {import('mysql2/promise').Connection|import('mysql2/promise').Pool} client
 * @param {Object} params
 * @param {number|string} params.bookingId
 * @param {string} [params.reason='Booking cancelled or rescheduled']
 * @returns {Promise<number>} Number of cancelled jobs
 */
const cancelBookingReminders = async (client, { bookingId, reason = 'Booking cancelled or rescheduled' }) => {
  const [result] = await client.execute(
    `UPDATE notification_jobs
     SET status = 'CANCELLED',
         last_error = ?,
         updated_at = NOW()
     WHERE entity_type = 'booking'
       AND entity_id = ?
       AND job_type IN ('BOOKING_24H_REMINDER', 'BOOKING_1H_REMINDER', 'BOOKING_5M_REMINDER')
       AND status = 'PENDING';`,
    [reason, String(bookingId)]
  );
  return result.affectedRows;
};

/**
 * Claim a batch of eligible reminder jobs atomically with a worker lease token
 *
 * @param {Object} options
 * @param {string} options.workerLeaseToken
 * @param {number} [options.batchSize=10]
 * @returns {Promise<Array<Object>>}
 */
const claimReminderJobsBatch = async ({ workerLeaseToken, batchSize = 10 }) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [candidates] = await connection.execute(
      `SELECT id FROM notification_jobs
       WHERE job_type IN ('BOOKING_24H_REMINDER', 'BOOKING_1H_REMINDER', 'BOOKING_5M_REMINDER')
         AND (
           (status = 'PENDING' AND scheduled_at <= NOW())
           OR (status = 'PROCESSING' AND lease_expires_at < NOW())
         )
         AND attempts < 3
       ORDER BY id ASC
       LIMIT ?
       FOR UPDATE;`,
      [String(batchSize)]
    );

    if (candidates.length === 0) {
      await connection.commit();
      return [];
    }

    const candidateIds = candidates.map((c) => c.id);
    const placeholders = candidateIds.map(() => '?').join(',');

    await connection.execute(
      `UPDATE notification_jobs
       SET status = 'PROCESSING',
           lease_token = ?,
           lease_expires_at = NOW() + INTERVAL 5 MINUTE,
           attempts = attempts + 1,
           updated_at = NOW()
       WHERE id IN (${placeholders});`,
      [workerLeaseToken, ...candidateIds]
    );

    const [claimedJobs] = await connection.execute(
      `SELECT id, job_type, entity_type, entity_id, schedule_version, recipient_user_id,
              attempts, status, lease_token, lease_expires_at, scheduled_at, idempotency_key
       FROM notification_jobs
       WHERE id IN (${placeholders}) AND lease_token = ?;`,
      [...candidateIds, workerLeaseToken]
    );

    await connection.commit();
    return claimedJobs;
  } catch (err) {
    try { await connection.rollback(); } catch (_) {}
    throw err;
  } finally {
    connection.release();
  }
};

/**
 * Resolve eligible recipients for a booking reminder following confirmed business rules:
 * - Every active Administrator receives all booking reminders.
 * - The specific assigned Priest or Assistant receives the reminder.
 * - Customers are NEVER recipients.
 *
 * @param {Object} booking
 * @param {string|number|null} [booking.priest_id]
 * @returns {Promise<Array<number>>} Array of recipient user IDs
 */
const resolveReminderRecipients = async (booking) => {
  const recipientSet = new Set();

  // 1. All active administrators
  const adminIds = await notificationModel.resolveActiveAdminUserIds();
  adminIds.forEach((id) => recipientSet.add(Number(id)));

  // 2. Assigned Priest or Assistant if assigned
  const priestIdentifier = booking ? (booking.priest_id || booking.priestId) : null;
  if (priestIdentifier) {
    const assignedUserId = await notificationModel.resolveBookingAssignedStaffUserId(priestIdentifier);
    if (assignedUserId) {
      recipientSet.add(Number(assignedUserId));
    }
  }

  // Safety fallback: if no admins returned, ensure Super Admin (1) receives it
  if (recipientSet.size === 0) {
    recipientSet.add(1);
  }

  return Array.from(recipientSet);
};

/**
 * Process a single claimed reminder job:
 * 1. Authoritative in-transaction re-read of the live booking record.
 * 2. Validate schedule_version match, is_deleted = 0, and non-cancelled/completed status.
 * 3. Invalidate/Cancel stale reminder jobs without creating outbox records.
 * 4. Resolve confirmed recipients (Admins + assigned Priest; Never customers).
 * 5. Atomically insert canonical outbox event and complete the reminder job.
 *
 * @param {Object} job - Claimed notification_jobs record
 * @param {Object} options
 * @param {string} options.workerLeaseToken
 * @returns {Promise<{ status: string, outboxEventKey?: string, recipientCount?: number, reason?: string }>}
 */
const processSingleReminderJob = async (job, { workerLeaseToken }) => {
  if (!job || !job.entity_id) {
    return { status: 'CANCELLED', reason: 'Invalid or missing job record' };
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. In-transaction authoritative re-read of live booking record
    const [bookingRows] = await conn.execute(
      `SELECT id, booking_number, title, date_key, start_time, time_slot,
              priest_id, priest_name, schedule_version, status, is_deleted
       FROM bookings
       WHERE id = ?
       LOCK IN SHARE MODE;`,
      [job.entity_id]
    );

    // 2. Stale version or inactive booking check
    if (
      bookingRows.length === 0 ||
      bookingRows[0].is_deleted === 1 ||
      bookingRows[0].status === 'cancelled' ||
      bookingRows[0].status === 'completed' ||
      bookingRows[0].schedule_version !== job.schedule_version
    ) {
      let cancelReason = 'Stale reminder schedule_version';
      if (bookingRows.length === 0) cancelReason = 'Booking not found';
      else if (bookingRows[0].is_deleted === 1) cancelReason = 'Booking deleted';
      else if (bookingRows[0].status === 'cancelled') cancelReason = 'Booking cancelled';
      else if (bookingRows[0].status === 'completed') cancelReason = 'Booking already completed';

      // Fenced cancellation of stale reminder job
      await conn.execute(
        `UPDATE notification_jobs
         SET status = 'CANCELLED',
             lease_token = NULL,
             lease_expires_at = NULL,
             last_error = ?
         WHERE id = ? 
           AND lease_token = ? 
           AND status = 'PROCESSING' 
           AND lease_expires_at >= NOW();`,
        [cancelReason, job.id, workerLeaseToken]
      );

      await conn.commit();
      return { status: 'CANCELLED', reason: cancelReason };
    }

    const liveBooking = bookingRows[0];

    // 3. Resolve confirmed recipients: All active Admins + assigned Priest/Assistant (Never customers)
    const recipientUserIds = await resolveReminderRecipients(liveBooking);

    // 4. Construct canonical outbox event key & payload
    // Exactly ONE canonical reminder event per booking, schedule version, and reminder type
    const outboxEventKey = `outbox_${job.job_type.toLowerCase()}_b${liveBooking.id}_v${liveBooking.schedule_version}`;
    const reminderPriority = job.job_type === 'BOOKING_5M_REMINDER'
      ? 'urgent'
      : (job.job_type === 'BOOKING_1H_REMINDER' ? 'urgent' : 'high');

    const payload = {
      bookingId: liveBooking.id,
      bookingNumber: liveBooking.booking_number,
      title: liveBooking.title,
      dateKey: liveBooking.date_key,
      startTime: liveBooking.start_time,
      timeSlot: liveBooking.time_slot,
      priestId: liveBooking.priest_id,
      priestName: liveBooking.priest_name,
      scheduleVersion: liveBooking.schedule_version,
      reminderType: job.job_type,
      recipientUserIds,
      priority: reminderPriority
    };

    // Log structured scheduler processing metrics
    const scheduledAtTime = new Date(job.scheduled_at).getTime();
    const actualProcessTime = Date.now();
    const delaySeconds = !isNaN(scheduledAtTime) ? Math.max(0, Math.round((actualProcessTime - scheduledAtTime) / 1000)) : 0;
    console.log(JSON.stringify({
      event: 'REMINDER_JOB_PROCESSED',
      schedulerExecutionId: workerLeaseToken,
      reminderType: job.job_type,
      bookingId: liveBooking.id,
      scheduleVersion: liveBooking.schedule_version,
      scheduledAt: job.scheduled_at,
      processedAt: new Date(actualProcessTime).toISOString(),
      delaySeconds,
      recipientCount: recipientUserIds.length
    }));

    // 5. Insert canonical event into notification_outbox atomically
    await conn.execute(
      `INSERT INTO notification_outbox (
        event_type, entity_type, entity_id, event_key, payload, status, created_at
      ) VALUES (?, 'booking', ?, ?, ?, 'PENDING', NOW())
      ON DUPLICATE KEY UPDATE status = status;`,
      [job.job_type, String(liveBooking.id), outboxEventKey, JSON.stringify(payload)]
    );

    // 6. Fenced completion of parent reminder job
    const [completeRes] = await conn.execute(
      `UPDATE notification_jobs
       SET status = 'COMPLETED',
           lease_token = NULL,
           lease_expires_at = NULL,
           processed_at = NOW(),
           last_error = NULL
       WHERE id = ? 
         AND lease_token = ? 
         AND status = 'PROCESSING' 
         AND lease_expires_at >= NOW();`,
      [job.id, workerLeaseToken]
    );

    if (completeRes.affectedRows !== 1) {
      throw new Error('Fencing violation: reminder job lease expired or reclaimed by another worker');
    }

    await conn.commit();
    return {
      status: 'COMPLETED',
      outboxEventKey,
      recipientCount: recipientUserIds.length
    };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
};

/**
 * Process a reminder outbox event and handoff to downstream notifications,
 * recipient records, and PUSH_DELIVERY jobs within a single database transaction.
 *
 * @param {Object} outboxEvent - Claimed notification_outbox record
 * @param {Object} options
 * @param {string} options.workerLeaseToken
 * @returns {Promise<{ notificationId: number, recipientCount: number, pushJobCount: number }>}
 */
const handoffReminderOutboxEvent = async (outboxEvent, { workerLeaseToken }) => {
  const payload = typeof outboxEvent.payload === 'string'
    ? JSON.parse(outboxEvent.payload)
    : (outboxEvent.payload || {});

  const is24h = outboxEvent.event_type === 'BOOKING_24H_REMINDER';
  const is5m = outboxEvent.event_type === 'BOOKING_5M_REMINDER';
  const titleEn = is5m
    ? 'Booking Reminder (5 Minutes)'
    : (is24h ? 'Booking Reminder (24 Hours)' : 'Booking Reminder (1 Hour)');
  const bodyEn = is5m
    ? `Booking #${payload.bookingNumber || payload.bookingId} (${payload.title || 'Event'}) begins in 5 minutes at ${payload.timeSlot || payload.startTime}. Please be prepared.`
    : (is24h
      ? `Booking #${payload.bookingNumber || payload.bookingId} (${payload.title || 'Event'}) is scheduled for ${payload.dateKey} at ${payload.timeSlot || payload.startTime}.`
      : `Booking #${payload.bookingNumber || payload.bookingId} (${payload.title || 'Event'}) begins in 1 hour at ${payload.timeSlot || payload.startTime}.`);

  const titleTa = is5m
    ? 'முன்பதிவு நினைவூட்டல் (5 நிமிடங்கள்)'
    : (is24h ? 'முன்பதிவு நினைவூட்டல் (24 மணி நேரம்)' : 'முன்பதிவு நினைவூட்டல் (1 மணி நேரம்)');
  const bodyTa = is5m
    ? `முன்பதிவு #${payload.bookingNumber || payload.bookingId} (${payload.title || 'நிகழ்வு'}) இன்னும் 5 நிமிடங்களில் ${payload.timeSlot || payload.startTime} மணிக்கு தொடங்க உள்ளது. தயாராக இருக்கவும்.`
    : (is24h
      ? `முன்பதிவு #${payload.bookingNumber || payload.bookingId} (${payload.title || 'நிகழ்வு'}) ${payload.dateKey} அன்று ${payload.timeSlot || payload.startTime} மணிக்கு தொடங்க உள்ளது.`
      : `முன்பதிவு #${payload.bookingNumber || payload.bookingId} (${payload.title || 'நிகழ்வு'}) இன்னும் 1 மணி நேரத்தில் ${payload.timeSlot || payload.startTime} மணிக்கு தொடங்க உள்ளது.`);

  const recipientUserIds = Array.isArray(payload.recipientUserIds) && payload.recipientUserIds.length > 0
    ? payload.recipientUserIds
    : [1];

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Recover or insert canonical notification record
    let notificationId;
    const [existingNotif] = await conn.execute(
      'SELECT id FROM notifications WHERE idempotency_key = ? LIMIT 1;',
      [outboxEvent.event_key]
    );

    if (existingNotif.length > 0) {
      notificationId = existingNotif[0].id;
    } else {
      const [notifRes] = await conn.execute(
        `INSERT INTO notifications (
          event_type, idempotency_key, title_en, body_en, title_ta, body_ta,
          entity_type, entity_id, data, priority, created_by, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'booking', ?, ?, 'high', 1, NOW()
        );`,
        [
          outboxEvent.event_type,
          outboxEvent.event_key,
          titleEn,
          bodyEn,
          titleTa,
          bodyTa,
          String(payload.bookingId || outboxEvent.entity_id),
          JSON.stringify(payload)
        ]
      );
      notificationId = notifRes.insertId;
    }

    let recipientCount = 0;
    let pushJobCount = 0;

    // Filter recipientUserIds to ensure all recipients actually exist and are ACTIVE in users table
    const candidateIds = recipientUserIds.map(Number).filter((id) => id > 0);
    let activeRecipientIds = [];

    if (candidateIds.length > 0) {
      const uPlaceholders = candidateIds.map(() => '?').join(',');
      const [validUsers] = await conn.execute(
        `SELECT id FROM users WHERE id IN (${uPlaceholders}) AND status = 'ACTIVE';`,
        candidateIds
      );
      activeRecipientIds = validUsers.map((u) => u.id);
    }

    if (activeRecipientIds.length === 0) {
      const fallbackAdmins = await notificationModel.resolveActiveAdminUserIds();
      if (fallbackAdmins.length > 0) {
        activeRecipientIds = fallbackAdmins;
      }
    }

    // 2. Insert recipient records and PUSH_DELIVERY jobs for each eligible recipient
    for (const userId of activeRecipientIds) {
      await conn.execute(
        `INSERT INTO notification_recipients (
          notification_id, user_id, delivery_status, in_app_visible, created_at
        ) VALUES (?, ?, 'PENDING', 1, NOW())
        ON DUPLICATE KEY UPDATE in_app_visible = 1;`,
        [notificationId, userId]
      );
      recipientCount++;

      const pushJobKey = `push_${notificationId}_u${userId}`;
      await conn.execute(
        `INSERT INTO notification_jobs (
          job_type, notification_id, recipient_user_id, entity_type, entity_id,
          schedule_version, scheduled_at, status, attempts, idempotency_key, created_at
        ) VALUES (
          'PUSH_DELIVERY', ?, ?, 'booking', ?,
          ?, NOW(), 'PENDING', 0, ?, NOW()
        ) ON DUPLICATE KEY UPDATE status = status;`,
        [
          notificationId,
          userId,
          String(payload.bookingId || outboxEvent.entity_id),
          payload.scheduleVersion || 1,
          pushJobKey
        ]
      );
      pushJobCount++;
    }

    // 3. Fenced completion of outbox event
    const [completeRes] = await conn.execute(
      `UPDATE notification_outbox
       SET status = 'COMPLETED',
           lease_token = NULL,
           lease_expires_at = NULL,
           processed_at = NOW(),
           last_error = NULL
       WHERE id = ? 
         AND lease_token = ? 
         AND status = 'PROCESSING'
         AND lease_expires_at >= NOW();`,
      [outboxEvent.id, workerLeaseToken]
    );

    if (completeRes.affectedRows !== 1) {
      throw new Error('Fencing violation: outbox event lease expired or reclaimed by another worker');
    }

    await conn.commit();
    return { notificationId, recipientCount, pushJobCount };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
};

/**
 * Sweep abandoned reminder jobs whose worker lease expired after reaching max attempts (>= 3)
 *
 * @returns {Promise<number>} Number of swept jobs
 */
const sweepAbandonedReminderJobs = async () => {
  const [result] = await pool.execute(
    `UPDATE notification_jobs
     SET status = 'FAILED',
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error = 'Reminder worker lease expired on final attempt 3'
     WHERE job_type IN ('BOOKING_24H_REMINDER', 'BOOKING_1H_REMINDER')
       AND status = 'PROCESSING'
       AND lease_expires_at < NOW()
       AND attempts >= 3;`
  );
  return result.affectedRows;
};

/**
 * Process a batch of reminder jobs through claiming and execution
 *
 * @param {Object} [options={}]
 * @param {string} [options.workerLeaseToken]
 * @param {number} [options.batchSize=10]
 * @returns {Promise<{ processedCount: number, results: Array<Object> }>}
 */
const processReminderQueue = async ({
  workerLeaseToken = crypto.randomUUID(),
  batchSize = 10
} = {}) => {
  const claimedJobs = await claimReminderJobsBatch({ workerLeaseToken, batchSize });
  const results = [];

  for (const job of claimedJobs) {
    const outcome = await processSingleReminderJob(job, { workerLeaseToken });
    results.push({ jobId: job.id, ...outcome });
  }

  return {
    processedCount: claimedJobs.length,
    results
  };
};

module.exports = {
  parseBookingStartDateTime,
  toSqlDateTime,
  calculateReminderSchedule,
  scheduleBookingReminders,
  cancelBookingReminders,
  claimReminderJobsBatch,
  resolveReminderRecipients,
  processSingleReminderJob,
  handoffReminderOutboxEvent,
  sweepAbandonedReminderJobs,
  processReminderQueue
};
