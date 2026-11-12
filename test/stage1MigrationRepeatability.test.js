const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

describe('Stage 1: Migration 014 Repeatability & Schema Verification in Isolated Test Database', () => {
  let connection;
  const testDbName = 'mandhiragiri_stage1_repeatability_test';
  const migrationsDir = path.join(__dirname, '../database/migrations');

  before(async () => {
    connection = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
      multipleStatements: true
    });

    // Create fresh isolated test database
    await connection.query(`DROP DATABASE IF EXISTS \`${testDbName}\`;`);
    await connection.query(`CREATE DATABASE \`${testDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await connection.query(`USE \`${testDbName}\`;`);

    // Apply baseline migrations 001-013
    const baselineFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && f < '014').sort();
    for (const f of baselineFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      await connection.query(sql);
    }
  });

  after(async () => {
    if (connection) {
      try {
        await connection.query(`DROP DATABASE IF EXISTS \`${testDbName}\`;`);
        await connection.end();
      } catch (_) {}
    }
  });

  it('Pre-Migration Schema Assertions: confirms baseline 001-013 state', async () => {
    // Assert notification_jobs.notification_id is currently NOT NULL
    const [nullCols] = await connection.query(`
      SELECT IS_NULLABLE FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'notification_jobs' AND COLUMN_NAME = 'notification_id';
    `);
    assert.equal(nullCols[0].IS_NULLABLE, 'NO', 'notification_id must be NOT NULL in baseline');

    // Assert new columns do not exist yet
    const [schedCols] = await connection.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'schedule_version';
    `);
    assert.equal(schedCols[0].cnt, 0);

    // Assert new tables do not exist yet
    const [outboxTables] = await connection.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'notification_outbox';
    `);
    assert.equal(outboxTables[0].cnt, 0);
  });

  it('First Execution: applies Migration 014 successfully', async () => {
    const migration014Sql = fs.readFileSync(
      path.join(migrationsDir, '014_create_notification_outbox_and_enhance_jobs.sql'),
      'utf8'
    );
    await connection.query(migration014Sql);

    // Post-migration assertions
    const [res] = await connection.query(`
      SELECT 
        (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'notification_outbox') AS has_outbox,
        (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'api_idempotency_records') AS has_api_idem,
        (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'notification_device_deliveries') AS has_dev_deliv,
        (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'schedule_version') AS has_booking_sched,
        (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'leave_requests' AND COLUMN_NAME = 'decision_version') AS has_leave_dec,
        (SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'notification_jobs' AND COLUMN_NAME = 'notification_id') AS job_notif_null,
        (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'notification_jobs' AND COLUMN_NAME = 'notification_id' AND REFERENCED_TABLE_NAME = 'notifications') AS has_fk_notif;
    `);

    assert.equal(res[0].has_outbox, 1, 'notification_outbox table must exist');
    assert.equal(res[0].has_api_idem, 1, 'api_idempotency_records table must exist');
    assert.equal(res[0].has_dev_deliv, 1, 'notification_device_deliveries table must exist');
    assert.equal(res[0].has_booking_sched, 1, 'bookings.schedule_version must exist');
    assert.equal(res[0].has_leave_dec, 1, 'leave_requests.decision_version must exist');
    assert.equal(res[0].job_notif_null, 'YES', 'notification_jobs.notification_id must be nullable');
    assert.equal(res[0].has_fk_notif, 1, 'Foreign key to notifications must exist');
  });

  it('Second Execution (Repeatability): re-running Migration 014 succeeds idempotently with zero errors', async () => {
    const migration014Sql = fs.readFileSync(
      path.join(migrationsDir, '014_create_notification_outbox_and_enhance_jobs.sql'),
      'utf8'
    );

    // Run again - must not throw duplicate column or duplicate key errors
    await connection.query(migration014Sql);

    // Verify all assertions still hold true
    const [res] = await connection.query(`
      SELECT 
        (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'notification_outbox') AS has_outbox,
        (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'api_idempotency_records') AS has_api_idem,
        (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'notification_device_deliveries') AS has_dev_deliv,
        (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'schedule_version') AS has_booking_sched,
        (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'leave_requests' AND COLUMN_NAME = 'decision_version') AS has_leave_dec,
        (SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'notification_jobs' AND COLUMN_NAME = 'notification_id') AS job_notif_null,
        (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = '${testDbName}' AND TABLE_NAME = 'notification_jobs' AND COLUMN_NAME = 'notification_id' AND REFERENCED_TABLE_NAME = 'notifications') AS has_fk_notif;
    `);

    assert.equal(res[0].has_outbox, 1);
    assert.equal(res[0].has_api_idem, 1);
    assert.equal(res[0].has_dev_deliv, 1);
    assert.equal(res[0].has_booking_sched, 1);
    assert.equal(res[0].has_leave_dec, 1);
    assert.equal(res[0].job_notif_null, 'YES');
    assert.equal(res[0].has_fk_notif, 1);
  });
});
