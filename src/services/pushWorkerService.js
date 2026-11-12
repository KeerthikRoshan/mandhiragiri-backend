const crypto = require('crypto');
const { pool } = require('../config/database');
const { messaging } = require('../config/firebase');
const deviceModel = require('../models/deviceModel');
const deviceDeliveryModel = require('../models/deviceDeliveryModel');

/**
 * Mask FCM token for safe logging
 * @param {string} token
 * @returns {string}
 */
const maskToken = (token) => {
  if (!token || typeof token !== 'string') return '[empty]';
  if (token.length <= 10) return '***';
  return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
};

/**
 * Distinguish permanent device-level errors (bad token, app uninstalled)
 *
 * @param {string} errorCode
 * @returns {boolean} True if permanent device error
 */
const isPermanentDeviceError = (errorCode) => {
  const permanentDeviceCodes = [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token'
  ];
  return permanentDeviceCodes.includes(errorCode);
};

/**
 * Distinguish server-side credential and IAM authorization errors
 *
 * @param {string} errorCode
 * @returns {boolean} True if server credential/IAM error
 */
const isServerCredentialError = (errorCode) => {
  const serverCodes = [
    'messaging/mismatched-credential',
    'messaging/authentication-error'
  ];
  return serverCodes.includes(errorCode);
};

/**
 * Distinguish permanent FCM errors from retryable errors
 * Note: Server credential errors (e.g. mismatched-credential) are NOT device errors.
 *
 * @param {string} errorCode
 * @returns {boolean} True if permanent, false if retryable
 */
const isPermanentFcmError = (errorCode) => {
  return isPermanentDeviceError(errorCode) || errorCode === 'messaging/invalid-argument';
};

/**
 * Atomically claim a batch of eligible PUSH_DELIVERY jobs with a unique lease token
 *
 * @param {Object} options
 * @param {string} options.workerLeaseToken - Unique UUIDv4 lease token
 * @param {number} [options.batchSize=10]
 * @returns {Promise<Array<Object>>} Claimed jobs joined with notification details
 */
