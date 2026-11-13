const { pool } = require('../src/config/database');
const projectService = require('../src/services/projectService');
const outboxProcessorService = require('../src/services/outboxProcessorService');
const pushWorkerService = require('../src/services/pushWorkerService');

(async () => {
  try {
    console.log('[Test] Step 1: Finding active staff member...');
    const [staffRows] = await pool.execute(`
      SELECT s.id AS staff_id, s.user_id, s.name_english, s.name_tamil 
      FROM staff s 
      INNER JOIN users u ON u.id = s.user_id 
      WHERE u.status = 'ACTIVE' 
      LIMIT 1;
    `);

    if (staffRows.length === 0) {
      throw new Error('No active staff member found in database.');
    }
    const staff = staffRows[0];
    console.log(`[Test] Selected staff: ID ${staff.staff_id}, User ID ${staff.user_id}, Name: ${staff.name_english}`);

    // Check active Admin device
    const [adminDevices] = await pool.execute(`
      SELECT ud.id, ud.user_id, ud.device_id, ud.fcm_token 
      FROM user_devices ud 
      INNER JOIN users u ON u.id = ud.user_id 
      INNER JOIN roles r ON r.id = u.role_id 
      WHERE r.name IN ('SUPER_ADMIN', 'ADMIN') 
        AND u.status = 'ACTIVE' 
        AND ud.is_active = 1;
    `);
    console.log(`[Test] Active Admin devices count: ${adminDevices.length}`);
    if (adminDevices.length === 0) {
      console.warn('[Test Warning] No active admin device found with is_active = 1!');
    }

    const testStartDate = '2026-12-15';
    const testEndDate = '2026-12-16';

    // Clear any conflicting test leave
    await pool.execute('DELETE FROM leave_requests WHERE staff_id = ? AND start_date = ?', [staff.staff_id, testStartDate]);

    console.log('[Test] Step 2: Applying staff leave via projectService.applyLeave()...');
    const leaveInput = {
      startDate: testStartDate,
      endDate: testEndDate,
      leaveType: 'CASUAL',
      reason: 'Automated test leave application'
    };

    const leaveResult = await projectService.applyLeave(leaveInput, staff.user_id);
    console.log('[Test] Leave created successfully with ID:', leaveResult.id);

    // Verify outbox entry
    const [outboxRows] = await pool.execute(
      `SELECT * FROM notification_outbox WHERE entity_type = 'leave' AND entity_id = ?`,
      [leaveResult.id]
    );
    console.log(`[Test] Step 3: Outbox rows for leave ${leaveResult.id}:`, outboxRows.length);
    if (outboxRows.length === 0) {
      throw new Error('Outbox event LEAVE_REQUESTED was not inserted!');
    }
    console.log('[Test] Outbox event payload:', outboxRows[0].payload);

    // Process outbox
    console.log('[Test] Step 4: Running outboxProcessorService.processOutboxQueue()...');
    const outboxResult = await outboxProcessorService.processOutboxQueue({ batchSize: 5 });
    console.log('[Test] Outbox processing result:', outboxResult);

    // Verify notifications and notification_jobs
    const [notifRows] = await pool.execute(
      `SELECT * FROM notifications WHERE entity_type = 'leave' AND entity_id = ?`,
      [leaveResult.id]
    );
    console.log(`[Test] Step 5: Notifications created:`, notifRows.length);
    if (notifRows.length > 0) {
      console.log('[Test] Notification title_en:', notifRows[0].title_en, '| title_ta:', notifRows[0].title_ta);
      console.log('[Test] Notification body_en:', notifRows[0].body_en, '| body_ta:', notifRows[0].body_ta);
    }

    const [jobRows] = await pool.execute(
      `SELECT * FROM notification_jobs WHERE entity_type = 'leave' AND entity_id = ?`,
      [leaveResult.id]
    );
    console.log(`[Test] Notification jobs created:`, jobRows.length);
    if (jobRows.length > 0) {
      console.log('[Test] Job recipient user ID:', jobRows[0].recipient_user_id, 'Status:', jobRows[0].status);
    }

    // Process push jobs
    console.log('[Test] Step 6: Running pushWorkerService.processPushQueue()...');
    const pushResult = await pushWorkerService.processPushQueue({ batchSize: 5 });
    console.log('[Test] Push worker result:', pushResult);

    // Check device deliveries
    if (jobRows.length > 0) {
      const [deliveries] = await pool.execute(
        `SELECT id, job_id, device_id, status, last_error, updated_at 
         FROM notification_device_deliveries WHERE job_id = ?`,
        [jobRows[0].id]
      );
      console.log('[Test] Device delivery outcomes:', deliveries);
    }

    // Clean up test leave
    console.log('[Test] Step 7: Cleaning up test data...');
    await pool.execute('DELETE FROM leave_requests WHERE id = ?', [leaveResult.id]);
    await pool.execute('DELETE FROM leave_requests WHERE start_date = ?', [testStartDate]);
    console.log('[Test] Done! Leave notification flow verified.');
  } catch (error) {
    console.error('[Test Error]:', error);
  } finally {
    process.exit(0);
  }
})();
