const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/database');
const bookingReminderService = require('../src/services/bookingReminderService');
const outboxProcessorService = require('../src/services/outboxProcessorService');
const pushWorkerService = require('../src/services/pushWorkerService');
const notificationModel = require('../src/models/notificationModel');
const { getQueueHealthData } = require('../scripts/monitorNotificationQueues');
const { NOTIFICATION_EVENTS, JOB_TYPES } = require('../src/constants/notificationConstants');

describe('Booking Reminders (24H, 1H, 5M) & FCM Push Diagnostics Tests', () => {

  describe('1. Reminder Schedule Calculations & Timezone Accuracy (Asia/Kolkata +05:30 -> UTC)', () => {
    it('calculates exact 24h, 1h, and 5m UTC trigger timestamps for an Asia/Kolkata booking', () => {
      // 15 Nov 2026, 8:30 PM IST (20:30) is 15 Nov 2026 15:00:00 UTC
      const dateKey = '2026-11-15';
      const startTime = '20:30:00';
      const now = new Date('2026-11-10T00:00:00.000Z');

      const schedule = bookingReminderService.calculateReminderSchedule({ dateKey, startTime, now });

      assert.equal(schedule.eventStart.toISOString(), '2026-11-15T15:00:00.000Z');
      assert.equal(schedule.scheduledAt24h.toISOString(), '2026-11-14T15:00:00.000Z');
      assert.equal(schedule.scheduledAt1h.toISOString(), '2026-11-15T14:00:00.000Z');
      assert.equal(schedule.scheduledAt5m.toISOString(), '2026-11-15T14:55:00.000Z');

      assert.equal(schedule.shouldSchedule24h, true);
      assert.equal(schedule.shouldSchedule1h, true);
      assert.equal(schedule.shouldSchedule5m, true);
    });

    it('edge case: booking created < 24h before start schedules ONLY 1h and 5m reminders', () => {
      // Booking at 20:30 IST (15:00 UTC); created at 12:00 UTC (3 hours before event)
      const dateKey = '2026-11-15';
      const startTime = '20:30:00';
      const now = new Date('2026-11-15T12:00:00.000Z'); // 3 hours before start

      const schedule = bookingReminderService.calculateReminderSchedule({ dateKey, startTime, now });

      assert.equal(schedule.shouldSchedule24h, false); // 24h in the past
      assert.equal(schedule.shouldSchedule1h, true);  // 1h in future (14:00 > 12:00)
      assert.equal(schedule.shouldSchedule5m, true);  // 5m in future (14:55 > 12:00)
    });

    it('edge case: booking created < 1h before start schedules ONLY 5m reminder', () => {
      // Created at 14:30 UTC (30 minutes before event)
      const dateKey = '2026-11-15';
      const startTime = '20:30:00';
      const now = new Date('2026-11-15T14:30:00.000Z');

      const schedule = bookingReminderService.calculateReminderSchedule({ dateKey, startTime, now });

      assert.equal(schedule.shouldSchedule24h, false);
      assert.equal(schedule.shouldSchedule1h, false);
      assert.equal(schedule.shouldSchedule5m, true); // 14:55 > 14:30
    });

    it('edge case: booking created < 5m before start or in past schedules zero reminders', () => {
      // Created at 14:58 UTC (2 minutes before event)
      const dateKey = '2026-11-15';
      const startTime = '20:30:00';
      const now = new Date('2026-11-15T14:58:00.000Z');

      const schedule = bookingReminderService.calculateReminderSchedule({ dateKey, startTime, now });

      assert.equal(schedule.shouldSchedule24h, false);
      assert.equal(schedule.shouldSchedule1h, false);
      assert.equal(schedule.shouldSchedule5m, false);
    });
  });

  describe('2. Idempotency Key Format & Database Scheduling', () => {
    it('scheduleBookingReminders inserts 3 reminder jobs with standardized keys', async () => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        const testBookingId = 999901;
        const testVersion = 2;
        const dateKey = '2026-12-25';
        const startTime = '10:00:00';
        const now = new Date('2026-12-01T00:00:00.000Z');

        const scheduledJobs = await bookingReminderService.scheduleBookingReminders(conn, {
          bookingId: testBookingId,
          dateKey,
          startTime,
          scheduleVersion: testVersion,
          placeholderUserId: 1,
          now
        });

        assert.equal(scheduledJobs.length, 3);
        assert.equal(scheduledJobs[0].idempotencyKey, `booking_${testBookingId}_version_${testVersion}_24H`);
        assert.equal(scheduledJobs[1].idempotencyKey, `booking_${testBookingId}_version_${testVersion}_1H`);
        assert.equal(scheduledJobs[2].idempotencyKey, `booking_${testBookingId}_version_${testVersion}_5M`);

        // Verify rows in database
        const [rows] = await conn.execute(
          `SELECT job_type, idempotency_key, status FROM notification_jobs WHERE entity_id = ? ORDER BY id ASC;`,
          [String(testBookingId)]
        );
        assert.equal(rows.length, 3);
        assert.equal(rows[0].job_type, 'BOOKING_24H_REMINDER');
        assert.equal(rows[1].job_type, 'BOOKING_1H_REMINDER');
        assert.equal(rows[2].job_type, 'BOOKING_5M_REMINDER');

        // Verify cancelBookingReminders cancels all 3
        const cancelledCount = await bookingReminderService.cancelBookingReminders(conn, {
          bookingId: testBookingId,
          reason: 'Booking rescheduled or cancelled'
        });
        assert.equal(cancelledCount, 3);

        const [cancelledRows] = await conn.execute(
          `SELECT status, last_error FROM notification_jobs WHERE entity_id = ?;`,
          [String(testBookingId)]
        );
        cancelledRows.forEach(r => {
          assert.equal(r.status, 'CANCELLED');
          assert.equal(r.last_error, 'Booking rescheduled or cancelled');
        });

        await conn.rollback();
      } finally {
        conn.release();
      }
    });
  });

  describe('3. Recipient Resolution Rules (Admins + Assigned Staff; NEVER Customers)', () => {
    it('resolveReminderRecipients includes all active Admins and assigned Priest, never customers', async () => {
      // Mock booking assigned to staff id 1
      const booking = {
        id: 501,
        priest_id: '1'
      };

      const recipients = await bookingReminderService.resolveReminderRecipients(booking);

      assert.ok(Array.isArray(recipients));
      assert.ok(recipients.length > 0);
      // Admin (user id 1) must be included
      assert.ok(recipients.includes(1));

      // Customer IDs (not in admin or staff table) are never present
      const customerUserId = 999999;
      assert.ok(!recipients.includes(customerUserId));
    });
  });

  describe('4. Invalidation on Rescheduling, Cancellation, and Completion', () => {
    it('processSingleReminderJob cancels stale reminder when booking schedule_version mismatch', async () => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Insert dummy booking with schedule_version = 2
        await conn.execute(`
          INSERT INTO bookings (id, booking_number, title, date_key, start_time, time_slot, schedule_version, status, is_deleted, created_by)
          VALUES (999902, 'BKG-STALE-01', 'Stale Test Pooja', '2026-11-20', '10:00:00', '10:00 AM', 2, 'confirmed', 0, 1)
          ON DUPLICATE KEY UPDATE schedule_version = 2, status = 'confirmed';
        `);

        // Insert dummy reminder job with stale schedule_version = 1
        const staleJobKey = 'booking_999902_version_1_5M';
        await conn.execute(`
          INSERT INTO notification_jobs (
            id, job_type, recipient_user_id, entity_type, entity_id, schedule_version,
            scheduled_at, status, lease_token, lease_expires_at, attempts, idempotency_key
          ) VALUES (
            999902, 'BOOKING_5M_REMINDER', 1, 'booking', '999902', 1,
            NOW() - INTERVAL 1 MINUTE, 'PROCESSING', 'worker-test-token', NOW() + INTERVAL 5 MINUTE, 1, ?
          ) ON DUPLICATE KEY UPDATE status = 'PROCESSING', lease_token = 'worker-test-token', lease_expires_at = NOW() + INTERVAL 5 MINUTE;
        `, [staleJobKey]);

        await conn.commit();

        const outcome = await bookingReminderService.processSingleReminderJob(
          { id: 999902, entity_id: '999902', schedule_version: 1, job_type: 'BOOKING_5M_REMINDER' },
          { workerLeaseToken: 'worker-test-token' }
        );

        assert.equal(outcome.status, 'CANCELLED');
        assert.ok(outcome.reason.includes('Stale reminder schedule_version'));

        // Verify no outbox event was created for the stale reminder
        const [outbox] = await pool.execute(
          `SELECT id FROM notification_outbox WHERE entity_id = '999902' AND event_type = 'BOOKING_5M_REMINDER';`
        );
        assert.equal(outbox.length, 0);

        // Cleanup
        await pool.execute('DELETE FROM notification_jobs WHERE id = 999902;');
        await pool.execute('DELETE FROM bookings WHERE id = 999902;');
      } finally {
        conn.release();
      }
    });

    it('processSingleReminderJob cancels reminder when booking is completed or cancelled', async () => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        await conn.execute(`
          INSERT INTO bookings (id, booking_number, title, date_key, start_time, time_slot, schedule_version, status, is_deleted, created_by)
          VALUES (999903, 'BKG-COMPLETED-01', 'Completed Pooja', '2026-11-20', '10:00:00', '10:00 AM', 1, 'completed', 0, 1)
          ON DUPLICATE KEY UPDATE status = 'completed';
        `);

        await conn.execute(`
          INSERT INTO notification_jobs (
            id, job_type, recipient_user_id, entity_type, entity_id, schedule_version,
            scheduled_at, status, lease_token, lease_expires_at, attempts, idempotency_key
          ) VALUES (
            999903, 'BOOKING_5M_REMINDER', 1, 'booking', '999903', 1,
            NOW() - INTERVAL 1 MINUTE, 'PROCESSING', 'worker-test-token-2', NOW() + INTERVAL 5 MINUTE, 1, 'booking_999903_version_1_5M'
          ) ON DUPLICATE KEY UPDATE status = 'PROCESSING', lease_token = 'worker-test-token-2', lease_expires_at = NOW() + INTERVAL 5 MINUTE;
        `);

        await conn.commit();

        const outcome = await bookingReminderService.processSingleReminderJob(
          { id: 999903, entity_id: '999903', schedule_version: 1, job_type: 'BOOKING_5M_REMINDER' },
          { workerLeaseToken: 'worker-test-token-2' }
        );

        assert.equal(outcome.status, 'CANCELLED');
        assert.ok(outcome.reason.includes('Booking already completed'));

        // Cleanup
        await pool.execute('DELETE FROM notification_jobs WHERE id = 999903;');
        await pool.execute('DELETE FROM bookings WHERE id = 999903;');
      } finally {
        conn.release();
      }
    });
  });

  describe('5. Bilingual Content Generation for BOOKING_5M_REMINDER', () => {
    it('generates bilingual Tamil & English notification content with urgent priority', () => {
      const payload = {
        bookingId: 88,
        bookingNumber: 'BKG-88',
        title: 'Ganapathi Homam',
        dateKey: '2026-11-15',
        timeSlot: '08:30 PM'
      };

      const content = outboxProcessorService.generateBilingualContent('BOOKING_5M_REMINDER', payload);

      assert.equal(content.titleEn, 'Booking Reminder (5 Minutes)');
      assert.ok(content.bodyEn.includes('BKG-88'));
      assert.ok(content.bodyEn.includes('begins in 5 minutes'));
      assert.equal(content.titleTa, 'முன்பதிவு நினைவூட்டல் (5 நிமிடங்கள்)');
      assert.ok(content.bodyTa.includes('5 நிமிடங்களில்'));
      assert.equal(content.priority, 'urgent');
    });
  });

  describe('6. Push Worker FCM Error Classification & Diagnostics', () => {
    it('distinguishes permanent device errors from server credential errors', () => {
      // 1. Permanent device errors (token dead or bad) -> deactivates token
      assert.equal(pushWorkerService.isPermanentDeviceError('messaging/registration-token-not-registered'), true);
      assert.equal(pushWorkerService.isPermanentDeviceError('messaging/invalid-registration-token'), true);
      assert.equal(pushWorkerService.isPermanentDeviceError('messaging/mismatched-credential'), false);
      assert.equal(pushWorkerService.isPermanentDeviceError('messaging/internal-error'), false);

      // 2. Server credential errors -> does NOT deactivate device token
      assert.equal(pushWorkerService.isServerCredentialError('messaging/mismatched-credential'), true);
      assert.equal(pushWorkerService.isServerCredentialError('messaging/authentication-error'), true);
      assert.equal(pushWorkerService.isServerCredentialError('messaging/registration-token-not-registered'), false);
    });

    it('processes push job and differentiates server credential error without deactivating device token', async () => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // 1. Insert dummy user device
        const [devRes] = await conn.execute(`
          INSERT INTO user_devices (user_id, fcm_token, device_id, platform, is_active, created_at, updated_at)
          VALUES (1, 'fcm_credential_test_token_12345', 'dev_cred_test_1', 'android', 1, NOW(), NOW())
          ON DUPLICATE KEY UPDATE is_active = 1;
        `);
        const dummyDeviceId = devRes.insertId;

        // 2. Insert dummy notification & push job
        const [notifRes] = await conn.execute(`
          INSERT INTO notifications (event_type, idempotency_key, title_en, body_en, title_ta, body_ta, entity_type, entity_id, priority, created_by, created_at)
          VALUES ('BOOKING_5M_REMINDER', 'notif_test_cred_diag', 'Test 5M', 'Body 5M', 'தலைப்பு', 'உரை', 'booking', '999905', 'urgent', 1, NOW());
        `);
        const dummyNotifId = notifRes.insertId;

        const [jobRes] = await conn.execute(`
          INSERT INTO notification_jobs (
            job_type, notification_id, recipient_user_id, entity_type, entity_id,
            schedule_version, scheduled_at, status, lease_token, lease_expires_at, attempts, idempotency_key
          ) VALUES (
            'PUSH_DELIVERY', ?, 1, 'booking', '999905', 1,
            NOW(), 'PROCESSING', 'cred-worker-lease', NOW() + INTERVAL 5 MINUTE, 1, 'push_test_cred_diag'
          );
        `, [dummyNotifId]);
        const dummyJobId = jobRes.insertId;

        await conn.commit();

        // 3. Mock FCM client that throws messaging/mismatched-credential
        const mockFcmClient = {
          send: async () => {
            const err = new Error("Permission 'cloudmessaging.messages.create' denied on resource");
            err.code = 'messaging/mismatched-credential';
            throw err;
          }
        };

        const jobRecord = {
          id: dummyJobId,
          notification_id: dummyNotifId,
          recipient_user_id: 1,
          entity_type: 'booking',
          entity_id: '999905',
          event_type: 'BOOKING_5M_REMINDER',
          title_en: 'Test 5M',
          body_en: 'Body 5M',
          title_ta: 'தலைப்பு',
          body_ta: 'உரை',
          attempts: 1
        };

        const result = await pushWorkerService.processSinglePushJob(jobRecord, {
          workerLeaseToken: 'cred-worker-lease',
          fcmClient: mockFcmClient
        });

        // 4. Verify: Device token must REMAIN ACTIVE (is_active = 1) because it was a server IAM error!
        const [deviceCheck] = await pool.execute(
          `SELECT is_active FROM user_devices WHERE fcm_token = 'fcm_credential_test_token_12345';`
        );
        assert.equal(deviceCheck[0].is_active, 1);

        // Verify delivery is PENDING retry (not permanently FAILED)
        const [deliveryCheck] = await pool.execute(
          `SELECT status, last_error FROM notification_device_deliveries WHERE job_id = ?;`,
          [dummyJobId]
        );
        assert.equal(deliveryCheck[0].status, 'PENDING');
        assert.ok(deliveryCheck[0].last_error.includes('Server Credential Error'));

        // Cleanup
        await pool.execute('DELETE FROM notification_device_deliveries WHERE job_id = ?;', [dummyJobId]);
        await pool.execute('DELETE FROM notification_jobs WHERE id = ?;', [dummyJobId]);
        await pool.execute('DELETE FROM notifications WHERE id = ?;', [dummyNotifId]);
        await pool.execute('DELETE FROM user_devices WHERE fcm_token = "fcm_credential_test_token_12345";');
      } finally {
        conn.release();
      }
    });
  });

  describe('7. Admin Diagnostic Report & Queue Health', () => {
    it('getQueueHealthData returns comprehensive FCM status, device mapping, and error metrics', async () => {
      const data = await getQueueHealthData();

      assert.ok(data.timestamp);
      assert.ok(data.fcm_config);
      assert.equal(data.fcm_config.initialized, true);
      assert.equal(data.fcm_config.project_id, 'mandhiragiri-jothidam');
      assert.ok(data.devices);
      assert.ok(typeof data.devices.total === 'number');
      assert.ok(typeof data.devices.active === 'number');
      assert.ok(Array.isArray(data.recent_errors));
    });
  });

  after(async () => {
    await closePool();
  });
});
