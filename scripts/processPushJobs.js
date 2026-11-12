/**
 * Standalone Push Delivery Worker CLI Runner
 * Suitable for running via Linux Cron (Hostinger / cPanel / hPanel)
 * or triggering via scheduled worker processes.
 *
 * Example Cron Configuration:
 * * * * * * cd /home/uXXXX/public_html/api && /usr/bin/node scripts/processPushJobs.js >> /home/uXXXX/logs/push_worker.log 2>&1
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const crypto = require('crypto');
const { pool, closePool } = require('../src/config/database');
const pushWorkerService = require('../src/services/pushWorkerService');

const BATCH_SIZE = 25;
const MAX_JOBS_PER_RUN = 100; // Safety cap per cron invocation

const runPushWorker = async (options = {}) => {
  const { isTimeBudgetAvailable = () => true, shouldClosePool = true } = options;
  const startTime = Date.now();
  const workerLeaseToken = crypto.randomUUID();
  let totalProcessed = 0;
  let totalSent = 0;
  let totalFailed = 0;
  let totalRetried = 0;
  let totalSkipped = 0;

  console.log(`[PushWorker] Starting execution at ${new Date().toISOString()} (Worker Token: ${workerLeaseToken})`);

  try {
    // 1. Sweep abandoned jobs whose leases expired on final attempt
    const sweptCount = await pushWorkerService.sweepAbandonedPushJobs();
    if (sweptCount > 0) {
      console.log(`[PushWorker] Swept ${sweptCount} abandoned push job(s) whose worker leases expired.`);
    }

    // 2. Process push queue in batches
    while (totalProcessed < MAX_JOBS_PER_RUN && isTimeBudgetAvailable()) {
      const remainingLimit = Math.min(BATCH_SIZE, MAX_JOBS_PER_RUN - totalProcessed);
      const claimedJobs = await pushWorkerService.claimPushJobsBatch({
        workerLeaseToken,
        batchSize: remainingLimit
      });

      if (!claimedJobs || claimedJobs.length === 0) {
        break; // Queue drained
      }

      for (const job of claimedJobs) {
        if (!isTimeBudgetAvailable()) break;
        totalProcessed++;
        const outcome = await pushWorkerService.processSinglePushJob(job, {
          workerLeaseToken
        });

        if (outcome.status === 'COMPLETED') {
          totalSent += outcome.deliveredCount;
        } else if (outcome.status === 'RETRY_SCHEDULED') {
          totalRetried++;
        } else if (outcome.status === 'FAILED') {
          totalFailed++;
        } else if (outcome.status === 'SKIPPED') {
          totalSkipped++;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[PushWorker] Finished in ${durationMs}ms. Processed: ${totalProcessed}, Delivered Devices: ${totalSent}, Retried: ${totalRetried}, Failed: ${totalFailed}, Skipped: ${totalSkipped}`
    );
    return { totalProcessed, totalSent, totalFailed, totalRetried, totalSkipped, durationMs };
  } catch (err) {
    console.error('[PushWorker] Fatal error during push worker execution:', err);
    process.exitCode = 1;
    throw err;
  } finally {
    if (shouldClosePool) {
      await closePool();
    }
  }
};

if (require.main === module) {
  runPushWorker().then(() => {
    process.exit(process.exitCode || 0);
  });
}

module.exports = { runPushWorker };

