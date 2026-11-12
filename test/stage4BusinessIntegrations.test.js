const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { pool, closePool } = require('../src/config/database');
const bookingModel = require('../src/models/bookingModel');
const bookingService = require('../src/services/bookingService');
const projectModel = require('../src/models/projectModel');
const projectService = require('../src/services/projectService');
const outboxModel = require('../src/models/outboxModel');
const notificationService = require('../src/services/notificationService');
const { executeWithIdempotency } = require('../src/services/apiIdempotencyService');
const { NOTIFICATION_EVENTS } = require('../src/constants/notificationConstants');

describe('Stage 4: Business Integrations & End-to-End Automation Tests', () => {
  const testPrefix = `bi_${Date.now()}`;
  let createdUserIds = [];
  let createdBookingIds = [];
  let createdStaffIds = [];
  let createdLeaveIds = [];
  let adminUserId;
  let priestUserId;
  let priestStaffId;
  let customerUserId;

  // Helper to create test user
  const createTestUser = async (suffix, roleId = 1) => {
    const mobile = `984${String(Date.now()).slice(-4)}${suffix}`.slice(0, 15);
    const [res] = await pool.execute(
      `INSERT INTO users (role_id, mobile, password_hash, name, status)
       VALUES (?, ?, 'test_hash', 'Test User ${suffix}', 'ACTIVE');`,
      [roleId, mobile]
    );
    createdUserIds.push(res.insertId);
    return res.insertId;
  };

  // Helper to create test staff
  const createTestStaff = async (userId, name = 'Test Priest') => {
    const staffCode = ('S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)).toUpperCase().slice(0, 18);
    const phone = `984${String(Date.now()).slice(-4)}${Math.floor(Math.random() * 1000)}`.slice(0, 15);
    const [res] = await pool.execute(
      `INSERT INTO staff (user_id, staff_id, name_english, name_tamil, staff_role, status, phone)
       VALUES (?, ?, ?, 'டெஸ்ட் புரோகிதர்', 'Priest', 'ACTIVE', ?);`,
      [userId, staffCode, name, phone]
    );
    createdStaffIds.push(res.insertId);
    return { id: res.insertId, staffCode, userId };
  };

  before(async () => {
    // 1. Resolve or create an Admin user (role_id = 1, SUPER_ADMIN)
    adminUserId = await createTestUser('adm1', 1);

    // 2. Resolve or create a Staff/Priest user (role_id = 5, STAFF)
    priestUserId = await createTestUser('pri1', 5);
    const staffRecord = await createTestStaff(priestUserId, 'Archagar Raman');
    priestStaffId = staffRecord.id;

    // 3. Resolve or create a Customer user (role_id = 5, not a staff member, not an admin)
    customerUserId = await createTestUser('cst1', 5);
  });

  after(async () => {
    // Clean up created records
    if (createdLeaveIds.length > 0) {
      await pool.execute(
        `DELETE FROM leave_requests WHERE id IN (${createdLeaveIds.map(() => '?').join(',')});`,
        createdLeaveIds
      );
    }

    if (createdBookingIds.length > 0) {
      const placeholders = createdBookingIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM booking_transactions WHERE booking_id IN (${placeholders});`, createdBookingIds);
      await pool.execute(`DELETE FROM booking_priests WHERE booking_id IN (${placeholders});`, createdBookingIds);
      await pool.execute(`DELETE FROM notification_jobs WHERE entity_type = 'booking' AND entity_id IN (${placeholders});`, createdBookingIds.map(String));
      await pool.execute(`DELETE FROM bookings WHERE id IN (${placeholders});`, createdBookingIds);
    }

    if (createdBookingIds.length > 0) {
      const bIds = createdBookingIds.map(String);
      const bPlaceholders = bIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM notification_outbox WHERE entity_type = 'booking' AND entity_id IN (${bPlaceholders});`, bIds);
    }
    if (createdLeaveIds.length > 0) {
      const lIds = createdLeaveIds.map(String);
      const lPlaceholders = lIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM notification_outbox WHERE entity_type = 'leave' AND entity_id IN (${lPlaceholders});`, lIds);
    }
    if (createdStaffIds.length > 0) {
      const sIds = createdStaffIds.map(String);
      const sPlaceholders = sIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM notification_outbox WHERE entity_type = 'staff' AND entity_id IN (${sPlaceholders});`, sIds);
    }
    await pool.execute(`DELETE FROM notification_outbox WHERE event_key LIKE 'payment_updated_%';`);
    await pool.execute(`DELETE FROM notification_outbox WHERE event_key LIKE 'attendance_alert_%';`);
    await pool.execute(`DELETE FROM notification_outbox WHERE event_key LIKE '%_${testPrefix}%';`);
    await pool.execute(`DELETE FROM api_idempotency_records WHERE idempotency_key LIKE 'test_idem_${testPrefix}%';`);

    if (createdStaffIds.length > 0) {
      await pool.execute(`DELETE FROM staff_attendance_audit WHERE staff_id IN (${createdStaffIds.map(() => '?').join(',')});`, createdStaffIds);
      await pool.execute(`DELETE FROM attendance_records WHERE staff_id IN (${createdStaffIds.map(() => '?').join(',')});`, createdStaffIds);
      await pool.execute(`DELETE FROM staff WHERE id IN (${createdStaffIds.map(() => '?').join(',')});`, createdStaffIds);
    }

    if (createdUserIds.length > 0) {
      await pool.execute(
        `DELETE FROM users WHERE id IN (${createdUserIds.map(() => '?').join(',')});`,
        createdUserIds
      );
    }

    await closePool();
  });

  describe('1. Booking Creation & BOOKING_CREATED Outbox Handoff', () => {
    it('creates booking with schedule_version 1, schedules reminders, and inserts BOOKING_CREATED outbox event', async () => {
      // Future date 3 days ahead
      const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const dateKey = futureDate.toISOString().slice(0, 10);

      const created = await bookingService.createBooking({
        dateKey,
        startTime: '10:00 AM',
        durationMinutes: 60,
        title: 'Ganapathi Homam',
        clientName: 'Suresh Kumar',
        phone: '9876543210',
        priestId: priestStaffId,
        totalEventCharge: 5000,
        clientAdvanceAmount: 1000,
        priestTotalPay: 2000,
        priestAdvancePaid: 500
      }, adminUserId);

      const bookingId = Number(created.id);
      createdBookingIds.push(bookingId);

      // 1. Verify schedule_version = 1
      const [bookingRows] = await pool.execute('SELECT schedule_version, status FROM bookings WHERE id = ?;', [bookingId]);
      assert.equal(bookingRows[0].schedule_version, 1);
      assert.equal(bookingRows[0].status, 'confirmed');

      // 2. Verify reminder jobs were scheduled in notification_jobs (24H, 1H, and 5M)
      const [reminderJobs] = await pool.execute(
        `SELECT job_type, schedule_version, status FROM notification_jobs
         WHERE entity_type = 'booking' AND entity_id = ? ORDER BY job_type ASC;`,
        [String(bookingId)]
      );
      assert.equal(reminderJobs.length, 3);
      assert.ok(reminderJobs.some(r => r.job_type === 'BOOKING_24H_REMINDER' && r.status === 'PENDING'));
      assert.ok(reminderJobs.some(r => r.job_type === 'BOOKING_1H_REMINDER' && r.status === 'PENDING'));
      assert.ok(reminderJobs.some(r => r.job_type === 'BOOKING_5M_REMINDER' && r.status === 'PENDING'));

      // 3. Verify BOOKING_CREATED event in notification_outbox
      const [outboxRows] = await pool.execute(
        `SELECT event_type, entity_type, entity_id, event_key, payload, status
         FROM notification_outbox WHERE entity_type = 'booking' AND entity_id = ? AND event_type = 'BOOKING_CREATED';`,
        [String(bookingId)]
      );
      assert.equal(outboxRows.length, 1);
      assert.equal(outboxRows[0].event_type, 'BOOKING_CREATED');
      assert.ok(
        ['PENDING', 'PROCESSING', 'COMPLETED'].includes(outboxRows[0].status),
        `Expected status to be PENDING, PROCESSING, or COMPLETED, but got ${outboxRows[0].status}`
      );

      // 4. Assert payload is customer safe (no password, contains booking metadata)
      const payload = typeof outboxRows[0].payload === 'string'
        ? JSON.parse(outboxRows[0].payload)
        : outboxRows[0].payload;
      assert.equal(payload.bookingId, bookingId);
      assert.equal(payload.title, 'Ganapathi Homam');
      assert.equal(payload.priestId, String(priestStaffId));
      assert.equal(payload.password, undefined);

      // 5. Verify recipient resolution for BOOKING_CREATED: includes active Admins and assigned priest
      const recipients = await notificationService.resolveRecipientsForEvent(
        NOTIFICATION_EVENTS.BOOKING_CREATED,
        { priestId: priestStaffId }
      );
      assert.ok(recipients.includes(adminUserId));
      assert.ok(recipients.includes(priestUserId));
      assert.ok(!recipients.includes(customerUserId), 'Customers must NEVER receive notifications');
    });

    it('idempotency replay returns cached booking without creating duplicate rows', async () => {
      const idempotencyKey = `test_idem_${testPrefix}_create_replay`;
      const futureDate = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
      const dateKey = futureDate.toISOString().slice(0, 10);
      const payload = {
        dateKey,
        startTime: '02:00 PM',
        durationMinutes: 60,
        title: 'Navagraha Pooja',
        clientName: 'Muthu Vel',
        phone: '9840123456',
        priestId: priestStaffId,
        totalEventCharge: 3000
      };

      // First call
      const res1 = await executeWithIdempotency(
        pool,
        {
          userId: adminUserId,
          idempotencyKey,
          httpMethod: 'POST',
          requestPath: '/api/v1/bookings',
          body: payload
        },
        async (conn) => {
          const created = await bookingService.createBooking(payload, adminUserId, conn);
          return { statusCode: 201, body: { success: true, data: created } };
        }
      );
      assert.equal(res1.isReplay, false);
      const firstBookingId = Number(res1.body.data.id);
      createdBookingIds.push(firstBookingId);

      // Second call with same idempotency key
      const res2 = await executeWithIdempotency(
        pool,
        {
          userId: adminUserId,
          idempotencyKey,
          httpMethod: 'POST',
          requestPath: '/api/v1/bookings',
          body: payload
        },
        async (conn) => {
          const created = await bookingService.createBooking(payload, adminUserId, conn);
          return { statusCode: 201, body: { success: true, data: created } };
        }
      );
      assert.equal(res2.isReplay, true);
      assert.equal(Number(res2.body.data.id), firstBookingId);

      // Third call with same idempotency key but altered payload -> throws 422
      await assert.rejects(
        async () => {
          await executeWithIdempotency(
            pool,
            {
              userId: adminUserId,
              idempotencyKey,
              httpMethod: 'POST',
              requestPath: '/api/v1/bookings',
              body: { ...payload, title: 'Tampered Title' }
            },
            async (conn) => {
              const created = await bookingService.createBooking(payload, adminUserId, conn);
              return { statusCode: 201, body: { success: true, data: created } };
            }
          );
        },
        (err) => err.statusCode === 422
      );
    });
  });

  describe('2. Booking Assignment & BOOKING_ASSIGNED Outbox Handoff', () => {
    it('updating priest emits BOOKING_ASSIGNED outbox event without altering schedule_version or reminders', async () => {
      // Create a second priest
      const priest2User = await createTestUser('pri2', 5);
      const priest2Staff = await createTestStaff(priest2User, 'Sivachariyar Anand');

      // Create initial booking
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const dateKey = futureDate.toISOString().slice(0, 10);
      const created = await bookingService.createBooking({
        dateKey,
        startTime: '09:00 AM',
        durationMinutes: 60,
        title: 'Lakshmi Pooja',
        clientName: 'Kavitha Devi',
        phone: '9841122334',
        priestId: priestStaffId,
        totalEventCharge: 4000
      }, adminUserId);
      const bookingId = Number(created.id);
      createdBookingIds.push(bookingId);

      // Update ONLY the priest (no date or time change)
      await bookingService.updateBooking(bookingId, {
        priestId: priest2Staff.id
      }, adminUserId);

      // Verify schedule_version remains 1
      const [bookingRows] = await pool.execute('SELECT schedule_version, priest_id FROM bookings WHERE id = ?;', [bookingId]);
      assert.equal(bookingRows[0].schedule_version, 1);
      assert.ok(bookingRows[0].priest_id === String(priest2Staff.id) || bookingRows[0].priest_id === priest2Staff.staffCode);

      // Verify BOOKING_ASSIGNED outbox event
      const [assignEvents] = await pool.execute(
        `SELECT event_type, entity_id, payload FROM notification_outbox
         WHERE entity_type = 'booking' AND entity_id = ? AND event_type = 'BOOKING_ASSIGNED';`,
        [String(bookingId)]
      );
      assert.equal(assignEvents.length, 1);
      const payload = typeof assignEvents[0].payload === 'string'
        ? JSON.parse(assignEvents[0].payload)
        : assignEvents[0].payload;
      assert.ok(payload.priestId === String(priest2Staff.id) || payload.priestId === priest2Staff.staffCode);

      // Reminders remain in version 1
      const [reminders] = await pool.execute(
        `SELECT schedule_version, status FROM notification_jobs
         WHERE entity_type = 'booking' AND entity_id = ?;`,
        [String(bookingId)]
      );
      assert.ok(reminders.every(r => r.schedule_version === 1 && r.status === 'PENDING'));
    });
  });

  describe('3. Booking Rescheduling, Schedule Versioning & Invalidation', () => {
    it('rescheduling increments schedule_version, cancels old reminders, schedules new version, and emits BOOKING_RESCHEDULED', async () => {
      const futureDate = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
      const dateKey = futureDate.toISOString().slice(0, 10);

      const created = await bookingService.createBooking({
        dateKey,
        startTime: '08:00 AM',
        durationMinutes: 60,
        title: 'Sudarshana Homam',
        clientName: 'Ramesh Krishnan',
        phone: '9840998877',
        priestId: priestStaffId,
        totalEventCharge: 6000
      }, adminUserId);
      const bookingId = Number(created.id);
      createdBookingIds.push(bookingId);

      // Reschedule: new date and new time
      const newFutureDate = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
      const newDateKey = newFutureDate.toISOString().slice(0, 10);

      await bookingService.updateBooking(bookingId, {
        dateKey: newDateKey,
        startTime: '11:00 AM'
      }, adminUserId);

      // 1. Verify schedule_version incremented from 1 to 2
      const [bookingRows] = await pool.execute('SELECT schedule_version, date_key, start_time FROM bookings WHERE id = ?;', [bookingId]);
      assert.equal(bookingRows[0].schedule_version, 2);

      // 2. Verify version 1 reminders are CANCELLED
      const [v1Reminders] = await pool.execute(
        `SELECT status, last_error FROM notification_jobs
         WHERE entity_type = 'booking' AND entity_id = ? AND schedule_version = 1;`,
        [String(bookingId)]
      );
      assert.ok(v1Reminders.length > 0);
      assert.ok(v1Reminders.every(r => r.status === 'CANCELLED'));

      // 3. Verify version 2 reminders are scheduled PENDING
      const [v2Reminders] = await pool.execute(
        `SELECT status FROM notification_jobs
         WHERE entity_type = 'booking' AND entity_id = ? AND schedule_version = 2;`,
        [String(bookingId)]
      );
      assert.ok(v2Reminders.length > 0);
      assert.ok(v2Reminders.every(r => r.status === 'PENDING'));

      // 4. Verify BOOKING_RESCHEDULED outbox event emitted
      const [reschedEvents] = await pool.execute(
        `SELECT event_type, entity_id, payload FROM notification_outbox
         WHERE entity_type = 'booking' AND entity_id = ? AND event_type = 'BOOKING_RESCHEDULED';`,
        [String(bookingId)]
      );
      assert.equal(reschedEvents.length, 1);
      const payload = typeof reschedEvents[0].payload === 'string'
        ? JSON.parse(reschedEvents[0].payload)
        : reschedEvents[0].payload;
      assert.equal(payload.scheduleVersion, 2);
      assert.equal(payload.newDateKey, newDateKey);
    });
  });

  describe('4. Booking Cancellation & Pending Reminders Cancellation', () => {
    it('cancels booking, cancels all pending reminders, and emits BOOKING_CANCELLED outbox event', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const dateKey = futureDate.toISOString().slice(0, 10);

      const created = await bookingService.createBooking({
        dateKey,
        startTime: '04:00 PM',
        durationMinutes: 60,
        title: 'Sashti Pooja',
        clientName: 'Meenakshi Sundaram',
        phone: '9840114477',
        priestId: priestStaffId,
        totalEventCharge: 2500
      }, adminUserId);
      const bookingId = Number(created.id);
      createdBookingIds.push(bookingId);

      // Cancel booking
      await bookingService.deleteBooking(bookingId);

      // 1. Verify booking status
      const [bookingRows] = await pool.execute('SELECT status, is_deleted FROM bookings WHERE id = ?;', [bookingId]);
      assert.equal(bookingRows[0].status, 'cancelled');
      assert.equal(bookingRows[0].is_deleted, 1);

      // 2. Verify all pending reminders are cancelled
      const [reminders] = await pool.execute(
        `SELECT status, last_error FROM notification_jobs
         WHERE entity_type = 'booking' AND entity_id = ?;`,
        [String(bookingId)]
      );
      assert.ok(reminders.length > 0);
      assert.ok(reminders.every(r => r.status === 'CANCELLED'));

      // 3. Verify BOOKING_CANCELLED outbox event emitted
      const [cancelEvents] = await pool.execute(
        `SELECT event_type, entity_id FROM notification_outbox
         WHERE entity_type = 'booking' AND entity_id = ? AND event_type = 'BOOKING_CANCELLED';`,
        [String(bookingId)]
      );
      assert.equal(cancelEvents.length, 1);
    });
  });

  describe('5. Booking Completion & Pending Reminders Cancellation', () => {
    it('completes event via staff completion, cancels pending reminders, and emits BOOKING_COMPLETED', async () => {
      const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const dateKey = futureDate.toISOString().slice(0, 10);

      const created = await bookingService.createBooking({
        dateKey,
        startTime: '06:00 PM',
        durationMinutes: 60,
        title: 'Pradosham Pooja',
        clientName: 'Sivagami Ammal',
        phone: '9840336699',
        priestId: priestStaffId,
        totalEventCharge: 3500
      }, adminUserId);
      const bookingId = Number(created.id);
      createdBookingIds.push(bookingId);

      // Complete event
      const completed = await projectModel.completeEvent({
        eventId: bookingId,
        staffId: priestStaffId,
        notes: 'Pooja performed with full vidhi'
      });
      assert.ok(completed !== null);
      assert.equal(completed.status, 'completed');

      // 1. Verify pending reminders cancelled
      const [reminders] = await pool.execute(
        `SELECT status, last_error FROM notification_jobs
         WHERE entity_type = 'booking' AND entity_id = ?;`,
        [String(bookingId)]
      );
      assert.ok(reminders.length > 0);
      assert.ok(reminders.every(r => r.status === 'CANCELLED'));

      // 2. Verify BOOKING_COMPLETED outbox event emitted
      const [compEvents] = await pool.execute(
        `SELECT event_type, entity_id, payload FROM notification_outbox
         WHERE entity_type = 'booking' AND entity_id = ? AND event_type = 'BOOKING_COMPLETED';`,
        [String(bookingId)]
      );
      assert.equal(compEvents.length, 1);
      const payload = typeof compEvents[0].payload === 'string'
        ? JSON.parse(compEvents[0].payload)
        : compEvents[0].payload;
      assert.equal(payload.bookingId, bookingId);
      assert.equal(payload.staffId, priestStaffId);

      // 3. Recipient resolution: Admins + Assigned Priest; Customers never
      const recipients = await notificationService.resolveRecipientsForEvent(
        NOTIFICATION_EVENTS.BOOKING_COMPLETED,
        { priestId: priestStaffId }
      );
      assert.ok(recipients.includes(adminUserId));
      assert.ok(recipients.includes(priestUserId));
      assert.ok(!recipients.includes(customerUserId), 'Customers must NEVER receive notifications');
    });
  });

  describe('6. Client Payment Notifications (PAYMENT_UPDATED, party: CLIENT)', () => {
    it('recording client payment emits PAYMENT_UPDATED outbox event and notifies Admins only', async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const dateKey = futureDate.toISOString().slice(0, 10);

      const created = await bookingService.createBooking({
        dateKey,
        startTime: '10:00 AM',
        durationMinutes: 60,
        title: 'Ayushya Homam',
        clientName: 'Narayanan S',
        phone: '9840778899',
        priestId: priestStaffId,
        totalEventCharge: 10000,
        clientAdvanceAmount: 2000
      }, adminUserId);
      const bookingId = Number(created.id);
      createdBookingIds.push(bookingId);

      // Record subsequent client payment
      const paymentRes = await bookingService.recordPayment(bookingId, {
        party: 'CLIENT',
        amount: 3000,
        paymentMethod: 'cash',
        notes: 'Second installment'
      }, adminUserId);

      assert.equal(paymentRes.updatedTotalReceived, 5000);
      assert.equal(paymentRes.updatedPaymentStatus, 'partial');

      // Verify PAYMENT_UPDATED outbox event
      const [payEvents] = await pool.execute(
        `SELECT event_type, entity_type, entity_id, payload FROM notification_outbox
         WHERE entity_type = 'payment' AND entity_id = ? AND event_type = 'PAYMENT_UPDATED';`,
        [paymentRes.transactionId]
      );
      assert.equal(payEvents.length, 1);
      const payload = typeof payEvents[0].payload === 'string'
        ? JSON.parse(payEvents[0].payload)
        : payEvents[0].payload;
      assert.equal(payload.party, 'CLIENT');
      assert.equal(payload.amount, 3000);

      // Recipient resolution: Admins ONLY, never priest, never customers
      const recipients = await notificationService.resolveRecipientsForEvent(
        NOTIFICATION_EVENTS.PAYMENT_UPDATED,
        { party: 'CLIENT', priestId: priestStaffId }
      );
      assert.ok(recipients.includes(adminUserId));
      assert.ok(!recipients.includes(priestUserId), 'Priest should NOT be notified for client payments');
      assert.ok(!recipients.includes(customerUserId), 'Customers must NEVER receive notifications');
    });
  });

  describe('7. Priest Advance & Remuneration Notifications (PAYMENT_UPDATED, party: PRIEST)', () => {
    it('recording priest remuneration emits PAYMENT_UPDATED outbox event and notifies Admins + Priest', async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const dateKey = futureDate.toISOString().slice(0, 10);

      const created = await bookingService.createBooking({
        dateKey,
        startTime: '11:00 AM',
        durationMinutes: 60,
        title: 'Chandi Homam',
        clientName: 'Venkatesh Iyer',
        phone: '9840665544',
        priestId: priestStaffId,
        totalEventCharge: 15000,
        priestTotalPay: 5000,
        priestAdvancePaid: 1000
      }, adminUserId);
      const bookingId = Number(created.id);
      createdBookingIds.push(bookingId);

      // Record additional priest remuneration
      const paymentRes = await bookingService.recordPayment(bookingId, {
        party: 'PRIEST',
        amount: 2000,
        paymentMethod: 'cash',
        staffId: priestStaffId,
        notes: 'Priest remuneration installment'
      }, adminUserId);

      assert.equal(paymentRes.updatedTotalReceived, 3000);
      assert.equal(paymentRes.updatedPaymentStatus, 'partial');

      // Verify PAYMENT_UPDATED outbox event
      const [payEvents] = await pool.execute(
        `SELECT event_type, entity_type, entity_id, payload FROM notification_outbox
         WHERE entity_type = 'payment' AND entity_id = ? AND event_type = 'PAYMENT_UPDATED';`,
        [paymentRes.transactionId]
      );
      assert.equal(payEvents.length, 1);
      const payload = typeof payEvents[0].payload === 'string'
        ? JSON.parse(payEvents[0].payload)
        : payEvents[0].payload;
      assert.equal(payload.party, 'PRIEST');
      assert.equal(payload.amount, 2000);

      // Recipient resolution: Admins + Assigned Priest
      const recipients = await notificationService.resolveRecipientsForEvent(
        NOTIFICATION_EVENTS.PAYMENT_UPDATED,
        { party: 'PRIEST', priestId: priestStaffId }
      );
      assert.ok(recipients.includes(adminUserId));
      assert.ok(recipients.includes(priestUserId));
      assert.ok(!recipients.includes(customerUserId), 'Customers must NEVER receive notifications');
    });
  });

  describe('8. Leave Request & LEAVE_REQUESTED Outbox Handoff', () => {
    it('creates leave request with decision_version 0, emits LEAVE_REQUESTED to Admins', async () => {
      const leaveRes = await projectModel.createLeaveRequest({
        staffId: priestStaffId,
        startDate: '2026-12-01',
        endDate: '2026-12-03',
        leaveType: 'CASUAL',
        reason: 'Family temple visit'
      });
      assert.ok(leaveRes.id > 0);
      createdLeaveIds.push(leaveRes.id);

      // 1. Verify decision_version = 0 in database
      const [leaveRows] = await pool.execute('SELECT decision_version, status FROM leave_requests WHERE id = ?;', [leaveRes.id]);
      assert.equal(leaveRows[0].decision_version, 0);
      assert.equal(leaveRows[0].status, 'PENDING');

      // 2. Verify LEAVE_REQUESTED outbox event
      const [outboxRows] = await pool.execute(
        `SELECT event_type, entity_type, entity_id, payload FROM notification_outbox
         WHERE entity_type = 'leave' AND entity_id = ? AND event_type = 'LEAVE_REQUESTED';`,
        [String(leaveRes.id)]
      );
      assert.equal(outboxRows.length, 1);

      // 3. Recipient resolution: Admins only
      const recipients = await notificationService.resolveRecipientsForEvent(
        NOTIFICATION_EVENTS.LEAVE_REQUESTED,
        {}
      );
      assert.ok(recipients.includes(adminUserId));
      assert.ok(!recipients.includes(customerUserId));
    });
  });

  describe('9. Leave Decision Concurrency Guard & Outbox Handoff', () => {
    it('decideLeaveRequest atomically increments decision_version, emits LEAVE_APPROVED, and rejects concurrent decision', async () => {
      const leaveRes = await projectModel.createLeaveRequest({
        staffId: priestStaffId,
        startDate: '2026-12-10',
        endDate: '2026-12-11',
        leaveType: 'MEDICAL',
        reason: 'Health checkup'
      });
      const leaveId = leaveRes.id;
      createdLeaveIds.push(leaveId);

      // First decision: APPROVE
      const decided = await projectModel.decideLeaveRequest({
        leaveId,
        decision: 'APPROVED',
        remarks: 'Approved by head priest',
        decidedBy: adminUserId
      });
      assert.ok(decided !== null);
      assert.equal(decided.status, 'APPROVED');
      assert.equal(decided.decision_version, 1);

      // Verify LEAVE_APPROVED outbox event
      const [outboxRows] = await pool.execute(
        `SELECT event_type, entity_id, payload FROM notification_outbox
         WHERE entity_type = 'leave' AND entity_id = ? AND event_type = 'LEAVE_APPROVED';`,
        [String(leaveId)]
      );
      assert.equal(outboxRows.length, 1);

      // Recipient resolution: ONLY requesting staff user (Admins and Customers strictly excluded)
      const approveRecipients = await notificationService.resolveRecipientsForEvent(
        NOTIFICATION_EVENTS.LEAVE_APPROVED,
        { staffId: priestStaffId }
      );
      assert.equal(approveRecipients.length, 1);
      assert.equal(approveRecipients[0], priestUserId);
      assert.ok(!approveRecipients.includes(adminUserId), 'Admins must NEVER receive LEAVE_APPROVED notifications');
      assert.ok(!approveRecipients.includes(customerUserId), 'Customers must NEVER receive notifications');

      // Also verify LEAVE_REJECTED recipient resolution: ONLY requesting staff user
      const rejectRecipients = await notificationService.resolveRecipientsForEvent(
        NOTIFICATION_EVENTS.LEAVE_REJECTED,
        { staffId: priestStaffId }
      );
      assert.equal(rejectRecipients.length, 1);
      assert.equal(rejectRecipients[0], priestUserId);
      assert.ok(!rejectRecipients.includes(adminUserId), 'Admins must NEVER receive LEAVE_REJECTED notifications');
      assert.ok(!rejectRecipients.includes(customerUserId), 'Customers must NEVER receive notifications');

      // Concurrency guard: second attempt on same leave request returns null (0 affected rows)
      const repeatDecision = await projectModel.decideLeaveRequest({
        leaveId,
        decision: 'REJECTED',
        remarks: 'Attempt to overturn',
        decidedBy: adminUserId
      });
      assert.equal(repeatDecision, null, 'Second decision on already decided leave must be rejected');
    });
  });

  describe('10. Attendance Alerts for ABSENT/LEAVE Conditions', () => {
    it('upsertAttendance with ABSENT status emits ATTENDANCE_ALERT outbox event to Admins', async () => {
      const testDateKey = '2026-11-25';

      // 1. Mark ABSENT -> should emit ATTENDANCE_ALERT
      await projectModel.upsertAttendance({
        staffId: priestStaffId,
        dateKey: testDateKey,
        status: 'ABSENT',
        remarks: 'Uninformed absence',
        updatedBy: adminUserId
      });

      const [alertEvents] = await pool.execute(
        `SELECT event_type, entity_type, entity_id, payload FROM notification_outbox
         WHERE entity_type = 'attendance' AND entity_id = ? AND event_type = 'ATTENDANCE_ALERT';`,
        [`${priestStaffId}_${testDateKey}`]
      );
      assert.equal(alertEvents.length, 1);

      // Recipient resolution: Admins only
      const recipients = await notificationService.resolveRecipientsForEvent(
        NOTIFICATION_EVENTS.ATTENDANCE_ALERT,
        {}
      );
      assert.ok(recipients.includes(adminUserId));
      assert.ok(!recipients.includes(customerUserId));

      // 2. Mark PRESENT on another date -> should NOT emit ATTENDANCE_ALERT
      const presentDateKey = '2026-11-26';
      await projectModel.upsertAttendance({
        staffId: priestStaffId,
        dateKey: presentDateKey,
        status: 'PRESENT',
        submissionTime: '09:00:00',
        updatedBy: adminUserId
      });

      const [noAlertEvents] = await pool.execute(
        `SELECT event_type FROM notification_outbox
         WHERE entity_type = 'attendance' AND entity_id = ? AND event_type = 'ATTENDANCE_ALERT';`,
        [`${priestStaffId}_${presentDateKey}`]
      );
      assert.equal(noAlertEvents.length, 0);
    });
  });

  describe('11. Transaction Rollback Atomicity', () => {
    it('rolls back completely on error, leaving zero orphan outbox events or reminders', async () => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
        const dateKey = futureDate.toISOString().slice(0, 10);
        const failBookingNumber = `BK-FAIL-${Date.now()}`;

        // Attempt creation with intentional collision/failure
        let caughtErr = null;
        let createdBookingId = null;
        try {
          createdBookingId = await bookingModel.createBooking({
            bookingNumber: failBookingNumber,
            dateKey,
            startTime24: '10:00:00',
            endTime24: '11:00:00',
            timeSlot: '10:00 AM - 11:00 AM',
            priestId: priestStaffId,
            priestName: 'Test Priest',
            totalEventCharge: 1000
          }, conn);

          // Force transaction failure
          throw new Error('Simulated transactional failure after booking creation');
        } catch (err) {
          caughtErr = err;
          await conn.rollback();
        }

        assert.ok(caughtErr !== null);

        // Verify no orphan booking exists
        const [bookings] = await pool.execute(
          `SELECT id FROM bookings WHERE booking_number = ?;`,
          [failBookingNumber]
        );
        assert.equal(bookings.length, 0, 'Booking must be rolled back');

        if (createdBookingId) {
          // Verify no orphan reminder jobs exist
          const [reminders] = await pool.execute(
            `SELECT id FROM notification_jobs WHERE entity_type = 'booking' AND entity_id = ?;`,
            [String(createdBookingId)]
          );
          assert.equal(reminders.length, 0, 'Reminder jobs must be rolled back');

          // Verify no orphan outbox events exist
          const [outbox] = await pool.execute(
            `SELECT id FROM notification_outbox WHERE entity_type = 'booking' AND entity_id = ?;`,
            [String(createdBookingId)]
          );
          assert.equal(outbox.length, 0, 'Outbox event must be rolled back');
        }
      } finally {
        conn.release();
      }
    });
  });
});
