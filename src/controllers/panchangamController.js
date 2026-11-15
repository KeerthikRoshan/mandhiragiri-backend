/**
 * Daily Panchangam Controller - Mandhiragiri Jothidam
 * Endpoint: GET /api/v1/panchangam/daily
 * Strict rules:
 * - Current date (today) in Asia/Kolkata automatically determined by server
 * - Location: Tiruppur only (Fixed)
 * - Language: Tamil (Default & Preferred)
 * - Provider: OneBhakthi API with MySQL temporary daily cache
 * - No date or location parameters accepted
 */

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const panchangamService = require('../services/panchangamService');

/**
 * GET /api/v1/panchangam/daily
 * Public access: Both mobile Admin and Staff dashboards and full view screen
 */
const getDailyPanchangam = asyncHandler(async (req, res) => {
  const panchangam = await panchangamService.getDailyPanchangam();
  return sendSuccess(res, 'Daily Panchangam retrieved successfully.', panchangam);
});

module.exports = {
  getDailyPanchangam
};
