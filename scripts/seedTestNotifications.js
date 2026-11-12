/**
 * Database Test Notification Seeder for Mobile App Testing
 *
 * Populates realistic bilingual (Tamil/English) test notifications across 12 event types
 * adhering strictly to confirmed recipient eligibility rules:
 * - Active Admins receive all booking events, payments, leave requests, attendance alerts.
 * - Relevant Priest receives assigned booking events and their own leave decisions / priest payments.
 * - Customers NEVER receive notifications.
 * - All test notifications are initially unread (read_at = NULL).
 * - Zero FCM push jobs are created (no push dispatched).
 *
 * Usage:
 *   node scripts/seedTestNotifications.js          # Inserts the test notifications
 *   node scripts/seedTestNotifications.js --clean  # Deletes only these test records
 */

const { pool } = require('../src/config/database');

const TEST_BATCH_TAG = 'STAGE5_MOBILE_TEST';
const IDEMPOTENCY_PREFIX = 'test_ui_stage5_';

async function main() {
  const isClean = process.argv.includes('--clean');

  if (isClean) {
    console.log('🧹 Cleaning up test notification records...');
    const [result] = await pool.query(
      'DELETE FROM notifications WHERE idempotency_key LIKE ?;',
      [`${IDEMPOTENCY_PREFIX}%`]
    );
    console.log(`✅ Deleted ${result.affectedRows} test notification rows (associated recipients deleted via CASCADE).`);
    await pool.end();
    process.exit(0);
  }

  console.log('🚀 Starting Test Notification Seeding in mandhiragiri_db...\n');

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Resolve Active Admin User IDs
    const [adminRows] = await connection.query(`
      SELECT u.id, u.name, r.name AS role_name
      FROM users u
      INNER JOIN roles r ON r.id = u.role_id
      WHERE r.name IN ('SUPER_ADMIN', 'ADMIN')
        AND UPPER(u.status) = 'ACTIVE'
        AND UPPER(u.status) != 'DELETED';
    `);
    const adminUserIds = adminRows.map(r => r.id);
    console.log('👑 Active Administrator Recipients:', adminRows);

    if (adminUserIds.length === 0) {
      throw new Error('No active administrator users found in database!');
    }

    // 2. Resolve Priest Users
    // Priest 1: Karthik Sastrigal (User 4, staff MJSTF00003)
    // Priest 2: Roshan (User 16, staff MJSTF00015)
    const [priestKarthikRows] = await connection.query(`
      SELECT u.id, u.name, s.staff_id, s.name_tamil
      FROM staff s
      INNER JOIN users u ON u.id = s.user_id
      WHERE (s.staff_id = 'MJSTF00003' OR u.id = 4)
        AND UPPER(u.status) = 'ACTIVE' AND UPPER(s.status) = 'ACTIVE'
      LIMIT 1;
    `);
    const priestKarthik = priestKarthikRows[0] || { id: 4, name: 'Karthik Sastrigal', staff_id: 'MJSTF00003' };

    const [priestRoshanRows] = await connection.query(`
      SELECT u.id, u.name, s.staff_id, s.name_tamil
      FROM staff s
      INNER JOIN users u ON u.id = s.user_id
      WHERE (s.staff_id = 'MJSTF00015' OR u.id = 16)
        AND UPPER(u.status) = 'ACTIVE' AND UPPER(s.status) = 'ACTIVE'
      LIMIT 1;
    `);
    const priestRoshan = priestRoshanRows[0] || { id: 16, name: 'Roshan The Stun', staff_id: 'MJSTF00015' };

    console.log('🪔 Priest Recipient 1 (Karthik Sastrigal):', priestKarthik);
    console.log('🪔 Priest Recipient 2 (Roshan):', priestRoshan);

    // 3. Define the 12 Test Notifications with staggered timestamps
    // Stagger timestamps by a few minutes so they order naturally in the mobile app feed
    const nowMs = Date.now();
    const minutesAgo = (m) => new Date(nowMs - m * 60 * 1000);

    const testNotifications = [
      {
        key: `${IDEMPOTENCY_PREFIX}booking_created_b5`,
        eventType: 'BOOKING_CREATED',
        entityType: 'booking',
        entityId: '5',
        titleTa: 'புதிய பூஜை முன்பதிவு',
        bodyTa: 'பக்தர் கணபதி ஹோமம் பூஜையை 2026-11-20 அன்று முன்பதிவு செய்துள்ளார்.',
        titleEn: 'New Pooja Booking Created',
        bodyEn: 'Devotee has booked Ganapathi Homam for 2026-11-20 at 09:00 AM.',
        priority: 'normal',
        createdAt: minutesAgo(5),
        recipients: [...adminUserIds, priestKarthik.id], // Admin + Assigned Priest Karthik
        data: {
          bookingId: 5,
          bookingNumber: 'MJ-2026-1793989819632-da329e',
          priestId: priestKarthik.staff_id,
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}booking_assigned_b6`,
        eventType: 'BOOKING_ASSIGNED',
        entityType: 'booking',
        entityId: '6',
        titleTa: 'புரோகிதர் நியமனம் செய்யப்பட்டது',
        bodyTa: 'நவக்ரஹ சாந்தி பூஜைக்கு புரோகிதர் ரோஷன் நியமிக்கப்பட்டுள்ளார்.',
        titleEn: 'Priest Assigned to Booking',
        bodyEn: 'Priest Roshan has been assigned to Navagraha Shanti Pooja #MJ-2026-1794046154181-f2b9a6.',
        priority: 'normal',
        createdAt: minutesAgo(12),
        recipients: [...adminUserIds, priestRoshan.id], // Admin + Assigned Priest Roshan
        data: {
          bookingId: 6,
          bookingNumber: 'MJ-2026-1794046154181-f2b9a6',
          priestId: priestRoshan.staff_id,
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}booking_rescheduled_b4`,
        eventType: 'BOOKING_RESCHEDULED',
        entityType: 'booking',
        entityId: '4',
        titleTa: 'நிகழ்வு நேரம் மாற்றப்பட்டது',
        bodyTa: 'கணபதி ஹோமம் நிகழ்வு 2026-11-16 அன்று காலை 07:00 மணிக்கு மாற்றியமைக்கப்பட்டுள்ளது.',
        titleEn: 'Booking Rescheduled',
        bodyEn: 'Ganapati Homam #MJ-2026-1793959026694-f95cdb has been rescheduled to 2026-11-16 at 07:00 AM.',
        priority: 'high',
        createdAt: minutesAgo(20),
        recipients: [...adminUserIds, priestRoshan.id], // Admin + Assigned Priest Roshan
        data: {
          bookingId: 4,
          bookingNumber: 'MJ-2026-1793959026694-f95cdb',
          priestId: priestRoshan.staff_id,
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}booking_cancelled_b2`,
        eventType: 'BOOKING_CANCELLED',
        entityType: 'booking',
        entityId: '2',
        titleTa: 'முன்பதிவு ரத்து செய்யப்பட்டது',
        bodyTa: 'கணபதி ஹோமம் முன்பதிவு #MJ-2026-1793719067987-83c1de நிர்வாகியால் ரத்து செய்யப்பட்டுள்ளது.',
        titleEn: 'Booking Cancelled',
        bodyEn: 'Booking #MJ-2026-1793719067987-83c1de has been cancelled.',
        priority: 'high',
        createdAt: minutesAgo(35),
        recipients: [...adminUserIds], // Admin only
        data: {
          bookingId: 2,
          bookingNumber: 'MJ-2026-1793719067987-83c1de',
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}booking_completed_b3`,
        eventType: 'BOOKING_COMPLETED',
        entityType: 'booking',
        entityId: '3',
        titleTa: 'பூஜை வெற்றிகரமாக முடிவுற்றது',
        bodyTa: 'கணபதி ஹோமம் & சங்கல்ப பூஜை வெற்றிகரமாக நிறைவுபெற்றது.',
        titleEn: 'Booking Completed',
        bodyEn: 'Ganapathi Homam & Sankalpam #MJ-2026-1793950217842-f1e7ec has been successfully completed.',
        priority: 'normal',
        createdAt: minutesAgo(50),
        recipients: [...adminUserIds], // Admin only
        data: {
          bookingId: 3,
          bookingNumber: 'MJ-2026-1793950217842-f1e7ec',
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}booking_reminder_24h_b5`,
        eventType: 'BOOKING_REMINDER',
        entityType: 'booking',
        entityId: '5',
        titleTa: '24 மணி நேர முன்பதிவு நினைவூட்டல்',
        bodyTa: 'பூஜை #MJ-2026-1793989819632-da329e நாளை காலை தொடங்க உள்ளது. ஆயத்தமாக இருக்கவும்.',
        titleEn: '24-Hour Booking Reminder',
        bodyEn: 'Booking #MJ-2026-1793989819632-da329e is scheduled for tomorrow morning. Please be prepared.',
        priority: 'high',
        createdAt: minutesAgo(65),
        recipients: [...adminUserIds, priestKarthik.id], // Admin + Assigned Priest Karthik
        data: {
          bookingId: 5,
          bookingNumber: 'MJ-2026-1793989819632-da329e',
          reminderType: '24H',
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}booking_reminder_1h_b4`,
        eventType: 'BOOKING_REMINDER',
        entityType: 'booking',
        entityId: '4',
        titleTa: '1 மணி நேர உடனடி நினைவூட்டல்',
        bodyTa: 'கணபதி ஹோமம் இன்னும் 1 மணி நேரத்தில் தொடங்க உள்ளது.',
        titleEn: '1-Hour Urgent Booking Reminder',
        bodyEn: 'Ganapati Homam #MJ-2026-1793959026694-f95cdb commences in 1 hour.',
        priority: 'urgent',
        createdAt: minutesAgo(80),
        recipients: [...adminUserIds, priestRoshan.id], // Admin + Assigned Priest Roshan
        data: {
          bookingId: 4,
          bookingNumber: 'MJ-2026-1793959026694-f95cdb',
          reminderType: '1H',
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}payment_updated_client_b5`,
        eventType: 'PAYMENT_UPDATED',
        entityType: 'payment',
        entityId: '5',
        titleTa: 'பக்தர் முன்பணம் பெறப்பட்டது',
        bodyTa: 'முன்பதிவு #MJ-2026-1793989819632-da329e க்கான முன்பணம் ₹2,500 ரொக்கமாக பெறப்பட்டது.',
        titleEn: 'Client Advance Payment Received',
        bodyEn: 'Advance payment of ₹2,500 received in cash for booking #MJ-2026-1793989819632-da329e.',
        priority: 'normal',
        createdAt: minutesAgo(95),
        recipients: [...adminUserIds], // Admin only (Client payments go strictly to Admins)
        data: {
          bookingId: 5,
          amount: 2500,
          party: 'CLIENT',
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}payment_updated_priest_b6`,
        eventType: 'PAYMENT_UPDATED',
        entityType: 'payment',
        entityId: '6',
        titleTa: 'புரோகிதர் ஊதியம் வழங்கப்பட்டது',
        bodyTa: 'புரோகிதர் ரோஷனுக்கு பூஜைக்கான ஊதியம் ₹1,500 ரொக்கமாக வழங்கப்பட்டது.',
        titleEn: 'Priest Remuneration Disbursed',
        bodyEn: 'Priest remuneration of ₹1,500 paid in cash to Priest Roshan for booking #MJ-2026-1794046154181-f2b9a6.',
        priority: 'normal',
        createdAt: minutesAgo(110),
        recipients: [...adminUserIds, priestRoshan.id], // Admin + Assigned Priest Roshan
        data: {
          bookingId: 6,
          amount: 1500,
          party: 'PRIEST',
          staffId: 15,
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}leave_requested_lr101`,
        eventType: 'LEAVE_REQUESTED',
        entityType: 'leave',
        entityId: '101',
        titleTa: 'புதிய விடுப்பு விண்ணப்பம்',
        bodyTa: 'புரோகிதர் கார்த்திக் சாஸ்திரிகள் 2 நாட்கள் மருத்துவ விடுப்பு கோரியுள்ளார்.',
        titleEn: 'New Staff Leave Application',
        bodyEn: 'Priest Karthik Sastrigal has submitted a leave application for 2 days.',
        priority: 'normal',
        createdAt: minutesAgo(130),
        recipients: [...adminUserIds], // Admin only (Leave requests go to Admins)
        data: {
          leaveId: 101,
          staffId: 3,
          staffName: 'Karthik Sastrigal',
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}leave_approved_lr101`,
        eventType: 'LEAVE_APPROVED',
        entityType: 'leave',
        entityId: '101',
        titleTa: 'விடுப்பு விண்ணப்பம் ஏற்கப்பட்டது',
        bodyTa: 'உங்களது 2 நாட்கள் விடுப்பு விண்ணப்பத்தை நிர்வாகி ஏற்றுக்கொண்டார்.',
        titleEn: 'Leave Application Approved',
        bodyEn: 'Your leave application for 2 days has been approved by the Administrator.',
        priority: 'normal',
        createdAt: minutesAgo(145),
        recipients: [priestKarthik.id], // Requesting Staff Priest Karthik only
        data: {
          leaveId: 101,
          status: 'APPROVED',
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}leave_rejected_lr102`,
        eventType: 'LEAVE_REJECTED',
        entityType: 'leave',
        entityId: '102',
        titleTa: 'விடுப்பு விண்ணப்பம் நிராகரிக்கப்பட்டது',
        bodyTa: 'நிகழ்வுகள் திட்டமிடப்பட்டுள்ளதால் உங்களது விடுப்பு விண்ணப்பம் நிராகரிக்கப்பட்டது.',
        titleEn: 'Leave Application Rejected',
        bodyEn: 'Your leave application has been rejected due to scheduled temple bookings.',
        priority: 'normal',
        createdAt: minutesAgo(160),
        recipients: [priestRoshan.id], // Requesting Staff Priest Roshan only
        data: {
          leaveId: 102,
          status: 'REJECTED',
          testBatch: TEST_BATCH_TAG
        }
      },
      {
        key: `${IDEMPOTENCY_PREFIX}attendance_alert_att201`,
        eventType: 'ATTENDANCE_ALERT',
        entityType: 'attendance',
        entityId: '201',
        titleTa: 'பணியாளர் வருகை எச்சரிக்கை',
        bodyTa: 'புரோகிதர் ரோஷன் இன்று வருகை பதிவு செய்யவில்லை (வராதவர்).',
        titleEn: 'Staff Absence Alert',
        bodyEn: 'Priest Roshan has been marked ABSENT for today.',
        priority: 'high',
        createdAt: minutesAgo(180),
        recipients: [...adminUserIds], // Admin only (Attendance alerts go to Admins)
        data: {
          staffId: 15,
          dateKey: '2026-11-11',
          status: 'ABSENT',
          testBatch: TEST_BATCH_TAG
        }
      }
    ];

    // Clean existing test batch if any prior test with same prefix exists
    await connection.execute(
      'DELETE FROM notifications WHERE idempotency_key LIKE ?;',
      [`${IDEMPOTENCY_PREFIX}%`]
    );

    let insertedNotifications = 0;
    let insertedRecipients = 0;

    for (const item of testNotifications) {
      // 1. Insert into notifications
      const [nResult] = await connection.execute(`
        INSERT INTO notifications (
          event_type, idempotency_key, title_en, body_en, title_ta, body_ta,
          entity_type, entity_id, data, priority, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?);
      `, [
        item.eventType,
        item.key,
        item.titleEn,
        item.bodyEn,
        item.titleTa,
        item.bodyTa,
        item.entityType,
        item.entityId,
        JSON.stringify(item.data),
        item.priority,
        item.createdAt
      ]);

      const notificationId = nResult.insertId;
      insertedNotifications++;

      // 2. Insert into notification_recipients as UNREAD (read_at = NULL)
      for (const userId of item.recipients) {
        await connection.execute(`
          INSERT INTO notification_recipients (
            notification_id, user_id, delivery_status, read_at, is_deleted, in_app_visible, created_at
          ) VALUES (?, ?, 'PENDING', NULL, 0, 1, ?);
        `, [
          notificationId,
          userId,
          item.createdAt
        ]);
        insertedRecipients++;
      }
    }

    await connection.commit();

    console.log('🎉 Insertion completed successfully inside transaction!');
    console.log(`📊 Notifications inserted : ${insertedNotifications}`);
    console.log(`📊 Recipient records inserted: ${insertedRecipients}`);

    // Verify unread counts per user
    const [counts] = await pool.query(`
      SELECT nr.user_id, u.name, r.name as role_name, COUNT(*) as unread_count
      FROM notification_recipients nr
      JOIN users u ON u.id = nr.user_id
      JOIN roles r ON r.id = u.role_id
      JOIN notifications n ON n.id = nr.notification_id
      WHERE n.idempotency_key LIKE '${IDEMPOTENCY_PREFIX}%' AND nr.read_at IS NULL
      GROUP BY nr.user_id;
    `);

    console.log('\n📈 Initial Unread Notification Counts per Account:');
    console.table(counts);

  } catch (err) {
    await connection.rollback();
    console.error('❌ Insertion failed, transaction rolled back:', err);
    throw err;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
