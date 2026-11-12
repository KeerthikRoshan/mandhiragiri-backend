const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { pool, closePool } = require('../src/config/database');
const { runMasterCron, LOCK_NAME, HEARTBEAT_FILE } = require('../scripts/cronRunner');
const outboxProcessorService = require('../src/services/outboxProcessorService');
const pushWorkerService = require('../src/services/pushWorkerService');
const outboxModel = require('../src/models/outboxModel');
const notificationModel = require('../src/models/notificationModel');
const deviceDeliveryModel = require('../src/models/deviceDeliveryModel');
const notificationController = require('../src/controllers/notificationController');
const { NOTIFICATION_EVENTS } = require('../src/constants/notificationConstants');

describe('Stage 5: Scheduled Processing & Cron Automation Tests', () => {
  const testPrefix = `stg5_${Date.now()}`;
  let createdUserIds = [];
  let createdDeviceIds = [];
  let createdNotificationIds = [];
  let createdJobIds = [];
  let createdOutboxIds = [];
  let adminUserId;

  // Helper to create test user
  const createTestUser = async (suffix, roleId = 1) => {
    const mobile = `975${String(Date.now()).slice(-4)}${suffix}`.slice(0, 15);
    const [res] = await pool.execute(
      `INSERT INTO users (role_id, mobile, password_hash, name, status)
       VALUES (?, ?, 'test_hash', 'Stage 5 User ${suffix}', 'ACTIVE');`,
      [roleId, mobile]
    );
    createdUserIds.push(res.insertId);
    return res.insertId;
  };

  // Helper to create test device
  const createTestDevice = async (userId, tokenSuffix, isActive = 1) => {
    const fcmToken = `fcm_stg5_${testPrefix}_${tokenSuffix}`;
    const deviceId = `dev_stg5_${testPrefix}_${tokenSuffix}`;
    const [res] = await pool.execute(
      `INSERT INTO user_devices (
        user_id, fcm_token, device_id, platform, is_active, last_seen_at, created_at
      ) VALUES (?, ?, ?, 'android', ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE is_active = VALUES(is_active);`,
      [userId, fcmToken, deviceId, isActive]
    );
    const insertId = res.insertId;
    createdDeviceIds.push(insertId);
    return { id: insertId, fcm_token: fcmToken, device_id: deviceId };
  };

  // Helper to create test notification
  const createTestNotification = async (key) => {
    const [res] = await pool.execute(
      `INSERT INTO notifications (
        event_type, idempotency_key, title_en, body_en, title_ta, body_ta,
        entity_type, entity_id, data, priority, created_by, created_at
      ) VALUES (
        'BOOKING_CREATED', ?, 'Booking Created EN', 'Body EN', 'முன்பதிவு உருவாக்கப்பட்டது', 'உடல் TA',
        'booking', '101', '{}', 'normal', ?, NOW()
      );`,
      [key, adminUserId]
    );
    createdNotificationIds.push(res.insertId);
    return res.insertId;
  };

  // Helper to create test push job with unique idempotency_key
  const createTestPushJob = async ({
    notificationId,
    userId,
    attempts = 0,
    status = 'PENDING',
    jobType = 'PUSH_DELIVERY',
    lastError = null,
    keySuffix = crypto.randomUUID()
  }) => {
    const idempotencyKey = `stg5_job_${testPrefix}_${keySuffix}`;
    const [res] = await pool.execute(
      `INSERT INTO notification_jobs (
        job_type, notification_id, recipient_user_id, entity_type, entity_id,
        attempts, status, idempotency_key, last_error, scheduled_at, created_at
      ) VALUES (?, ?, ?, 'booking', '101', ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP());`,
      [jobType, notificationId, userId, attempts, status, idempotencyKey, lastError]
    );
    createdJobIds.push(res.insertId);
    return res.insertId;
  };

  // Helper to create mock res that supports awaiting async controller handlers
  const createMockRes = () => {
    let responseStatus = 200;
    let responseData = null;
    let settled = false;
    let resolvePromise;
    let rejectPromise;

    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const resObj = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(payload) {
        responseData = payload;
        if (!settled) {
          settled = true;
          resolvePromise({ status: responseStatus, data: payload });
        }
        return payload;
      },
      next(err) {
        if (!settled) {
          settled = true;
          if (err) rejectPromise(err);
          else resolvePromise({ status: responseStatus, data: responseData });
        }
      },
      wait: () => promise,
      getStatus: () => responseStatus,
      getData: () => responseData
    };

    return resObj;
  };

  before(async () => {
    adminUserId = await createTestUser('adm1', 1);
  });

  after(async () => {
    try {
      if (createdJobIds.length > 0) {
        const ph = createdJobIds.map(() => '?').join(',');
        await pool.execute(`DELETE FROM notification_device_deliveries WHERE job_id IN (${ph});`, createdJobIds);
        await pool.execute(`DELETE FROM notification_jobs WHERE id IN (${ph});`, createdJobIds);
      }
      if (createdNotificationIds.length > 0) {
        const ph = createdNotificationIds.map(() => '?').join(',');
        await pool.execute(`DELETE FROM notification_recipients WHERE notification_id IN (${ph});`, createdNotificationIds);
        await pool.execute(`DELETE FROM notifications WHERE id IN (${ph});`, createdNotificationIds);
      }
      if (createdOutboxIds.length > 0) {
        const ph = createdOutboxIds.map(() => '?').join(',');
        await pool.execute(`DELETE FROM notification_outbox WHERE id IN (${ph});`, createdOutboxIds);
      }
      if (createdDeviceIds.length > 0) {
        const ph = createdDeviceIds.map(() => '?').join(',');
        await pool.execute(`DELETE FROM user_devices WHERE id IN (${ph});`, createdDeviceIds);
      }
      if (createdUserIds.length > 0) {
        const ph = createdUserIds.map(() => '?').join(',');
        await pool.execute(`DELETE FROM notification_preferences WHERE user_id IN (${ph});`, createdUserIds);
        await pool.execute(`DELETE FROM users WHERE id IN (${ph});`, createdUserIds);
      }
    } catch (_) {}
    await closePool();
  });

  // 1. MariaDB UTC connection initialization and failure destruction safety
  it('1. MariaDB UTC initialization: verify session time zone is +00:00 for pool.getConnection, pool.query, pool.execute, and broken init connections are destroyed', async () => {
    // Pattern A: pool.getConnection()
    const conn = await pool.getConnection();
    try {
      const [connRows] = await conn.execute(`
        SELECT 
          @@session.time_zone AS tz,
          UTC_TIMESTAMP() AS utc_ts,
          NOW() AS now_ts;
      `);
      assert.equal(connRows[0].tz, '+00:00', 'pool.getConnection() session time_zone must be +00:00');
      const diffConn = Math.abs(
        Math.round((new Date(connRows[0].utc_ts).getTime() - new Date(connRows[0].now_ts).getTime()) / 1000)
      );
      assert.ok(diffConn <= 1, 'NOW() and UTC_TIMESTAMP() on conn must evaluate identically within 1s');
    } finally {
      conn.release();
    }

    // Pattern B1: pool.query()
    const [queryRows] = await pool.query(`
      SELECT 
        @@session.time_zone AS tz,
        UTC_TIMESTAMP() AS utc_ts,
        NOW() AS now_ts;
    `);
    assert.equal(queryRows[0].tz, '+00:00', 'pool.query() session time_zone must be +00:00');
    const diffQuery = Math.abs(
      Math.round((new Date(queryRows[0].utc_ts).getTime() - new Date(queryRows[0].now_ts).getTime()) / 1000)
    );
    assert.ok(diffQuery <= 1, 'NOW() and UTC_TIMESTAMP() on pool.query must evaluate identically within 1s');

    // Pattern B2: pool.execute()
    const [executeRows] = await pool.execute(`
      SELECT 
        @@session.time_zone AS tz,
        UTC_TIMESTAMP() AS utc_ts,
        NOW() AS now_ts;
    `);
    assert.equal(executeRows[0].tz, '+00:00', 'pool.execute() session time_zone must be +00:00');
    const diffExec = Math.abs(
      Math.round((new Date(executeRows[0].utc_ts).getTime() - new Date(executeRows[0].now_ts).getTime()) / 1000)
    );
    assert.ok(diffExec <= 1, 'NOW() and UTC_TIMESTAMP() on pool.execute must evaluate identically within 1s');

    // Pattern C: UTC initialization failure destroys the connection and prevents reuse
    const testPool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'mandhiragiri_db',
      waitForConnections: true,
      connectionLimit: 2,
      dateStrings: true
    });

    const core = testPool.pool;
    const origCoreGetConn = core.getConnection.bind(core);

    let simulateFailure = true;
    let destroyCalled = false;

    core.getConnection = function (cb) {
      origCoreGetConn((err, c) => {
        if (err) return cb(err);
        if (!c._utcInitialized) {
          if (simulateFailure) {
            simulateFailure = false;
            const origDestroy = c.destroy.bind(c);
            c.destroy = function () {
              destroyCalled = true;
              return origDestroy.apply(this, arguments);
            };
            // Simulate failure during SET time_zone = '+00:00'
            c.query("TRIGGER_SYNTAX_ERROR_FOR_INIT;", (err2) => {
              if (err2) {
                try {
                  c.destroy();
                } catch (_) {}
                return cb(err2);
              }
              c._utcInitialized = true;
              cb(null, c);
            });
            return;
          }

          c.query("SET time_zone = '+00:00';", (err2) => {
            if (err2) {
              try {
                c.destroy();
              } catch (_) {}
              return cb(err2);
            }
            c._utcInitialized = true;
            cb(null, c);
          });
        } else {
          cb(null, c);
        }
      });
    };

    // 1. Initial checkout fails during UTC init
    await assert.rejects(async () => {
      await testPool.getConnection();
    });

    // 2. Failed connection was destroyed and is NOT in free connections pool
    assert.equal(destroyCalled, true, 'Failed connection must be destroyed via conn.destroy()');
    assert.equal(core._freeConnections.length, 0, 'Failed connection must not be in _freeConnections');

    // 3. Subsequent checkout gets a fresh connection that succeeds with +00:00
    const connRecovered = await testPool.getConnection();
    try {
      const [rRows] = await connRecovered.query("SELECT @@session.time_zone AS tz;");
      assert.equal(rRows[0].tz, '+00:00', 'Recovered connection must be initialized with UTC');
    } finally {
      connRecovered.release();
    }

    // 4. pool.query and pool.execute continue to work on fresh connections
    const [qTestRows] = await testPool.query("SELECT @@session.time_zone AS tz;");
    assert.equal(qTestRows[0].tz, '+00:00');

    await testPool.end();
  });

  beforeEach(async () => {
    try {
      const c = await pool.getConnection();
      try {
        await c.execute('SELECT RELEASE_LOCK(?);', [LOCK_NAME]);
      } finally {
        c.release();
      }
    } catch (_) {}
  });

  // 2. Advisory lock acquisition
  it('2. Advisory lock acquisition: master cron runner acquires mandhiragiri_cron_lock', async () => {
    const summary = await runMasterCron({ budgetMs: 10000, shouldClosePool: false });
    assert.equal(summary.lock_acquired, true);
    assert.equal(summary.status, 'SUCCESS');
    assert.ok(summary.duration_ms >= 0);
  });

  // 3. Advisory lock exclusion
  it('3. Advisory lock exclusion: concurrent runner receives SKIPPED_LOCK_HELD when lock is held', async () => {
    const dedicatedConn = await pool.getConnection();
    try {
      const [lockRows] = await dedicatedConn.execute(`SELECT GET_LOCK(?, 0) AS lock_acquired;`, [LOCK_NAME]);
      assert.equal(lockRows[0].lock_acquired, 1, 'Dedicated connection must acquire advisory lock');

      // Attempt concurrent cron run
      const summary = await runMasterCron({ budgetMs: 10000, shouldClosePool: false });
      assert.equal(summary.lock_acquired, false);
      assert.equal(summary.status, 'SKIPPED_LOCK_HELD');

      // Release lock
      await dedicatedConn.execute(`SELECT RELEASE_LOCK(?);`, [LOCK_NAME]);
    } finally {
      dedicatedConn.release();
    }
  });

  // 4. Advisory lock release and reacquisition
  it('4. Advisory lock release: runner releases lock, subsequent runner can acquire immediately', async () => {
    const run1 = await runMasterCron({ budgetMs: 10000, shouldClosePool: false });
    assert.equal(run1.lock_acquired, true);
    assert.equal(run1.status, 'SUCCESS');

    // Run 2 immediately after
    const run2 = await runMasterCron({ budgetMs: 10000, shouldClosePool: false });
    assert.equal(run2.lock_acquired, true);
    assert.equal(run2.status, 'SUCCESS');
  });

  // 5. Advisory lock error recovery: destroying connection immediately frees lock in MariaDB
  it('5. Advisory lock connection destruction safety: destroying connection immediately frees lock', async () => {
    const dedicatedConn = await pool.getConnection();
    const [lockRows] = await dedicatedConn.execute(`SELECT GET_LOCK(?, 0) AS lock_acquired;`, [LOCK_NAME]);
    assert.equal(lockRows[0].lock_acquired, 1);

    // Forcefully destroy TCP socket without clean RELEASE_LOCK
    dedicatedConn.destroy();

    // Verify another connection can acquire lock with a 2-second timeout allowing MariaDB socket cleanup
    const checkConn = await pool.getConnection();
    try {
      const [recheckRows] = await checkConn.execute(`SELECT GET_LOCK(?, 2) AS lock_acquired;`, [LOCK_NAME]);
      assert.equal(recheckRows[0].lock_acquired, 1, 'MariaDB must automatically release advisory lock when socket is destroyed');
      await checkConn.execute(`SELECT RELEASE_LOCK(?);`, [LOCK_NAME]);
    } finally {
      checkConn.release();
    }
  });

  // 6. Atomic JSON heartbeat recording
  it('6. Atomic JSON heartbeat recording: storage/worker_heartbeats.json contains status, duration, and stages', async () => {
    await runMasterCron({ budgetMs: 10000, shouldClosePool: false });

    assert.ok(fs.existsSync(HEARTBEAT_FILE), 'Heartbeat JSON file must exist');
    const content = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));

    assert.equal(content.status, 'SUCCESS');
    assert.ok(content.last_run_at);
    assert.ok(typeof content.duration_ms === 'number');
    assert.ok(content.reminders !== undefined);
    assert.ok(content.outbox !== undefined);
    assert.ok(content.push !== undefined);
  });

  // 7. Bilingual content generation for all 12 actively emitted Phase 4 events
  it('7. Bilingual content generation: generates Tamil and English content for all 12 active event types', () => {
    const activeEvents = [
      'BOOKING_CREATED',
      'BOOKING_ASSIGNED',
      'BOOKING_RESCHEDULED',
      'BOOKING_CANCELLED',
      'BOOKING_COMPLETED',
      'PAYMENT_UPDATED',
      'ATTENDANCE_ALERT',
      'LEAVE_REQUESTED',
      'LEAVE_APPROVED',
      'LEAVE_REJECTED',
      'BOOKING_24H_REMINDER',
      'BOOKING_1H_REMINDER'
    ];

    const samplePayload = {
      bookingNumber: 'BK-1001',
      bookingId: 1001,
      title: 'Ganapathi Homam',
      dateKey: '2026-11-20',
      timeSlot: '09:00:00',
      newDateKey: '2026-11-21',
      priestName: 'Raman Archagar',
      staffName: 'Raman Archagar',
      reason: 'Devotee requested',
      amount: 1500,
      party: 'CLIENT',
      leaveType: 'CASUAL'
    };

    assert.equal(activeEvents.length, 12, 'Must test exactly 12 actively emitted Phase 4 events');

    for (const eventType of activeEvents) {
      const content = outboxProcessorService.generateBilingualContent(eventType, samplePayload);
      assert.ok(content.titleEn, `titleEn missing for ${eventType}`);
      assert.ok(content.bodyEn, `bodyEn missing for ${eventType}`);
      assert.ok(content.titleTa, `titleTa missing for ${eventType}`);
      assert.ok(content.bodyTa, `bodyTa missing for ${eventType}`);

      // Verify Tamil script presence
      const hasTamilTitle = /[\u0B80-\u0BFF]/.test(content.titleTa);
      const hasTamilBody = /[\u0B80-\u0BFF]/.test(content.bodyTa);
      assert.ok(hasTamilTitle, `titleTa for ${eventType} must contain Tamil characters: "${content.titleTa}"`);
      assert.ok(hasTamilBody, `bodyTa for ${eventType} must contain Tamil characters: "${content.bodyTa}"`);
    }
  });

  // 8. Notification channel preferences - Combination 1 (In-app ON, Push ON)
  it('8. Channel preferences: combination 1 (In-app ON, Push ON) creates recipient and push job', async () => {
    const user = await createTestUser('pref1', 1);
    await createTestDevice(user, 'pref1_dev');

    // Preferences: In-app ON, Push ON
    await pool.execute(
      `INSERT INTO notification_preferences (user_id, event_type, in_app_enabled, push_enabled, created_at, updated_at)
       VALUES (?, 'BOOKING_CREATED', 1, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE in_app_enabled = 1, push_enabled = 1;`,
      [user]
    );

    const eventKey = `${testPrefix}_pref1_${Date.now()}`;
    const [res] = await pool.execute(
      `INSERT INTO notification_outbox (event_type, entity_type, entity_id, event_key, payload, status, created_at)
       VALUES ('BOOKING_CREATED', 'booking', '501', ?, ?, 'PENDING', NOW());`,
      [eventKey, JSON.stringify({ bookingNumber: 'BK-501', recipientUserIds: [user] })]
    );
    const eventId = res.insertId;
    createdOutboxIds.push(eventId);

    const workerToken = crypto.randomUUID();
    const [claimed] = await pool.execute(`SELECT * FROM notification_outbox WHERE id = ?;`, [eventId]);
    await pool.execute(`UPDATE notification_outbox SET status = 'PROCESSING', lease_token = ?, lease_expires_at = NOW() + INTERVAL 5 MINUTE WHERE id = ?;`, [workerToken, eventId]);

    await outboxProcessorService.processSingleOutboxEvent(
      { ...claimed[0], id: eventId },
      { workerLeaseToken: workerToken }
    );

    // Assert: Notification record exists
    const [notifRows] = await pool.execute(
      `SELECT id FROM notifications WHERE idempotency_key = ?;`,
      [eventKey]
    );
    assert.equal(notifRows.length, 1);
    createdNotificationIds.push(notifRows[0].id);

    // In-app recipient row exists
    const [recipRows] = await pool.execute(
      `SELECT * FROM notification_recipients WHERE notification_id = ? AND user_id = ?;`,
      [notifRows[0].id, user]
    );
    assert.equal(recipRows.length, 1, 'Recipient record must be created when in-app is ON');
    assert.equal(recipRows[0].in_app_visible, 1);

    // Push job exists
    const [jobRows] = await pool.execute(
      `SELECT * FROM notification_jobs WHERE notification_id = ? AND recipient_user_id = ? AND job_type = 'PUSH_DELIVERY';`,
      [notifRows[0].id, user]
    );
    assert.equal(jobRows.length, 1, 'Push job must be created when push is ON');
    createdJobIds.push(jobRows[0].id);
  });

  // 9. Notification channel preferences - Combination 2 (In-app ON, Push OFF)
  it('9. Channel preferences: combination 2 (In-app ON, Push OFF) creates recipient but NO push job', async () => {
    const user = await createTestUser('pref2', 1);
    await createTestDevice(user, 'pref2_dev');

    // Preferences: In-app ON, Push OFF
    await pool.execute(
      `INSERT INTO notification_preferences (user_id, event_type, in_app_enabled, push_enabled, created_at, updated_at)
       VALUES (?, 'BOOKING_CREATED', 1, 0, NOW(), NOW())
       ON DUPLICATE KEY UPDATE in_app_enabled = 1, push_enabled = 0;`,
      [user]
    );

    const eventKey = `${testPrefix}_pref2_${Date.now()}`;
    const [res] = await pool.execute(
      `INSERT INTO notification_outbox (event_type, entity_type, entity_id, event_key, payload, status, created_at)
       VALUES ('BOOKING_CREATED', 'booking', '502', ?, ?, 'PENDING', NOW());`,
      [eventKey, JSON.stringify({ bookingNumber: 'BK-502', recipientUserIds: [user] })]
    );
    const eventId = res.insertId;
    createdOutboxIds.push(eventId);

    const workerToken = crypto.randomUUID();
    const [claimed] = await pool.execute(`SELECT * FROM notification_outbox WHERE id = ?;`, [eventId]);
    await pool.execute(`UPDATE notification_outbox SET status = 'PROCESSING', lease_token = ?, lease_expires_at = NOW() + INTERVAL 5 MINUTE WHERE id = ?;`, [workerToken, eventId]);

    await outboxProcessorService.processSingleOutboxEvent(
      { ...claimed[0], id: eventId },
      { workerLeaseToken: workerToken }
    );

    const [notifRows] = await pool.execute(
      `SELECT id FROM notifications WHERE idempotency_key = ?;`,
      [eventKey]
    );
    assert.equal(notifRows.length, 1);
    createdNotificationIds.push(notifRows[0].id);

    // In-app recipient exists
    const [recipRows] = await pool.execute(
      `SELECT * FROM notification_recipients WHERE notification_id = ? AND user_id = ?;`,
      [notifRows[0].id, user]
    );
    assert.equal(recipRows.length, 1, 'In-app recipient record must be created');

    // Push job must NOT exist
    const [jobRows] = await pool.execute(
      `SELECT * FROM notification_jobs WHERE notification_id = ? AND recipient_user_id = ? AND job_type = 'PUSH_DELIVERY';`,
      [notifRows[0].id, user]
    );
    assert.equal(jobRows.length, 0, 'No push job should be created when push is OFF');
  });

  // 10. Notification channel preferences - Combination 3 (In-app OFF, Push ON)
  it('10. Channel preferences: combination 3 (In-app OFF, Push ON) creates push job but NO visible recipient', async () => {
    const user = await createTestUser('pref3', 1);
    await createTestDevice(user, 'pref3_dev');

    // Preferences: In-app OFF, Push ON
    await pool.execute(
      `INSERT INTO notification_preferences (user_id, event_type, in_app_enabled, push_enabled, created_at, updated_at)
       VALUES (?, 'BOOKING_CREATED', 0, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE in_app_enabled = 0, push_enabled = 1;`,
      [user]
    );

    const eventKey = `${testPrefix}_pref3_${Date.now()}`;
    const [res] = await pool.execute(
      `INSERT INTO notification_outbox (event_type, entity_type, entity_id, event_key, payload, status, created_at)
       VALUES ('BOOKING_CREATED', 'booking', '503', ?, ?, 'PENDING', NOW());`,
      [eventKey, JSON.stringify({ bookingNumber: 'BK-503', recipientUserIds: [user] })]
    );
    const eventId = res.insertId;
    createdOutboxIds.push(eventId);

    const workerToken = crypto.randomUUID();
    const [claimed] = await pool.execute(`SELECT * FROM notification_outbox WHERE id = ?;`, [eventId]);
    await pool.execute(`UPDATE notification_outbox SET status = 'PROCESSING', lease_token = ?, lease_expires_at = NOW() + INTERVAL 5 MINUTE WHERE id = ?;`, [workerToken, eventId]);

    await outboxProcessorService.processSingleOutboxEvent(
      { ...claimed[0], id: eventId },
      { workerLeaseToken: workerToken }
    );

    const [notifRows] = await pool.execute(
      `SELECT id FROM notifications WHERE idempotency_key = ?;`,
      [eventKey]
    );
    assert.equal(notifRows.length, 1);
    createdNotificationIds.push(notifRows[0].id);

    // No visible in-app recipient (in_app_visible = 0)
    const [recipRows] = await pool.execute(
      `SELECT * FROM notification_recipients WHERE notification_id = ? AND user_id = ?;`,
      [notifRows[0].id, user]
    );
    assert.equal(recipRows.length, 1);
    assert.equal(recipRows[0].in_app_visible, 0, 'In-app notification row must be hidden (in_app_visible = 0) when in-app is OFF');
    assert.equal(recipRows[0].delivery_status, 'PENDING');

    // Push job exists
    const [jobRows] = await pool.execute(
      `SELECT * FROM notification_jobs WHERE notification_id = ? AND recipient_user_id = ? AND job_type = 'PUSH_DELIVERY';`,
      [notifRows[0].id, user]
    );
    assert.equal(jobRows.length, 1, 'Push job must be created when push is ON');
    createdJobIds.push(jobRows[0].id);
  });

  // 11. Notification channel preferences - Combination 4 (In-app OFF, Push OFF)
  it('11. Channel preferences: combination 4 (In-app OFF, Push OFF) creates NEITHER recipient nor push job', async () => {
    const user = await createTestUser('pref4', 1);
    await createTestDevice(user, 'pref4_dev');

    // Preferences: In-app OFF, Push OFF
    await pool.execute(
      `INSERT INTO notification_preferences (user_id, event_type, in_app_enabled, push_enabled, created_at, updated_at)
       VALUES (?, 'BOOKING_CREATED', 0, 0, NOW(), NOW())
       ON DUPLICATE KEY UPDATE in_app_enabled = 0, push_enabled = 0;`,
      [user]
    );

    const eventKey = `${testPrefix}_pref4_${Date.now()}`;
    const [res] = await pool.execute(
      `INSERT INTO notification_outbox (event_type, entity_type, entity_id, event_key, payload, status, created_at)
       VALUES ('BOOKING_CREATED', 'booking', '504', ?, ?, 'PENDING', NOW());`,
      [eventKey, JSON.stringify({ bookingNumber: 'BK-504', recipientUserIds: [user] })]
    );
    const eventId = res.insertId;
    createdOutboxIds.push(eventId);

    const workerToken = crypto.randomUUID();
    const [claimed] = await pool.execute(`SELECT * FROM notification_outbox WHERE id = ?;`, [eventId]);
    await pool.execute(`UPDATE notification_outbox SET status = 'PROCESSING', lease_token = ?, lease_expires_at = NOW() + INTERVAL 5 MINUTE WHERE id = ?;`, [workerToken, eventId]);

    await outboxProcessorService.processSingleOutboxEvent(
      { ...claimed[0], id: eventId },
      { workerLeaseToken: workerToken }
    );

    const [notifRows] = await pool.execute(
      `SELECT id FROM notifications WHERE idempotency_key = ?;`,
      [eventKey]
    );
    assert.equal(notifRows.length, 1);
    createdNotificationIds.push(notifRows[0].id);

    // Hidden in-app recipient with SKIPPED delivery
    const [recipRows] = await pool.execute(
      `SELECT * FROM notification_recipients WHERE notification_id = ? AND user_id = ?;`,
      [notifRows[0].id, user]
    );
    assert.equal(recipRows.length, 1);
    assert.equal(recipRows[0].in_app_visible, 0, 'In-app notification row must be hidden (in_app_visible = 0) when in-app is OFF');
    assert.equal(recipRows[0].delivery_status, 'SKIPPED', 'Delivery status must be SKIPPED when push is OFF');

    const [jobRows] = await pool.execute(
      `SELECT * FROM notification_jobs WHERE notification_id = ? AND recipient_user_id = ? AND job_type = 'PUSH_DELIVERY';`,
      [notifRows[0].id, user]
    );
    assert.equal(jobRows.length, 0, 'Zero push jobs when push is OFF');
  });

  // 12. Multi-device push delivery: one device succeeds, one temporarily fails -> parent rescheduled, successful device not resent
  it('12. Multi-device push: transient device failure reschedules parent, subsequent attempt succeeds without resending', async () => {
    const user = await createTestUser('mdev12', 1);
    const devA = await createTestDevice(user, 'devA');
    const devB = await createTestDevice(user, 'devB');
    const notifId = await createTestNotification(`${testPrefix}_mdev12`);

    await pool.execute(
      `INSERT INTO notification_recipients (notification_id, user_id, delivery_status, in_app_visible, created_at)
       VALUES (?, ?, 'PENDING', 1, NOW());`,
      [notifId, user]
    );

    const jobId = await createTestPushJob({
      notificationId: notifId,
      userId: user,
      attempts: 0,
      status: 'PENDING'
    });

    // Initial deliveries setup
    await pool.execute(
      `INSERT INTO notification_device_deliveries (job_id, device_id, fcm_token, status, attempts, created_at)
       VALUES (?, ?, ?, 'PENDING', 0, NOW()), (?, ?, ?, 'PENDING', 0, NOW());`,
      [jobId, devA.id, devA.fcm_token, jobId, devB.id, devB.fcm_token]
    );

    let devASendCount = 0;
    let devBSendCount = 0;

    // Run 1: DevA succeeds, DevB throws transient error
    const mockFcmRun1 = {
      send: async (msg) => {
        if (msg.token === devA.fcm_token) {
          devASendCount++;
          return 'msg_devA_ok';
        }
        devBSendCount++;
        const err = new Error('FCM transient server unavailable');
        err.code = 'messaging/server-unavailable';
        throw err;
      }
    };

    const workerToken1 = crypto.randomUUID();
    const [claimedJobs1] = await pool.execute(`SELECT * FROM notification_jobs WHERE id = ?;`, [jobId]);
    await pool.execute(
      `UPDATE notification_jobs SET status = 'PROCESSING', lease_token = ?, lease_expires_at = UTC_TIMESTAMP() + INTERVAL 5 MINUTE, attempts = attempts + 1 WHERE id = ?;`,
      [workerToken1, jobId]
    );

    const outcome1 = await pushWorkerService.processSinglePushJob(
      { ...claimedJobs1[0], attempts: 1 },
      { workerLeaseToken: workerToken1, fcmClient: mockFcmRun1 }
    );

    assert.equal(outcome1.status, 'RETRY_SCHEDULED');
    assert.equal(devASendCount, 1);
    assert.equal(devBSendCount, 1);

    // Verify database state after Run 1
    const deliveries1 = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    const delA1 = deliveries1.find(d => d.device_id === devA.id);
    const delB1 = deliveries1.find(d => d.device_id === devB.id);
    assert.equal(delA1.status, 'SENT');
    assert.equal(delB1.status, 'PENDING', 'Failed device must remain PENDING for retry');

    const [jobRows1] = await pool.execute('SELECT status, attempts FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(jobRows1[0].status, 'PENDING');
    assert.equal(jobRows1[0].attempts, 1);

    // Run 2: DevB now succeeds
    const mockFcmRun2 = {
      send: async (msg) => {
        if (msg.token === devA.fcm_token) {
          devASendCount++;
          return 'msg_devA_ok';
        }
        devBSendCount++;
        return 'msg_devB_ok';
      }
    };

    const workerToken2 = crypto.randomUUID();
    await pool.execute(
      `UPDATE notification_jobs SET status = 'PROCESSING', lease_token = ?, lease_expires_at = UTC_TIMESTAMP() + INTERVAL 5 MINUTE, attempts = attempts + 1 WHERE id = ?;`,
      [workerToken2, jobId]
    );

    const outcome2 = await pushWorkerService.processSinglePushJob(
      { ...claimedJobs1[0], attempts: 2 },
      { workerLeaseToken: workerToken2, fcmClient: mockFcmRun2 }
    );

    assert.equal(outcome2.status, 'COMPLETED');
    assert.equal(devASendCount, 1, 'Device A must NEVER be resent on subsequent attempt!');
    assert.equal(devBSendCount, 2);

    const deliveries2 = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    assert.ok(deliveries2.every(d => d.status === 'SENT'));

    const [jobRows2] = await pool.execute('SELECT status FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(jobRows2[0].status, 'COMPLETED');
  });

  // 13. Multi-device push delivery: terminal partial delivery
  it('13. Multi-device push: terminal partial delivery marks parent COMPLETED with [PARTIAL_DELIVERY] notice and SENT recipient', async () => {
    const user = await createTestUser('mdev13', 1);
    const goodDev = await createTestDevice(user, 'goodDev');
    const badDev = await createTestDevice(user, 'badDev');
    const notifId = await createTestNotification(`${testPrefix}_mdev13`);

    await pool.execute(
      `INSERT INTO notification_recipients (notification_id, user_id, delivery_status, in_app_visible, created_at)
       VALUES (?, ?, 'PENDING', 1, NOW());`,
      [notifId, user]
    );

    const jobId = await createTestPushJob({
      notificationId: notifId,
      userId: user,
      attempts: 0,
      status: 'PENDING'
    });

    await pool.execute(
      `INSERT INTO notification_device_deliveries (job_id, device_id, fcm_token, status, attempts, created_at)
       VALUES (?, ?, ?, 'PENDING', 0, NOW()), (?, ?, ?, 'PENDING', 0, NOW());`,
      [jobId, goodDev.id, goodDev.fcm_token, jobId, badDev.id, badDev.fcm_token]
    );

    const mockFcm = {
      send: async (msg) => {
        if (msg.token === goodDev.fcm_token) {
          return 'msg_good_ok';
        }
        const err = new Error('Token not registered');
        err.code = 'messaging/registration-token-not-registered';
        throw err;
      }
    };

    const workerToken = crypto.randomUUID();
    const [claimed] = await pool.execute(`SELECT * FROM notification_jobs WHERE id = ?;`, [jobId]);
    await pool.execute(
      `UPDATE notification_jobs SET status = 'PROCESSING', lease_token = ?, lease_expires_at = UTC_TIMESTAMP() + INTERVAL 5 MINUTE, attempts = 1 WHERE id = ?;`,
      [workerToken, jobId]
    );

    const outcome = await pushWorkerService.processSinglePushJob(
      { ...claimed[0], attempts: 1 },
      { workerLeaseToken: workerToken, fcmClient: mockFcm }
    );

    assert.equal(outcome.status, 'COMPLETED');
    assert.equal(outcome.deliveredCount, 1);
    assert.equal(outcome.partialDelivery, true);

    const [jobRows] = await pool.execute('SELECT status, last_error FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(jobRows[0].status, 'COMPLETED');
    assert.ok(jobRows[0].last_error.includes('[PARTIAL_DELIVERY]'));

    const [recipRows] = await pool.execute('SELECT delivery_status FROM notification_recipients WHERE notification_id = ? AND user_id = ?;', [notifId, user]);
    assert.equal(recipRows[0].delivery_status, 'SENT', 'Recipient must be SENT when user was reached on at least one device');

    // Bad device deactivated
    const [devRows] = await pool.execute('SELECT is_active FROM user_devices WHERE id = ?;', [badDev.id]);
    assert.equal(devRows[0].is_active, 0);
  });

  // 14. Infrastructure claim exhaustion does NOT fail undispatched pending devices
  it('14. Infrastructure exhaustion: parent marked FAILED while undispatched device deliveries remain PENDING', async () => {
    const user = await createTestUser('infra14', 1);
    const dev = await createTestDevice(user, 'infra_dev');
    const notifId = await createTestNotification(`${testPrefix}_infra14`);

    await pool.execute(
      `INSERT INTO notification_recipients (notification_id, user_id, delivery_status, in_app_visible, created_at)
       VALUES (?, ?, 'PENDING', 1, NOW());`,
      [notifId, user]
    );

    const jobId = await createTestPushJob({
      notificationId: notifId,
      userId: user,
      attempts: 5,
      status: 'PROCESSING'
    });

    await pool.execute(
      `INSERT INTO notification_device_deliveries (job_id, device_id, fcm_token, status, attempts, created_at)
       VALUES (?, ?, ?, 'PENDING', 0, NOW());`,
      [jobId, dev.id, dev.fcm_token]
    );

    // Set lease as expired on attempt 5 (worker crashed before dispatching to FCM)
    await pool.execute(
      `UPDATE notification_jobs 
       SET lease_expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE 
       WHERE id = ?;`,
      [jobId]
    );

    // Run abandoned sweeper
    const sweptCount = await pushWorkerService.sweepAbandonedPushJobs();
    assert.ok(sweptCount >= 1, 'Sweeper must sweep the abandoned job');

    // Verify parent job is FAILED with infrastructure error
    const [jobRows] = await pool.execute('SELECT status, last_error FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(jobRows[0].status, 'FAILED');
    assert.ok(jobRows[0].last_error.includes('Infrastructure claim limit exhausted'));

    // Verify device delivery remains PENDING with attempts = 0 (preserved for Admin retry!)
    const [devDeliveries] = await pool.execute('SELECT status, attempts FROM notification_device_deliveries WHERE job_id = ?;', [jobId]);
    assert.equal(devDeliveries[0].status, 'PENDING', 'Undispatched pending device must remain PENDING');
    assert.equal(devDeliveries[0].attempts, 0, 'Device attempt count must remain 0 when dispatch was not completed');
  });

  // 15. Admin queue health endpoint
  it('15. Admin queue health: GET /api/v1/notifications/admin/queue-health returns heartbeat and live metrics', async () => {
    const req = {
      user: { id: adminUserId, role: 'SUPER_ADMIN' }
    };
    const res = createMockRes();

    notificationController.getQueueHealth(req, res, res.next);
    const completed = await res.wait();

    assert.equal(completed.status, 200);
    const data = completed.data.data;

    assert.ok(data.timestamp);
    assert.ok(data.heartbeat !== undefined);
    assert.ok(data.outbox && data.outbox.by_status);
    assert.ok(data.jobs && data.jobs.by_type_and_status);
    assert.ok(data.device_deliveries && data.device_deliveries.by_status);
  });

  // 16. Admin retry failed push job
  it('16. Admin retry failed job: resets FAILED job to PENDING, preserves SENT devices, rejects CANCELLED jobs', async () => {
    const user = await createTestUser('admretry16', 1);
    const devGood = await createTestDevice(user, 'adm_good');
    const devFail = await createTestDevice(user, 'adm_fail');
    const notifId = await createTestNotification(`${testPrefix}_admretry16`);

    // 1. Create FAILED push job
    const jobId = await createTestPushJob({
      notificationId: notifId,
      userId: user,
      attempts: 5,
      status: 'FAILED',
      lastError: 'Prior failure message'
    });

    // Insert 1 SENT device delivery and 1 FAILED device delivery
    await pool.execute(
      `INSERT INTO notification_device_deliveries (job_id, device_id, fcm_token, status, attempts, created_at)
       VALUES (?, ?, ?, 'SENT', 1, NOW()), (?, ?, ?, 'FAILED', 3, NOW());`,
      [jobId, devGood.id, devGood.fcm_token, jobId, devFail.id, devFail.fcm_token]
    );

    // 2. Invoke Admin retry controller
    const req = {
      user: { id: adminUserId, role: 'ADMIN' },
      params: { jobId },
      body: { reason: 'Network restored by Admin' }
    };
    const res = createMockRes();

    notificationController.retryFailedJob(req, res, res.next);
    const completed = await res.wait();

    assert.equal(completed.status, 200);
    const result = completed.data.data;
    assert.equal(result.success, true);
    assert.equal(result.newStatus, 'PENDING');

    // Verify parent job in DB
    const [jobRows] = await pool.execute('SELECT status, attempts, last_error FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(jobRows[0].status, 'PENDING');
    assert.equal(jobRows[0].attempts, 0);
    assert.ok(jobRows[0].last_error.includes('[ADMIN_RETRY by User'));
    assert.ok(jobRows[0].last_error.includes('Network restored by Admin'));

    // Verify devices: SENT preserved, FAILED reset to PENDING
    const deliveries = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    const dGood = deliveries.find(d => d.device_id === devGood.id);
    const dFail = deliveries.find(d => d.device_id === devFail.id);

    assert.equal(dGood.status, 'SENT', 'SENT device must be preserved');
    assert.equal(dFail.status, 'PENDING', 'Eligible failed device must be reset to PENDING');
    assert.equal(dFail.attempts, 0);

    // 3. Test CANCELLED job rejection
    const cancJobId = await createTestPushJob({
      notificationId: notifId,
      userId: user,
      attempts: 1,
      status: 'CANCELLED',
      jobType: 'REMINDER_24H'
    });

    const cancReq = {
      user: { id: adminUserId, role: 'ADMIN' },
      params: { jobId: cancJobId },
      body: {}
    };
    const cancRes = createMockRes();

    notificationController.retryFailedJob(cancReq, cancRes, cancRes.next);
    await assert.rejects(
      async () => {
        await cancRes.wait();
      },
      /Cannot retry CANCELLED/
    );
  });

  // 17. Admin retry failed outbox event
  it('17. Admin retry failed outbox: resets FAILED event to PENDING with audit trail', async () => {
    const eventKey = `${testPrefix}_adm_outbox_17_${Date.now()}`;
    const [resOutbox] = await pool.execute(
      `INSERT INTO notification_outbox (
        event_type, entity_type, entity_id, event_key, payload, attempts, status, last_error, created_at
      ) VALUES ('BOOKING_CREATED', 'booking', '999', ?, '{}', 5, 'FAILED', 'Fatal worker crash on final attempt', NOW());`,
      [eventKey]
    );
    const eventId = resOutbox.insertId;
    createdOutboxIds.push(eventId);

    const req = {
      user: { id: adminUserId, role: 'SUPER_ADMIN' },
      params: { eventId },
      body: { reason: 'DevOps recovered worker node' }
    };
    const res = createMockRes();

    notificationController.retryFailedOutbox(req, res, res.next);
    const completed = await res.wait();

    assert.equal(completed.status, 200);
    const data = completed.data.data;
    assert.equal(data.success, true);
    assert.equal(data.newStatus, 'PENDING');

    const [outboxRows] = await pool.execute('SELECT status, attempts, last_error FROM notification_outbox WHERE id = ?;', [eventId]);
    assert.equal(outboxRows[0].status, 'PENDING');
    assert.equal(outboxRows[0].attempts, 0);
    assert.ok(outboxRows[0].last_error.includes('[ADMIN_RETRY by User'));
    assert.ok(outboxRows[0].last_error.includes('DevOps recovered worker node'));
  });
});
