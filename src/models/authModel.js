const { pool } = require('../config/database');

/**
 * Find user by mobile number with role details
 * @param {string} mobile
 * @returns {Promise<Object|null>}
 */
const findUserByMobile = async (mobile) => {
  const query = `
    SELECT 
      u.id,
      u.role_id,
      u.mobile,
      u.password_hash,
      u.name,
      u.email,
      u.status,
      u.must_change_password,
      u.last_login_at,
      r.name AS role
    FROM users u
    INNER JOIN roles r ON u.role_id = r.id
    WHERE u.mobile = ?
    LIMIT 1;
  `;
  const [rows] = await pool.execute(query, [mobile]);
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Find user by ID with role details
 * @param {number|string} id
 * @returns {Promise<Object|null>}
 */
const findUserById = async (id) => {
  const query = `
    SELECT 
      u.id,
      u.role_id,
      u.mobile,
      u.password_hash,
      u.name,
      u.email,
      u.status,
      u.must_change_password,
      u.last_login_at,
      r.name AS role
    FROM users u
    INNER JOIN roles r ON u.role_id = r.id
    WHERE u.id = ?
    LIMIT 1;
  `;
  const [rows] = await pool.execute(query, [id]);
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Get distinct permission names assigned to a user's role
 * @param {number|string} userId
 * @returns {Promise<string[]>}
 */
const getUserPermissions = async (userId) => {
  const query = `
    SELECT DISTINCT p.name
    FROM users u
    INNER JOIN role_permissions rp ON u.role_id = rp.role_id
    INNER JOIN permissions p ON rp.permission_id = p.id
    WHERE u.id = ?;
  `;
  const [rows] = await pool.execute(query, [userId]);
  return rows.map((r) => r.name);
};

/**
 * Update user last login timestamp
 * @param {number|string} userId
 * @returns {Promise<void>}
 */
const updateLastLogin = async (userId) => {
  const query = `
    UPDATE users 
    SET last_login_at = CURRENT_TIMESTAMP 
    WHERE id = ?;
  `;
  await pool.execute(query, [userId]);
};

/**
 * Create a new user session with refresh token hash
 * @param {Object} sessionData
 * @returns {Promise<number>} Inserted session ID
 */
const createSession = async ({ userId, tokenHash, ipAddress, userAgent, expiresAt }) => {
  const query = `
    INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at, is_revoked)
    VALUES (?, ?, ?, ?, ?, 0);
  `;
  const [result] = await pool.execute(query, [
    userId,
    tokenHash,
    ipAddress || null,
    userAgent || null,
    expiresAt
  ]);
  return result.insertId;
};

/**
 * Find session by token hash
 * @param {string} tokenHash
 * @returns {Promise<Object|null>}
 */
const findSessionByTokenHash = async (tokenHash) => {
  const query = `
    SELECT 
      id,
      user_id,
      token_hash,
      ip_address,
      user_agent,
      is_revoked,
      expires_at
    FROM user_sessions
    WHERE token_hash = ?
    LIMIT 1;
  `;
  const [rows] = await pool.execute(query, [tokenHash]);
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Revoke session by session ID
 * @param {number|string} sessionId
 * @returns {Promise<void>}
 */
const revokeSessionById = async (sessionId) => {
  const query = `
    UPDATE user_sessions
    SET is_revoked = 1
    WHERE id = ?;
  `;
  await pool.execute(query, [sessionId]);
};

/**
 * Revoke session by token hash
 * @param {string} tokenHash
 * @returns {Promise<void>}
 */
const revokeSessionByTokenHash = async (tokenHash) => {
  const query = `
    UPDATE user_sessions
    SET is_revoked = 1
    WHERE token_hash = ?;
  `;
  await pool.execute(query, [tokenHash]);
};

/**
 * Revoke all active sessions for a user
 * @param {number|string} userId
 * @returns {Promise<void>}
 */
const revokeAllUserSessions = async (userId) => {
  const query = `
    UPDATE user_sessions
    SET is_revoked = 1
    WHERE user_id = ?;
  `;
  await pool.execute(query, [userId]);
};

/**
 * Update user password and clear must_change_password flag
 * @param {number|string} userId
 * @param {string} passwordHash
 * @returns {Promise<void>}
 */
const updatePassword = async (userId, passwordHash) => {
  const query = `
    UPDATE users
    SET password_hash = ?, must_change_password = 0
    WHERE id = ?;
  `;
  await pool.execute(query, [passwordHash, userId]);
};

module.exports = {
  findUserByMobile,
  findUserById,
  getUserPermissions,
  updateLastLogin,
  createSession,
  findSessionByTokenHash,
  revokeSessionById,
  revokeSessionByTokenHash,
  revokeAllUserSessions,
  updatePassword
};
