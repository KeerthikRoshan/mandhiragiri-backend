const authService = require('../services/authService');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Handle user login
 */
const login = asyncHandler(async (req, res) => {
  const mobile = req.body.mobile || req.body.mobileNumber;
  const { password } = req.body;
  const ipAddress = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  const result = await authService.loginUser({
    mobile,
    password,
    ipAddress,
    userAgent
  });

  return sendSuccess(res, 'Login successful', result, 200);
});

/**
 * Handle refresh token rotation
 */
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const ipAddress = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  const result = await authService.refreshTokens({
    refreshToken,
    ipAddress,
    userAgent
  });

  return sendSuccess(res, 'Token refreshed successfully', result, 200);
});

/**
 * Handle user logout
 */
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const userId = req.user ? req.user.id : null;

  await authService.logoutUser({
    refreshToken,
    userId
  });

  return sendSuccess(res, 'Logged out successfully', null, 200);
});

/**
 * Fetch authenticated user profile
 */
const getMe = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const result = await authService.getCurrentUser(userId);

  return sendSuccess(res, 'User profile fetched successfully', result, 200);
});

/**
 * Handle user password change
 */
const changePassword = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  await authService.changePassword({
    userId,
    currentPassword,
    newPassword
  });

  return sendSuccess(
    res,
    'Password changed successfully. Please log in again with your new password.',
    null,
    200
  );
});

module.exports = {
  login,
  refresh,
  logout,
  getMe,
  changePassword
};
