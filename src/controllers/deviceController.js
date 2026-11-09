const deviceModel = require('../models/deviceModel');
const notificationService = require('../services/notificationService');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * Register a device for push notifications
 * POST /api/v1/devices/register
 */
const registerDevice = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { fcmToken, platform, deviceId, appVersion } = req.body;

  const device = await deviceModel.upsertDevice({
    userId,
    fcmToken,
    platform,
    deviceId,
    appVersion
  });

  console.log(`[DEVICE REGISTER] User ${userId} registered token ${notificationService.maskToken(fcmToken)} on ${platform || 'android'}`);

  return sendSuccess(
    res,
    'Device registered successfully for push notifications.',
    {
      deviceId: device.device_id,
      platform: device.platform,
      isActive: Boolean(device.is_active),
      registeredAt: device.last_seen_at
    },
    200
  );
});

/**
 * Update device token (token rotation)
 * PUT /api/v1/devices/token
 */
const updateToken = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { fcmToken, oldToken, deviceId, platform, appVersion } = req.body;

  const device = await deviceModel.updateDeviceToken({
    userId,
    newToken: fcmToken,
    oldToken,
    deviceId,
    platform,
    appVersion
  });

  console.log(`[DEVICE TOKEN UPDATE] User ${userId} updated token to ${notificationService.maskToken(fcmToken)}`);

  return sendSuccess(
    res,
    'Device token updated successfully.',
    {
      deviceId: device.device_id,
      isActive: Boolean(device.is_active),
      updatedAt: device.last_seen_at
    },
    200
  );
});

/**
 * Unregister a device on logout
 * POST /api/v1/devices/unregister
 */
const unregisterDevice = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { fcmToken, deviceId } = req.body;

  const deactivatedCount = await deviceModel.deactivateDevice({
    userId,
    fcmToken,
    deviceId
  });

  console.log(`[DEVICE UNREGISTER] User ${userId} deactivated ${deactivatedCount} device(s)`);

  return sendSuccess(
    res,
    'Device unregistered successfully.',
    {
      unregistered: true,
      deactivatedCount
    },
    200
  );
});

/**
 * Send a test push notification to the authenticated admin's active device
 * POST /api/v1/devices/test-notification
 * Strict security: Only allows targeting the authenticated admin's own active devices.
 */
const sendTestNotification = asyncHandler(async (req, res) => {
  const adminId = req.user.id;
  const { fcmToken, title, body } = req.body;

  // 1. Fetch active devices belonging exclusively to the authenticated admin
  const activeDevices = await deviceModel.getActiveDevicesForUser(adminId);

  if (!activeDevices || activeDevices.length === 0) {
    throw ApiError.badRequest(
      'No active registered devices found for your account. Please log in on the mobile app to register a device first.'
    );
  }

  // 2. Determine target token strictly from admin's own devices
  let targetToken = activeDevices[0].fcm_token;

  if (fcmToken) {
    const matched = activeDevices.find((d) => d.fcm_token === fcmToken);
    if (!matched) {
      throw ApiError.forbidden(
        'The specified FCM token is not registered as an active device for your account.'
      );
    }
    targetToken = matched.fcm_token;
  }

  // 3. Send test notification via Firebase Admin Messaging
  const result = await notificationService.sendPushNotification({
    token: targetToken,
    title: title || 'Mandhiragiri Jothidam',
    body: body || 'Push notification test successful!',
    data: {
      type: 'TEST_NOTIFICATION',
      sentAt: new Date().toISOString()
    }
  });

  return sendSuccess(
    res,
    'Test push notification sent successfully.',
    {
      messageId: result.messageId,
      maskedToken: result.maskedToken,
      targetDeviceCount: 1
    },
    200
  );
});

module.exports = {
  registerDevice,
  updateToken,
  unregisterDevice,
  sendTestNotification
};
