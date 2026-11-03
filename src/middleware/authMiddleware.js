const rateLimit = require('express-rate-limit');
const { verifyAccessToken } = require('../utils/token');
const authModel = require('../models/authModel');
const ApiError = require('../utils/ApiError');
const { sendError } = require('../utils/response');

/**
 * Authentication middleware: verifies Bearer JWT and attaches user to request
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Access token is required. Format: Bearer <token>');
    }

    const token = authHeader.split(' ')[1];
    let decoded;

    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('Access token has expired. Please refresh your session.');
      }
      throw ApiError.unauthorized('Invalid access token');
    }

    if (decoded.tokenType !== 'ACCESS') {
      throw ApiError.unauthorized('Invalid token type');
    }

    // Verify user still exists and remains active in database
    const user = await authModel.findUserById(decoded.userId);
    if (!user || (user.status && user.status.toLowerCase() !== 'active')) {
      throw ApiError.unauthorized('User account is invalid or inactive');
    }

    req.user = {
      id: user.id,
      role: user.role,
      nameEnglish: user.name_english,
      nameTamil: user.name_tamil,
      phone: user.country_code ? `${user.country_code}${user.mobile_number}` : user.mobile_number,
      email: user.email,
      avatarUrl: user.avatar_url
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Role-based access control (RBAC) middleware
 * @param {...string} allowedRoles - List of allowed roles (e.g. 'admin', 'staff')
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    const normalizedAllowed = allowedRoles.map((r) => r.toLowerCase());
    if (!normalizedAllowed.includes(req.user.role.toLowerCase())) {
      return next(ApiError.forbidden('You do not have permission to access this resource'));
    }

    return next();
  };
};

/**
 * Strict rate limiter for login route to mitigate brute-force attacks
 */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 login requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return sendError(
      res,
      'Too many login attempts from this IP address. Please try again after 15 minutes.',
      429,
      { rateLimit: 'Too many login attempts. Please try again later.' }
    );
  }
});

module.exports = {
  authenticate,
  authorizeRoles,
  loginRateLimiter
};
