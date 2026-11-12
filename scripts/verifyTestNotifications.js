const { pool } = require('../src/config/database');
const notificationModel = require('../src/models/notificationModel');

async function verify() {
  console.log('--- ADMIN VERIFICATION (User 1) ---');
  const adminUnread = await notificationModel.getUnreadCountForUser(1);
  const adminListTa = await notificationModel.listNotificationsForUser(1, { lang: 'ta', limit: 5 });
  const adminListEn = await notificationModel.listNotificationsForUser(1, { lang: 'en', limit: 2 });
  console.log('Admin unread count:', adminUnread);
  console.log('Admin top notifications (Tamil):');
  adminListTa.notifications.forEach(n => console.log('  [' + n.eventType + '] ' + n.title + ' -> ' + n.body + ' (isRead: ' + n.isRead + ')'));
  console.log('Admin top notifications (English):');
  adminListEn.notifications.forEach(n => console.log('  [' + n.eventType + '] ' + n.title + ' -> ' + n.body + ' (isRead: ' + n.isRead + ')'));

  console.log('\n--- PRIEST KARTHIK VERIFICATION (User 4) ---');
  const priestUnread = await notificationModel.getUnreadCountForUser(4);
  const priestList = await notificationModel.listNotificationsForUser(4, { lang: 'ta', limit: 5 });
  console.log('Priest 4 unread count:', priestUnread);
  priestList.notifications.forEach(n => console.log('  [' + n.eventType + '] ' + n.title + ' (isRead: ' + n.isRead + ')'));

  console.log('\n--- PRIEST ROSHAN VERIFICATION (User 16) ---');
  const roshanUnread = await notificationModel.getUnreadCountForUser(16);
  const roshanList = await notificationModel.listNotificationsForUser(16, { lang: 'ta', limit: 5 });
  console.log('Priest 16 unread count:', roshanUnread);
  roshanList.notifications.forEach(n => console.log('  [' + n.eventType + '] ' + n.title + ' (isRead: ' + n.isRead + ')'));

  console.log('\n--- PUSH JOBS CHECK (Must be 0) ---');
  const [jobs] = await pool.query("SELECT COUNT(*) as c FROM notification_jobs WHERE idempotency_key LIKE 'test_ui_stage5_%';");
  console.log('Test Push Delivery Jobs in notification_jobs:', jobs[0].c);

  await pool.end();
  process.exit(0);
}

verify().catch(console.error);
