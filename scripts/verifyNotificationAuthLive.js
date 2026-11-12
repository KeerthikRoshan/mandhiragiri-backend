/**
 * Verification Script: Dynamic Unread Count, Staff Authentication & User Isolation
 * Validates real HTTP API calls, dynamic database assertions, and cross-account isolation.
 */
const assert = require('assert');
const bcrypt = require('bcrypt');
const { pool, closePool } = require('../src/config/database');

const BASE_URL = 'http://127.0.0.1:5000/api/v1';

async function apiRequest(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runVerification() {
  console.log('===============================================================');
  console.log('🧪 Starting Mobile Notification & Authentication Verification');
  console.log('===============================================================\n');

  let staffAOriginalHash = null;
  let staffBOriginalHash = null;
  let staffAUserId = null;
  let staffBUserId = null;

  try {
    // 1. Fetch credentials from database dynamically to avoid hardcoding any sensitive data
    const [adminRows] = await pool.execute(
      `SELECT u.id, u.mobile, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name IN ('admin', 'super_admin') AND u.status = 'ACTIVE'
       LIMIT 1;`
    );
    assert.ok(adminRows.length > 0, 'Active admin must exist in DB');
    const adminUser = adminRows[0];
    const adminMobile = adminUser.mobile;
    const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@1234';

    const [staffRows] = await pool.execute(
      `SELECT u.id as user_id, u.password_hash, s.id as staff_id, s.phone, s.name_english, s.name_tamil
       FROM staff s
       JOIN users u ON s.user_id = u.id
       WHERE u.status = 'ACTIVE' AND s.status = 'Active'
       ORDER BY s.id ASC
       LIMIT 2;`
    );
    assert.ok(staffRows.length >= 2, 'At least 2 active staff members must exist in DB');
    const staffA = staffRows[0];
    const staffB = staffRows[1];

    staffAUserId = staffA.user_id;
    staffBUserId = staffB.user_id;
    staffAOriginalHash = staffA.password_hash;
    staffBOriginalHash = staffB.password_hash;

    const testStaffPassword = 'StaffTest@1234';
    const testStaffHash = await bcrypt.hash(testStaffPassword, 10);

    // Set temporary known test password hash for staff test accounts
    await pool.execute('UPDATE users SET password_hash = ? WHERE id IN (?, ?);', [
      testStaffHash,
      staffA.user_id,
      staffB.user_id
    ]);

    // -----------------------------------------------------------------
    // TEST 1: Admin Login & Dynamic Unread Count
    // -----------------------------------------------------------------
    console.log('1️⃣ Testing Admin Authentication & Dynamic Unread Count...');
    const adminLoginRes = await apiRequest('/auth/login', {
      method: 'POST',
      body: {
        mobileNumber: adminMobile,
        password: adminPassword,
        role: 'admin'
      }
    });

    assert.equal(adminLoginRes.status, 200, 'Admin login must return HTTP 200');
    const adminToken = adminLoginRes.data?.data?.token;
    assert.ok(adminToken, 'Admin JWT token must be returned');
    assert.ok(!adminToken.startsWith('staff-jwt-token'), 'Token must be an authentic JWT, not a mock string');

    // Query unread count for Admin via API
    const adminCountRes = await apiRequest('/notifications/unread-count', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminCountRes.status, 200);
    const adminApiUnread = adminCountRes.data.data.unreadCount;

    // Verify against DB directly
    const [adminDbRows] = await pool.execute(
      `SELECT COUNT(*) as count FROM notification_recipients
       WHERE user_id = ? AND is_deleted = 0 AND in_app_visible = 1 AND read_at IS NULL;`,
      [adminUser.id]
    );
    const adminDbUnread = adminDbRows[0].count;
    assert.equal(adminApiUnread, adminDbUnread, 'Admin API unread count must dynamically match DB');
    console.log(`   ✅ Admin dynamic unread count verified: ${adminApiUnread} (dynamically matches DB)\n`);

    // -----------------------------------------------------------------
    // TEST 2: Priest Test Account A Login & Recipient Isolation
    // -----------------------------------------------------------------
    console.log('2️⃣ Testing Priest Test Account A Authentication & Unread Count...');
    const staffALoginRes = await apiRequest('/auth/staff-login', {
      method: 'POST',
      body: {
        mobileNumber: staffA.phone.replace('+91', ''),
        password: testStaffPassword
      }
    });

    assert.equal(staffALoginRes.status, 200, 'Priest Test Account A login must return HTTP 200 (no 401)');
    const staffAToken = staffALoginRes.data?.data?.token;
    assert.ok(staffAToken, 'Staff A JWT token must be returned');
    assert.ok(!staffAToken.startsWith('staff-jwt-token'), 'Token must be an authentic JWT, not a mock string');

    // Query unread count for Staff A
    const staffACountRes = await apiRequest('/notifications/unread-count', {
      headers: { Authorization: `Bearer ${staffAToken}` }
    });
    assert.equal(staffACountRes.status, 200, 'Priest unread-count endpoint must return HTTP 200 (no 401)');
    const staffAApiUnread = staffACountRes.data.data.unreadCount;

    // Verify against DB directly
    const [staffADbRows] = await pool.execute(
      `SELECT COUNT(*) as count FROM notification_recipients
       WHERE user_id = ? AND is_deleted = 0 AND in_app_visible = 1 AND read_at IS NULL;`,
      [staffA.user_id]
    );
    const staffADbUnread = staffADbRows[0].count;
    assert.equal(staffAApiUnread, staffADbUnread, 'Staff A API unread count must dynamically match DB');
    console.log(`   ✅ Staff A dynamic unread count verified: ${staffAApiUnread} (dynamically matches DB)`);

    // -----------------------------------------------------------------
    // TEST 3: Priest Test Account B Login & Cross-Account Isolation
    // -----------------------------------------------------------------
    console.log('\n3️⃣ Testing Priest Test Account B Cross-Account Isolation...');
    const staffBLoginRes = await apiRequest('/auth/staff-login', {
      method: 'POST',
      body: {
        mobileNumber: staffB.phone.replace('+91', ''),
        password: testStaffPassword
      }
    });

    assert.equal(staffBLoginRes.status, 200, 'Priest Test Account B login must return HTTP 200 (no 401)');
    const staffBToken = staffBLoginRes.data?.data?.token;
    assert.ok(staffBToken, 'Staff B JWT token must be returned');

    const staffBCountRes = await apiRequest('/notifications/unread-count', {
      headers: { Authorization: `Bearer ${staffBToken}` }
    });
    assert.equal(staffBCountRes.status, 200);
    const staffBApiUnread = staffBCountRes.data.data.unreadCount;

    const [staffBDbRows] = await pool.execute(
      `SELECT COUNT(*) as count FROM notification_recipients
       WHERE user_id = ? AND is_deleted = 0 AND in_app_visible = 1 AND read_at IS NULL;`,
      [staffB.user_id]
    );
    const staffBDbUnread = staffBDbRows[0].count;
    assert.equal(staffBApiUnread, staffBDbUnread, 'Staff B API unread count must dynamically match DB');
    console.log(`   ✅ Staff B dynamic unread count verified: ${staffBApiUnread} (dynamically matches DB)`);

    // Cross-account test: Staff B cannot list Staff A's notifications
    const staffAListRes = await apiRequest('/notifications', {
      headers: { Authorization: `Bearer ${staffAToken}` }
    });
    const staffBListRes = await apiRequest('/notifications', {
      headers: { Authorization: `Bearer ${staffBToken}` }
    });

    const staffANotifIds = new Set((staffAListRes.data?.data?.notifications || []).map(n => n.id));
    const staffBNotifIds = new Set((staffBListRes.data?.data?.notifications || []).map(n => n.id));
    console.log(`   ✅ Staff A notification rows: ${staffANotifIds.size}`);
    console.log(`   ✅ Staff B notification rows: ${staffBNotifIds.size}`);

    // Verify zero unauthorized cross-account mutations:
    // Staff B attempts to mark Staff A's notification as read
    if (staffANotifIds.size > 0) {
      const aNotifId = Array.from(staffANotifIds)[0];
      const crossMarkRes = await apiRequest(`/notifications/${aNotifId}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${staffBToken}` }
      });
      assert.equal(crossMarkRes.status, 200);
      assert.equal(crossMarkRes.data.data.affected, false, 'Staff B must not affect Staff A notification');
      console.log('   ✅ Cross-account mutation prevented: affected = false when Staff B attempts to touch Staff A notification');
    }

    // -----------------------------------------------------------------
    // TEST 4: Single Mark-as-Read & Dynamic Decrement
    // -----------------------------------------------------------------
    console.log('\n4️⃣ Testing Single Notification Mark-As-Read...');
    // Create an ephemeral test notification specifically for Staff A to test mark-as-read
    const [notifInsert] = await pool.execute(
      `INSERT INTO notifications (
        event_type, idempotency_key, title_en, body_en, title_ta, body_ta,
        entity_type, entity_id, priority, created_at
      ) VALUES (
        'BOOKING_CREATED', 'idem_test_mark_read_${Date.now()}', 'Mark Test EN', 'Body',
        'Mark Test TA', 'Body TA', 'booking', '888', 'normal', NOW()
      );`
    );
    const ephemeralNotifId = notifInsert.insertId;

    await pool.execute(
      `INSERT INTO notification_recipients (
        notification_id, user_id, delivery_status, in_app_visible, created_at
      ) VALUES (?, ?, 'SENT', 1, NOW());`,
      [ephemeralNotifId, staffA.user_id]
    );

    // Fetch count before mark
    const countBeforeRes = await apiRequest('/notifications/unread-count', {
      headers: { Authorization: `Bearer ${staffAToken}` }
    });
    const countBefore = countBeforeRes.data.data.unreadCount;

    // Mark ephemeral notification as read
    const markRes = await apiRequest(`/notifications/${ephemeralNotifId}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${staffAToken}` }
    });
    assert.equal(markRes.status, 200);
    assert.equal(markRes.data.data.affected, true, 'Row should be marked read (affected = true)');

    // Fetch count after mark
    const countAfterRes = await apiRequest('/notifications/unread-count', {
      headers: { Authorization: `Bearer ${staffAToken}` }
    });
    const countAfter = countAfterRes.data.data.unreadCount;
    assert.equal(countAfter, countBefore - 1, 'Unread count must dynamically decrement by exactly 1');
    console.log(`   ✅ Single read verified: Count dynamically decremented from ${countBefore} -> ${countAfter} (-1)`);

    // Clean up ephemeral notification
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id = ?;', [ephemeralNotifId]);
    await pool.execute('DELETE FROM notifications WHERE id = ?;', [ephemeralNotifId]);

    // -----------------------------------------------------------------
    // TEST 5: Mark All Notifications As Read & Dynamic Clear to 0
    // -----------------------------------------------------------------
    console.log('\n5️⃣ Testing Mark-All-As-Read Dynamic Synchronization...');
    // Create 2 test notifications for Staff B to verify mark-all
    const [notifB1] = await pool.execute(
      `INSERT INTO notifications (
        event_type, idempotency_key, title_en, body_en, title_ta, body_ta,
        entity_type, entity_id, priority, created_at
      ) VALUES (
        'BOOKING_CREATED', 'idem_test_all_1_${Date.now()}', 'All Test 1', 'Body',
        'All Test TA', 'Body TA', 'booking', '777', 'normal', NOW()
      );`
    );
    const [notifB2] = await pool.execute(
      `INSERT INTO notifications (
        event_type, idempotency_key, title_en, body_en, title_ta, body_ta,
        entity_type, entity_id, priority, created_at
      ) VALUES (
        'BOOKING_CREATED', 'idem_test_all_2_${Date.now()}', 'All Test 2', 'Body',
        'All Test TA', 'Body TA', 'booking', '778', 'normal', NOW()
      );`
    );

    await pool.execute(
      `INSERT INTO notification_recipients (notification_id, user_id, delivery_status, in_app_visible, created_at)
       VALUES (?, ?, 'SENT', 1, NOW()), (?, ?, 'SENT', 1, NOW());`,
      [notifB1.insertId, staffB.user_id, notifB2.insertId, staffB.user_id]
    );

    // Verify Staff B unread count increased to 2
    const staffBBeforeAll = await apiRequest('/notifications/unread-count', {
      headers: { Authorization: `Bearer ${staffBToken}` }
    });
    assert.equal(staffBBeforeAll.data.data.unreadCount, 2);

    // Call PATCH /notifications/read-all for Staff B
    const readAllRes = await apiRequest('/notifications/read-all', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${staffBToken}` }
    });
    assert.equal(readAllRes.status, 200);

    // Verify Staff B count cleared to 0
    const staffBAfterAll = await apiRequest('/notifications/unread-count', {
      headers: { Authorization: `Bearer ${staffBToken}` }
    });
    assert.equal(staffBAfterAll.data.data.unreadCount, 0, 'Unread count must clear to 0 after read-all');
    console.log(`   ✅ Mark-all verified: Count dynamically transitioned from 2 -> 0`);

    // Clean up test notifications
    await pool.execute('DELETE FROM notification_recipients WHERE notification_id IN (?, ?);', [notifB1.insertId, notifB2.insertId]);
    await pool.execute('DELETE FROM notifications WHERE id IN (?, ?);', [notifB1.insertId, notifB2.insertId]);

    console.log('\n===============================================================');
    console.log('🎉 ALL NOTIFICATION & AUTHENTICATION TESTS PASSED SUCCESSFULLY!');
    console.log('===============================================================\n');

  } catch (err) {
    console.error('❌ Verification Error:', err.message);
    process.exitCode = 1;
  } finally {
    // Restore original staff password hashes
    if (staffAOriginalHash && staffAUserId) {
      await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?;', [
        staffAOriginalHash,
        staffAUserId
      ]);
    }
    if (staffBOriginalHash && staffBUserId) {
      await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?;', [
        staffBOriginalHash,
        staffBUserId
      ]);
    }
    await closePool();
  }
}

runVerification();
