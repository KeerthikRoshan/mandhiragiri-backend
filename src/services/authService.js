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
const isActive = (status) => String(status).toLowerCase() === 'active';
const isStaffRole = (role) => ['STAFF', 'PRIEST', 'ASSISTANT'].includes(String(role).toUpperCase());

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
 * Authenticate user with mobile, password, and optional role
 * @param {Object} credentials - { mobileNumber, password, role, ipAddress, userAgent }
 */
const loginUser = async ({ mobileNumber, password, role, ipAddress, userAgent }) => {
  const targetMobile = mobileNumber;
  const user = await authModel.findUserByMobileAndRole(targetMobile, role);

  if (!user) {
    // Perform dummy compare to prevent timing side-channels
    await bcrypt.compare(password, DUMMY_HASH);
    throw new ApiError(
      401,
      'மொபைல் எண் அல்லது கடவுச்சொல் தவறானது.',
      true,
      { credentials: 'Invalid mobile number or password.' }
    );
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw new ApiError(
      401,
      'மொபைல் எண் அல்லது கடவுச்சொல் தவறானது.',
      true,
      { credentials: 'Invalid mobile number or password.' }
    );
  }

  // Check account status
  if (!isActive(user.status)) {
    throw new ApiError(
      403,
      'தங்கள் பணியாளர் கணக்கு தற்போது முடக்கப்பட்டுள்ளது.',
      true,
      { account: 'Account is currently inactive. Contact chief administrator.' }
    );
  }

  // Generate tokens
  const accessToken = generateAccessToken({
    id: user.id,
    role: user.role
  });

  const refreshToken = generateRefreshToken();
  const tokenHash = hashToken(refreshToken);
  const expiresDate = getRefreshTokenExpiry();
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Create persistent session
  await authModel.createSession({
    userId: user.id,
    tokenHash,
    ipAddress,
    userAgent,
    expiresAt: expiresDate
  });

  // Build client response user object matching role contract
  let userPayload;
  let successMessage = 'உள்நுழைவு வெற்றிகரமாக முடிந்தது (Sign in successful)';

  if (isStaffRole(user.role)) {
    successMessage = 'பணியாளர் தளம் உள்நுழைவு வெற்றிகரமாக முடிந்தது';
    const staff = await authModel.getStaffProfile(user.id, targetMobile);

    if (staff) {
      userPayload = {
        id: String(staff.id),
        staffId: staff.staff_id || String(staff.id),
        userId: user.id,
        role: 'staff',
        staffRole: staff.staff_role,
        nameEnglish: staff.name_english,
        nameTamil: staff.name_tamil,
        designation: staff.designation,
        phone: staff.phone || (user.country_code ? `${user.country_code}${user.mobile_number}` : `+91${user.mobile_number}`),
        tradition: staff.tradition,
        certification: staff.certification,
        expertise: staff.expertise,
        languagesSpoken: staff.languages_spoken,
        avatarUrl: staff.avatar_url,
        // Backward-compatibility aliases for frontend
        designationTamil: staff.designation,
        designationEnglish: staff.designation,
        roleBadge: staff.staff_role,
        roleCategory: (staff.staff_role || 'PRIEST').toUpperCase(),
        traditionTamil: staff.tradition,
        certificationTamil: staff.certification,
        expertiseTamil: staff.expertise,
        languagesTamil: staff.languages_spoken
      };
    } else {
      userPayload = {
        id: user.id,
        role: 'staff',
        nameEnglish: user.name_english,
        nameTamil: user.name_tamil,
        title: user.title,
        phone: user.country_code ? `${user.country_code}${user.mobile_number}` : `+91${user.mobile_number}`,
        email: user.email,
        avatarUrl: user.avatar_url
      };
    }
  } else {
    // Admin user profile
    userPayload = {
      id: user.id,
      role: 'admin',
      nameEnglish: user.name_english,
      nameTamil: user.name_tamil,
      title: user.title || 'முதன்மை நிர்வாகி (Chief Administrator)',
      phone: user.country_code ? `${user.country_code}${user.mobile_number}` : `+91${user.mobile_number}`,
      email: user.email || 'mandhragiri.jothidam@gmail.com',
      avatarUrl: user.avatar_url || null
    };
  }

  return {
    message: successMessage,
    data: {
      token: accessToken,
      refreshToken,
      expiresAt: tokenExpiresAt,
      user: userPayload
    }
  };
};

