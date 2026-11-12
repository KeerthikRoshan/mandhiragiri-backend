/**
 * Standalone Booking Reminders Worker CLI Runner
 * Suitable for running via Linux Cron (Hostinger / cPanel / hPanel)
 * or triggering via scheduled worker processes.
 *
 * Example Cron Configuration:
 * * * * * * cd /home/uXXXX/public_html/api && /usr/bin/node scripts/processBookingReminders.js >> /home/uXXXX/logs/reminder_worker.log 2>&1
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const crypto = require('crypto');
const { pool, closePool } = require('../src/config/database');
const bookingReminderService = require('../src/services/bookingReminderService');

const BATCH_SIZE = 25;
const MAX_JOBS_PER_RUN = 100;

const runReminderWorker = async (options = {}) => {
  const { isTimeBudgetAvailable = () => true, shouldClosePool = true } = options;
  const startTime = Date.now();
  const workerLeaseToken = crypto.randomUUID();
  let totalProcessed = 0;
  let totalCompleted = 0;
  let totalCancelled = 0;

  console.log(`[ReminderWorker] Starting execution at ${new Date().toISOString()} (Worker Token: ${workerLeaseToken})`);

  try {
    // 1. Sweep abandoned reminder jobs whose worker leases expired after max attempts
    const sweptCount = await bookingReminderService.sweepAbandonedReminderJobs();
    if (sweptCount > 0) {
      console.log(`[ReminderWorker] Swept ${sweptCount} abandoned reminder job(s) whose worker leases expired.`);
    }

    // 2. Process reminder queue in batches
    while (totalProcessed < MAX_JOBS_PER_RUN && isTimeBudgetAvailable()) {
      const remainingLimit = Math.min(BATCH_SIZE, MAX_JOBS_PER_RUN - totalProcessed);
      const claimedJobs = await bookingReminderService.claimReminderJobsBatch({
        workerLeaseToken,
        batchSize: remainingLimit
      });

      if (!claimedJobs || claimedJobs.length === 0) {
        break; // Queue drained
      }

      for (const job of claimedJobs) {
        if (!isTimeBudgetAvailable()) break;
        totalProcessed++;
        const outcome = await bookingReminderService.processSingleReminderJob(job, {
          workerLeaseToken
        });

        if (outcome.status === 'COMPLETED') {
          totalCompleted++;
        } else if (outcome.status === 'CANCELLED') {
          totalCancelled++;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[ReminderWorker] Finished in ${durationMs}ms. Processed Reminders: ${totalProcessed} (Completed: ${totalCompleted}, Cancelled: ${totalCancelled})`
    );
    return { totalProcessed, totalCompleted, totalCancelled, durationMs };
  } catch (err) {
    console.error('[ReminderWorker] Fatal error during reminder worker execution:', err);
    process.exitCode = 1;
    throw err;
  } finally {
    if (shouldClosePool) {
      await closePool();
    }
  }
};

if (require.main === module) {
  runReminderWorker().then(() => {
    process.exit(process.exitCode || 0);
  });
}

module.exports = { runReminderWorker };

