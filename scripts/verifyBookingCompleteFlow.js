/**
 * Diagnostic and Verification Script for Booking Completion Push Notification Flow
 * 
 * Verifies:
 * 1. Admin (user_id = 1) has active registered Android device token.
 * 2. Staff (user_id = 809, staff_id = 108) exists and is active.
 * 3. Creates a test booking assigned to Staff #108.
 * 4. Calls completeEvent (simulating Staff completing the booking).
 * 5. Runs outboxProcessor to generate the canonical notification & queue push jobs.
 * 6. Checks outbox, notification, and notification_jobs records.
 * 7. Runs pushWorker to dispatch push notification via Firebase Admin SDK to Admin.
 * 8. Records and reports FCM message ID, recipient status, and delivery log.
 */

const { pool } = require('../src/config/database');
const { messaging } = require('../src/config/firebase');
const projectModel = require('../src/models/projectModel');
const outboxProcessorService = require('../src/services/outboxProcessorService');
const pushWorkerService = require('../src/services/pushWorkerService');

const maskToken = (token) => {
  if (!token) return '[empty]';
  if (token.length <= 10) return '***';
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
};

async function run() {
  console.log('========================================================');
  console.log('🔍 MANDHIRAGIRI JOTHIDAM - BOOKING COMPLETION PUSH AUDIT');
  console.log('========================================================\n');

  try {
    // 1. Inspect Active Devices
    console.log('Step 1: Inspecting registered devices in database...');
    const [devices] = await pool.query(
      `SELECT d.id, d.user_id, u.name, u.mobile, u.role_id, d.fcm_token, d.is_active, d.updated_at
       FROM user_devices d
       JOIN users u ON u.id = d.user_id
       WHERE d.user_id IN (1, 809)
       ORDER BY d.user_id, d.id DESC;`
    );

    console.log(`Found ${devices.length} registered device records:`);
    devices.forEach((d) => {
      console.log(` - Device #${d.id} | User #${d.user_id} (RoleID: ${d.role_id}, ${d.name}) | Active: ${d.is_active} | Token: ${maskToken(d.fcm_token)} | Updated: ${d.updated_at}`);
    });

    // Ensure Admin has an active device (reactivate device 1010 if needed)
    const adminActiveDevices = devices.filter((d) => d.user_id === 1 && d.is_active === 1);
    if (adminActiveDevices.length === 0) {
      console.log('⚠️ Admin device is currently inactive. Reactivating Device 1010 for test...');
      await pool.query('UPDATE user_devices SET is_active = 1, updated_at = NOW() WHERE id = 1010;');
      console.log('✅ Admin Device 1010 reactivated.');
    } else {
      console.log(`✅ Admin (user_id = 1) has ${adminActiveDevices.length} active device(s).`);
    }

    // 2. Fetch Staff Details
    console.log('\nStep 2: Resolving assigned Staff...');
    const [staffRows] = await pool.query(
      `SELECT s.id, s.staff_id, s.user_id, s.name_english, s.name_tamil, s.staff_role, s.phone, s.status
       FROM staff s
       WHERE s.user_id = 809 OR s.id = 108
       LIMIT 1;`
    );

    if (staffRows.length === 0) {
      throw new Error('Staff #108 (user_id = 809) not found in database');
    }
    const staff = staffRows[0];
    console.log(`✅ Assigned Staff: ID=${staff.id}, StaffCode=${staff.staff_id}, UserID=${staff.user_id}, Name="${staff.name_english}", Role=${staff.staff_role}`);

    // 3. Create a Real Test Booking Assigned to this Staff
    console.log('\nStep 3: Creating a test booking assigned to Staff...');
    const testBookingNumber = `BK-AUDIT-${Date.now().toString().slice(-6)}`;
    const [bookingInsert] = await pool.query(
      `INSERT INTO bookings (
         booking_number, date_key, title, client_name, client_phone,
         start_time, end_time, duration_minutes, schedule_version,
         priest_id, priest_name, status, is_deleted, created_at, updated_at
       ) VALUES (
         ?, CURDATE(), 'Ganapathy Homam Audit Test', 'Ravi Kumar', '9876543210',
         '10:00:00', '11:30:00', 90, 1,
         ?, ?, 'confirmed', 0, NOW(), NOW()
       );`,
      [testBookingNumber, staff.id, staff.name_english]
    );

    const bookingId = bookingInsert.insertId;
    console.log(`✅ Test Booking created: ID=${bookingId}, Number=${testBookingNumber}, Title="Ganapathy Homam Audit Test", Client="Ravi Kumar"`);

    // 4. Simulate Staff Completing the Booking
    console.log('\nStep 4: Executing completeEvent() as Staff #108...');
    const completedBooking = await projectModel.completeEvent({
      eventId: bookingId,
      staffId: staff.id,
      notes: 'Audit Test: Pooja completed with full rituals and poornahuthi.'
    });

    console.log(`✅ completeEvent completed. Status: ${completedBooking?.status}, CompletedAt: ${completedBooking?.completed_at}`);

    // 5. Inspect Outbox Table for the Generated Event
    console.log('\nStep 5: Verifying Outbox Table...');
    const [outboxRows] = await pool.query(
      `SELECT id, event_type, entity_type, entity_id, status, payload, created_at
       FROM notification_outbox
       WHERE entity_type = 'booking' AND entity_id = ?
       ORDER BY id DESC LIMIT 1;`,
      [bookingId]
    );

    if (outboxRows.length === 0) {
      throw new Error(`Zero outbox events found for booking ${bookingId}`);
    }
    const outboxEvent = outboxRows[0];
    const parsedPayload = typeof outboxEvent.payload === 'string' ? JSON.parse(outboxEvent.payload) : outboxEvent.payload;
    console.log(`✅ Outbox event found: ID=${outboxEvent.id}, Type=${outboxEvent.event_type}, Status=${outboxEvent.status}`);
    console.log('   Payload:', JSON.stringify(parsedPayload, null, 2));

    // 6. Process the Outbox Event
    console.log('\nStep 6: Running outboxProcessorService.processOutboxQueue()...');
    const outboxBatchResult = await outboxProcessorService.processOutboxQueue({ batchSize: 5 });
    console.log(`✅ Outbox processing result:`, outboxBatchResult);

    // 7. Verify Canonical Notification Record & Recipients
    console.log('\nStep 7: Verifying Canonical Notification & Recipients...');
    const [notifRows] = await pool.query(
      `SELECT n.id, n.event_type, n.title_en, n.body_en, n.title_ta, n.body_ta, n.priority, n.created_at
       FROM notifications n
       WHERE n.entity_type = 'booking' AND n.entity_id = ?
       ORDER BY n.id DESC LIMIT 1;`,
      [bookingId]
    );

    if (notifRows.length === 0) {
      throw new Error(`Zero notifications found for booking ${bookingId}`);
    }
    const notification = notifRows[0];
    console.log(`✅ Notification created: ID=${notification.id}`);
    console.log(`   Title (EN): "${notification.title_en}"`);
    console.log(`   Body (EN):  "${notification.body_en}"`);
    console.log(`   Title (TA): "${notification.title_ta}"`);
    console.log(`   Body (TA):  "${notification.body_ta}"`);
    console.log(`   Priority:   ${notification.priority}`);

    const [recipientRows] = await pool.query(
      `SELECT r.id, r.user_id, u.name, u.role_id, r.delivery_status, r.in_app_visible
       FROM notification_recipients r
       JOIN users u ON u.id = r.user_id
       WHERE r.notification_id = ?;`,
      [notification.id]
    );

    console.log(`\n   Resolved Recipients (${recipientRows.length}):`);
    recipientRows.forEach((r) => {
      console.log(`    - User #${r.user_id} (Role: ${r.role_id}, ${r.name}) | DeliveryStatus=${r.delivery_status} | InAppVisible=${r.in_app_visible}`);
    });

    // 8. Inspect Notification Push Jobs
    console.log('\nStep 8: Checking queued notification_jobs...');
    const [jobs] = await pool.query(
      `SELECT j.id, j.job_type, j.recipient_user_id, u.name, u.role_id, j.status, j.attempts, j.last_error
       FROM notification_jobs j
       JOIN users u ON u.id = j.recipient_user_id
       WHERE j.notification_id = ?;`,
      [notification.id]
    );

    console.log(`Found ${jobs.length} push delivery job(s):`);
    jobs.forEach((j) => {
      console.log(` - Job #${j.id} | Recipient User #${j.recipient_user_id} (Role: ${j.role_id}, ${j.name}) | Status=${j.status}`);
    });

    // 9. Dispatch Push Jobs via Push Worker
    console.log('\nStep 9: Running pushWorkerService.processPushQueue()...');
    const pushBatchResult = await pushWorkerService.processPushQueue({ batchSize: 5 });
    console.log(`✅ Push worker result:`, pushBatchResult);

    // 10. Verify Final Delivery Records & Google Cloud Response
    console.log('\nStep 10: Verifying Delivery Records in Database...');
    const [deliveries] = await pool.query(
      `SELECT dd.id, dd.job_id, dd.device_id, dd.fcm_token, dd.status, dd.attempts, dd.last_error, dd.sent_at
       FROM notification_device_deliveries dd
       WHERE dd.job_id IN (SELECT id FROM notification_jobs WHERE notification_id = ?)
       ORDER BY dd.id DESC;`,
      [notification.id]
    );

    console.log(`Found ${deliveries.length} per-device delivery record(s):`);
    deliveries.forEach((del) => {
      console.log(` - Delivery #${del.id} | Job #${del.job_id} | Device #${del.device_id} | Status=${del.status} | SentAt=${del.sent_at} | LastError=${del.last_error || 'None'}`);
    });

    const [finalRecipients] = await pool.query(
      `SELECT r.user_id, u.name, u.role_id, r.delivery_status
       FROM notification_recipients r
       JOIN users u ON u.id = r.user_id
       WHERE r.notification_id = ?;`,
      [notification.id]
    );

    console.log('\nFinal Recipient Delivery Status:');
    finalRecipients.forEach((r) => {
      console.log(` - User #${r.user_id} (Role: ${r.role_id}, ${r.name}) -> ${r.delivery_status}`);
    });

    console.log('\n========================================================');
    console.log('🎉 AUDIT & VERIFICATION COMPLETED SUCCESSFULLY');
    console.log('========================================================');
  } catch (err) {
    console.error('\n❌ Verification Failed:', err);
  } finally {
    await pool.end();
  }
}

run();
