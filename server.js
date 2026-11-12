const dotenv = require('dotenv');

// Load environment variables before any other module
dotenv.config();

const app = require('./src/app');
const { testConnection, closePool } = require('./src/config/database');

const PORT = parseInt(process.env.PORT, 10) || 5000;

let server;
let cronInterval = null;

/**
 * Start Express HTTP server and verify database connectivity
 */
const startServer = async () => {
  try {
    console.log('[Server] Connecting to MySQL database...');
    const isDbConnected = await testConnection();

    if (!isDbConnected) {
      console.warn('[Server Warning] MySQL database is currently unreachable. Server will start in degraded mode.');
    } else {
      console.log('[Server] MySQL database connected successfully.');
    }

    server = app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`  Mandhiragiri Jothidam Backend Server                 `);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`  Port:        ${PORT}                                 `);
      console.log(`  Health API:  http://localhost:${PORT}/health         `);
      console.log(`  Auth API:    http://localhost:${PORT}/api/v1/auth    `);
      console.log(`=======================================================`);
    });

    // In local development / testing, run periodic cron worker if not production or if enabled
    if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_DEV_CRON === 'true') {
      const { runMasterCron } = require('./scripts/cronRunner');
      const DEV_CRON_INTERVAL_MS = parseInt(process.env.DEV_CRON_INTERVAL_MS, 10) || 5000;
      console.log(`[Server] Enabling local dev cron worker (interval: ${DEV_CRON_INTERVAL_MS}ms)`);
      cronInterval = setInterval(async () => {
        try {
          await runMasterCron({ shouldClosePool: false });
        } catch (err) {
          console.warn('[Server Dev Cron Warning]', err.message);
        }
      }, DEV_CRON_INTERVAL_MS);
    }
  } catch (error) {
    console.error('[Server Error] Failed to start server:', error);
    process.exit(1);
  }
};

/**
 * Graceful server shutdown
 * @param {string} signal
 */
const gracefulShutdown = (signal) => {
  console.log(`\n[Server] Received ${signal}. Initiating graceful shutdown...`);

  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }

  if (server) {
    server.close(async () => {
      console.log('[Server] HTTP server closed.');
      await closePool();
      console.log('[Server] Graceful shutdown completed.');
      process.exit(0);
    });

    // Force shutdown after timeout if connections hang
    setTimeout(() => {
      console.error('[Server] Forcing shutdown after timeout.');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
};

// Process lifecycle event listeners
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process Error] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Process Error] Uncaught Exception thrown:', error);
  process.exit(1);
});

startServer();
