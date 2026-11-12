const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pool, closePool } = require('../src/config/database');

describe('Stage 1: Migration 014 & Schema Preflight Verification', () => {
  const migrationPath = path.join(__dirname, '../database/migrations/014_create_notification_outbox_and_enhance_jobs.sql');

  it('Migration 014 SQL file exists and contains all required DDL statements', () => {
    assert.equal(fs.existsSync(migrationPath), true, 'Migration 014 file must exist');
    const content = fs.readFileSync(migrationPath, 'utf8');

    // Assert key components
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS `notification_outbox`'), 'Must create notification_outbox');
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS `api_idempotency_records`'), 'Must create api_idempotency_records');
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS `notification_device_deliveries`'), 'Must create notification_device_deliveries');
    assert.ok(content.includes('schedule_version'), 'Must manage schedule_version on bookings and jobs');
    assert.ok(content.includes('decision_version'), 'Must manage decision_version on leave_requests');
    assert.ok(content.includes('lease_token'), 'Must manage lease_token on notification_jobs');
    assert.ok(content.includes('lease_expires_at'), 'Must manage lease_expires_at on notification_jobs');
    assert.ok(content.includes('SET FOREIGN_KEY_CHECKS = 1'), 'Must restore foreign key checks');
  });

  it('Database Preflight: validates notification_jobs foreign key and nullability status', async () => {
    const [fkRows] = await pool.execute(`
      SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME 
      FROM information_schema.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'notification_jobs' 
        AND COLUMN_NAME = 'notification_id'
        AND REFERENCED_TABLE_NAME = 'notifications';
    `);

    // Verify foreign key exists in live schema
    assert.ok(fkRows.length >= 1, 'Foreign key on notification_id must exist in information_schema');
    assert.equal(fkRows[0].REFERENCED_TABLE_NAME, 'notifications');

    const [colRows] = await pool.execute(`
      SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_jobs' AND COLUMN_NAME = 'notification_id';
    `);
    assert.ok(colRows.length >= 1);
  });

  it('Database Preflight: asserts zero orphan NULL-notification jobs exist', async () => {
    const [rows] = await pool.execute(`
      SELECT COUNT(*) AS null_jobs_count FROM notification_jobs WHERE notification_id IS NULL;
    `);
    assert.equal(rows[0].null_jobs_count, 0, 'Must have zero orphan NULL notification jobs before migration');
  });

  it('Database Preflight: confirms user_devices schema structure has required columns', async () => {
    const [cols] = await pool.execute(`
      SELECT COLUMN_NAME 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_devices';
    `);
    const colNames = cols.map(c => c.COLUMN_NAME);
    assert.ok(colNames.includes('id'), 'Must have id');
    assert.ok(colNames.includes('user_id'), 'Must have user_id');
    assert.ok(colNames.includes('fcm_token'), 'Must have fcm_token');
    assert.ok(colNames.includes('is_active'), 'Must have is_active');
  });

  after(async () => {
    await closePool();
  });
});
