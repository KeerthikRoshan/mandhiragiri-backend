const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * Generate short-lived JWT Access Token
 * @param {Object} payload - User identification { id, role }
 * @returns {string} Signed JWT
 */
const generateAccessToken = (payload) => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET environment variable is not defined.');
  }

  const expiry = process.env.JWT_ACCESS_EXPIRY || '15m';

  return jwt.sign(
    {
      userId: payload.id,
      role: payload.role,
      tokenType: 'ACCESS'
    },
    secret,
    { expiresIn: expiry }
  );
};

/**
 * Generate cryptographically secure opaque refresh token string
 * @returns {string} Random hex string (80 characters)
 */
const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
};

/**
 * Compute SHA-256 hash of an opaque token for secure storage
 * @param {string} token
 * @returns {string} Hex hash
 */
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Verify JWT Access Token
 * @param {string} token
 * @returns {Object} Decoded payload
 */
const verifyAccessToken = (token) => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET environment variable is not defined.');
  }

  return jwt.verify(token, secret);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyAccessToken
};
