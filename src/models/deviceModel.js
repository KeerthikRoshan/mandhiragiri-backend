const { pool } = require('../config/database');

/**
 * Device Model for FCM Token Registration and Device Management
 * Supports multi-device registration, token rotation, and safe reassignment.
 */

/**
 * Upsert user device record
 * Handles token reassignment when switching users on the same physical device.
 *
 * @param {Object} params
 * @param {number|string} params.userId
 * @param {string} params.fcmToken
 * @param {string} [params.platform='android']
 * @param {string|null} [params.deviceId]
 * @param {string|null} [params.appVersion]
 * @returns {Promise<Object>}
 */
const upsertDevice = async ({ userId, fcmToken, platform = 'android', deviceId = null, appVersion = null }) => {
  const normalizedPlatform = ['android', 'ios', 'web'].includes(String(platform).toLowerCase())
    ? String(platform).toLowerCase()
    : 'android';

  // 1. If deviceId is provided, deactivate any previous active tokens on this device
  // to prevent duplicate active records for the same physical device
  if (deviceId) {
    const deactivateOldSql = `
      UPDATE user_devices 
      SET is_active = 0 
      WHERE device_id = ? AND fcm_token != ?;
    `;
    await pool.execute(deactivateOldSql, [deviceId, fcmToken]);
  }

  // 2. Insert or update on duplicate fcm_token.
  // If the same FCM token was previously registered to a different user,
  // it is safely reassigned to the current authenticated userId and reactivated.
  const upsertSql = `
    INSERT INTO user_devices (
      user_id,
      fcm_token,
      device_id,
      platform,
      app_version,
      is_active,
      last_seen_at
    )
    VALUES (?, ?, ?, ?, ?, 1, NOW())
    ON DUPLICATE KEY UPDATE
      user_id = VALUES(user_id),
      device_id = COALESCE(VALUES(device_id), device_id),
      platform = VALUES(platform),
      app_version = COALESCE(VALUES(app_version), app_version),
      is_active = 1,
      last_seen_at = NOW();
  `;

  await pool.execute(upsertSql, [
    userId,
    fcmToken,
    deviceId || null,
    normalizedPlatform,
    appVersion || null
  ]);

  return findDeviceByToken(fcmToken);
};

/**
 * Update an existing device token (e.g. on FCM token refresh)
 *
 * @param {Object} params
 * @param {number|string} params.userId
 * @param {string} params.newToken
 * @param {string|null} [params.oldToken]
 * @param {string|null} [params.deviceId]
 * @param {string} [params.platform='android']
 * @param {string|null} [params.appVersion]
 * @returns {Promise<Object>}
 */
const updateDeviceToken = async ({
  userId,
  newToken,
  oldToken = null,
  deviceId = null,
  platform = 'android',
  appVersion = null
}) => {
  // If old token provided, deactivate it
  if (oldToken && oldToken !== newToken) {
    await pool.execute(
      'UPDATE user_devices SET is_active = 0 WHERE user_id = ? AND fcm_token = ?;',
      [userId, oldToken]
    );
  }

  return upsertDevice({
    userId,
    fcmToken: newToken,
    platform,
    deviceId,
    appVersion
  });
};

/**
 * Deactivate device registration during logout
 * Scoped strictly to the authenticated userId.
 *
 * @param {Object} params
 * @param {number|string} params.userId
 * @param {string|null} [params.fcmToken]
 * @param {string|null} [params.deviceId]
 * @returns {Promise<number>} Number of deactivated rows
 */
const deactivateDevice = async ({ userId, fcmToken = null, deviceId = null }) => {
  if (!fcmToken && !deviceId) {
    return 0;
  }

  let sql = 'UPDATE user_devices SET is_active = 0 WHERE user_id = ? AND (';
  const conditions = [];
  const params = [userId];

  if (fcmToken) {
    conditions.push('fcm_token = ?');
    params.push(fcmToken);
  }

  if (deviceId) {
    conditions.push('device_id = ?');
    params.push(deviceId);
  }

  sql += conditions.join(' OR ') + ');';

  const [result] = await pool.execute(sql, params);
  return result.affectedRows;
};

/**
 * Find device by unique FCM token
 *
 * @param {string} fcmToken
 * @returns {Promise<Object|null>}
 */
const findDeviceByToken = async (fcmToken) => {
  const query = `
    SELECT 
      id,
      user_id,
      fcm_token,
      device_id,
      platform,
      app_version,
      is_active,
      last_seen_at,
      created_at,
      updated_at
    FROM user_devices
    WHERE fcm_token = ?
    LIMIT 1;
  `;
  const [rows] = await pool.execute(query, [fcmToken]);
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Get all active devices for a specific user
 *
 * @param {number|string} userId
 * @returns {Promise<Array<Object>>}
 */
const getActiveDevicesForUser = async (userId) => {
  const query = `
    SELECT 
      id,
      user_id,
      fcm_token,
      device_id,
      platform,
      app_version,
      is_active,
      last_seen_at,
      created_at,
      updated_at
    FROM user_devices
    WHERE user_id = ? AND is_active = 1
    ORDER BY last_seen_at DESC;
  `;
  const [rows] = await pool.execute(query, [userId]);
  return rows;
};

/**
 * Deactivate a stale token (e.g. when Firebase reports it is invalid or unregistered)
 *
 * @param {string} fcmToken
 * @returns {Promise<number>}
 */
const deactivateStaleToken = async (fcmToken) => {
  const [result] = await pool.execute(
    'UPDATE user_devices SET is_active = 0 WHERE fcm_token = ?;',
    [fcmToken]
  );
  return result.affectedRows;
};

module.exports = {
  upsertDevice,
  updateDeviceToken,
  deactivateDevice,
  findDeviceByToken,
  getActiveDevicesForUser,
  deactivateStaleToken
};
