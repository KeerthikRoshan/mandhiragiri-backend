const bcrypt = require('bcrypt');
const authModel = require('../models/authModel');
const ApiError = require('../utils/ApiError');
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken
} = require('../utils/token');

// Dummy hash for constant-time comparison against nonexistent users
const DUMMY_HASH = '$2b$12$e8Y6/m5L4wO7q3NlWpA1q.1xYk2YyJ9kGqE9x0sWk9N9N9N9N9N9e';

/**
 * Calculate refresh token expiry date
 * @returns {Date}
 */
const getRefreshTokenExpiry = () => {
  const days = parseInt(process.env.JWT_REFRESH_EXPIRY_DAYS, 10) || 7;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry;
};

/**
 * Authenticate user with mobile and password
 * @param {Object} credentials - { mobile, password, ipAddress, userAgent }
 */
const loginUser = async ({ mobile, password, ipAddress, userAgent }) => {
  const user = await authModel.findUserByMobile(mobile);

  if (!user) {
    // Perform dummy compare to prevent timing side-channels
    await bcrypt.compare(password, DUMMY_HASH);
    throw ApiError.unauthorized('Invalid mobile number or password');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw ApiError.unauthorized('Invalid mobile number or password');
  }

  // Check account status
  if (user.status !== 'ACTIVE') {
    throw ApiError.unauthorized('Invalid mobile number or password');
  }

  // Retrieve user permissions from database
  const permissions = await authModel.getUserPermissions(user.id);

  // Generate tokens
  const accessToken = generateAccessToken({
    id: user.id,
    role: user.role
  });

  const refreshToken = generateRefreshToken();
  const tokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshTokenExpiry();

  // Create persistent session
  await authModel.createSession({
    userId: user.id,
    tokenHash,
    ipAddress,
    userAgent,
    expiresAt
  });

  // Update last login timestamp
  await authModel.updateLastLogin(user.id);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      mobile: user.mobile,
      role: user.role,
      mustChangePassword: Boolean(user.must_change_password),
      permissions
    }
  };
};

/**
 * Rotate refresh token and issue new token pair
 * @param {Object} params - { refreshToken, ipAddress, userAgent }
 */
const refreshTokens = async ({ refreshToken, ipAddress, userAgent }) => {
  if (!refreshToken) {
    throw ApiError.badRequest('Refresh token is required');
  }

  const tokenHash = hashToken(refreshToken);
  const session = await authModel.findSessionByTokenHash(tokenHash);

  if (!session) {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  // If token is already revoked, potential token reuse attempt: revoke all sessions for this user
  if (session.is_revoked) {
    await authModel.revokeAllUserSessions(session.user_id);
    throw ApiError.unauthorized('Session has been revoked due to security breach');
  }

  // Check expiration
  const now = new Date();
  if (new Date(session.expires_at) < now) {
    await authModel.revokeSessionById(session.id);
    throw ApiError.unauthorized('Refresh token has expired. Please log in again.');
  }

  // Validate user status
  const user = await authModel.findUserById(session.user_id);
  if (!user || user.status !== 'ACTIVE') {
    await authModel.revokeSessionById(session.id);
    throw ApiError.unauthorized('User account is inactive or not found');
  }

  // Revoke old session (Rotation)
  await authModel.revokeSessionById(session.id);

  // Generate new token pair
  const newAccessToken = generateAccessToken({
    id: user.id,
    role: user.role
  });

  const newRefreshToken = generateRefreshToken();
  const newTokenHash = hashToken(newRefreshToken);
  const expiresAt = getRefreshTokenExpiry();

  // Save new session
  await authModel.createSession({
    userId: user.id,
    tokenHash: newTokenHash,
    ipAddress,
    userAgent,
    expiresAt
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      name: user.name,
      mobile: user.mobile,
      role: user.role,
      mustChangePassword: Boolean(user.must_change_password)
    }
  };
};

/**
 * Log out user by revoking the refresh token session
 * @param {Object} params - { refreshToken, userId }
 */
const logoutUser = async ({ refreshToken, userId }) => {
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await authModel.revokeSessionByTokenHash(tokenHash);
  } else if (userId) {
    // If no refresh token passed but user is authenticated, revoke all active sessions
    await authModel.revokeAllUserSessions(userId);
  }
};

/**
 * Get profile for authenticated user
 * @param {number|string} userId
 */
const getCurrentUser = async (userId) => {
  const user = await authModel.findUserById(userId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  if (user.status !== 'ACTIVE') {
    throw ApiError.unauthorized('Account is deactivated');
  }

  const permissions = await authModel.getUserPermissions(userId);

  return {
    id: user.id,
    name: user.name,
    mobile: user.mobile,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: Boolean(user.must_change_password),
    lastLoginAt: user.last_login_at,
    permissions
  };
};

/**
 * Change user password
 * @param {Object} params - { userId, currentPassword, newPassword }
 */
const changePassword = async ({ userId, currentPassword, newPassword }) => {
  const user = await authModel.findUserById(userId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  const isCurrentPasswordCorrect = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isCurrentPasswordCorrect) {
    throw ApiError.badRequest('Current password is incorrect');
  }

  if (currentPassword === newPassword) {
    throw ApiError.badRequest('New password cannot be identical to current password');
  }

  const saltRounds = 12;
  const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

  // Update password in database and clear must_change_password flag
  await authModel.updatePassword(userId, newPasswordHash);

  // Revoke all existing sessions so old tokens cannot be used
  await authModel.revokeAllUserSessions(userId);

  return true;
};

module.exports = {
  loginUser,
  refreshTokens,
  logoutUser,
  getCurrentUser,
  changePassword
};
