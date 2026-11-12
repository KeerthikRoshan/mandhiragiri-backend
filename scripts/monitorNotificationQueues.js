#!/usr/bin/env node

/**
 * Notification Queue & Cron Health Diagnostic CLI Tool
 * Inspects worker heartbeat, queue depths, stuck worker leases, and oldest pending jobs.
 *
 * Usage:
 *   node scripts/monitorNotificationQueues.js
 *   node scripts/monitorNotificationQueues.js --json
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { pool, closePool } = require('../src/config/database');
const HEARTBEAT_FILE = path.resolve(__dirname, '../storage/worker_heartbeats.json');

const getQueueHealthData = async () => {
  // 1. Read JSON heartbeat
  let heartbeat = null;
  let heartbeatAgeSeconds = null;
  if (fs.existsSync(HEARTBEAT_FILE)) {
    try {
      heartbeat = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));
      if (heartbeat.last_run_at) {
        heartbeatAgeSeconds = Math.round((Date.now() - new Date(heartbeat.last_run_at).getTime()) / 1000);
      }
    } catch (_) {}
  }

  // 2. Query live database counts
  const [outboxCounts] = await pool.execute(`
    SELECT status, COUNT(*) AS count
    FROM notification_outbox
    GROUP BY status;
  `);

  const [jobCounts] = await pool.execute(`
    SELECT job_type, status, COUNT(*) AS count
    FROM notification_jobs
    GROUP BY job_type, status;
  `);

  const [deliveryCounts] = await pool.execute(`
    SELECT status, COUNT(*) AS count
    FROM notification_device_deliveries
    GROUP BY status;
  `);

  // 3. Query device registration & mapping statistics
  const [deviceStats] = await pool.execute(`
    SELECT 
      COUNT(*) AS total_devices,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_devices,
      SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_devices,
      COUNT(DISTINCT user_id) AS total_users,
      COUNT(DISTINCT CASE WHEN is_active = 1 THEN user_id END) AS users_with_active_devices,
      MAX(updated_at) AS last_registration_time
    FROM user_devices;
  `);

  // 4. Query recent Firebase errors and last successful delivery
  const [recentErrors] = await pool.execute(`
    SELECT DISTINCT last_error, COUNT(*) as count, MAX(updated_at) as last_seen
    FROM notification_device_deliveries
    WHERE status = 'FAILED' AND last_error IS NOT NULL
    GROUP BY last_error
    ORDER BY last_seen DESC
    LIMIT 5;
  `);

  const [lastSuccess] = await pool.execute(`
    SELECT MAX(sent_at) AS last_accepted_at
    FROM notification_device_deliveries
    WHERE status = 'SENT';
  `);

  const [stuckOutbox] = await pool.execute(`
    SELECT COUNT(*) AS count
    FROM notification_outbox
    WHERE status = 'PROCESSING' AND lease_expires_at < NOW();
  `);

  const [stuckJobs] = await pool.execute(`
    SELECT COUNT(*) AS count
    FROM notification_jobs
    WHERE status = 'PROCESSING' AND lease_expires_at < NOW();
  `);

  const [oldestPendingOutbox] = await pool.execute(`
    SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
    FROM notification_outbox
    WHERE status = 'PENDING'
    ORDER BY created_at ASC
    LIMIT 1;
  `);

  const [oldestPendingJob] = await pool.execute(`
    SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
    FROM notification_jobs
    WHERE status = 'PENDING'
    ORDER BY created_at ASC
    LIMIT 1;
  `);

  const outboxMap = {};
  outboxCounts.forEach(r => { outboxMap[r.status] = Number(r.count); });

  const jobMap = {};
  jobCounts.forEach(r => {
    const key = `${r.job_type}:${r.status}`;
    jobMap[key] = Number(r.count);
  });

  const deliveryMap = {};
  deliveryCounts.forEach(r => { deliveryMap[r.status] = Number(r.count); });

  let fcmStatus = {
    initialized: false,
    project_id: null,
    client_email: null,
  };
  try {
    const sa = require('../src/config/firebase-service-account.json');
    fcmStatus = {
      initialized: true,
      project_id: sa.project_id || null,
      client_email: sa.client_email || null,
    };
  } catch (_) {}

  const dStat = deviceStats[0] || {};

  return {
    timestamp: new Date().toISOString(),
    fcm_config: fcmStatus,
    heartbeat: {
      found: !!heartbeat,
      age_seconds: heartbeatAgeSeconds,
      data: heartbeat
    },
    outbox: {
      by_status: outboxMap,
      stuck_leases: Number(stuckOutbox[0]?.count || 0),
      oldest_pending_age_seconds: oldestPendingOutbox[0]?.age_seconds ? Number(oldestPendingOutbox[0].age_seconds) : null
    },
    jobs: {
      by_type_and_status: jobMap,
      stuck_leases: Number(stuckJobs[0]?.count || 0),
      oldest_pending_age_seconds: oldestPendingJob[0]?.age_seconds ? Number(oldestPendingJob[0].age_seconds) : null
    },
    device_deliveries: {
      by_status: deliveryMap,
      last_accepted_at: lastSuccess[0]?.last_accepted_at || null
    },
    devices: {
      total: Number(dStat.total_devices || 0),
      active: Number(dStat.active_devices || 0),
      inactive: Number(dStat.inactive_devices || 0),
      total_users: Number(dStat.total_users || 0),
      users_with_active_devices: Number(dStat.users_with_active_devices || 0),
      last_registration_time: dStat.last_registration_time || null
    },
    recent_errors: recentErrors.map(e => ({
      error: e.last_error,
      count: Number(e.count),
      last_seen: e.last_seen
    }))
  };
};

const run = async () => {
  const isJson = process.argv.includes('--json');

  try {
    const data = await getQueueHealthData();

    if (isJson) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log('====================================================');
      console.log('   MANDHIRAGIRI JOTHIDAM NOTIFICATION QUEUE HEALTH   ');
      console.log('====================================================');
      console.log(`Current Time: ${data.timestamp}`);
      console.log('\n--- CRON HEARTBEAT ---');
      if (data.heartbeat.found) {
        console.log(`Last Run:    ${data.heartbeat.data.last_run_at} (${data.heartbeat.age_seconds}s ago)`);
        console.log(`Status:      ${data.heartbeat.data.status}`);
        console.log(`Duration:    ${data.heartbeat.data.duration_ms}ms`);
      } else {
        console.log('No heartbeat recorded yet in storage/worker_heartbeats.json');
      }

      console.log('\n--- NOTIFICATION OUTBOX ---');
      console.log(`Pending:     ${data.outbox.by_status.PENDING || 0}`);
      console.log(`Processing:  ${data.outbox.by_status.PROCESSING || 0}`);
      console.log(`Completed:   ${data.outbox.by_status.COMPLETED || 0}`);
      console.log(`Failed:      ${data.outbox.by_status.FAILED || 0}`);
      console.log(`Stuck Leases: ${data.outbox.stuck_leases}`);
      console.log(`Oldest Pending Age: ${data.outbox.oldest_pending_age_seconds !== null ? `${data.outbox.oldest_pending_age_seconds}s` : 'None'}`);

      console.log('\n--- NOTIFICATION JOBS ---');
      Object.entries(data.jobs.by_type_and_status).forEach(([k, v]) => {
        console.log(`  ${k}: ${v}`);
      });
      console.log(`Stuck Leases: ${data.jobs.stuck_leases}`);
      console.log(`Oldest Pending Age: ${data.jobs.oldest_pending_age_seconds !== null ? `${data.jobs.oldest_pending_age_seconds}s` : 'None'}`);

      console.log('\n--- DEVICE DELIVERIES ---');
      console.log(`Pending:     ${data.device_deliveries.by_status.PENDING || 0}`);
      console.log(`Sent:        ${data.device_deliveries.by_status.SENT || 0}`);
      console.log(`Failed:      ${data.device_deliveries.by_status.FAILED || 0}`);
      console.log(`Skipped:     ${data.device_deliveries.by_status.SKIPPED || 0}`);
      console.log('====================================================');
    }
  } catch (err) {
    console.error('Diagnostic error:', err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
};

if (require.main === module) {
  run().then(() => {
    process.exit(process.exitCode || 0);
  });
}

module.exports = { getQueueHealthData };
