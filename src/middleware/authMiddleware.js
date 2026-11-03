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
    if (!user || user.status !== 'ACTIVE') {
      throw ApiError.unauthorized('User account is invalid or inactive');
    }

    // Attach role and permissions from database
    const permissions = await authModel.getUserPermissions(user.id);

    req.user = {
      id: user.id,
      name: user.name,
      mobile: user.mobile,
      email: user.email,
      role: user.role,
      mustChangePassword: Boolean(user.must_change_password),
      permissions
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Role-based access control (RBAC) middleware
 * @param {...string} allowedRoles - List of allowed roles (e.g. 'SUPER_ADMIN', 'ADMIN')
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to access this resource'));
    }

    return next();
  };
};

/**
 * Permission-based access control middleware
 * @param {...string} requiredPermissions - Permissions required to access endpoint
 */
const requirePermission = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user || !Array.isArray(req.user.permissions)) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    const hasPermission = requiredPermissions.every((perm) =>
      req.user.permissions.includes(perm)
    );

    if (!hasPermission) {
      return next(ApiError.forbidden('Forbidden: Insufficient privileges'));
    }

    return next();
  };
};

/**
 * Strict rate limiter for login route to mitigate brute-force attacks
 */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return sendError(
      res,
      'Too many login attempts from this IP address. Please try again after 15 minutes.',
      429
    );
  }
});

module.exports = {
  authenticate,
  authorizeRoles,
  requirePermission,
  loginRateLimiter
};
