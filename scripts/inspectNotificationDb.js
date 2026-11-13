const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { pool, closePool } = require('../src/config/database');

async function inspect() {
  const [users] = await pool.query('SELECT u.id, u.name, u.mobile, r.name as role_name, u.status FROM users u JOIN roles r ON u.role_id = r.id');
  console.log('=== USERS ===');
  console.table(users);

  const [devices] = await pool.query('SELECT id, user_id, device_id, platform, LEFT(fcm_token, 15) as token_start, is_active, last_seen_at, updated_at FROM user_devices');
  console.log('=== USER DEVICES ===');
  console.table(devices);

  const [recentOutbox] = await pool.query('SELECT id, event_type, entity_id, status, attempts, last_error, created_at, processed_at FROM notification_outbox ORDER BY id DESC LIMIT 10');
  console.log('=== RECENT OUTBOX ===');
  console.table(recentOutbox);

  const [recentJobs] = await pool.query('SELECT id, job_type, notification_id, recipient_user_id, status, attempts, last_error, created_at, processed_at FROM notification_jobs ORDER BY id DESC LIMIT 10');
  console.log('=== RECENT JOBS ===');
  console.table(recentJobs);

  const [recentRecipients] = await pool.query('SELECT nr.id, nr.notification_id, nr.user_id, n.event_type, nr.delivery_status, nr.in_app_visible, nr.read_at, nr.push_sent_at, nr.delivery_error FROM notification_recipients nr JOIN notifications n ON nr.notification_id = n.id ORDER BY nr.id DESC LIMIT 10');
  console.log('=== RECENT RECIPIENTS ===');
  console.table(recentRecipients);

  const [o] = await pool.query("SELECT id, event_type, payload, status FROM notification_outbox WHERE event_type = 'BOOKING_COMPLETED' ORDER BY id DESC LIMIT 3");
  console.log('=== OUTBOX BOOKING_COMPLETED PAYLOADS ===');
  console.log(JSON.stringify(o, null, 2));

  const [recentDeliveries] = await pool.query('SELECT * FROM notification_device_deliveries ORDER BY id DESC LIMIT 10');
  console.log('=== RECENT DEVICE DELIVERIES ===');
  console.table(recentDeliveries.map(d => ({
    id: d.id,
    job_id: d.job_id,
    device_id: d.device_id,
    token_preview: (d.fcm_token || '').substring(0, 15),
    status: d.status,
    attempts: d.attempts,
    last_error: d.last_error,
    sent_at: d.sent_at
  })));

  await closePool();
}

inspect().catch(err => {
  console.error('Inspect error:', err);
  process.exit(1);
});
