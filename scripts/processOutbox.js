#!/usr/bin/env node

/**
 * Standalone Outbox Processor Runner for Mandhiragiri Jothidam (Phase 5)
 * Can be run via Hostinger cron or standalone CLI.
 * Enforces a 45-second execution budget and max batch cap (100 events).
 */

const path = require('path');
const dotenv = require('dotenv');

// Explicitly resolve absolute path to .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { pool, closePool } = require('../src/config/database');
const outboxProcessorService = require('../src/services/outboxProcessorService');
const outboxModel = require('../src/models/outboxModel');

const runOutboxWorker = async (options = {}) => {
  const { isTimeBudgetAvailable = () => true, shouldClosePool = true } = options;
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [ProcessOutbox] Starting outbox queue processing...`);

  let totalProcessed = 0;
  let batches = 0;
  const MAX_BATCHES = 4; // Max 4 batches of 25 = 100 events max

  try {
    // 1. Sweep expired outbox events
    const sweptCount = await outboxModel.sweepExpiredOutboxEvents();
    if (sweptCount > 0) {
      console.log(`[ProcessOutbox] Swept ${sweptCount} expired outbox event(s).`);
    }

    // 2. Process batches
    while (isTimeBudgetAvailable() && batches < MAX_BATCHES) {
      batches++;
      const result = await outboxProcessorService.processOutboxQueue({
        batchSize: 25,
        isTimeBudgetAvailable
      });

      totalProcessed += result.processedCount;

      if (result.claimedCount === 0 || result.claimedCount < 25) {
        // Queue is drained
        break;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] [ProcessOutbox] Completed in ${elapsed}ms. Total processed: ${totalProcessed}.`);
    return { totalProcessed, durationMs: elapsed };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [ProcessOutbox] Fatal error:`, error.message);
    process.exitCode = 1;
    throw error;
  } finally {
    if (shouldClosePool) {
      await closePool();
    }
  }
};

if (require.main === module) {
  runOutboxWorker().then(() => {
    process.exit(process.exitCode || 0);
  });
}

module.exports = { runOutboxWorker };