const claimPushJobsBatch = async ({ workerLeaseToken, batchSize = 10 }) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Lock candidate jobs
    const [candidates] = await connection.execute(
      `SELECT id FROM notification_jobs
       WHERE job_type = 'PUSH_DELIVERY'
         AND (
           (status = 'PENDING' AND (scheduled_at <= UTC_TIMESTAMP()))
           OR (status = 'PROCESSING' AND lease_expires_at < UTC_TIMESTAMP())
         )
         AND attempts < 5
       ORDER BY id ASC
       LIMIT ?
       FOR UPDATE;`,
      [String(batchSize)]
    );

    if (candidates.length === 0) {
      await connection.commit();
      return [];
    }

    const candidateIds = candidates.map(c => c.id);
    const placeholders = candidateIds.map(() => '?').join(',');

    // 2. Claim jobs atomically with lease token & 5-minute lease expiry
    await connection.execute(
      `UPDATE notification_jobs
       SET status = 'PROCESSING',
           lease_token = ?,
           lease_expires_at = UTC_TIMESTAMP() + INTERVAL 5 MINUTE,
           attempts = attempts + 1,
           updated_at = UTC_TIMESTAMP()
       WHERE id IN (${placeholders});`,
      [workerLeaseToken, ...candidateIds]
    );

    // 3. Fetch full claimed jobs with canonical notification payload
    const [claimedJobs] = await connection.execute(
      `SELECT 
         j.id, j.job_type, j.notification_id, j.recipient_user_id, j.entity_type, j.entity_id,
         j.attempts, j.status, j.lease_token, j.lease_expires_at, j.scheduled_at,
         n.event_type, n.title_en, n.body_en, n.title_ta, n.body_ta
       FROM notification_jobs j
       LEFT JOIN notifications n ON n.id = j.notification_id
       WHERE j.id IN (${placeholders}) AND j.lease_token = ?;`,
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
 * Renew worker lease for an in-progress push job
 * Extends lease_expires_at by extensionMinutes if still within active valid lease
 *
 * @param {Object} options
 * @param {number} options.jobId
 * @param {string} options.workerLeaseToken
 * @param {number} [options.extensionMinutes=5]
 * @returns {Promise<boolean>} True if lease renewed, false if expired or mismatched token
 */
const renewPushJobLease = async ({ jobId, workerLeaseToken, extensionMinutes = 5 }) => {
  const [res] = await pool.execute(
    `UPDATE notification_jobs
     SET lease_expires_at = NOW() + INTERVAL ? MINUTE,
         updated_at = NOW()
     WHERE id = ? 
       AND lease_token = ? 
       AND status = 'PROCESSING' 
       AND lease_expires_at >= NOW();`,
    [extensionMinutes, jobId, workerLeaseToken]
  );
  return res.affectedRows === 1;
};

/**
 * Process a single claimed push delivery job through per-device dispatch and terminal state evaluation
 *
 * @param {Object} job - Claimed notification_jobs record
 * @param {Object} options
 * @param {string} options.workerLeaseToken - Must match job's current lease_token
 * @param {Object} [options.fcmClient=messaging] - FCM messaging client (injectable for unit tests)
 * @returns {Promise<{ status: string, deliveredCount: number, error?: string }>}
 */
const processSinglePushJob = async (job, { workerLeaseToken, fcmClient = messaging }) => {
  const userId = job.recipient_user_id;

  // 1. Fetch active registered devices for this user
  const activeDevices = await deviceModel.getActiveDevicesForUser(userId);

  // If user has zero active devices, mark job COMPLETED and recipient SKIPPED
  if (!activeDevices || activeDevices.length === 0) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [jobRes] = await conn.execute(
        `UPDATE notification_jobs
         SET status = 'COMPLETED', lease_token = NULL, lease_expires_at = NULL, processed_at = UTC_TIMESTAMP(), last_error = 'No active registered devices'
         WHERE id = ? AND lease_token = ? AND status = 'PROCESSING' AND lease_expires_at >= UTC_TIMESTAMP();`,
        [job.id, workerLeaseToken]
      );

      if (jobRes.affectedRows === 1) {
        await conn.execute(
          `UPDATE notification_recipients
           SET delivery_status = 'SKIPPED', updated_at = UTC_TIMESTAMP()
           WHERE notification_id = ? AND user_id = ? AND delivery_status = 'PENDING';`,
          [job.notification_id, userId]
        );
      }

      await conn.commit();
      return { status: 'SKIPPED', deliveredCount: 0 };
    } finally {
      conn.release();
    }
  }

  // 2. Initialize device delivery records (idempotent via uq_job_device)
  await deviceDeliveryModel.initDeviceDeliveries(pool, {
    jobId: job.id,
    devices: activeDevices
  });

  // 3. Select ONLY pending device deliveries (never retry permanently FAILED or already SENT devices)
  const pendingDeliveries = await deviceDeliveryModel.getPendingDeviceDeliveries(pool, job.id);
  const correlationId = job.correlation_id || `corr_j${job.id}_n${job.notification_id || 0}_u${userId}`;

  // 4. Dispatch FCM to each pending device
  let fcmAcceptedCount = 0;
  let lastErrorMessage = null;
  const isUrgentReminder = job.event_type === 'BOOKING_5M_REMINDER' || job.event_type === 'BOOKING_1H_REMINDER';
  const channelId = isUrgentReminder ? 'mandhiragiri_reminder_channel' : 'mandhiragiri_default_channel';

  for (const delivery of pendingDeliveries) {
    const message = {
      token: delivery.fcm_token,
      notification: {
        title: job.title_ta || job.title_en || 'Mandhiragiri Jothidam',
        body: job.body_ta || job.body_en || 'Notification'
      },
      data: {
        notificationId: String(job.notification_id || ''),
        eventType: String(job.event_type || ''),
        entityType: String(job.entity_type || ''),
        entityId: String(job.entity_id || ''),
        bookingId: String(job.entity_id || ''),
        reminderType: String(job.event_type || ''),
        correlationId: String(correlationId || '')
      },
      android: {
        priority: 'high',
        notification: {
          channelId,
          sound: 'default',
          priority: isUrgentReminder ? 'max' : 'high',
          defaultSound: true,
          defaultVibrateTimings: true
        }
      }
    };

    try {
      await fcmClient.send(message);
      fcmAcceptedCount++;

      console.log(JSON.stringify({
        event: 'FCM_MESSAGE_ACCEPTED',
        correlationId,
        jobId: job.id,
        notificationId: job.notification_id,
        recipientUserId: userId,
        deviceId: delivery.device_id,
        maskedToken: maskToken(delivery.fcm_token),
        success: true
      }));

      // Lease-fenced per-device delivery update
      await deviceDeliveryModel.updateDeliveryOutcomeFenced({
        deliveryId: delivery.id,
        jobId: job.id,
        workerLeaseToken,
        status: 'SENT'
      });
    } catch (fcmErr) {
      const errCode = fcmErr.code || '';
      lastErrorMessage = fcmErr.message;
      const isPermDev = isPermanentDeviceError(errCode);
      const isServerCred = isServerCredentialError(errCode);

      if (isServerCred) {
        // Server configuration / IAM error
        console.error(JSON.stringify({
          event: 'FCM_SERVER_CREDENTIAL_ERROR',
          correlationId,
          jobId: job.id,
          notificationId: job.notification_id,
          recipientUserId: userId,
          deviceId: delivery.device_id,
          maskedToken: maskToken(delivery.fcm_token),
          errorCode: errCode,
          errorMessage: fcmErr.message,
          troubleshooting: 'Check Google Cloud Console: service account requires Firebase Cloud Messaging Admin (roles/firebasemessaging.admin)'
        }));

        // Do NOT deactivate device token or permanently fail device delivery for server configuration error
        await deviceDeliveryModel.updateDeliveryOutcomeFenced({
          deliveryId: delivery.id,
          jobId: job.id,
          workerLeaseToken,
          status: 'PENDING',
          error: `Server Credential Error: ${fcmErr.message}`
        });
      } else if (isPermDev) {
        // Permanent device error (unregistered or invalid token)
        console.warn(JSON.stringify({
          event: 'FCM_DEVICE_TOKEN_INVALID',
          correlationId,
          jobId: job.id,
          notificationId: job.notification_id,
          recipientUserId: userId,
          deviceId: delivery.device_id,
          maskedToken: maskToken(delivery.fcm_token),
          errorCode: errCode,
          errorMessage: fcmErr.message
        }));

        await deviceDeliveryModel.updateDeliveryOutcomeFenced({
          deliveryId: delivery.id,
          jobId: job.id,
          workerLeaseToken,
          status: 'FAILED',
          error: fcmErr.message
        });

        await deviceDeliveryModel.deactivateDeviceFenced({
          deviceId: delivery.device_id,
          jobId: job.id,
          workerLeaseToken
        });
      } else if (isPermanentFcmError(errCode)) {
        // Other permanent FCM error (e.g. invalid-argument)
        await deviceDeliveryModel.updateDeliveryOutcomeFenced({
          deliveryId: delivery.id,
          jobId: job.id,
          workerLeaseToken,
          status: 'FAILED',
          error: fcmErr.message
        });
      } else {
        // Transient error
        const nextDevAttempts = (delivery.attempts || 0) + 1;
        if (nextDevAttempts >= 3) {
          await deviceDeliveryModel.updateDeliveryOutcomeFenced({
            deliveryId: delivery.id,
            jobId: job.id,
            workerLeaseToken,
            status: 'FAILED',
            error: 'Device FCM delivery attempts exhausted (3 attempts)'
          });
        } else {
          await deviceDeliveryModel.updateDeliveryOutcomeFenced({
            deliveryId: delivery.id,
            jobId: job.id,
            workerLeaseToken,
            status: 'PENDING',
            error: fcmErr.message
          });
        }
      }
    }
  }

  // 5. Evaluate terminal state based on deliveries summary
  const summary = await deviceDeliveryModel.getDeliveriesSummary(pool, job.id);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    if (summary.pending > 0 && job.attempts < 5) {
      // 1. Pending retryable device deliveries remain and infrastructure claim limit (< 5) not exhausted
      await conn.execute(
        `UPDATE notification_jobs
         SET status = 'PENDING',
             lease_token = NULL,
             lease_expires_at = NULL,
             scheduled_at = CASE attempts
               WHEN 1 THEN UTC_TIMESTAMP() + INTERVAL 1 MINUTE
               WHEN 2 THEN UTC_TIMESTAMP() + INTERVAL 3 MINUTE
               ELSE UTC_TIMESTAMP() + INTERVAL 5 MINUTE
             END,
             last_error = ?
         WHERE id = ? AND lease_token = ? AND status = 'PROCESSING' AND lease_expires_at >= UTC_TIMESTAMP();`,
        [lastErrorMessage ? String(lastErrorMessage).slice(0, 1000) : null, job.id, workerLeaseToken]
      );

      if (summary.sent > 0) {
        await conn.execute(
          `UPDATE notification_recipients
           SET delivery_status = 'SENT', push_sent_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
           WHERE notification_id = ? AND user_id = ?;`,
          [job.notification_id, userId]
        );
      }

      await conn.commit();
      return { status: 'RETRY_SCHEDULED', deliveredCount: summary.sent, pendingCount: summary.pending };
    } else if (summary.pending > 0 && job.attempts >= 5) {
      // 2. Infrastructure claim limit exhausted: worker failed or crashed before completing dispatch
      const infraError = 'Infrastructure claim limit exhausted (5 claims): worker crashed or failed before completing dispatch';
      await conn.execute(
        `UPDATE notification_jobs
         SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL, last_error = ?
         WHERE id = ? AND lease_token = ? AND status = 'PROCESSING' AND lease_expires_at >= UTC_TIMESTAMP();`,
        [infraError, job.id, workerLeaseToken]
      );

      if (summary.sent > 0) {
        await conn.execute(
          `UPDATE notification_recipients
           SET delivery_status = 'SENT', delivery_error = 'Infrastructure error with partial delivery', updated_at = UTC_TIMESTAMP()
           WHERE notification_id = ? AND user_id = ?;`,
          [job.notification_id, userId]
        );
      } else {
        await conn.execute(
          `UPDATE notification_recipients
           SET delivery_status = 'FAILED', delivery_error = 'Infrastructure error before complete delivery', updated_at = UTC_TIMESTAMP()
           WHERE notification_id = ? AND user_id = ? AND delivery_status = 'PENDING';`,
          [job.notification_id, userId]
        );
      }

      // Pending device deliveries remain intact for Admin retry resumption!
      await conn.commit();
      return { status: 'FAILED', deliveredCount: summary.sent, error: infraError };
    } else if (summary.sent === summary.total && summary.failed === 0) {
      // 3. Complete Success: All registered devices received the push notification
      const [completeRes] = await conn.execute(
        `UPDATE notification_jobs
         SET status = 'COMPLETED', lease_token = NULL, lease_expires_at = NULL, processed_at = UTC_TIMESTAMP(), last_error = NULL
         WHERE id = ? AND lease_token = ? AND status = 'PROCESSING' AND lease_expires_at >= UTC_TIMESTAMP();`,
        [job.id, workerLeaseToken]
      );

      if (completeRes.affectedRows === 1) {
        await conn.execute(
          `UPDATE notification_recipients
           SET delivery_status = 'SENT', push_sent_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
           WHERE notification_id = ? AND user_id = ?;`,
          [job.notification_id, userId]
        );
      }

      await conn.commit();
      return { status: 'COMPLETED', deliveredCount: summary.sent };
    } else if (summary.sent > 0 && summary.failed > 0) {
      // 4. Terminal Partial Success: At least 1 device succeeded, but remaining devices failed permanently or exhausted attempts
      const partialError = `[PARTIAL_DELIVERY] Delivered to ${summary.sent}/${summary.total} devices. Remaining devices failed permanently or exhausted attempts.`;
      await conn.execute(
        `UPDATE notification_jobs
         SET status = 'COMPLETED', lease_token = NULL, lease_expires_at = NULL, processed_at = UTC_TIMESTAMP(), last_error = ?
         WHERE id = ? AND lease_token = ? AND status = 'PROCESSING' AND lease_expires_at >= UTC_TIMESTAMP();`,
        [partialError, job.id, workerLeaseToken]
      );

      await conn.execute(
        `UPDATE notification_recipients
         SET delivery_status = 'SENT', push_sent_at = UTC_TIMESTAMP(), delivery_error = ?, updated_at = UTC_TIMESTAMP()
         WHERE notification_id = ? AND user_id = ?;`,
        [`Partial delivery: ${summary.sent}/${summary.total} delivered`, job.notification_id, userId]
      );

      await conn.commit();
      return { status: 'COMPLETED', deliveredCount: summary.sent, failedCount: summary.failed, partialDelivery: true };
    } else {
      // 5. Total Failure: All devices failed permanently or exhausted attempts
      const failError = lastErrorMessage ? String(lastErrorMessage).slice(0, 1000) : 'Push delivery attempts exhausted';
      await conn.execute(
        `UPDATE notification_jobs
         SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL, last_error = ?
         WHERE id = ? AND lease_token = ? AND status = 'PROCESSING' AND lease_expires_at >= UTC_TIMESTAMP();`,
        [failError, job.id, workerLeaseToken]
      );

      await conn.execute(
        `UPDATE notification_recipients
         SET delivery_status = 'FAILED', delivery_error = ?, updated_at = UTC_TIMESTAMP()
         WHERE notification_id = ? AND user_id = ? AND delivery_status = 'PENDING';`,
        [failError, job.notification_id, userId]
      );

      await conn.commit();
      return { status: 'FAILED', deliveredCount: 0, error: failError };
    }
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
};

