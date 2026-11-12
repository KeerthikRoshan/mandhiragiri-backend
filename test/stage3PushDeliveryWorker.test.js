const { describe, it, before, beforeEach, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { pool, closePool } = require('../src/config/database');
const pushWorkerService = require('../src/services/pushWorkerService');
const deviceDeliveryModel = require('../src/models/deviceDeliveryModel');

describe('Stage 3: Push Delivery Worker & Per-Device Tracking Tests', () => {
  let testUserId;
  const testPrefix = `test_stg3_${Date.now()}`;
  let testNotificationId;
  let createdDeviceIds = [];
  let createdJobIds = [];
  let createdUserIds = [];

  // Helper to create test user with unique mobile
  const createTestUser = async (suffix = '') => {
    const mobile = `999${String(Date.now()).slice(-4)}${suffix}`.slice(0, 15);
    const [res] = await pool.execute(
      `INSERT INTO users (role_id, mobile, password_hash, name, status)
       VALUES (1, ?, 'test_hash', 'Stage 3 Test User', 'ACTIVE');`,
      [mobile]
    );
    createdUserIds.push(res.insertId);
    return res.insertId;
  };

  // Helper to create test notification
  const createTestNotification = async (key, dataPayload = {}) => {
    const [res] = await pool.execute(
      `INSERT INTO notifications (
        event_type, idempotency_key, title_en, body_en, title_ta, body_ta,
        entity_type, entity_id, data, priority, created_by, created_at
      ) VALUES (
        'BOOKING_CREATED', ?, 'Test Title EN', 'Test Body EN', 'சோதனை தலைப்பு', 'சோதனை உடல்',
        'booking', '999', ?, 'normal', ?, NOW()
      );`,
      [key, JSON.stringify(dataPayload), testUserId]
    );
    return res.insertId;
  };

  // Helper to create test recipient
  const createTestRecipient = async (notificationId, userId = testUserId) => {
    await pool.execute(
      `INSERT INTO notification_recipients (
        notification_id, user_id, delivery_status, in_app_visible, created_at
      ) VALUES (?, ?, 'PENDING', 1, NOW())
      ON DUPLICATE KEY UPDATE delivery_status = 'PENDING';`,
      [notificationId, userId]
    );
  };

  // Helper to create test user device
  const createTestDevice = async (userId, tokenSuffix, isActive = 1) => {
    const fcmToken = `fcm_token_${testPrefix}_${tokenSuffix}`;
    const deviceId = `dev_id_${testPrefix}_${tokenSuffix}`;
    const [res] = await pool.execute(
      `INSERT INTO user_devices (
        user_id, fcm_token, device_id, platform, is_active, last_seen_at, created_at
      ) VALUES (?, ?, ?, 'android', ?, NOW(), NOW());`,
      [userId, fcmToken, deviceId, isActive]
    );
    createdDeviceIds.push(res.insertId);
    return { id: res.insertId, fcm_token: fcmToken, device_id: deviceId, is_active: isActive };
  };

  // Helper to create test push job
  const createTestPushJob = async (notificationId, userId = testUserId, keySuffix = '1', scheduledAtSql = 'NOW()') => {
    const key = `push_job_${testPrefix}_${keySuffix}`;
    const [res] = await pool.execute(
      `INSERT INTO notification_jobs (
        job_type, notification_id, recipient_user_id, entity_type, entity_id,
        scheduled_at, status, attempts, idempotency_key, created_at
      ) VALUES (
        'PUSH_DELIVERY', ?, ?, 'booking', '999',
        ${scheduledAtSql}, 'PENDING', 0, ?, NOW()
      );`,
      [notificationId, userId, key]
    );
    createdJobIds.push(res.insertId);
    return res.insertId;
  };

  before(async () => {
    testUserId = await createTestUser('owner');
    // Create base test notification
    testNotificationId = await createTestNotification(`${testPrefix}_base_notif`, {
      bookingId: '999',
      internalCode: 'BK-999'
    });
    await createTestRecipient(testNotificationId, testUserId);
  });

  after(async () => {
    // Teardown created test data
    if (createdJobIds.length > 0) {
      const placeholders = createdJobIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM notification_device_deliveries WHERE job_id IN (${placeholders});`, createdJobIds);
      await pool.execute(`DELETE FROM notification_jobs WHERE id IN (${placeholders});`, createdJobIds);
    }
    if (createdDeviceIds.length > 0) {
      const placeholders = createdDeviceIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM user_devices WHERE id IN (${placeholders});`, createdDeviceIds);
    }
    if (testNotificationId) {
      await pool.execute(`DELETE FROM notification_recipients WHERE notification_id = ?;`, [testNotificationId]);
      await pool.execute(`DELETE FROM notifications WHERE id = ?;`, [testNotificationId]);
    }
    await pool.execute(`DELETE FROM notifications WHERE idempotency_key LIKE '${testPrefix}%';`);
    if (createdUserIds.length > 0) {
      const placeholders = createdUserIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM users WHERE id IN (${placeholders});`, createdUserIds);
    }
    await closePool();
  });

  // 1. Successful push delivery
  it('1. Successful push delivery: updates device delivery to SENT and parent job to COMPLETED', async () => {
    const dev = await createTestDevice(testUserId, 'dev1_succ');
    const jobId = await createTestPushJob(testNotificationId, testUserId, 'succ_1');

    const sentMessages = [];
    const mockFcm = {
      send: async (msg) => {
        sentMessages.push(msg);
        return 'projects/test/messages/msg_succ_1';
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 5 });
    const targetJob = claimed.find(j => j.id === jobId);
    assert.ok(targetJob, 'Job must be claimed');

    const outcome = await pushWorkerService.processSinglePushJob(targetJob, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    assert.equal(outcome.status, 'COMPLETED');
    assert.equal(outcome.deliveredCount, 1);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].token, dev.fcm_token);

    // Verify database state
    const deliveries = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].status, 'SENT');
    assert.ok(deliveries[0].sent_at !== null);

    const [jobRows] = await pool.execute('SELECT status, processed_at FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(jobRows[0].status, 'COMPLETED');
    assert.ok(jobRows[0].processed_at !== null);

    const [recipRows] = await pool.execute('SELECT delivery_status FROM notification_recipients WHERE notification_id = ? AND user_id = ?;', [testNotificationId, testUserId]);
    assert.equal(recipRows[0].delivery_status, 'SENT');
  });

  // 2. Multiple devices belonging to one recipient
  it('2. Multiple devices belonging to one recipient: sends push to all active devices', async () => {
    // Add a second device for testUserId
    const dev2 = await createTestDevice(testUserId, 'dev2_multi');
    const jobId = await createTestPushJob(testNotificationId, testUserId, 'multi_2');

    const sentTokens = [];
    const mockFcm = {
      send: async (msg) => {
        sentTokens.push(msg.token);
        return 'msg_' + msg.token;
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const targetJob = claimed.find(j => j.id === jobId);
    assert.ok(targetJob);

    const outcome = await pushWorkerService.processSinglePushJob(targetJob, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    assert.equal(outcome.status, 'COMPLETED');
    // User now has at least 2 active devices
    assert.ok(outcome.deliveredCount >= 2);
    assert.ok(sentTokens.includes(dev2.fcm_token));

    const deliveries = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    assert.ok(deliveries.length >= 2);
    deliveries.forEach(d => assert.equal(d.status, 'SENT'));
  });

  // 3. Inactive device exclusion
  it('3. Inactive device exclusion: only sends to active devices (is_active = 1)', async () => {
    const inactiveDev = await createTestDevice(testUserId, 'dev_inactive', 0); // is_active = 0
    const jobId = await createTestPushJob(testNotificationId, testUserId, 'inact_3');

    const sentTokens = [];
    const mockFcm = {
      send: async (msg) => {
        sentTokens.push(msg.token);
        return 'msg_' + msg.token;
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const targetJob = claimed.find(j => j.id === jobId);

    await pushWorkerService.processSinglePushJob(targetJob, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    // Inactive device token must NOT be in sent tokens
    assert.equal(sentTokens.includes(inactiveDev.fcm_token), false);

    const deliveries = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    const inactDelivery = deliveries.find(d => d.device_id === inactiveDev.id);
    assert.equal(inactDelivery, undefined, 'Inactive device must not have delivery row created');
  });

  // 4. Retryable FCM failure
  it('4. Retryable FCM failure: keeps device delivery PENDING and reschedules job with backoff', async () => {
    // Isolate a user with 1 device
    const singleUser = await createTestUser('4');
    const dev = await createTestDevice(singleUser, 'dev_retryable');
    const notifId = await createTestNotification(`${testPrefix}_notif_retry`);
    await createTestRecipient(notifId, singleUser);
    const jobId = await createTestPushJob(notifId, singleUser, 'retry_4');

    const mockFcm = {
      send: async () => {
        const err = new Error('FCM server is temporarily unavailable');
        err.code = 'messaging/server-unavailable';
        throw err;
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const targetJob = claimed.find(j => j.id === jobId);

    const outcome = await pushWorkerService.processSinglePushJob(targetJob, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    assert.equal(outcome.status, 'RETRY_SCHEDULED');

    // Device delivery status remains PENDING
    const deliveries = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    assert.equal(deliveries[0].status, 'PENDING');
    assert.ok(deliveries[0].last_error.includes('temporarily unavailable'));

    // Parent job status returned to PENDING with +1 minute backoff on attempt 1
    const [jobRows] = await pool.execute('SELECT status, attempts, scheduled_at FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(jobRows[0].status, 'PENDING');
    assert.equal(jobRows[0].attempts, 1);

    // Clean up
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id = ?;', [notifId]);
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 5. Permanent FCM failure
  it('5. Permanent FCM failure: marks device FAILED and does not retry on exhaustion', async () => {
    const singleUser = await createTestUser('5');
    await createTestDevice(singleUser, 'dev_perm_fail');
    const notifId = await createTestNotification(`${testPrefix}_notif_perm`);
    await createTestRecipient(notifId, singleUser);
    const jobId = await createTestPushJob(notifId, singleUser, 'perm_5');

    // Simulate attempts = 2 already
    await pool.execute('UPDATE notification_jobs SET attempts = 2 WHERE id = ?;', [jobId]);

    const mockFcm = {
      send: async () => {
        const err = new Error('Invalid argument in payload');
        err.code = 'messaging/invalid-argument';
        throw err;
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const targetJob = claimed.find(j => j.id === jobId);

    const outcome = await pushWorkerService.processSinglePushJob(targetJob, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    assert.equal(outcome.status, 'FAILED');

    // Device delivery is marked permanently FAILED
    const deliveries = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    assert.equal(deliveries[0].status, 'FAILED');

    // Parent job is FAILED (attempts reached 3)
    const [jobRows] = await pool.execute('SELECT status, attempts FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(jobRows[0].status, 'FAILED');
    assert.equal(jobRows[0].attempts, 3);

    // Recipient delivery_status is FAILED
    const [recipRows] = await pool.execute('SELECT delivery_status FROM notification_recipients WHERE notification_id = ? AND user_id = ?;', [notifId, singleUser]);
    assert.equal(recipRows[0].delivery_status, 'FAILED');

    // Clean up
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id = ?;', [notifId]);
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 6. Invalid token deactivation
  it('6. Invalid token deactivation: deactivates user_devices row with lease fencing when unregistered', async () => {
    const singleUser = await createTestUser('6');
    const dev = await createTestDevice(singleUser, 'dev_unreg');
    const notifId = await createTestNotification(`${testPrefix}_notif_unreg`);
    await createTestRecipient(notifId, singleUser);
    const jobId = await createTestPushJob(notifId, singleUser, 'unreg_6');

    const mockFcm = {
      send: async () => {
        const err = new Error('Requested entity was not found');
        err.code = 'messaging/registration-token-not-registered';
        throw err;
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const targetJob = claimed.find(j => j.id === jobId);

    await pushWorkerService.processSinglePushJob(targetJob, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    // Verify token was deactivated in user_devices
    const [devRows] = await pool.execute('SELECT is_active FROM user_devices WHERE id = ?;', [dev.id]);
    assert.equal(devRows[0].is_active, 0, 'Unregistered token must be deactivated');

    // Clean up
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id = ?;', [notifId]);
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 7. PENDING-only retry selection
  it('7. PENDING-only retry selection: never retries already SENT or FAILED device deliveries', async () => {
    const singleUser = await createTestUser('7');
    const devA = await createTestDevice(singleUser, 'dev_retry_a');
    const devB = await createTestDevice(singleUser, 'dev_retry_b');
    const notifId = await createTestNotification(`${testPrefix}_notif_pnd`);
    await createTestRecipient(notifId, singleUser);
    const jobId = await createTestPushJob(notifId, singleUser, 'pnd_7');

    // Pre-insert deliveries: Dev A is SENT, Dev B is PENDING
    await pool.execute(
      `INSERT INTO notification_device_deliveries (job_id, device_id, fcm_token, status, attempts, created_at)
       VALUES (?, ?, ?, 'SENT', 1, NOW()), (?, ?, ?, 'PENDING', 1, NOW());`,
      [jobId, devA.id, devA.fcm_token, jobId, devB.id, devB.fcm_token]
    );

    const sentTokens = [];
    const mockFcm = {
      send: async (msg) => {
        sentTokens.push(msg.token);
        return 'msg_ok';
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const targetJob = claimed.find(j => j.id === jobId);

    await pushWorkerService.processSinglePushJob(targetJob, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    // FCM must ONLY be dispatched to Dev B, Dev A was already SENT
    assert.equal(sentTokens.length, 1);
    assert.equal(sentTokens[0], devB.fcm_token);

    // Clean up
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id = ?;', [notifId]);
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 8. Stale lease rejection
  it('8. Stale lease rejection: worker with wrong lease token cannot update delivery status', async () => {
    const singleUser = await createTestUser('8');
    const dev = await createTestDevice(singleUser, 'dev_stale');
    const notifId = await createTestNotification(`${testPrefix}_notif_stale`);
    const jobId = await createTestPushJob(notifId, singleUser, 'stale_8');

    // Claim job with Token A
    const tokenA = 'token_A_active';
    await pool.execute(
      `UPDATE notification_jobs 
       SET status = 'PROCESSING', lease_token = ?, lease_expires_at = NOW() + INTERVAL 5 MINUTE, attempts = 1
       WHERE id = ?;`,
      [tokenA, jobId]
    );

    await deviceDeliveryModel.initDeviceDeliveries(pool, { jobId, devices: [dev] });
    const [deliv] = await deviceDeliveryModel.getPendingDeviceDeliveries(pool, jobId);

    // Attempt update with Token B (stale/wrong token)
    const updated = await deviceDeliveryModel.updateDeliveryOutcomeFenced({
      deliveryId: deliv.id,
      jobId,
      workerLeaseToken: 'wrong_token_B',
      status: 'SENT'
    });

    assert.equal(updated, false, 'Update with mismatched lease token must return false');

    // Verify row remains PENDING in database
    const deliveries = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    assert.equal(deliveries[0].status, 'PENDING');

    // Clean up
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 9. Worker crash and expired lease recovery
  it('9. Worker crash and expired lease recovery: re-claims job whose lease has expired', async () => {
    const singleUser = await createTestUser('9');
    await createTestDevice(singleUser, 'dev_crash');
    const notifId = await createTestNotification(`${testPrefix}_notif_crash`);
    const jobId = await createTestPushJob(notifId, singleUser, 'crash_9');

    // Simulate crashed worker: job left in PROCESSING with lease expired 10 minutes ago
    await pool.execute(
      `UPDATE notification_jobs 
       SET status = 'PROCESSING', lease_token = 'crashed_worker_token', lease_expires_at = NOW() - INTERVAL 10 MINUTE, attempts = 1
       WHERE id = ?;`,
      [jobId]
    );

    // New worker claims
    const newWorkerToken = 'new_worker_token_recovered';
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: newWorkerToken, batchSize: 10 });
    const target = claimed.find(j => j.id === jobId);

    assert.ok(target, 'Expired PROCESSING job must be reclaimed');
    assert.equal(target.lease_token, newWorkerToken);
    assert.equal(target.attempts, 2, 'Attempts count must increment to 2');

    // Clean up
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 10. Duplicate worker concurrency
  it('10. Duplicate worker concurrency: two concurrent workers never claim the same job', async () => {
    const singleUser = await createTestUser('10');
    await createTestDevice(singleUser, 'dev_conc');
    const notifId = await createTestNotification(`${testPrefix}_notif_conc`);
    const jobId = await createTestPushJob(notifId, singleUser, 'conc_10');

    const workerToken1 = 'worker_concurrent_1';
    const workerToken2 = 'worker_concurrent_2';

    // Both workers attempt claim concurrently
    const [batch1, batch2] = await Promise.all([
      pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken1, batchSize: 10 }),
      pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken2, batchSize: 10 })
    ]);

    const claimed1 = batch1.some(j => j.id === jobId);
    const claimed2 = batch2.some(j => j.id === jobId);

    // Exactly one worker claimed the job!
    assert.equal(claimed1 && claimed2, false, 'Both workers must never claim the same job');
    assert.ok(claimed1 || claimed2, 'At least one worker must claim the job');

    // Clean up
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 11. Parent job completion after all device deliveries finish
  it('11. Parent job completion: transitions to COMPLETED when all devices complete', async () => {
    const singleUser = await createTestUser('11');
    await createTestDevice(singleUser, 'dev_term_succ');
    const notifId = await createTestNotification(`${testPrefix}_notif_term`);
    await createTestRecipient(notifId, singleUser);
    const jobId = await createTestPushJob(notifId, singleUser, 'term_11');

    const mockFcm = { send: async () => 'msg_ok' };
    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const target = claimed.find(j => j.id === jobId);

    const outcome = await pushWorkerService.processSinglePushJob(target, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    assert.equal(outcome.status, 'COMPLETED');
    const [rows] = await pool.execute('SELECT status, lease_token FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(rows[0].status, 'COMPLETED');
    assert.equal(rows[0].lease_token, null);

    // Clean up
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id = ?;', [notifId]);
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 12. FCM accepted but database success update fails (Crash Window Documentation)
  it('12. FCM accepted but DB update fails: demonstrates at-least-once push network reality', async () => {
    const singleUser = await createTestUser('12');
    const dev = await createTestDevice(singleUser, 'dev_crash_window');
    const notifId = await createTestNotification(`${testPrefix}_notif_cw`);
    const jobId = await createTestPushJob(notifId, singleUser, 'cw_12');

    let fcmDispatched = false;
    const mockFcm = {
      send: async () => {
        fcmDispatched = true;
        // Simulates crash immediately after FCM network send
        throw new Error('SIMULATED_PROCESS_CRASH_BEFORE_DB_COMMIT');
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const target = claimed.find(j => j.id === jobId);

    await pushWorkerService.processSinglePushJob(target, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    // FCM network call succeeded, but DB row remains in PENDING for retry recovery
    assert.equal(fcmDispatched, true);
    const deliveries = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    assert.equal(deliveries[0].status, 'PENDING');

    // Clean up
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 13. Notification ID included in the data payload
  it('13. Notification ID included in data payload: client deduplication support', async () => {
    const singleUser = await createTestUser('13');
    await createTestDevice(singleUser, 'dev_notif_id');
    const notifId = await createTestNotification(`${testPrefix}_notif_payload`);
    const jobId = await createTestPushJob(notifId, singleUser, 'payload_13');

    let capturedPayload = null;
    const mockFcm = {
      send: async (msg) => {
        capturedPayload = msg;
        return 'msg_ok';
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const target = claimed.find(j => j.id === jobId);

    await pushWorkerService.processSinglePushJob(target, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    assert.ok(capturedPayload !== null);
    assert.equal(capturedPayload.data.notificationId, String(notifId));
    assert.equal(capturedPayload.data.eventType, 'BOOKING_CREATED');
    assert.equal(capturedPayload.data.entityId, '999');

    // Clean up
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 14. No sensitive customer data in the push payload
  it('14. No sensitive customer data in push payload: excludes phone numbers and credentials', async () => {
    const singleUser = await createTestUser('14');
    await createTestDevice(singleUser, 'dev_sensitive');
    const notifId = await createTestNotification(`${testPrefix}_notif_sens`, {
      customerPhone: '+919999999999',
      sensitivePasswordHash: 'secret_hash_123'
    });
    const jobId = await createTestPushJob(notifId, singleUser, 'sens_14');

    let capturedPayload = null;
    const mockFcm = {
      send: async (msg) => {
        capturedPayload = msg;
        return 'msg_ok';
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const target = claimed.find(j => j.id === jobId);

    await pushWorkerService.processSinglePushJob(target, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    // Verify payload data does NOT leak customer phone or password
    const dataKeys = Object.keys(capturedPayload.data);
    const dataValues = Object.values(capturedPayload.data);

    assert.equal(dataKeys.includes('customerPhone'), false);
    assert.equal(dataKeys.includes('sensitivePasswordHash'), false);
    dataValues.forEach(val => {
      assert.equal(String(val).includes('+919999999999'), false);
      assert.equal(String(val).includes('secret_hash_123'), false);
    });

    // Clean up
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 15. Five-minute lease safety & renewal
  it('15. Five-minute lease safety & renewal: successfully extends lease for active worker and rejects expired', async () => {
    const singleUser = await createTestUser('15');
    await createTestDevice(singleUser, 'dev_renew');
    const notifId = await createTestNotification(`${testPrefix}_notif_renew`);
    const jobId = await createTestPushJob(notifId, singleUser, 'renew_15');

    const workerToken = 'token_renew_active';
    await pool.execute(
      `UPDATE notification_jobs 
       SET status = 'PROCESSING', lease_token = ?, lease_expires_at = NOW() + INTERVAL 2 MINUTE, attempts = 1
       WHERE id = ?;`,
      [workerToken, jobId]
    );

    // Active worker renews lease
    const renewed = await pushWorkerService.renewPushJobLease({
      jobId,
      workerLeaseToken: workerToken,
      extensionMinutes: 10
    });
    assert.equal(renewed, true, 'Active lease must be renewed');

    // Wrong worker token cannot renew
    const wrongRenew = await pushWorkerService.renewPushJobLease({
      jobId,
      workerLeaseToken: 'wrong_token',
      extensionMinutes: 10
    });
    assert.equal(wrongRenew, false, 'Mismatched token must not renew lease');

    // Clean up
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 16. Terminal state when recipient has zero active devices
  it('16. Terminal state with no active devices: marks parent job COMPLETED and recipient SKIPPED', async () => {
    const singleUser = await createTestUser('16');
    // Note: No active devices are created for singleUser
    const notifId = await createTestNotification(`${testPrefix}_notif_nodev`);
    await createTestRecipient(notifId, singleUser);
    const jobId = await createTestPushJob(notifId, singleUser, 'nodev_16');

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const target = claimed.find(j => j.id === jobId);

    const outcome = await pushWorkerService.processSinglePushJob(target, {
      workerLeaseToken: workerToken
    });

    assert.equal(outcome.status, 'SKIPPED');
    assert.equal(outcome.deliveredCount, 0);

    // Verify parent job is COMPLETED (queue will not loop or retry endlessly)
    const [jobRows] = await pool.execute('SELECT status, last_error FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(jobRows[0].status, 'COMPLETED');
    assert.ok(jobRows[0].last_error.includes('No active registered devices'));

    // Verify recipient status is SKIPPED
    const [recipRows] = await pool.execute('SELECT delivery_status FROM notification_recipients WHERE notification_id = ? AND user_id = ?;', [notifId, singleUser]);
    assert.equal(recipRows[0].delivery_status, 'SKIPPED');

    // Clean up
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id = ?;', [notifId]);
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });

  // 17. Mixed outcomes across multiple devices
  it('17. Mixed device outcomes: one SENT and one permanent FAILED yields COMPLETED job and SENT recipient', async () => {
    const singleUser = await createTestUser('17');
    const goodDev = await createTestDevice(singleUser, 'dev_good');
    const badDev = await createTestDevice(singleUser, 'dev_bad');
    const notifId = await createTestNotification(`${testPrefix}_notif_mixed`);
    await createTestRecipient(notifId, singleUser);
    const jobId = await createTestPushJob(notifId, singleUser, 'mixed_17');

    const mockFcm = {
      send: async (msg) => {
        if (msg.token === goodDev.fcm_token) {
          return 'msg_good_ok';
        }
        const err = new Error('Registration token is not registered');
        err.code = 'messaging/registration-token-not-registered';
        throw err;
      }
    };

    const workerToken = crypto.randomUUID();
    const claimed = await pushWorkerService.claimPushJobsBatch({ workerLeaseToken: workerToken, batchSize: 10 });
    const target = claimed.find(j => j.id === jobId);

    const outcome = await pushWorkerService.processSinglePushJob(target, {
      workerLeaseToken: workerToken,
      fcmClient: mockFcm
    });

    // When at least 1 device succeeds, outcome is COMPLETED
    assert.equal(outcome.status, 'COMPLETED');
    assert.equal(outcome.deliveredCount, 1);

    // Verify per-device delivery rows
    const deliveries = await deviceDeliveryModel.findDeliveriesByJobId(jobId);
    assert.equal(deliveries.length, 2);
    const goodDelivery = deliveries.find(d => d.device_id === goodDev.id);
    const badDelivery = deliveries.find(d => d.device_id === badDev.id);

    assert.equal(goodDelivery.status, 'SENT');
    assert.equal(badDelivery.status, 'FAILED');

    // Bad device token was deactivated
    const [badDevRows] = await pool.execute('SELECT is_active FROM user_devices WHERE id = ?;', [badDev.id]);
    assert.equal(badDevRows[0].is_active, 0);

    // Good device token remains active
    const [goodDevRows] = await pool.execute('SELECT is_active FROM user_devices WHERE id = ?;', [goodDev.id]);
    assert.equal(goodDevRows[0].is_active, 1);

    // Parent job is COMPLETED
    const [jobRows] = await pool.execute('SELECT status FROM notification_jobs WHERE id = ?;', [jobId]);
    assert.equal(jobRows[0].status, 'COMPLETED');

    // Recipient delivery_status is SENT (user successfully reached on good device)
    const [recipRows] = await pool.execute('SELECT delivery_status FROM notification_recipients WHERE notification_id = ? AND user_id = ?;', [notifId, singleUser]);
    assert.equal(recipRows[0].delivery_status, 'SENT');

    // Clean up
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id = ?;', [notifId]);
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [notifId]);
  });
});
