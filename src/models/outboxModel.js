const { pool } = require('../config/database');

/**
 * Outbox Model for Mandhiragiri Jothidam (Phase 4)
 * Manages atomic outbox event persistence, worker lease acquisition with fencing,
 * exponential retry backoff, and abandoned lease recovery.
 */

/**
 * Insert an outbox event within an existing transaction
 *
 * @param {import('mysql2/promise').Connection} conn - Active database connection holding transaction
 * @param {Object} event
 * @param {string} event.eventType - e.g. 'BOOKING_CREATED', 'BOOKING_ASSIGNED'
 * @param {string} event.entityType - e.g. 'booking', 'leave_request', 'payment'
 * @param {string|number} event.entityId - ID of the entity
 * @param {string} event.eventKey - Unique idempotency event key
 * @param {Object} event.payload - Immutable JSON event payload
 * @returns {Promise<{ id: number, eventKey: string, inserted: boolean }>}
 */
const insertEventTx = async (conn, { eventType, entityType, entityId, eventKey, payload }) => {
  if (!conn) {
    throw new Error('insertEventTx requires an active transaction connection');
  }

  const [result] = await conn.execute(
    `INSERT INTO notification_outbox (
      event_type, entity_type, entity_id, event_key, payload, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'PENDING', NOW())
    ON DUPLICATE KEY UPDATE status = status;`,
    [eventType, entityType, String(entityId), eventKey, JSON.stringify(payload || {})]
  );

  return {
    id: result.insertId,
    eventKey,
    inserted: result.affectedRows > 0
  };
};

/**
 * Atomically claim a batch of pending/expired outbox events with a unique lease token
 *
 * @param {Object} options
 * @param {string} options.workerLeaseToken - Unique UUIDv4 worker lease token
 * @param {number} [options.batchSize=10]
 * @returns {Promise<Array<Object>>} Claimed outbox event records
 */
const claimOutboxBatch = async ({ workerLeaseToken, batchSize = 10 }) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Select candidate event IDs matching claim criteria
    const [candidates] = await connection.execute(
      `SELECT id FROM notification_outbox
       WHERE (
         (status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
         OR (status = 'PROCESSING' AND lease_expires_at < NOW())
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

    // 2. Atomically acquire lease
    await connection.execute(
      `UPDATE notification_outbox
       SET status = 'PROCESSING',
           lease_token = ?,
           lease_expires_at = NOW() + INTERVAL 5 MINUTE,
           attempts = attempts + 1,
           updated_at = NOW()
       WHERE id IN (${placeholders});`,
      [workerLeaseToken, ...candidateIds]
    );

    // 3. Fetch full claimed records
    const [claimedRows] = await connection.execute(
      `SELECT id, event_type, entity_type, entity_id, event_key, payload, attempts, created_at
       FROM notification_outbox
       WHERE id IN (${placeholders}) AND lease_token = ?;`,
      [...candidateIds, workerLeaseToken]
    );

    await connection.commit();
    return claimedRows;
  } catch (err) {
    try { await connection.rollback(); } catch (_) {}
    throw err;
  } finally {
    connection.release();
  }
};

/**
 * Complete an outbox event with lease ownership and expiry fencing inside a transaction
 *
 * @param {import('mysql2/promise').Connection} conn
 * @param {Object} params
 * @param {number} params.eventId
 * @param {string} params.workerLeaseToken
 * @returns {Promise<boolean>}
 */
const completeOutboxEventTx = async (conn, { eventId, workerLeaseToken }) => {
  const [result] = await conn.execute(
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
    [eventId, workerLeaseToken]
  );

  return result.affectedRows === 1;
};

/**
 * Record failure with exponential backoff and lease ownership fencing
 *
 * @param {Object} params
 * @param {number} params.eventId
 * @param {string} params.workerLeaseToken
 * @param {string} params.errorMessage
 * @returns {Promise<boolean>}
 */
const failOutboxEvent = async ({ eventId, workerLeaseToken, errorMessage }) => {
  const [result] = await pool.execute(
    `UPDATE notification_outbox
     SET status = IF(attempts >= 5, 'FAILED', 'PENDING'),
         lease_token = NULL,
         lease_expires_at = NULL,
         next_attempt_at = IF(attempts >= 5, NULL,
           CASE attempts
             WHEN 1 THEN NOW() + INTERVAL 30 SECOND
             WHEN 2 THEN NOW() + INTERVAL 2 MINUTE
             WHEN 3 THEN NOW() + INTERVAL 4 MINUTE
             WHEN 4 THEN NOW() + INTERVAL 8 MINUTE
             ELSE NOW() + INTERVAL 16 MINUTE
           END
         ),
         last_error = ?
     WHERE id = ? 
       AND lease_token = ? 
       AND status = 'PROCESSING' 
       AND lease_expires_at >= NOW();`,
    [String(errorMessage || 'Unknown error').slice(0, 1000), eventId, workerLeaseToken]
  );

  return result.affectedRows === 1;
};

/**
 * Sweep abandoned events that exhausted all 5 attempts and whose worker lease expired
 *
 * @returns {Promise<number>} Count of events moved to FAILED
 */
const sweepExpiredOutboxEvents = async () => {
  const [result] = await pool.execute(
    `UPDATE notification_outbox
     SET status = 'FAILED',
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error = 'Processing lease expired on final attempt 5'
     WHERE status = 'PROCESSING' 
       AND lease_expires_at < NOW() 
       AND attempts >= 5;`
  );

  return result.affectedRows;
};

/**
 * Find outbox event by event key
 *
 * @param {string} eventKey
 * @returns {Promise<Object|null>}
 */
const findOutboxEventByKey = async (eventKey) => {
  const [rows] = await pool.execute(
    'SELECT * FROM notification_outbox WHERE event_key = ? LIMIT 1;',
    [eventKey]
  );
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Atomically reset a FAILED outbox event for retry by an administrator
 *
 * @param {Object} params
 * @param {number|string} params.eventId
 * @param {number|string} params.adminUserId
 * @param {string} [params.reason]
 * @returns {Promise<Object>}
 */
const retryFailedOutboxEvent = async ({ eventId, adminUserId, reason = '' }) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, event_type, status, attempts, last_error FROM notification_outbox WHERE id = ? FOR UPDATE;`,
      [eventId]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return { success: false, notFound: true };
    }

    const event = rows[0];
    if (event.status !== 'FAILED') {
      await connection.rollback();
      return { success: false, invalidStatus: true, currentStatus: event.status };
    }

    const auditPrefix = `[ADMIN_RETRY by User ${adminUserId} at ${new Date().toISOString()}${reason ? ': ' + reason : ''}]`;
    const newLastError = `${auditPrefix} Prior error: ${event.last_error || 'None'}`.slice(0, 1000);

    await connection.execute(
      `UPDATE notification_outbox
       SET status = 'PENDING',
           attempts = 0,
           next_attempt_at = UTC_TIMESTAMP(),
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?;`,
      [newLastError, eventId]
    );

    await connection.commit();
    return { success: true, eventId: event.id, previousStatus: event.status, newStatus: 'PENDING' };
  } catch (err) {
    try { await connection.rollback(); } catch (_) {}
    throw err;
  } finally {
    connection.release();
  }
};

module.exports = {
  insertEventTx,
  claimOutboxBatch,
  completeOutboxEventTx,
  failOutboxEvent,
  sweepExpiredOutboxEvents,
  findOutboxEventByKey,
  retryFailedOutboxEvent
};

