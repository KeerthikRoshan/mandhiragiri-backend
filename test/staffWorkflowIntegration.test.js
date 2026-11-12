const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { pool, closePool } = require('../src/config/database');
const { generateAccessToken } = require('../src/utils/token');
const { processOutboxQueue } = require('../src/services/outboxProcessorService');
const { processReminderQueue, scheduleBookingReminders } = require('../src/services/bookingReminderService');

describe('Staff Flow Complete Integration Test Suite (17 Requirements)', () => {
  let server;
  let baseUrl;

  // Track created entities for reliable cleanup
  let createdUserIds = [];
  let createdStaffIds = [];
  let createdBookingIds = [];
  let createdLeaveIds = [];
  let createdAttendanceKeys = [];

  let adminUser, adminToken;
  let priest1User, priest1Staff, priest1Token;
  let priest2User, priest2Staff, priest2Token;
  let customerUser, customerToken;

  let testBookingId;
  let testBookingNumber;
  let testCompletedBookingId;

  // Helper to create test user
  const createTestUser = async (suffix, roleId = 1) => {
    const mobile = `982${String(Date.now()).slice(-4)}${suffix}`.slice(0, 15);
    const [res] = await pool.execute(
      `INSERT INTO users (role_id, mobile, password_hash, name, status)
       VALUES (?, ?, 'test_hash', 'User ${suffix}', 'ACTIVE');`,
      [roleId, mobile]
    );
    const userId = res.insertId;
    createdUserIds.push(userId);
    const roleMap = { 1: 'SUPER_ADMIN', 2: 'ADMIN', 3: 'PRIEST', 4: 'ASSISTANT', 5: 'STAFF' };
    const token = generateAccessToken({ id: userId, role: roleMap[roleId] || 'STAFF' });
    return { id: userId, mobile, token };
  };

  // Helper to create test staff
  const createTestStaff = async (userId, name = 'Test Priest') => {
    const staffCode = ('MJSTF' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase().slice(0, 18);
    const phone = `982${String(Date.now()).slice(-4)}${Math.floor(Math.random() * 1000)}`.slice(0, 15);
    const [res] = await pool.execute(
      `INSERT INTO staff (user_id, staff_id, name_english, name_tamil, staff_role, status, phone)
       VALUES (?, ?, ?, 'டெஸ்ட் குருக்கள்', 'Priest', 'ACTIVE', ?);`,
      [userId, staffCode, name, phone]
    );
    createdStaffIds.push(res.insertId);
    return { id: res.insertId, staffCode, userId, phone };
  };

  before(async () => {
    // 1. Start HTTP test server
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

    // 2. Create users
    adminUser = await createTestUser('adm', 1); // SUPER_ADMIN
    adminToken = adminUser.token;

    priest1User = await createTestUser('pr1', 5); // STAFF
    priest1Staff = await createTestStaff(priest1User.id, 'Priest One');
    priest1Token = priest1User.token;

    priest2User = await createTestUser('pr2', 5); // STAFF
    priest2Staff = await createTestStaff(priest2User.id, 'Priest Two');
    priest2Token = priest2User.token;

    customerUser = await createTestUser('cst', 5); // Customer (not in staff table)
    customerToken = customerUser.token;
  });

  after(async () => {
    // Close server
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Clean up created entities
    if (createdLeaveIds.length > 0) {
      await pool.execute(
        `DELETE FROM leave_requests WHERE id IN (${createdLeaveIds.map(() => '?').join(',')});`,
        createdLeaveIds
      );
    }
    if (createdAttendanceKeys.length > 0) {
      for (const k of createdAttendanceKeys) {
        await pool.execute(`DELETE FROM attendance_records WHERE staff_id = ? AND date_key = ?;`, [k.staffId, k.dateKey]);
        await pool.execute(`DELETE FROM staff_attendance_audit WHERE staff_id = ? AND date_key = ?;`, [k.staffId, k.dateKey]);
      }
    }
    if (createdBookingIds.length > 0) {
      const ph = createdBookingIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM booking_transactions WHERE booking_id IN (${ph});`, createdBookingIds);
      await pool.execute(`DELETE FROM booking_priests WHERE booking_id IN (${ph});`, createdBookingIds);
      await pool.execute(`DELETE FROM notification_device_deliveries WHERE job_id IN (SELECT id FROM notification_jobs WHERE entity_type = 'booking' AND entity_id IN (${ph}));`, createdBookingIds.map(String));
      await pool.execute(`DELETE FROM notification_jobs WHERE entity_type = 'booking' AND entity_id IN (${ph});`, createdBookingIds.map(String));
      await pool.execute(`DELETE FROM notification_outbox WHERE entity_type = 'booking' AND entity_id IN (${ph});`, createdBookingIds.map(String));
      await pool.execute(`DELETE FROM notification_recipients WHERE notification_id IN (SELECT id FROM notifications WHERE entity_type = 'booking' AND entity_id IN (${ph}));`, createdBookingIds.map(String));
      await pool.execute(`DELETE FROM notifications WHERE entity_type = 'booking' AND entity_id IN (${ph});`, createdBookingIds.map(String));
      await pool.execute(`DELETE FROM bookings WHERE id IN (${ph});`, createdBookingIds);
    }
    if (createdStaffIds.length > 0) {
      await pool.execute(`DELETE FROM staff WHERE id IN (${createdStaffIds.map(() => '?').join(',')});`, createdStaffIds);
    }
    if (createdUserIds.length > 0) {
      const uPh = createdUserIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM user_devices WHERE user_id IN (${uPh});`, createdUserIds);
      await pool.execute(`DELETE FROM notification_preferences WHERE user_id IN (${uPh});`, createdUserIds);
      await pool.execute(`DELETE FROM notification_recipients WHERE user_id IN (${uPh});`, createdUserIds);
      await pool.execute(`DELETE FROM users WHERE id IN (${uPh});`, createdUserIds);
    }

    await closePool();
  });

  // Requirement 1
  it('1. Admin creates a booking and assigns a Priest', async () => {
    const payload = {
      dateKey: '2026-11-20',
      title: 'கணபதி ஹோமம்',
      clientName: 'சுரேஷ் குமார்',
      phone: '9840012345',
      startTime: '10:00 AM',
      durationMinutes: 120,
      venueType: 'home',
      priestId: priest1Staff.staffCode,
      totalEventCharge: 5000,
      clientAdvanceAmount: 1000,
      priestTotalPay: 2000,
      priestAdvancePaid: 500
    };

    const res = await fetch(`${baseUrl}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify(payload)
    });

    const body = await res.json();
    assert.equal(res.status, 201, `Failed to create booking: ${JSON.stringify(body)}`);
    assert.ok(body.data && body.data.id, 'Booking ID missing');
    assert.equal(body.data.priestId, priest1Staff.staffCode);

    testBookingId = Number(body.data.id);
    testBookingNumber = body.data.bookingNumber;
    createdBookingIds.push(testBookingId);
  });

  // Requirement 2
  it('2. Assigned Priest sees the booking in GET /api/v1/bookings', async () => {
    const res = await fetch(`${baseUrl}/bookings`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });

    const body = await res.json();
    assert.equal(res.status, 200);
    const bookings = body.data?.bookings || body.data;
    assert.ok(Array.isArray(bookings), 'Expected array of bookings');
    const found = bookings.find((b) => Number(b.id) === testBookingId);
    assert.ok(found, `Assigned booking ${testBookingId} not found in Priest 1 list`);
    assert.equal(found.bookingNumber, testBookingNumber);
  });

  // Requirement 3
  it('3. Another Priest/Staff cannot see that booking in GET /api/v1/bookings', async () => {
    const res = await fetch(`${baseUrl}/bookings`, {
      headers: { Authorization: `Bearer ${priest2Token}` }
    });

    const body = await res.json();
    assert.equal(res.status, 200);
    const bookings = body.data?.bookings || body.data;
    assert.ok(Array.isArray(bookings));
    const found = bookings.find((b) => Number(b.id) === testBookingId);
    assert.equal(found, undefined, `Priest 2 should NOT see booking ${testBookingId} assigned to Priest 1`);
  });

  // Requirement 4
  it('4. Admin sees all relevant bookings across staff', async () => {
    const res = await fetch(`${baseUrl}/bookings`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    const body = await res.json();
    assert.equal(res.status, 200);
    const bookings = body.data?.bookings || body.data;
    assert.ok(Array.isArray(bookings));
    const found = bookings.find((b) => Number(b.id) === testBookingId);
    assert.ok(found, `Admin must see created booking ${testBookingId}`);
  });

  // Requirement 5
  it('5. Staff cannot create a booking (POST /api/v1/bookings returns 403)', async () => {
    const payload = {
      dateKey: '2026-11-21',
      title: 'நவக்கிரக ஹோமம்',
      clientName: 'ராமு',
      phone: '9840054321',
      startTime: '09:00 AM',
      durationMinutes: 60,
      priestId: priest1Staff.staffCode
    };

    const res = await fetch(`${baseUrl}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priest1Token}`
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 403, 'Staff creating booking must be rejected with 403 Forbidden');
  });

  // Requirement 6
  it('6. Staff cannot modify or cancel an Admin booking (PUT/DELETE return 403)', async () => {
    // Try modifying
    const putRes = await fetch(`${baseUrl}/bookings/${testBookingId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priest1Token}`
      },
      body: JSON.stringify({ notes: 'Illegal staff edit' })
    });
    assert.equal(putRes.status, 403, 'Staff modifying booking must return 403');

    // Try deleting
    const delRes = await fetch(`${baseUrl}/bookings/${testBookingId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    assert.equal(delRes.status, 403, 'Staff deleting booking must return 403');

    // Try recording payment
    const payRes = await fetch(`${baseUrl}/bookings/${testBookingId}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priest1Token}`
      },
      body: JSON.stringify({ amount: 500, party: 'client' })
    });
    assert.equal(payRes.status, 403, 'Staff recording payments must return 403');
  });

  // Requirement 7
  it('7. Completed bookings appear in staff history (GET /api/v1/bookings?view=completed)', async () => {
    const compBNum = `MJ-COMPLETED-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    // Insert a dedicated completed booking for Priest 1
    const [cRes] = await pool.execute(
      `INSERT INTO bookings (
        booking_number, date_key, title, client_name, client_phone, location, venue_type,
        start_time, end_time, duration_minutes, priest_id, priest_name, status,
        total_event_charge, client_advance_amount, client_total_received, priest_total_pay,
        priest_advance_paid, completed_at, created_by, created_at
      ) VALUES (
        ?, '2026-11-10', 'நிறைவுற்ற பூஜை', 'ராதா', '9840011111', 'கோவில்', 'temple',
        '08:00:00', '10:00:00', 120, ?, 'Priest One', 'completed',
        3000, 3000, 3000, 1500, 1500, NOW(), ?, NOW()
      );`,
      [compBNum, priest1Staff.staffCode, adminUser.id]
    );
    testCompletedBookingId = cRes.insertId;
    createdBookingIds.push(testCompletedBookingId);

    // Also link in booking_priests
    await pool.execute(
      `INSERT INTO booking_priests (booking_id, staff_id, is_primary) VALUES (?, ?, 1);`,
      [testCompletedBookingId, priest1Staff.id]
    );

    const res = await fetch(`${baseUrl}/bookings?view=completed`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });

    const body = await res.json();
    assert.equal(res.status, 200);
    const bookings = body.data?.bookings || body.data;
    assert.ok(Array.isArray(bookings));
    const found = bookings.find((b) => Number(b.id) === testCompletedBookingId);
    assert.ok(found, `Completed booking ${testCompletedBookingId} must appear in staff completed history`);
    assert.equal(found.status, 'completed');
  });

  // Requirement 8
  it('8. Rescheduling updates assigned staff listing with new timing', async () => {
    // Admin reschedules booking to 2026-11-25 11:00 AM
    const updateRes = await fetch(`${baseUrl}/bookings/${testBookingId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        dateKey: '2026-11-25',
        startTime: '11:00 AM',
        durationMinutes: 90
      })
    });
    const updateBody = await updateRes.json();
    assert.equal(updateRes.status, 200, `Rescheduling failed: ${JSON.stringify(updateBody)}`);

    // Priest checks assigned bookings
    const res = await fetch(`${baseUrl}/bookings`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    const bookings = body.data?.bookings || body.data;
    const found = bookings.find((b) => Number(b.id) === testBookingId);
    assert.ok(found);
    assert.equal(found.dateKey, '2026-11-25');
    assert.equal(found.startTime, '11:00 AM');
  });

  // Requirement 9
  it('9. Cancellation updates assigned staff listing with cancelled status', async () => {
    // Admin cancels booking
    const cancelRes = await fetch(`${baseUrl}/bookings/${testBookingId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(cancelRes.status, 200);

    // Priest checks assigned bookings history
    const res = await fetch(`${baseUrl}/bookings?view=history`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    const bookings = body.data?.bookings || body.data;
    const found = bookings.find((b) => Number(b.id) === testBookingId);
    assert.ok(found, 'Cancelled booking must still be visible in staff history');
    assert.equal(found.status, 'cancelled');
  });

  // Requirement 10
  it('10. Staff attendance is isolated to caller and self-attendance swipe works', async () => {
    const todayStr = '2026-11-12';
    createdAttendanceKeys.push({ staffId: priest1Staff.id, dateKey: todayStr });

    // 10a. Submit self attendance
    const swipeRes = await fetch(`${baseUrl}/attendance/self`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priest1Token}`
      },
      body: JSON.stringify({
        dateKey: todayStr,
        status: 'present',
        remarks: 'Swiped on time via mobile app'
      })
    });
    const swipeBody = await swipeRes.json();
    assert.equal(swipeRes.status, 200, `Self attendance swipe failed: ${JSON.stringify(swipeBody)}`);

    // 10b. Fetch own monthly attendance with valid year and month params
    const monthlyRes = await fetch(`${baseUrl}/attendance/${priest1Staff.id}/monthly?year=2026&month=11`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    const monthlyBody = await monthlyRes.json();
    assert.equal(monthlyRes.status, 200, `Fetch monthly attendance failed: ${JSON.stringify(monthlyBody)}`);
    assert.ok(monthlyBody.data && Array.isArray(monthlyBody.data.records));
    const record = monthlyBody.data.records.find((r) => r.dateKey === todayStr);
    assert.ok(record, 'Submitted attendance record must exist in monthly view');
    assert.equal(record.status, 'present');

    // 10c. Staff querying another staff member is rejected with 403 Forbidden
    const otherRes = await fetch(`${baseUrl}/attendance/${priest2Staff.id}/monthly?year=2026&month=11`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    assert.equal(otherRes.status, 403, 'Staff querying another staff member monthly attendance must return 403 Forbidden');
  });

  // Requirement 11
  it('11. Staff leave request (POST /staff/me/leaves) and Admin decision work', async () => {
    // 11a. Priest 1 applies for leave
    const applyRes = await fetch(`${baseUrl}/staff/me/leaves`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priest1Token}`
      },
      body: JSON.stringify({
        startDate: '2026-11-28',
        endDate: '2026-11-29',
        leaveType: 'Festival Leave',
        reason: 'Family temple visit'
      })
    });
    const applyBody = await applyRes.json();
    assert.equal(applyRes.status, 201, `Leave application failed: ${JSON.stringify(applyBody)}`);
    assert.ok(applyBody.data && applyBody.data.id);
    const leaveId = applyBody.data.id;
    createdLeaveIds.push(leaveId);

    // 11b. Priest 1 checks own leave list
    const myLeavesRes = await fetch(`${baseUrl}/staff/me/leaves`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    const myLeavesBody = await myLeavesRes.json();
    assert.equal(myLeavesRes.status, 200);
    const leaves = myLeavesBody.data?.leaves || myLeavesBody.data;
    assert.ok(Array.isArray(leaves));
    const pendingLeave = leaves.find((l) => l.id === leaveId);
    assert.ok(pendingLeave, 'Pending leave must appear in staff leave list');
    assert.equal(pendingLeave.status, 'pending');

    // 11c. Priest 2 cannot see Priest 1 leave in own leave list
    const p2LeavesRes = await fetch(`${baseUrl}/staff/me/leaves`, {
      headers: { Authorization: `Bearer ${priest2Token}` }
    });
    const p2LeavesBody = await p2LeavesRes.json();
    assert.equal(p2LeavesRes.status, 200);
    const p2Leaves = p2LeavesBody.data?.leaves || p2LeavesBody.data;
    assert.ok(Array.isArray(p2Leaves));
    const p2Found = p2Leaves.find((l) => l.id === leaveId);
    assert.equal(p2Found, undefined, 'Priest 2 must not see Priest 1 leave request');

    // 11d. Admin decides leave
    const decideRes = await fetch(`${baseUrl}/leaves/admin/${leaveId}/decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        decision: 'approved',
        adminRemarks: 'Approved by head priest'
      })
    });
    assert.equal(decideRes.status, 200);

    // 11e. Priest 1 sees approved leave with admin remarks
    const updatedLeavesRes = await fetch(`${baseUrl}/staff/me/leaves`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    const updatedLeavesBody = await updatedLeavesRes.json();
    assert.equal(updatedLeavesRes.status, 200);
    const updatedLeaves = updatedLeavesBody.data?.leaves || updatedLeavesBody.data;
    assert.ok(Array.isArray(updatedLeaves));
    const approvedLeave = updatedLeaves.find((l) => l.id === leaveId);
    assert.ok(approvedLeave);
    assert.equal(approvedLeave.status, 'approved');
    assert.equal(approvedLeave.adminRemarks, 'Approved by head priest');
  });

  // Requirement 12
  it('12. Staff receives the correct booking notification (BOOKING_CREATED)', async () => {
    // Process outbox events
    await processOutboxQueue();

    // Verify in-app notifications endpoint for Priest 1
    const notifRes = await fetch(`${baseUrl}/notifications`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    const notifBody = await notifRes.json();
    assert.equal(notifRes.status, 200);
    const notifications = notifBody.data?.notifications || notifBody.data;
    assert.ok(Array.isArray(notifications));

    // Check if notification recipient row exists in DB for priest1User
    const [recipients] = await pool.execute(
      `SELECT nr.*, n.event_type, n.title_en, n.title_ta
       FROM notification_recipients nr
       INNER JOIN notifications n ON n.id = nr.notification_id
       WHERE nr.user_id = ? AND n.entity_type = 'booking' AND n.entity_id = ?;`,
      [priest1User.id, String(testBookingId)]
    );
    assert.ok(recipients.length > 0, `Priest 1 must have notification recipient row for booking ${testBookingId}`);
    assert.ok(recipients.some((r) => r.event_type === 'BOOKING_CREATED' || r.event_type === 'BOOKING_RESCHEDULED' || r.event_type === 'BOOKING_CANCELLED'));
  });

  // Requirement 13
  it('13. Staff receives 24H/1H reminders according to existing timing rules', async () => {
    const remBNum = `MJ-REMINDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    // Create a future booking 3 days ahead
    const [bRes] = await pool.execute(
      `INSERT INTO bookings (
        booking_number, date_key, title, client_name, client_phone, location, venue_type,
        start_time, end_time, duration_minutes, priest_id, priest_name, status,
        total_event_charge, client_advance_amount, client_total_received, priest_total_pay,
        priest_advance_paid, created_by, created_at
      ) VALUES (
        ?, '2026-11-20', 'நினைவூட்டல் பூஜை', 'டெஸ்ட் பயனர்', '9999999999', 'கோவில்', 'temple',
        '10:00:00', '11:00:00', 60, ?, 'Priest One', 'confirmed',
        1000, 500, 500, 500, 250, ?, NOW()
      );`,
      [remBNum, priest1Staff.staffCode, adminUser.id]
    );
    const remBookingId = bRes.insertId;
    createdBookingIds.push(remBookingId);

    // Assign to booking_priests
    await pool.execute(
      `INSERT INTO booking_priests (booking_id, staff_id, is_primary) VALUES (?, ?, 1);`,
      [remBookingId, priest1Staff.id]
    );

    // Schedule reminders using existing reminder service
    await scheduleBookingReminders(pool, {
      bookingId: remBookingId,
      dateKey: '2026-11-20',
      startTime: '10:00:00',
      scheduleVersion: 1,
      placeholderUserId: adminUser.id,
      now: new Date('2026-11-17T09:00:00Z')
    });

    // Make the 1H reminder job due immediately for testing
    await pool.execute(
      `UPDATE notification_jobs 
       SET scheduled_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE)
       WHERE entity_type = 'booking' AND entity_id = ? AND job_type = 'BOOKING_1H_REMINDER';`,
      [String(remBookingId)]
    );

    // Run reminders batch to dispatch to outbox
    const reminderSummary = await processReminderQueue();
    assert.ok(reminderSummary, 'Reminders batch must execute cleanly');

    // Run outbox processor to deliver notifications and resolve recipients
    await processOutboxQueue();

    // Check for reminder notification recipient for priest1User
    const [remRows] = await pool.execute(
      `SELECT nr.*, n.event_type
       FROM notification_recipients nr
       INNER JOIN notifications n ON n.id = nr.notification_id
       WHERE nr.user_id = ? AND n.entity_type = 'booking' AND n.entity_id = ?;`,
      [priest1User.id, String(remBookingId)]
    );
    assert.ok(remRows.length > 0, 'Priest 1 must receive reminder notification for upcoming booking');
    assert.ok(
      remRows.some((r) => r.event_type === 'BOOKING_REMINDER' || r.event_type === 'BOOKING_1H_REMINDER' || r.event_type === 'BOOKING_24H_REMINDER')
    );
  });

  // Requirement 14
  it('14. Notification preferences work correctly for staff', async () => {
    // 14a. Fetch current preferences
    const getRes = await fetch(`${baseUrl}/notifications/preferences`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    const getBody = await getRes.json();
    assert.equal(getRes.status, 200);

    // 14b. Update push preference for BOOKING_CREATED to disabled
    const putRes = await fetch(`${baseUrl}/notifications/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priest1Token}`
      },
      body: JSON.stringify({
        preferences: [
          { eventType: 'BOOKING_CREATED', inAppEnabled: true, pushEnabled: false }
        ]
      })
    });
    const putBody = await putRes.json();
    assert.equal(putRes.status, 200, `Preferences update failed: ${JSON.stringify(putBody)}`);

    // 14c. Verify in database
    const [prefRows] = await pool.execute(
      `SELECT * FROM notification_preferences WHERE user_id = ? AND event_type = 'BOOKING_CREATED';`,
      [priest1User.id]
    );
    assert.ok(prefRows.length > 0);
    assert.equal(prefRows[0].push_enabled, 0);
    assert.equal(prefRows[0].in_app_enabled, 1);
  });

  // Requirement 15
  it('15. Customers never receive internal notifications', async () => {
    // Verify customer user has no recipient records for booking notifications
    const [cstRows] = await pool.execute(
      `SELECT * FROM notification_recipients WHERE user_id = ?;`,
      [customerUser.id]
    );
    assert.equal(cstRows.length, 0, 'Customer must never receive internal booking notifications');
  });

  // Requirement 16
  it('16. Staff cannot access Admin-only endpoints (403 Forbidden)', async () => {
    // 16a. Financial audits summary
    const faRes = await fetch(`${baseUrl}/bookings/financial-audits/summary`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    assert.equal(faRes.status, 403, 'Financial audit summary must be 403 for staff');

    // 16b. Financial audits settlements
    const setRes = await fetch(`${baseUrl}/bookings/financial-audits/settlements`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    assert.equal(setRes.status, 403, 'Financial audit settlements must be 403 for staff');

    // 16c. Check availability
    const caRes = await fetch(`${baseUrl}/bookings/check-availability`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priest1Token}`
      },
      body: JSON.stringify({
        booking_date: '2026-11-20',
        start_time: '10:00 AM',
        priest_id: priest1Staff.staffCode
      })
    });
    assert.equal(caRes.status, 403, 'Check availability must be 403 for staff');

    // 16d. Admin all leaves
    const allLeavesRes = await fetch(`${baseUrl}/leaves/admin/all`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    assert.equal(allLeavesRes.status, 403, 'Admin all leaves must be 403 for staff');

    // 16e. Admin daily attendance
    const dailyAttRes = await fetch(`${baseUrl}/attendance/daily`, {
      headers: { Authorization: `Bearer ${priest1Token}` }
    });
    assert.equal(dailyAttRes.status, 403, 'Admin daily attendance must be 403 for staff');
  });

  // Requirement 17
  it('17. Logout/login between Admin and Staff does not leak sessions or device mapping', async () => {
    const sharedFcmToken = `fcm_shared_${Date.now()}`;
    const sharedDeviceId = `device_${Date.now()}`;

    // Step 1: Admin registers device
    const admRegRes = await fetch(`${baseUrl}/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        fcmToken: sharedFcmToken,
        deviceId: sharedDeviceId,
        platform: 'android'
      })
    });
    assert.equal(admRegRes.status, 200);

    // Verify token belongs to Admin
    let [devRows] = await pool.execute(
      `SELECT * FROM user_devices WHERE fcm_token = ?;`,
      [sharedFcmToken]
    );
    assert.equal(devRows.length, 1);
    assert.equal(devRows[0].user_id, adminUser.id);

    // Step 2: Admin unregisters on logout
    const unregRes = await fetch(`${baseUrl}/devices/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ fcmToken: sharedFcmToken })
    });
    assert.equal(unregRes.status, 200);

    // Step 3: Staff logs in and registers the same device token
    const stfRegRes = await fetch(`${baseUrl}/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${priest1Token}`
      },
      body: JSON.stringify({
        fcmToken: sharedFcmToken,
        deviceId: sharedDeviceId,
        platform: 'android'
      })
    });
    assert.equal(stfRegRes.status, 200);

    // Verify token was safely reassigned to Staff with zero session leakage
    [devRows] = await pool.execute(
      `SELECT * FROM user_devices WHERE fcm_token = ?;`,
      [sharedFcmToken]
    );
    assert.equal(devRows.length, 1);
    assert.equal(devRows[0].user_id, priest1User.id);
    assert.equal(devRows[0].is_active, 1);
  });
});
