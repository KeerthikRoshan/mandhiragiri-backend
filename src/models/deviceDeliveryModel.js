const { pool } = require('../config/database');

/**
 * Device Delivery Model for Mandhiragiri Jothidam (Phase 4)
 * Manages persistent per-device delivery tracking, lease-fenced status updates,
 * and lease-fenced device token deactivations.
 */

/**
 * Initialize delivery rows for all active recipient devices with status 'PENDING'
 *
 * @param {import('mysql2/promise').Connection|import('mysql2/promise').Pool} client
 * @param {Object} params
 * @param {number} params.jobId
 * @param {Array<{ id: number, fcm_token: string }>} params.devices
 * @returns {Promise<number>} Number of inserted rows
 */
const initDeviceDeliveries = async (client, { jobId, devices }) => {
  if (!devices || devices.length === 0) return 0;

  const placeholders = devices.map(() => '(?, ?, ?, \'PENDING\', 0, NOW())').join(',');
  const params = [];

  for (const dev of devices) {
    params.push(jobId, dev.id, dev.fcm_token);
  }

  const [result] = await client.execute(
    `INSERT IGNORE INTO notification_device_deliveries (
      job_id, device_id, fcm_token, status, attempts, created_at
    ) VALUES ${placeholders};`,
    params
  );

  return result.affectedRows;
};

/**
 * Retrieve ONLY pending device deliveries for a specific push job
 * Permanently failed and already-sent devices are strictly excluded.
 *
 * @param {import('mysql2/promise').Connection|import('mysql2/promise').Pool} client
 * @param {number} jobId
 * @returns {Promise<Array<Object>>}
 */
const getPendingDeviceDeliveries = async (client, jobId) => {
  const [rows] = await client.execute(
    `SELECT dd.id, dd.job_id, dd.device_id, dd.fcm_token, dd.status, dd.attempts
     FROM notification_device_deliveries dd
     WHERE dd.job_id = ? AND dd.status = 'PENDING'
     ORDER BY dd.id ASC;`,
    [jobId]
  );
  return rows;
};

/**
 * Get summary of delivery statuses for a specific push job
 *
 * @param {import('mysql2/promise').Connection|import('mysql2/promise').Pool} client
 * @param {number} jobId
 * @returns {Promise<{ total: number, sent: number, failed: number, pending: number }>}
 */
const getDeliveriesSummary = async (client, jobId) => {
  const [rows] = await client.execute(
    `SELECT 
       COUNT(*) AS total,
       SUM(IF(status = 'SENT', 1, 0)) AS sent,
       SUM(IF(status = 'FAILED', 1, 0)) AS failed,
       SUM(IF(status = 'PENDING', 1, 0)) AS pending
     FROM notification_device_deliveries
     WHERE job_id = ?;`,
    [jobId]
  );

  const row = rows[0] || {};
  return {
    total: Number(row.total || 0),
    sent: Number(row.sent || 0),
    failed: Number(row.failed || 0),
    pending: Number(row.pending || 0)
  };
};

/**
 * Update delivery status with mandatory parent job lease ownership and expiry fencing
 * An expired or stale worker CANNOT update status.
 *
 * @param {Object} params
 * @param {number} params.deliveryId
 * @param {number} params.jobId
 * @param {string} params.workerLeaseToken
 * @param {'SENT'|'FAILED'|'PENDING'} params.status
 * @param {string|null} [params.error]
 * @returns {Promise<boolean>} True if updated under valid lease, false if stale/fencing rejected
 */
const updateDeliveryOutcomeFenced = async ({
  deliveryId,
  jobId,
  workerLeaseToken,
  status,
  error = null
}) => {
  const isSent = status === 'SENT';

  const [result] = await pool.execute(
    `UPDATE notification_device_deliveries dd
     JOIN notification_jobs j ON j.id = dd.job_id
     SET dd.status = ?,
         dd.sent_at = ${isSent ? 'NOW()' : 'dd.sent_at'},
         dd.attempts = dd.attempts + 1,
         dd.last_error = ?
     WHERE dd.id = ? 
       AND j.id = ?
       AND j.lease_token = ? 
       AND j.status = 'PROCESSING' 
       AND j.lease_expires_at >= NOW();`,
    [status, error ? String(error).slice(0, 1000) : null, deliveryId, jobId, workerLeaseToken]
  );

  return result.affectedRows === 1;
};

/**
 * Deactivate a stale/invalid FCM device token with mandatory parent job lease fencing
 *
 * @param {Object} params
 * @param {number} params.deviceId - user_devices.id
 * @param {number} params.jobId - notification_jobs.id
 * @param {string} params.workerLeaseToken
 * @returns {Promise<boolean>}
 */
const deactivateDeviceFenced = async ({ deviceId, jobId, workerLeaseToken }) => {
  const [result] = await pool.execute(
    `UPDATE user_devices ud
     JOIN notification_device_deliveries dd ON dd.device_id = ud.id
     JOIN notification_jobs j ON j.id = dd.job_id
     SET ud.is_active = 0
     WHERE ud.id = ? 
       AND j.id = ?
       AND j.lease_token = ? 
       AND j.status = 'PROCESSING' 
       AND j.lease_expires_at >= NOW();`,
    [deviceId, jobId, workerLeaseToken]
  );

  return result.affectedRows >= 1;
};

/**
 * Find all deliveries for a specific job (used in assertions and tests)
 *
 * @param {number} jobId
 * @returns {Promise<Array<Object>>}
 */
const findDeliveriesByJobId = async (jobId) => {
  const [rows] = await pool.execute(
    `SELECT * FROM notification_device_deliveries WHERE job_id = ? ORDER BY id ASC;`,
    [jobId]
  );
  return rows;
};

module.exports = {
  initDeviceDeliveries,
  getPendingDeviceDeliveries,
  getDeliveriesSummary,
  updateDeliveryOutcomeFenced,
  deactivateDeviceFenced,
  findDeliveriesByJobId
};
