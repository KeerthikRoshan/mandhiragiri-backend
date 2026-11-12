#!/usr/bin/env node

/**
 * Unified Master Cron Runner for Mandhiragiri Jothidam (Phase 5)
 * Suitable for running once per minute on Hostinger / cPanel / hPanel.
 *
 * Enforces:
 * 1. MariaDB Advisory Locking (`GET_LOCK` / `RELEASE_LOCK`) with dedicated connection destruction on failure.
 * 2. Shared 45-second execution budget across all sequential stages:
 *    - Stage A: Booking Reminders (24h & 1h)
 *    - Stage B: Outbox Event Processing (Tamil/English generation & dispatch)
 *    - Stage C: FCM Push Delivery Worker
 * 3. Atomic JSON heartbeat to storage/worker_heartbeats.json via temporary file rename.
 *
 * Example Hostinger Cron:
 * * * * * * cd /home/uXXXX/public_html/api && /usr/bin/node scripts/cronRunner.js >> /home/uXXXX/logs/cron_runner.log 2>&1
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { pool, closePool } = require('../src/config/database');
const { runReminderWorker } = require('./processBookingReminders');
const { runOutboxWorker } = require('./processOutbox');
const { runPushWorker } = require('./processPushJobs');

const LOCK_NAME = 'mandhiragiri_cron_lock';
const CRON_BUDGET_MS = 45000;
const SAFETY_MARGIN_MS = 5000;

const HEARTBEAT_FILE = path.resolve(__dirname, '../storage/worker_heartbeats.json');

/**
 * Atomically record heartbeat JSON using temp file rename
 *
 * @param {Object} data
 */
const recordHeartbeat = (data) => {
  try {
    const dir = path.dirname(HEARTBEAT_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpFile = `${HEARTBEAT_FILE}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, HEARTBEAT_FILE);
  } catch (err) {
    console.error('[CronRunner] Warning: Failed to write heartbeat file:', err.message);
  }
};

/**
 * Execute master cron pipeline under advisory lock
 *
 * @param {Object} [options={}]
 * @param {number} [options.budgetMs=45000]
 * @param {boolean} [options.shouldClosePool=true]
 * @returns {Promise<Object>} Execution summary
 */
const runMasterCron = async (options = {}) => {
  const { budgetMs = CRON_BUDGET_MS, shouldClosePool = true } = options;
  const startTime = Date.now();
  const isTimeBudgetAvailable = () => (Date.now() - startTime) < (budgetMs - SAFETY_MARGIN_MS);

  let lockConnection = null;
  let lockAcquired = false;

  const summary = {
    started_at: new Date(startTime).toISOString(),
    lock_acquired: false,
    duration_ms: 0,
    status: 'UNKNOWN',
    stages: {
      reminders: null,
      outbox: null,
      push: null
    }
  };

  try {
    // 1. Acquire dedicated connection from pool for advisory lock
    lockConnection = await pool.getConnection();

    const [lockRows] = await lockConnection.execute(
      `SELECT GET_LOCK(?, 0) AS lock_acquired;`,
      [LOCK_NAME]
    );

    if (!lockRows || lockRows.length === 0 || lockRows[0].lock_acquired !== 1) {
      console.log(`[CronRunner] [${new Date().toISOString()}] Advisory lock '${LOCK_NAME}' is currently held by another worker. Skipping invocation.`);
      summary.status = 'SKIPPED_LOCK_HELD';
      summary.duration_ms = Date.now() - startTime;
      return summary;
    }

    lockAcquired = true;
    summary.lock_acquired = true;
    console.log(`[CronRunner] [${new Date().toISOString()}] Acquired advisory lock '${LOCK_NAME}'. Starting sequential pipeline...`);

    // 2. Stage A: Booking Reminders
    if (isTimeBudgetAvailable()) {
      summary.stages.reminders = await runReminderWorker({
        isTimeBudgetAvailable,
        shouldClosePool: false
      });
    } else {
      console.log('[CronRunner] Time budget exhausted before reminders stage.');
    }

    // 3. Stage B: Outbox Event Processing
    if (isTimeBudgetAvailable()) {
      summary.stages.outbox = await runOutboxWorker({
        isTimeBudgetAvailable,
        shouldClosePool: false
      });
    } else {
      console.log('[CronRunner] Time budget exhausted before outbox stage.');
    }

    // 4. Stage C: Push Delivery Worker
    if (isTimeBudgetAvailable()) {
      summary.stages.push = await runPushWorker({
        isTimeBudgetAvailable,
        shouldClosePool: false
      });
    } else {
      console.log('[CronRunner] Time budget exhausted before push stage.');
    }

    summary.status = 'SUCCESS';
  } catch (err) {
    summary.status = 'ERROR';
    summary.error = err.message;
    console.error(`[CronRunner] Fatal pipeline error:`, err);
    process.exitCode = 1;
  } finally {
    const duration = Date.now() - startTime;
    summary.duration_ms = duration;
    summary.finished_at = new Date().toISOString();

    // 5. Record atomic JSON heartbeat if lock was acquired
    if (lockAcquired) {
      recordHeartbeat({
        last_run_at: summary.finished_at,
        duration_ms: duration,
        status: summary.status,
        reminders: summary.stages.reminders,
        outbox: summary.stages.outbox,
        push: summary.stages.push,
        error: summary.error || null
      });
    }

    // 6. Release advisory lock safely
    if (lockConnection) {
      try {
        if (lockAcquired) {
          const [releaseRows] = await lockConnection.execute(
            `SELECT RELEASE_LOCK(?) AS lock_released;`,
            [LOCK_NAME]
          );
          if (releaseRows && releaseRows[0] && releaseRows[0].lock_released === 1) {
            lockConnection.release();
          } else {
            console.warn(`[CronRunner] RELEASE_LOCK did not return 1. Destroying dedicated connection.`);
            lockConnection.destroy();
          }
        } else {
          lockConnection.release();
        }
      } catch (releaseErr) {
        console.error(`[CronRunner] Error during RELEASE_LOCK:`, releaseErr.message);
        try {
          lockConnection.destroy();
        } catch (_) {}
      }
    }

    if (shouldClosePool) {
      await closePool();
    }
  }

  console.log(`[CronRunner] [${summary.finished_at}] Pipeline complete in ${summary.duration_ms}ms with status: ${summary.status}`);
  return summary;
};

if (require.main === module) {
  runMasterCron().then(() => {
    process.exit(process.exitCode || 0);
  });
}

module.exports = {
  runMasterCron,
  recordHeartbeat,
  LOCK_NAME,
  HEARTBEAT_FILE
};
