/**
 * Standalone CLI Script to generate a valid test notification for Admin testing
 * Usage:
 *   node scripts/create-test-notification.js [eventType]
 *
 * Example:
 *   node scripts/create-test-notification.js BOOKING_CREATED
 */

const dotenv = require('dotenv');
dotenv.config();

const { createNotificationEvent } = require('../src/services/notificationService');
const { NOTIFICATION_EVENTS, ENTITY_TYPES, PRIORITIES } = require('../src/constants/notificationConstants');

async function main() {
  const eventType = process.argv[2] || NOTIFICATION_EVENTS.BOOKING_CREATED;

  console.log(`[Test Notification Generator] Generating test event: ${eventType}...`);

  try {
    const result = await createNotificationEvent({
      eventType,
      titleEn: 'New Pooja Booking Created',
      bodyEn: 'Devotee Ramesh has booked Ganapathi Homam for tomorrow 09:00 AM.',
      titleTa: 'புதிய பூஜை முன்பதிவு',
      bodyTa: 'பக்தர் ரமேஷ் நாளை காலை 09:00 மணிக்கு கணபதி ஹோமம் முன்பதிவு செய்துள்ளார்.',
      entityType: ENTITY_TYPES.BOOKING,
      entityId: Math.floor(100 + Math.random() * 900),
      data: {
        bookingId: 101,
        bookingNumber: `BK-${Date.now().toString().slice(-6)}`,
        devoteeName: 'Ramesh',
        poojaName: 'Ganapathi Homam'
      },
      priority: PRIORITIES.NORMAL,
      idempotencyKey: `test_event_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    });

    console.log('\n========================================');
    console.log('✅ TEST NOTIFICATION CREATED SUCCESSFULLY');
    console.log(`Notification ID : ${result.notification.id}`);
    console.log(`Event Type      : ${result.notification.event_type}`);
    console.log(`Recipients Added: ${result.recipientCount}`);
    console.log(`Title (Tamil)   : ${result.notification.title_ta}`);
    console.log(`Title (English) : ${result.notification.title_en}`);
    console.log('========================================\n');
    console.log('👉 Next Steps in Postman:');
    console.log('1. Call GET /api/v1/notifications to view this notification.');
    console.log('2. Call GET /api/v1/notifications/unread-count to verify unread count.');
    console.log(`3. Call PATCH /api/v1/notifications/${result.notification.id}/read to mark it as read.\n`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to generate test notification:', err.message);
    process.exit(1);
  }
}

main();
