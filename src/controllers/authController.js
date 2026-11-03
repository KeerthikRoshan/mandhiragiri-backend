const authService = require('../services/authService');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Handle user login (Admin / Multi-role)
 */
const login = asyncHandler(async (req, res) => {
  const { mobileNumber, mobile, phone, password, role } = req.body;
  const targetMobile = mobileNumber || mobile || phone;
  const ipAddress = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  const result = await authService.loginUser({
    mobileNumber: targetMobile,
    password,
    role: role || null,
    ipAddress,
    userAgent
  });

  return sendSuccess(res, result.message, result.data, 200);
});

/**
 * Handle staff login specifically (POST /api/v1/auth/staff-login)
 */
const staffLogin = asyncHandler(async (req, res) => {
  const { mobileNumber, mobile, phone, password } = req.body;
  const targetMobile = mobileNumber || mobile || phone;
  const ipAddress = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  const result = await authService.loginUser({
    mobileNumber: targetMobile,
    password,
    role: 'staff',
    ipAddress,
    userAgent
  });

  return sendSuccess(res, result.message, result.data, 200);
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

  return sendSuccess(res, 'Session token refreshed successfully.', result, 200);
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

  return sendSuccess(res, 'Logged out successfully.', null, 200);
});

/**
 * Fetch authenticated user profile
 */
const getMe = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const result = await authService.getCurrentUser(userId);

  return sendSuccess(res, 'User profile fetched successfully.', result, 200);
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
    'கடவுச்சொல் வெற்றிகரமாக மாற்றப்பட்டது (Password changed successfully).',
    null,
    200
  );
});

module.exports = {
  login,
  staffLogin,
  refresh,
  logout,
  getMe,
  changePassword
};
