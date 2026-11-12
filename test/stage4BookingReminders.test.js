const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { pool, closePool } = require('../src/config/database');
const bookingReminderService = require('../src/services/bookingReminderService');
const outboxModel = require('../src/models/outboxModel');

describe('Stage 4: Booking Reminders & Schedule Versioning Tests', () => {
  const testPrefix = `stg4_${Date.now()}`;
  let createdBookingIds = [];
  let createdUserIds = [];
  let createdJobIds = [];
  let createdOutboxIds = [];
  let testStaffId;
  let testStaffUserId;

  // Helper to create test user
  const createTestUser = async (suffix, roleId = 1) => {
    const mobile = `994${String(Date.now()).slice(-4)}${suffix}`.slice(0, 15);
    const [res] = await pool.execute(
      `INSERT INTO users (role_id, mobile, password_hash, name, status)
       VALUES (?, ?, 'test_hash', 'Stage 4 Test User', 'ACTIVE');`,
      [roleId, mobile]
    );
    createdUserIds.push(res.insertId);
    return res.insertId;
  };

  // Helper to create test booking
  const createTestBooking = async ({
    dateKey = '2026-11-20',
    startTime = '10:00:00',
    scheduleVersion = 1,
    status = 'confirmed',
    priestId = null,
    isDeleted = 0
  } = {}) => {
    const bookingNumber = `BK-${testPrefix}-${Math.floor(Math.random() * 10000)}`;
    const effectivePriestId = priestId ? String(priestId) : (testStaffId || 'STAFF-DEFAULT');
    const [res] = await pool.execute(
      `INSERT INTO bookings (
        booking_number, date_key, title, client_name, client_phone,
        start_time, end_time, duration_minutes, schedule_version,
        priest_id, status, is_deleted, created_at
      ) VALUES (
        ?, ?, 'Test Pooja Event', 'Test Customer', '919876543210',
        ?, '11:00:00', 60, ?,
        ?, ?, ?, NOW()
      );`,
      [bookingNumber, dateKey, startTime, scheduleVersion, effectivePriestId, status, isDeleted]
    );
    createdBookingIds.push(res.insertId);
    return {
      id: res.insertId,
      bookingNumber,
      dateKey,
      startTime,
      scheduleVersion,
      priestId: effectivePriestId,
      clientPhone: '919876543210'
    };
  };

  before(async () => {
    // Create a priest/assistant staff user (role_id = 5 for Staff/Priest)
    testStaffUserId = await createTestUser('stf', 5);
    testStaffId = `STF${String(Date.now()).slice(-6)}`;

    // Insert staff record linked to testStaffUserId
    await pool.execute(
      `INSERT INTO staff (
        staff_id, user_id, name_english, name_tamil, staff_role, phone, status, created_at
      ) VALUES (
        ?, ?, 'Test Priest', 'சோதனை குருக்கள்', 'Priest', '9876500001', 'Active', NOW()
      );`,
      [testStaffId, testStaffUserId]
    );
  });

  after(async () => {
    // Cleanup created data
    if (createdBookingIds.length > 0) {
      const bPlaceholders = createdBookingIds.map(() => '?').join(',');
      await pool.execute(
        `DELETE FROM notification_device_deliveries WHERE job_id IN (
           SELECT id FROM notification_jobs WHERE entity_type = 'booking' AND entity_id IN (${bPlaceholders})
         );`,
        createdBookingIds
      );
      await pool.execute(
        `DELETE FROM notification_jobs WHERE entity_type = 'booking' AND entity_id IN (${bPlaceholders});`,
        createdBookingIds
      );
      await pool.execute(
        `DELETE FROM notification_outbox WHERE entity_type = 'booking' AND entity_id IN (${bPlaceholders});`,
        createdBookingIds
      );
      await pool.execute(
        `DELETE FROM notifications WHERE entity_type = 'booking' AND entity_id IN (${bPlaceholders});`,
        createdBookingIds
      );
      await pool.execute(`DELETE FROM bookings WHERE id IN (${bPlaceholders});`, createdBookingIds);
    }

    if (createdJobIds.length > 0) {
      const placeholders = createdJobIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM notification_device_deliveries WHERE job_id IN (${placeholders});`, createdJobIds);
      await pool.execute(`DELETE FROM notification_jobs WHERE id IN (${placeholders});`, createdJobIds);
    }
    await pool.execute(`DELETE FROM notification_jobs WHERE idempotency_key LIKE 'rem_%';`);
    await pool.execute(`DELETE FROM notification_outbox WHERE event_key LIKE '%_${testPrefix}%';`);
    await pool.execute(`DELETE FROM notifications WHERE idempotency_key LIKE '%_${testPrefix}%';`);

    if (testStaffId) {
      await pool.execute(`DELETE FROM staff WHERE staff_id = ?;`, [testStaffId]);
    }

    if (createdUserIds.length > 0) {
      const placeholders = createdUserIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM users WHERE id IN (${placeholders});`, createdUserIds);
    }

    await closePool();
  });

  // 1. Timing Boundaries & Schedule Calculation
  it('1. Timing boundaries: schedules both reminders 3 days ahead, skips 24h within 12h, skips both within 30m', () => {
    const fixedNow = new Date('2026-11-17T10:00:00Z');

    // Scenario A: Event 3 days in future (2026-11-20 10:00:00)
    const scheduleA = bookingReminderService.calculateReminderSchedule({
      dateKey: '2026-11-20',
      startTime: '10:00:00',
      now: fixedNow
    });
    assert.equal(scheduleA.shouldSchedule24h, true, '24H reminder must be scheduled 3 days ahead');
    assert.equal(scheduleA.shouldSchedule1h, true, '1H reminder must be scheduled 3 days ahead');

    // Scenario B: Event 12 hours in future (2026-11-17 22:00:00)
    const scheduleB = bookingReminderService.calculateReminderSchedule({
      dateKey: '2026-11-17',
      startTime: '22:00:00',
      now: fixedNow
    });
    assert.equal(scheduleB.shouldSchedule24h, false, '24H reminder must be skipped when event is 12h away');
    assert.equal(scheduleB.shouldSchedule1h, true, '1H reminder must be scheduled when event is 12h away');

    // Scenario C: Event 30 minutes in future (2026-11-17 10:30:00)
    const scheduleC = bookingReminderService.calculateReminderSchedule({
      dateKey: '2026-11-17',
      startTime: '10:30:00',
      now: fixedNow
    });
    assert.equal(scheduleC.shouldSchedule24h, false, '24H reminder must be skipped 30m ahead');
    assert.equal(scheduleC.shouldSchedule1h, false, '1H reminder must be skipped 30m ahead');
  });

  // 2. Idempotent Reminder Scheduling
  it('2. Idempotent scheduling: repeated calls do not create duplicate reminder jobs', async () => {
    const booking = await createTestBooking();
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    const firstRun = await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: booking.scheduleVersion,
      placeholderUserId: 1,
      now: fixedNow
    });
    assert.equal(firstRun.length, 3, 'Must schedule 3 reminder jobs (24H, 1H, 5M)');

    // Re-run scheduling with identical parameters
    const secondRun = await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: booking.scheduleVersion,
      placeholderUserId: 1,
      now: fixedNow
    });
    assert.equal(secondRun.length, 3);

    // Verify database row count: exactly 3 jobs exist
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM notification_jobs 
       WHERE entity_type = 'booking' AND entity_id = ? AND job_type IN ('BOOKING_24H_REMINDER', 'BOOKING_1H_REMINDER', 'BOOKING_5M_REMINDER');`,
      [String(booking.id)]
    );
    assert.equal(Number(rows[0].total), 3, 'Zero duplicate reminder jobs created');
  });

  // 3. Fresh Authoritative In-Transaction Re-read & Outbox Handoff
  it('3. Authoritative re-read: executes reminder, resolves recipients, and inserts outbox event', async () => {
    const booking = await createTestBooking({ priestId: testStaffId });
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: booking.scheduleVersion,
      now: fixedNow
    });

    // Make reminder eligible immediately by setting scheduled_at in past
    await pool.execute(
      `UPDATE notification_jobs SET scheduled_at = NOW() - INTERVAL 1 MINUTE
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );

    const workerToken = crypto.randomUUID();
    const claimed = await bookingReminderService.claimReminderJobsBatch({
      workerLeaseToken: workerToken,
      batchSize: 5
    });
    const target = claimed.find((j) => j.entity_id === String(booking.id) && j.job_type === 'BOOKING_24H_REMINDER');
    assert.ok(target, 'Target reminder job must be claimed');

    const outcome = await bookingReminderService.processSingleReminderJob(target, {
      workerLeaseToken: workerToken
    });

    assert.equal(outcome.status, 'COMPLETED');
    assert.ok(outcome.outboxEventKey);

    // Verify parent job is COMPLETED
    const [jobRows] = await pool.execute('SELECT status, processed_at FROM notification_jobs WHERE id = ?;', [target.id]);
    assert.equal(jobRows[0].status, 'COMPLETED');
    assert.ok(jobRows[0].processed_at !== null);

    // Verify outbox record was inserted with HIGH priority and confirmed recipients
    const outboxEvent = await outboxModel.findOutboxEventByKey(outcome.outboxEventKey);
    assert.ok(outboxEvent, 'Outbox event must exist');
    assert.equal(outboxEvent.status, 'PENDING');
    assert.equal(outboxEvent.event_type, 'BOOKING_24H_REMINDER');

    const payload = JSON.parse(outboxEvent.payload);
    assert.equal(payload.bookingId, booking.id);
    assert.equal(payload.scheduleVersion, 1);
    assert.equal(payload.priority, 'high');
    assert.ok(payload.recipientUserIds.includes(testStaffUserId), 'Assigned priest must be in recipients');
  });

  // 4. Stale Reminder Invalidation via schedule_version (Rescheduling)
  it('4. Stale schedule_version invalidation: cancels reminder when booking was rescheduled', async () => {
    // Booking initially at schedule_version = 1
    const booking = await createTestBooking({ scheduleVersion: 1 });
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // Simulate booking reschedule: bookings.schedule_version becomes 2
    await pool.execute('UPDATE bookings SET schedule_version = 2 WHERE id = ?;', [booking.id]);

    // Force job eligible for processing
    await pool.execute(
      `UPDATE notification_jobs SET scheduled_at = NOW() - INTERVAL 1 MINUTE
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );

    const workerToken = crypto.randomUUID();
    const claimed = await bookingReminderService.claimReminderJobsBatch({
      workerLeaseToken: workerToken,
      batchSize: 5
    });
    const target = claimed.find((j) => j.entity_id === String(booking.id) && j.job_type === 'BOOKING_24H_REMINDER');
    assert.ok(target);

    // Process: worker re-reads live booking, detects version mismatch (1 !== 2)
    const outcome = await bookingReminderService.processSingleReminderJob(target, {
      workerLeaseToken: workerToken
    });

    assert.equal(outcome.status, 'CANCELLED');
    assert.ok(outcome.reason.includes('schedule_version'));

    // Verify job transitioned to CANCELLED in DB
    const [jobRows] = await pool.execute('SELECT status, last_error FROM notification_jobs WHERE id = ?;', [target.id]);
    assert.equal(jobRows[0].status, 'CANCELLED');
    assert.ok(jobRows[0].last_error.includes('schedule_version'));

    // Assert zero outbox events were inserted
    const staleOutboxKey = `outbox_booking_24h_reminder_b${booking.id}_v1`;
    const outboxRow = await outboxModel.findOutboxEventByKey(staleOutboxKey);
    assert.equal(outboxRow, null, 'No outbox event must be created for stale reminder');
  });

  // 5. Cancelled Booking Invalidation
  it('5. Cancelled booking: marks reminder job CANCELLED without outbox dispatch', async () => {
    const booking = await createTestBooking({ status: 'cancelled' });
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    await pool.execute(
      `UPDATE notification_jobs SET scheduled_at = NOW() - INTERVAL 1 MINUTE
       WHERE entity_id = ? AND job_type = 'BOOKING_1H_REMINDER';`,
      [String(booking.id)]
    );

    const workerToken = crypto.randomUUID();
    const claimed = await bookingReminderService.claimReminderJobsBatch({ workerLeaseToken: workerToken, batchSize: 5 });
    const target = claimed.find((j) => j.entity_id === String(booking.id) && j.job_type === 'BOOKING_1H_REMINDER');

    const outcome = await bookingReminderService.processSingleReminderJob(target, { workerLeaseToken: workerToken });
    assert.equal(outcome.status, 'CANCELLED');
    assert.ok(outcome.reason.includes('cancelled'));

    const [jobRows] = await pool.execute('SELECT status FROM notification_jobs WHERE id = ?;', [target.id]);
    assert.equal(jobRows[0].status, 'CANCELLED');
  });

  // 6. Completed Booking Invalidation
  it('6. Completed booking: marks reminder job CANCELLED without outbox dispatch', async () => {
    const booking = await createTestBooking({ status: 'completed' });
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    await pool.execute(
      `UPDATE notification_jobs SET scheduled_at = NOW() - INTERVAL 1 MINUTE
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );

    const workerToken = crypto.randomUUID();
    const claimed = await bookingReminderService.claimReminderJobsBatch({ workerLeaseToken: workerToken, batchSize: 5 });
    const target = claimed.find((j) => j.entity_id === String(booking.id) && j.job_type === 'BOOKING_24H_REMINDER');

    const outcome = await bookingReminderService.processSingleReminderJob(target, { workerLeaseToken: workerToken });
    assert.equal(outcome.status, 'CANCELLED');
    assert.ok(outcome.reason.includes('completed'));
  });

  // 7. Soft-Deleted Booking Invalidation
  it('7. Soft-deleted booking: marks reminder job CANCELLED without outbox dispatch', async () => {
    const booking = await createTestBooking({ isDeleted: 1 });
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    await pool.execute(
      `UPDATE notification_jobs SET scheduled_at = NOW() - INTERVAL 1 MINUTE
       WHERE entity_id = ? AND job_type = 'BOOKING_1H_REMINDER';`,
      [String(booking.id)]
    );

    const workerToken = crypto.randomUUID();
    const claimed = await bookingReminderService.claimReminderJobsBatch({ workerLeaseToken: workerToken, batchSize: 5 });
    const target = claimed.find((j) => j.entity_id === String(booking.id) && j.job_type === 'BOOKING_1H_REMINDER');

    const outcome = await bookingReminderService.processSingleReminderJob(target, { workerLeaseToken: workerToken });
    assert.equal(outcome.status, 'CANCELLED');
    assert.ok(outcome.reason.includes('deleted'));
  });

  // 8. Confirmed Recipient Resolution (All active Admins/Super Admins + Priest; Inactive/Deleted excluded; Customers NEVER Notified)
  it('8. Recipient resolution: all active Admins/Super Admins and assigned Priest receive reminders; Inactive & Customers NEVER do', async () => {
    // 1. Create active Super Admin (role_id = 1)
    const activeSuperAdminId = await createTestUser('sa1', 1);

    // 2. Create active regular Admin (role_id = 2)
    const activeAdminId = await createTestUser('ad2', 2);

    // 3. Create inactive Admin (role_id = 2, status = 'INACTIVE')
    const inactiveMobile = `994${String(Date.now()).slice(-4)}inact`.slice(0, 15);
    const [inactRes] = await pool.execute(
      `INSERT INTO users (role_id, mobile, password_hash, name, status)
       VALUES (2, ?, 'test_hash', 'Inactive Admin', 'INACTIVE');`,
      [inactiveMobile]
    );
    const inactiveAdminId = inactRes.insertId;
    createdUserIds.push(inactiveAdminId);

    // 4. Create deleted Admin (role_id = 1, status = 'DELETED')
    const deletedMobile = `994${String(Date.now()).slice(-4)}del`.slice(0, 15);
    const [delRes] = await pool.execute(
      `INSERT INTO users (role_id, mobile, password_hash, name, status)
       VALUES (1, ?, 'test_hash', 'Deleted Admin', 'DELETED');`,
      [deletedMobile]
    );
    const deletedAdminId = delRes.insertId;
    createdUserIds.push(deletedAdminId);

    // 5. Create booking assigned to test priest
    const booking = await createTestBooking({ priestId: testStaffId });
    const recipients = await bookingReminderService.resolveReminderRecipients(booking);

    // Both active Super Admin and active regular Admin MUST be included
    assert.ok(recipients.includes(activeSuperAdminId), 'Active Super Admin (role 1) must be included');
    assert.ok(recipients.includes(activeAdminId), 'Active Admin (role 2) must be included');

    // Inactive and deleted administrators must NOT be included
    assert.equal(recipients.includes(inactiveAdminId), false, 'Inactive admin must not receive reminders');
    assert.equal(recipients.includes(deletedAdminId), false, 'Deleted admin must not receive reminders');

    // Assigned Priest MUST be included
    assert.ok(recipients.includes(testStaffUserId), 'Assigned active priest must be included');

    // Customer is NEVER in the recipient list
    assert.equal(recipients.includes(booking.clientPhone), false, 'Customer phone must never be in recipients');
    assert.equal(recipients.includes('919876543210'), false, 'Customer must never be in recipients');
  });

  // 9. Duplicate Worker Concurrency on Reminders
  it('9. Concurrency: two concurrent workers never claim the same reminder job', async () => {
    const booking = await createTestBooking();
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    await pool.execute(
      `UPDATE notification_jobs SET scheduled_at = NOW() - INTERVAL 1 MINUTE
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );

    const workerToken1 = 'rem_worker_conc_1';
    const workerToken2 = 'rem_worker_conc_2';

    // Both workers attempt claim simultaneously
    const [batch1, batch2] = await Promise.all([
      bookingReminderService.claimReminderJobsBatch({ workerLeaseToken: workerToken1, batchSize: 10 }),
      bookingReminderService.claimReminderJobsBatch({ workerLeaseToken: workerToken2, batchSize: 10 })
    ]);

    const claimed1 = batch1.some((j) => j.entity_id === String(booking.id) && j.job_type === 'BOOKING_24H_REMINDER');
    const claimed2 = batch2.some((j) => j.entity_id === String(booking.id) && j.job_type === 'BOOKING_24H_REMINDER');

    assert.equal(claimed1 && claimed2, false, 'Both workers must never claim the same reminder');
    assert.ok(claimed1 || claimed2, 'At least one worker must claim the reminder');
  });

  // 10. Worker Crash & Expired Lease Recovery
  it('10. Crash recovery: re-claims reminder job whose worker lease expired', async () => {
    const booking = await createTestBooking();
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // Simulate crashed worker: job left in PROCESSING with expired lease
    await pool.execute(
      `UPDATE notification_jobs 
       SET status = 'PROCESSING', lease_token = 'crashed_token', lease_expires_at = NOW() - INTERVAL 10 MINUTE, attempts = 1
       WHERE entity_id = ? AND job_type = 'BOOKING_1H_REMINDER';`,
      [String(booking.id)]
    );

    const newWorkerToken = 'rem_recovered_worker';
    const claimed = await bookingReminderService.claimReminderJobsBatch({
      workerLeaseToken: newWorkerToken,
      batchSize: 10
    });
    const target = claimed.find((j) => j.entity_id === String(booking.id) && j.job_type === 'BOOKING_1H_REMINDER');

    assert.ok(target, 'Expired PROCESSING reminder job must be reclaimed');
    assert.equal(target.lease_token, newWorkerToken);
    assert.equal(target.attempts, 2, 'Attempts must increment to 2');
  });

  // 11. Durable Outbox Handoff to Downstream Notifications & Push Jobs
  it('11. Outbox handoff: creates canonical notification, recipients, and PUSH_DELIVERY jobs', async () => {
    const outboxKey = `outbox_booking_24h_reminder_${testPrefix}_handoff`;
    const payload = {
      bookingId: 9999,
      bookingNumber: 'BK-9999',
      title: 'Handoff Test Event',
      dateKey: '2026-11-25',
      timeSlot: '10:00 AM - 11:00 AM',
      scheduleVersion: 1,
      recipientUserIds: [1, testStaffUserId]
    };

    // Insert test outbox event
    const [res] = await pool.execute(
      `INSERT INTO notification_outbox (
        event_type, entity_type, entity_id, event_key, payload, status, created_at
      ) VALUES (
        'BOOKING_24H_REMINDER', 'booking', '9999', ?, ?, 'PROCESSING', NOW()
      );`,
      [outboxKey, JSON.stringify(payload)]
    );
    const outboxId = res.insertId;
    const workerToken = 'outbox_handoff_worker';

    // Set lease on outbox event
    await pool.execute(
      `UPDATE notification_outbox 
       SET lease_token = ?, lease_expires_at = NOW() + INTERVAL 5 MINUTE 
       WHERE id = ?;`,
      [workerToken, outboxId]
    );

    const outboxEvent = {
      id: outboxId,
      event_type: 'BOOKING_24H_REMINDER',
      entity_type: 'booking',
      entity_id: '9999',
      event_key: outboxKey,
      payload
    };

    const outcome = await bookingReminderService.handoffReminderOutboxEvent(outboxEvent, {
      workerLeaseToken: workerToken
    });

    assert.ok(outcome.notificationId > 0);
    assert.equal(outcome.recipientCount, 2);
    assert.equal(outcome.pushJobCount, 2);

    // Verify outbox event is COMPLETED
    const [outboxRows] = await pool.execute('SELECT status, processed_at FROM notification_outbox WHERE id = ?;', [outboxId]);
    assert.equal(outboxRows[0].status, 'COMPLETED');
    assert.ok(outboxRows[0].processed_at !== null);

    // Verify canonical notification was created
    const [notifRows] = await pool.execute('SELECT title_en, title_ta FROM notifications WHERE id = ?;', [outcome.notificationId]);
    assert.equal(notifRows[0].title_en, 'Booking Reminder (24 Hours)');
    assert.equal(notifRows[0].title_ta, 'முன்பதிவு நினைவூட்டல் (24 மணி நேரம்)');

    // Verify PUSH_DELIVERY jobs were queued for both recipients
    const [pushRows] = await pool.execute(
      'SELECT recipient_user_id, status FROM notification_jobs WHERE notification_id = ? AND job_type = "PUSH_DELIVERY";',
      [outcome.notificationId]
    );
    assert.equal(pushRows.length, 2);
    pushRows.forEach((r) => assert.equal(r.status, 'PENDING'));

    // Clean up
    await pool.execute('DELETE FROM notification_device_deliveries WHERE job_id IN (SELECT id FROM notification_jobs WHERE notification_id = ?);', [outcome.notificationId]);
    await pool.execute('DELETE FROM notification_jobs WHERE notification_id = ?;', [outcome.notificationId]);
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id = ?;', [outcome.notificationId]);
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [outcome.notificationId]);
  });

  // 12. Repeated Outbox Handoff Idempotency
  it('12. Repeated outbox handoff: idempotent under retry with zero duplicate rows', async () => {
    const outboxKey = `outbox_booking_1h_reminder_${testPrefix}_idem`;
    const payload = {
      bookingId: 9998,
      bookingNumber: 'BK-9998',
      title: 'Idem Test Event',
      dateKey: '2026-11-25',
      timeSlot: '02:00 PM - 03:00 PM',
      scheduleVersion: 1,
      recipientUserIds: [1]
    };

    const [res] = await pool.execute(
      `INSERT INTO notification_outbox (
        event_type, entity_type, entity_id, event_key, payload, status, created_at
      ) VALUES (
        'BOOKING_1H_REMINDER', 'booking', '9998', ?, ?, 'PROCESSING', NOW()
      );`,
      [outboxKey, JSON.stringify(payload)]
    );
    const outboxId = res.insertId;
    const workerToken = 'outbox_idem_worker';

    await pool.execute(
      `UPDATE notification_outbox 
       SET lease_token = ?, lease_expires_at = NOW() + INTERVAL 5 MINUTE 
       WHERE id = ?;`,
      [workerToken, outboxId]
    );

    const outboxEvent = {
      id: outboxId,
      event_type: 'BOOKING_1H_REMINDER',
      entity_type: 'booking',
      entity_id: '9998',
      event_key: outboxKey,
      payload
    };

    // First handoff
    const firstRun = await bookingReminderService.handoffReminderOutboxEvent(outboxEvent, { workerLeaseToken: workerToken });

    // Reset lease on outbox event to simulate retry
    await pool.execute(
      `UPDATE notification_outbox 
       SET status = 'PROCESSING', lease_token = ?, lease_expires_at = NOW() + INTERVAL 5 MINUTE 
       WHERE id = ?;`,
      [workerToken, outboxId]
    );

    // Second handoff (retry)
    const secondRun = await bookingReminderService.handoffReminderOutboxEvent(outboxEvent, { workerLeaseToken: workerToken });
    assert.equal(secondRun.notificationId, firstRun.notificationId, 'Must return same canonical notification ID');

    // Assert exactly 1 notification row exists for this outbox key
    const [notifCount] = await pool.execute('SELECT COUNT(*) AS total FROM notifications WHERE idempotency_key = ?;', [outboxKey]);
    assert.equal(Number(notifCount[0].total), 1);

    // Clean up
    await pool.execute('DELETE FROM notification_device_deliveries WHERE job_id IN (SELECT id FROM notification_jobs WHERE notification_id = ?);', [firstRun.notificationId]);
    await pool.execute('DELETE FROM notification_jobs WHERE notification_id = ?;', [firstRun.notificationId]);
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id = ?;', [firstRun.notificationId]);
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [firstRun.notificationId]);
  });

  // 13. cancelBookingReminders API helper
  it('13. cancelBookingReminders: cancels all pending reminder jobs for booking', async () => {
    const booking = await createTestBooking();
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    const cancelledCount = await bookingReminderService.cancelBookingReminders(pool, {
      bookingId: booking.id,
      reason: 'User requested cancellation'
    });
    assert.equal(cancelledCount, 3, 'All 24H, 1H, and 5M jobs must be cancelled');

    const [rows] = await pool.execute('SELECT status, last_error FROM notification_jobs WHERE entity_id = ?;', [String(booking.id)]);
    rows.forEach((r) => {
      assert.equal(r.status, 'CANCELLED');
      assert.ok(r.last_error.includes('User requested cancellation'));
    });
  });

  // 14. Abandoned Reminder Sweeper
  it('14. Abandoned reminder sweeper: marks jobs FAILED when lease expired after 3 attempts', async () => {
    const booking = await createTestBooking();
    const [jobRes] = await pool.execute(
      `INSERT INTO notification_jobs (
        job_type, notification_id, recipient_user_id, entity_type, entity_id,
        schedule_version, scheduled_at, status, lease_token, lease_expires_at, attempts, idempotency_key, created_at
      ) VALUES (
        'BOOKING_24H_REMINDER', NULL, 1, 'booking', ?,
        1, NOW(), 'PROCESSING', 'stale_worker', NOW() - INTERVAL 10 MINUTE, 3, ?, NOW()
      );`,
      [String(booking.id), `rem_swept_${testPrefix}`]
    );

    const sweptCount = await bookingReminderService.sweepAbandonedReminderJobs();
    assert.ok(sweptCount >= 1, 'At least 1 abandoned reminder job swept');

    const [rows] = await pool.execute('SELECT status, last_error FROM notification_jobs WHERE id = ?;', [jobRes.insertId]);
    assert.equal(rows[0].status, 'FAILED');
    assert.ok(rows[0].last_error.includes('final attempt 3'));
  });

  // 15. Repeated scheduling after COMPLETED
  it('15. Repeated scheduling after COMPLETED: reminder job remains COMPLETED and is never reactivated to PENDING', async () => {
    const booking = await createTestBooking();
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // Mark job as COMPLETED
    await pool.execute(
      `UPDATE notification_jobs SET status = 'COMPLETED', processed_at = NOW()
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );

    // Re-run scheduler with identical parameters
    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // Assert status is STILL COMPLETED, NOT PENDING
    const [rows] = await pool.execute(
      `SELECT status, processed_at FROM notification_jobs 
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );
    assert.equal(rows[0].status, 'COMPLETED');
    assert.ok(rows[0].processed_at !== null);
  });

  // 16. Repeated scheduling after CANCELLED
  it('16. Repeated scheduling after CANCELLED: reminder job remains CANCELLED and is never reactivated to PENDING', async () => {
    const booking = await createTestBooking();
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // Mark job as CANCELLED
    await pool.execute(
      `UPDATE notification_jobs SET status = 'CANCELLED', last_error = 'Stale reminder'
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );

    // Re-run scheduler with identical parameters
    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // Assert status is STILL CANCELLED, NOT PENDING
    const [rows] = await pool.execute(
      `SELECT status, last_error FROM notification_jobs 
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );
    assert.equal(rows[0].status, 'CANCELLED');
    assert.equal(rows[0].last_error, 'Stale reminder');
  });

  // 17. Repeated scheduling after FAILED
  it('17. Repeated scheduling after FAILED: reminder job remains FAILED and is never reactivated to PENDING', async () => {
    const booking = await createTestBooking();
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // Mark job as permanently FAILED
    await pool.execute(
      `UPDATE notification_jobs SET status = 'FAILED', last_error = 'Permanent failure'
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );

    // Re-run scheduler with identical parameters
    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // Assert status is STILL FAILED, NOT PENDING
    const [rows] = await pool.execute(
      `SELECT status, last_error FROM notification_jobs 
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );
    assert.equal(rows[0].status, 'FAILED');
    assert.equal(rows[0].last_error, 'Permanent failure');
  });

  // 18. Rescheduling creates reminders for new schedule_version while old version remains invalidated
  it('18. Rescheduling creates reminders for new schedule_version while old version remains invalidated', async () => {
    const booking = await createTestBooking({ scheduleVersion: 1 });
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    // 1. Initial schedule at version 1
    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // 2. Booking is rescheduled to a new time and version 2
    await pool.execute('UPDATE bookings SET schedule_version = 2, start_time = "14:00:00" WHERE id = ?;', [booking.id]);

    // Invalidate old reminder jobs
    await bookingReminderService.cancelBookingReminders(pool, {
      bookingId: booking.id,
      reason: 'Rescheduled to new time slot'
    });

    // Schedule new reminder jobs for scheduleVersion = 2
    const newJobs = await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: '14:00:00',
      scheduleVersion: 2,
      now: fixedNow
    });
    assert.equal(newJobs.length, 3);

    // Verify database state: Version 1 jobs are CANCELLED, Version 2 jobs are PENDING
    const [v1Rows] = await pool.execute(
      `SELECT status FROM notification_jobs WHERE entity_id = ? AND schedule_version = 1;`,
      [String(booking.id)]
    );
    v1Rows.forEach((r) => assert.equal(r.status, 'CANCELLED'));

    const [v2Rows] = await pool.execute(
      `SELECT status FROM notification_jobs WHERE entity_id = ? AND schedule_version = 2;`,
      [String(booking.id)]
    );
    assert.equal(v2Rows.length, 3);
    v2Rows.forEach((r) => assert.equal(r.status, 'PENDING'));
  });

  // 19. Repeated scheduler execution does not duplicate outbox events or notifications
  it('19. Repeated scheduler execution: does not duplicate outbox events or notifications', async () => {
    const booking = await createTestBooking();
    const fixedNow = new Date('2026-11-15T10:00:00Z');

    // 1. Schedule reminders
    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // Make 24H reminder eligible
    await pool.execute(
      `UPDATE notification_jobs SET scheduled_at = NOW() - INTERVAL 1 MINUTE
       WHERE entity_id = ? AND job_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );

    // 2. Claim and process reminder job
    const workerToken = crypto.randomUUID();
    const claimed = await bookingReminderService.claimReminderJobsBatch({ workerLeaseToken: workerToken, batchSize: 5 });
    const target = claimed.find((j) => j.entity_id === String(booking.id) && j.job_type === 'BOOKING_24H_REMINDER');
    assert.ok(target);

    const outcome = await bookingReminderService.processSingleReminderJob(target, { workerLeaseToken: workerToken });
    assert.equal(outcome.status, 'COMPLETED');

    // 3. Re-run scheduler multiple times
    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });
    await bookingReminderService.scheduleBookingReminders(pool, {
      bookingId: booking.id,
      dateKey: booking.dateKey,
      startTime: booking.startTime,
      scheduleVersion: 1,
      now: fixedNow
    });

    // Assert: Exactly ONE outbox event exists for this reminder
    const [outboxCount] = await pool.execute(
      `SELECT COUNT(*) AS total FROM notification_outbox 
       WHERE entity_type = 'booking' AND entity_id = ? AND event_type = 'BOOKING_24H_REMINDER';`,
      [String(booking.id)]
    );
    assert.equal(Number(outboxCount[0].total), 1, 'Exactly one outbox event must exist');

    // Process outbox event
    const outboxEvent = await outboxModel.findOutboxEventByKey(outcome.outboxEventKey);
    await pool.execute(
      `UPDATE notification_outbox SET status = 'PROCESSING', lease_token = ?, lease_expires_at = NOW() + INTERVAL 5 MINUTE WHERE id = ?;`,
      [workerToken, outboxEvent.id]
    );
    await bookingReminderService.handoffReminderOutboxEvent(outboxEvent, { workerLeaseToken: workerToken });

    // Assert: Exactly ONE notification row exists
    const [notifCount] = await pool.execute(
      `SELECT COUNT(*) AS total FROM notifications WHERE idempotency_key = ?;`,
      [outcome.outboxEventKey]
    );
    assert.equal(Number(notifCount[0].total), 1, 'Exactly one notification row must exist');
  });
});
