const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { pool } = require('../src/config/database');

const BACKUP_FILE = path.resolve(__dirname, '../database/backups/mandhiragiri_db_reset_backup_20261112.sql');

async function cleanEnvironment() {
  console.log('🔍 [RESET] Validating local environment safety...');

  // 1. Environmental sanity check
  const [dbRows] = await pool.query('SELECT DATABASE() as db, @@hostname as host');
  const activeDb = dbRows[0]?.db;
  const host = dbRows[0]?.host;

  if (activeDb !== 'mandhiragiri_db') {
    throw new Error(`CRITICAL: Active database is '${activeDb}', expected 'mandhiragiri_db'. Aborting!`);
  }
  console.log(`✅ [RESET] Confirmed local database: ${activeDb} on host ${host}`);

  // 2. Backup verification
  if (!fs.existsSync(BACKUP_FILE)) {
    throw new Error(`CRITICAL: Backup file not found at ${BACKUP_FILE}. Aborting!`);
  }
  const stat = fs.statSync(BACKUP_FILE);
  if (stat.size < 10000) {
    throw new Error(`CRITICAL: Backup file is suspiciously small (${stat.size} bytes). Aborting!`);
  }
  console.log(`✅ [RESET] Verified database backup exists: ${BACKUP_FILE} (${stat.size} bytes)`);

  // 3. Confirm Super Admin user 1 exists
  const [adminRows] = await pool.query("SELECT * FROM users WHERE id = 1 AND role_id = 1 AND mobile = '9876543210'");
  if (adminRows.length === 0) {
    throw new Error('CRITICAL: Super Admin seeder account (ID 1, mobile 9876543210) not found. Aborting!');
  }
  console.log(`✅ [RESET] Confirmed Super Admin seeder account: ${adminRows[0].name} (${adminRows[0].mobile})`);

  // 4. Perform transactional cleanup in strict foreign key order
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    console.log('🧹 [RESET] Commencing transactional deletion of test data...');

    // a. Notification device deliveries
    const [delDevDel] = await conn.execute('DELETE FROM notification_device_deliveries;');
    console.log(`  - Deleted ${delDevDel.affectedRows} notification_device_deliveries`);

    // b. Notification jobs
    const [delJobs] = await conn.execute('DELETE FROM notification_jobs;');
    console.log(`  - Deleted ${delJobs.affectedRows} notification_jobs`);

    // c. Notification recipients
    const [delRecipients] = await conn.execute('DELETE FROM notification_recipients;');
    console.log(`  - Deleted ${delRecipients.affectedRows} notification_recipients`);

    // d. Notifications
    const [delNotifs] = await conn.execute('DELETE FROM notifications;');
    console.log(`  - Deleted ${delNotifs.affectedRows} notifications`);

    // e. Notification outbox
    const [delOutbox] = await conn.execute('DELETE FROM notification_outbox;');
    console.log(`  - Deleted ${delOutbox.affectedRows} notification_outbox`);

    // f. Booking transactions
    const [delTx] = await conn.execute('DELETE FROM booking_transactions;');
    console.log(`  - Deleted ${delTx.affectedRows} booking_transactions`);

    // g. Booking priests
    const [delBp] = await conn.execute('DELETE FROM booking_priests;');
    console.log(`  - Deleted ${delBp.affectedRows} booking_priests`);

    // h. Bookings
    const [delB] = await conn.execute('DELETE FROM bookings;');
    console.log(`  - Deleted ${delB.affectedRows} bookings`);

    // i. Attendance records
    const [delAtt] = await conn.execute('DELETE FROM attendance_records;');
    console.log(`  - Deleted ${delAtt.affectedRows} attendance_records`);

    // j. Staff attendance audit
    const [delAudit] = await conn.execute('DELETE FROM staff_attendance_audit;');
    console.log(`  - Deleted ${delAudit.affectedRows} staff_attendance_audit`);

    // k. Leave requests
    const [delLeaves] = await conn.execute('DELETE FROM leave_requests;');
    console.log(`  - Deleted ${delLeaves.affectedRows} leave_requests`);

    // l. Staff reminders
    const [delRem] = await conn.execute('DELETE FROM staff_reminders;');
    console.log(`  - Deleted ${delRem.affectedRows} staff_reminders`);

    // m. User devices (reset all registered FCM tokens)
    const [delDevices] = await conn.execute('DELETE FROM user_devices;');
    console.log(`  - Deleted ${delDevices.affectedRows} user_devices`);

    // n. User sessions (invalidate all old sessions)
    const [delSessions] = await conn.execute('DELETE FROM user_sessions;');
    console.log(`  - Deleted ${delSessions.affectedRows} user_sessions`);

    // o. Staff records
    const [delStaff] = await conn.execute('DELETE FROM staff;');
    console.log(`  - Deleted ${delStaff.affectedRows} staff`);

    // p. Non-admin users (preserve user ID 1)
    const [delUsers] = await conn.execute('DELETE FROM users WHERE id != 1;');
    console.log(`  - Deleted ${delUsers.affectedRows} non-admin users (Preserved User ID 1)`);

    // q. Notification preferences (preserve User 1 preferences)
    const [delPrefs] = await conn.execute('DELETE FROM notification_preferences WHERE user_id != 1;');
    console.log(`  - Deleted ${delPrefs.affectedRows} non-admin notification_preferences`);

    // Ensure User 1 has clean default preferences for all event types
    await conn.execute(
      `INSERT INTO notification_preferences (user_id, event_type, in_app_enabled, push_enabled)
       VALUES 
        (1, 'BOOKING_CREATED', 1, 1),
        (1, 'BOOKING_ASSIGNED', 1, 1),
        (1, 'BOOKING_RESCHEDULED', 1, 1),
        (1, 'BOOKING_CANCELLED', 1, 1),
        (1, 'BOOKING_REMINDER', 1, 1),
        (1, 'BOOKING_COMPLETED', 1, 1),
        (1, 'LEAVE_REQUESTED', 1, 1),
        (1, 'LEAVE_APPROVED', 1, 1),
        (1, 'LEAVE_REJECTED', 1, 1),
        (1, 'ATTENDANCE_REMINDER', 1, 1),
        (1, 'ATTENDANCE_ALERT', 1, 1),
        (1, 'PAYMENT_UPDATED', 1, 1),
        (1, 'SYSTEM_ANNOUNCEMENT', 1, 1)
       ON DUPLICATE KEY UPDATE in_app_enabled = 1, push_enabled = 1;`
    );

    // r. API Idempotency records
    const [delIdem] = await conn.execute('DELETE FROM api_idempotency_records;');
    console.log(`  - Deleted ${delIdem.affectedRows} api_idempotency_records`);

    await conn.commit();
    console.log('🎉 [RESET] Transaction committed successfully!');
  } catch (err) {
    await conn.rollback();
    console.error('❌ [RESET] Cleanup failed, transaction rolled back:', err);
    throw err;
  } finally {
    conn.release();
  }

  // 5. Verification after reset
  console.log('🔍 [RESET] Running post-reset integrity verification...');
  const [remUsers] = await pool.query('SELECT id, name, mobile, role_id, status FROM users');
  console.log('Preserved Users:', remUsers);

  const [remStaff] = await pool.query('SELECT COUNT(*) as c FROM staff');
  console.log('Preserved Staff Count (expected 0):', remStaff[0].c);

  const [remBookings] = await pool.query('SELECT COUNT(*) as c FROM bookings');
  console.log('Preserved Bookings Count (expected 0):', remBookings[0].c);

  const [remNotifs] = await pool.query('SELECT COUNT(*) as c FROM notifications');
  console.log('Preserved Notifications Count (expected 0):', remNotifs[0].c);

  // 6. Test Admin Login credentials check
  const [adminCheck] = await pool.query("SELECT * FROM users WHERE mobile = '9876543210' AND status = 'ACTIVE'");
  if (adminCheck.length === 0) {
    throw new Error('Verification failed: Super Admin not found');
  }
  const isMatch = await bcrypt.compare('Admin@1234', adminCheck[0].password_hash);
  console.log(`✅ [RESET] Super Admin password check (Admin@1234): ${isMatch ? 'PASSED' : 'FAILED'}`);

  console.log('🌟 [RESET] Environment reset completed cleanly and successfully!');
}

cleanEnvironment()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
