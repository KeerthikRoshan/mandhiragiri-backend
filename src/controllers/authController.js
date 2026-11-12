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

  const maskedMobile = targetMobile
    ? `${targetMobile.slice(0, 3)}****${targetMobile.slice(-2)}`
    : 'N/A';
  console.log('\n========================================');
  console.log(`[AUTH LOGIN SUCCESS]`);
  console.log(`User: ${result.data.user?.nameEnglish || result.data.user?.id} (Role: ${result.data.user?.role})`);
  console.log(`Mobile: ${maskedMobile}`);
  console.log(`JWT Token: ${result.data.token ? result.data.token.substring(0, 15) + '...' : 'NONE'}`);
  console.log(`Expires At: ${result.data.expiresAt}`);
  console.log('========================================\n');

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

  const maskedMobile = targetMobile
    ? `${targetMobile.slice(0, 3)}****${targetMobile.slice(-2)}`
    : 'N/A';
  console.log('\n========================================');
  console.log(`[STAFF LOGIN SUCCESS]`);
  console.log(`Staff: ${result.data.user?.nameEnglish} (ID: ${result.data.user?.staffId || result.data.user?.id})`);
  console.log(`Mobile: ${maskedMobile}`);
  console.log(`JWT Token: ${result.data.token ? result.data.token.substring(0, 15) + '...' : 'NONE'}`);
  console.log(`Expires At: ${result.data.expiresAt}`);
  console.log('========================================\n');

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

  console.log('\n========================================');
  console.log(`[AUTH REFRESH SUCCESS]`);
  console.log(`JWT Token: ${result.token}`);
  console.log(`Refresh Token: ${result.refreshToken}`);
  console.log('========================================\n');

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
