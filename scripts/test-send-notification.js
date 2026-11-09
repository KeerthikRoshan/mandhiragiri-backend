/**
 * Standalone CLI Test Script to verify FCM Push Notifications
 * Usage:
 *   node scripts/test-send-notification.js [optional_fcm_token]
 *
 * If no token is provided as an argument, it automatically fetches
 * the most recently active device token from the user_devices table.
 */

const dotenv = require('dotenv');
dotenv.config();

const { messaging } = require('../src/config/firebase');
const { pool } = require('../src/config/database');
const { maskToken } = require('../src/services/notificationService');

async function runTest() {
  let targetToken = process.argv[2];

  if (!targetToken) {
    console.log('[Test Script] No token provided via CLI argument. Querying latest active device from database...');
    try {
      const [rows] = await pool.query(
        'SELECT fcm_token, user_id, platform, device_id, last_seen_at FROM user_devices WHERE is_active = 1 ORDER BY last_seen_at DESC LIMIT 1;'
      );

      if (rows.length === 0) {
        console.error('❌ No active registered devices found in user_devices table.');
        console.error('👉 Please log in to the mobile application first to register a device token, or provide a token:');
        console.error('   node scripts/test-send-notification.js <FCM_TOKEN>');
        process.exit(1);
      }

      targetToken = rows[0].fcm_token;
      console.log(`[Test Script] Found active device for User ID: ${rows[0].user_id} (${rows[0].platform || 'android'})`);
    } catch (dbErr) {
      console.error('❌ Could not query database:', dbErr.message);
      console.error('👉 Please provide token explicitly: node scripts/test-send-notification.js <FCM_TOKEN>');
      process.exit(1);
    }
  }

  console.log(`[Test Script] Sending test notification to: ${maskToken(targetToken)}`);

  const message = {
    token: targetToken,
    notification: {
      title: 'Mandhiragiri Jothidam',
      body: 'Push notification test successful!'
    },
    data: {
      type: 'TEST_NOTIFICATION',
      sentAt: new Date().toISOString()
    }
  };

  try {
    const messageId = await messaging.send(message);
    console.log('\n========================================');
    console.log('✅ FCM PUSH NOTIFICATION SENT SUCCESSFULLY!');
    console.log(`Message ID: ${messageId}`);
    console.log(`Target Token: ${maskToken(targetToken)}`);
    console.log('========================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n========================================');
    console.error('❌ FAILED TO SEND PUSH NOTIFICATION');
    console.error(`Error Code: ${err.code || 'UNKNOWN'}`);
    console.error(`Error Message: ${err.message}`);
    console.error('========================================\n');
    process.exit(1);
  }
}

runTest();