/**
 * Sweep abandoned push jobs whose worker lease expired after reaching infrastructure claim limit (>= 5)
 *
 * @returns {Promise<number>} Number of swept jobs
 */
const sweepAbandonedPushJobs = async () => {
  const [jobRes] = await pool.execute(
    `UPDATE notification_jobs
     SET status = 'FAILED',
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error = 'Infrastructure claim limit exhausted (5 claims): worker lease expired repeatedly'
     WHERE job_type = 'PUSH_DELIVERY' 
       AND status = 'PROCESSING' 
       AND lease_expires_at < UTC_TIMESTAMP() 
       AND attempts >= 5;`
  );

  if (jobRes.affectedRows > 0) {
    await pool.execute(
      `UPDATE notification_recipients nr
       JOIN notification_jobs nj ON nj.notification_id = nr.notification_id AND nj.recipient_user_id = nr.user_id
       SET nr.delivery_status = 'FAILED', nr.delivery_error = 'Infrastructure claim limit exhausted (5 claims)'
       WHERE nj.job_type = 'PUSH_DELIVERY' AND nj.status = 'FAILED' AND nr.delivery_status = 'PENDING';`
    );
  }

  return jobRes.affectedRows;
};

/**
 * Process a batch of push delivery jobs
 *
 * @param {Object} [options={}]
 * @param {string} [options.workerLeaseToken]
 * @param {number} [options.batchSize=10]
 * @param {Object} [options.fcmClient]
 * @param {Function} [options.isTimeBudgetAvailable]
 * @returns {Promise<{ processedCount: number, claimedCount: number, results: Array<Object> }>}
 */
const processPushQueue = async ({
  workerLeaseToken = crypto.randomUUID(),
  batchSize = 10,
  fcmClient = messaging,
  isTimeBudgetAvailable = () => true
} = {}) => {
  if (!isTimeBudgetAvailable()) {
    return { processedCount: 0, claimedCount: 0, results: [] };
  }

  const claimedJobs = await claimPushJobsBatch({ workerLeaseToken, batchSize });
  const results = [];

  for (const job of claimedJobs) {
    if (!isTimeBudgetAvailable()) {
      break;
    }
    const outcome = await processSinglePushJob(job, { workerLeaseToken, fcmClient });
    results.push({ jobId: job.id, ...outcome });
  }

  return {
    processedCount: results.length,
    claimedCount: claimedJobs.length,
    results
  };
};

module.exports = {
  maskToken,
  isPermanentFcmError,
  isPermanentDeviceError,
  isServerCredentialError,
  claimPushJobsBatch,
  renewPushJobLease,
  processSinglePushJob,
  sweepAbandonedPushJobs,
  processPushQueue
};
