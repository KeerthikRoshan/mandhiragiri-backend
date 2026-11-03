const { pool } = require('../config/database');

/**
 * Find user by mobile number and optional role
 * @param {string} mobileNumber - 10-digit or full mobile number
 * @param {string|null} role - Optional role filter ('admin' or 'staff')
 * @returns {Promise<Object|null>}
 */
const findUserByMobileAndRole = async (mobileNumber, role = null) => {
  const cleanMobile = String(mobileNumber).replace(/\D/g, '').slice(-10);
  const pattern = `%${cleanMobile}`;

  // If role is explicitly 'staff', search both users and linked staff records
  if (role && role.toLowerCase() === 'staff') {
    const staffQuery = `
      SELECT 
        u.id,
        u.role,
        u.country_code,
        u.mobile_number,
        u.password_hash,
        u.name_english,
        u.name_tamil,
        u.title,
        u.email,
        u.avatar_url,
        u.status
      FROM staff s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.phone LIKE ? AND u.role = 'staff'
      LIMIT 1;
    `;
    const [staffRows] = await pool.execute(staffQuery, [pattern]);
    if (staffRows.length > 0) {
      return staffRows[0];
    }
  }

  // General search in users table
  if (role) {
    const query = `
      SELECT 
        id,
        role,
        country_code,
        mobile_number,
        password_hash,
        name_english,
        name_tamil,
        title,
        email,
        avatar_url,
        status
      FROM users
      WHERE mobile_number LIKE ? AND role = ?
      LIMIT 1;
    `;
    const [rows] = await pool.execute(query, [pattern, role.toLowerCase()]);
    if (rows.length > 0) return rows[0];
  }

  // Default fallback search by mobile
  const fallbackQuery = `
    SELECT 
      id,
      role,
      country_code,
      mobile_number,
      password_hash,
      name_english,
      name_tamil,
      title,
      email,
      avatar_url,
      status
    FROM users
    WHERE mobile_number LIKE ?
    ORDER BY (role = 'admin') DESC
    LIMIT 1;
  `;
  const [rows] = await pool.execute(fallbackQuery, [pattern]);
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Find staff details for a user or phone
 * @param {string} userId
 * @param {string} phone
 * @returns {Promise<Object|null>}
 */
const getStaffProfile = async (userId, phone = null) => {
  const cleanMobile = phone ? String(phone).replace(/\D/g, '').slice(-10) : '';
  const pattern = cleanMobile ? `%${cleanMobile}` : '';

  const query = `
    SELECT 
      id,
      user_id,
      name_english,
      name_tamil,
      designation_tamil,
      designation_english,
      role_badge,
      role_category,
      phone,
      tradition_tamil,
      certification_tamil,
      expertise_tamil,
      languages_tamil,
      avatar_url,
      status
    FROM staff
    WHERE user_id = ? OR (phone LIKE ? AND ? != '')
    LIMIT 1;
  `;
  const [rows] = await pool.execute(query, [userId, pattern, pattern]);
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Find user by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
const findUserById = async (id) => {
  const query = `
    SELECT 
      id,
      role,
      country_code,
      mobile_number,
      password_hash,
      name_english,
      name_tamil,
      title,
      email,
      avatar_url,
      status
    FROM users
    WHERE id = ?
    LIMIT 1;
  `;
  const [rows] = await pool.execute(query, [id]);
  return rows.length > 0 ? rows[0] : null;
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
 * Revoke session by ID
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
 * @param {string} userId
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
 * Update user password
 * @param {string} userId
 * @param {string} passwordHash
 * @returns {Promise<void>}
 */
const updatePassword = async (userId, passwordHash) => {
  const query = `
    UPDATE users
    SET password_hash = ?
    WHERE id = ?;
  `;
  await pool.execute(query, [passwordHash, userId]);
};

module.exports = {
  findUserByMobileAndRole,
  getStaffProfile,
  findUserById,
  createSession,
  findSessionByTokenHash,
  revokeSessionById,
  revokeSessionByTokenHash,
  revokeAllUserSessions,
  updatePassword
};