/**
 * Rotate refresh token and issue new token pair
 * @param {Object} params - { refreshToken, ipAddress, userAgent }
 */
const refreshTokens = async ({ refreshToken, ipAddress, userAgent }) => {
  if (!refreshToken) {
    throw new ApiError(400, 'Refresh token is required', true, { refreshToken: 'Refresh token is required.' });
  }

  const tokenHash = hashToken(refreshToken);
  const session = await authModel.findSessionByTokenHash(tokenHash);

  if (!session) {
    throw new ApiError(401, 'Invalid or expired refresh token', true, { credentials: 'Invalid or expired refresh token' });
  }

  if (session.is_revoked) {
    await authModel.revokeAllUserSessions(session.user_id);
    throw new ApiError(401, 'Session has been revoked due to security breach', true);
  }

  const now = new Date();
  if (new Date(session.expires_at) < now) {
    await authModel.revokeSessionById(session.id);
    throw new ApiError(401, 'Refresh token has expired. Please log in again.', true);
  }

  const user = await authModel.findUserById(session.user_id);
  if (!user || !isActive(user.status)) {
    await authModel.revokeSessionById(session.id);
    throw new ApiError(401, 'User account is inactive or not found', true);
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
  const expiresDate = getRefreshTokenExpiry();
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await authModel.createSession({
    userId: user.id,
    tokenHash: newTokenHash,
    ipAddress,
    userAgent,
    expiresAt: expiresDate
  });

  return {
    token: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt: tokenExpiresAt,
    user: {
      id: user.id,
      nameEnglish: user.name_english,
      nameTamil: user.name_tamil,
      role: user.role,
      phone: user.country_code ? `${user.country_code}${user.mobile_number}` : `+91${user.mobile_number}`
    }
  };
};

/**
 * Log out user by revoking refresh token session
 */
const logoutUser = async ({ refreshToken, userId }) => {
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await authModel.revokeSessionByTokenHash(tokenHash);
  } else if (userId) {
    await authModel.revokeAllUserSessions(userId);
  }
};

/**
 * Get profile for authenticated user
 * @param {string} userId
 */
const getCurrentUser = async (userId) => {
  const user = await authModel.findUserById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found', true);
  }

  if (!isActive(user.status)) {
    throw new ApiError(403, 'Account is deactivated', true);
  }

  if (isStaffRole(user.role)) {
    const staff = await authModel.getStaffProfile(user.id);
    if (staff) {
      return {
        id: String(staff.id),
        staffId: staff.staff_id || String(staff.id),
        userId: user.id,
        role: 'staff',
        staffRole: staff.staff_role,
        nameEnglish: staff.name_english,
        nameTamil: staff.name_tamil,
        designation: staff.designation,
        phone: staff.phone,
        tradition: staff.tradition,
        certification: staff.certification,
        expertise: staff.expertise,
        languagesSpoken: staff.languages_spoken,
        avatarUrl: staff.avatar_url,
        status: staff.status,
        // Backward-compatibility aliases for frontend
        designationTamil: staff.designation,
        designationEnglish: staff.designation,
        roleBadge: staff.staff_role,
        roleCategory: (staff.staff_role || 'PRIEST').toUpperCase(),
        traditionTamil: staff.tradition,
        certificationTamil: staff.certification,
        expertiseTamil: staff.expertise,
        languagesTamil: staff.languages_spoken
      };
    }
  }

  return {
    id: user.id,
    role: user.role,
    nameEnglish: user.name_english,
    nameTamil: user.name_tamil,
    title: user.title,
    phone: user.country_code ? `${user.country_code}${user.mobile_number}` : `+91${user.mobile_number}`,
    email: user.email,
    avatarUrl: user.avatar_url,
    addressTamil: user.address_tamil,
    status: user.status
  };
};

/**
 * Change user password
 */
const changePassword = async ({ userId, currentPassword, newPassword }) => {
  const user = await authModel.findUserById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found', true);
  }

  const isCurrentPasswordCorrect = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isCurrentPasswordCorrect) {
    throw new ApiError(400, 'Current password is incorrect', true, { currentPassword: 'Current password is incorrect.' });
  }

  if (currentPassword === newPassword) {
    throw new ApiError(400, 'New password cannot be identical to current password', true);
  }

  const saltRounds = 10;
  const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

  await authModel.updatePassword(userId, newPasswordHash);
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
