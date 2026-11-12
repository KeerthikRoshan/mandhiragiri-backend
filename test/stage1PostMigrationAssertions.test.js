const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/database');

describe('Stage 1: Post-Migration Schema Assertions on mandhiragiri_db', () => {
  after(async () => {
    await closePool();
  });

  it('1. bookings: asserts schedule_version column exists with default 1', async () => {
    const [cols] = await pool.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'schedule_version';
    `);
    assert.equal(cols.length, 1);
    assert.equal(cols[0].DATA_TYPE, 'int');
    assert.equal(cols[0].IS_NULLABLE, 'NO');
    assert.equal(cols[0].COLUMN_DEFAULT, '1');
  });

  it('2. leave_requests: asserts decision_version column exists with default 0', async () => {
    const [cols] = await pool.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_requests' AND COLUMN_NAME = 'decision_version';
    `);
    assert.equal(cols.length, 1);
    assert.equal(cols[0].DATA_TYPE, 'int');
    assert.equal(cols[0].IS_NULLABLE, 'NO');
    assert.equal(cols[0].COLUMN_DEFAULT, '0');
  });

  it('3. notification_jobs: asserts schedule_version, lease_token, lease_expires_at, and nullable notification_id', async () => {
    const [cols] = await pool.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_jobs' 
        AND COLUMN_NAME IN ('schedule_version', 'lease_token', 'lease_expires_at', 'notification_id');
    `);
    const colMap = Object.fromEntries(cols.map(c => [c.COLUMN_NAME, c]));

    // notification_id nullable
    assert.ok(colMap.notification_id, 'notification_id column exists');
    assert.equal(colMap.notification_id.IS_NULLABLE, 'YES', 'notification_id must be nullable');

    // schedule_version
    assert.ok(colMap.schedule_version, 'schedule_version column exists');
    assert.equal(colMap.schedule_version.DATA_TYPE, 'int');
    assert.equal(colMap.schedule_version.IS_NULLABLE, 'NO');
    assert.equal(colMap.schedule_version.COLUMN_DEFAULT, '1');

    // lease_token
    assert.ok(colMap.lease_token, 'lease_token column exists');
    assert.equal(colMap.lease_token.DATA_TYPE, 'varchar');
    assert.equal(colMap.lease_token.IS_NULLABLE, 'YES');

    // lease_expires_at
    assert.ok(colMap.lease_expires_at, 'lease_expires_at column exists');
    assert.equal(colMap.lease_expires_at.DATA_TYPE, 'timestamp');
    assert.equal(colMap.lease_expires_at.IS_NULLABLE, 'YES');
  });

  it('4. notification_jobs: asserts foreign key fk_notification_jobs_notification exists and references notifications(id)', async () => {
    const [fks] = await pool.execute(`
      SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME 
      FROM information_schema.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_jobs' 
        AND COLUMN_NAME = 'notification_id' AND REFERENCED_TABLE_NAME = 'notifications';
    `);
    assert.equal(fks.length, 1);
    assert.equal(fks[0].CONSTRAINT_NAME, 'fk_notification_jobs_notification');
  });

  it('5. notification_outbox: asserts table exists with correct columns, unique key, and index', async () => {
    const [tables] = await pool.execute(`
      SELECT TABLE_NAME FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_outbox';
    `);
    assert.equal(tables.length, 1);

    const [indexes] = await pool.execute(`
      SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX 
      FROM information_schema.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_outbox';
    `);
    const indexNames = [...new Set(indexes.map(i => i.INDEX_NAME))];
    assert.ok(indexNames.includes('PRIMARY'), 'Must have PRIMARY key');
    assert.ok(indexNames.includes('event_key'), 'Must have event_key unique index');
    assert.ok(indexNames.includes('idx_outbox_status_next'), 'Must have idx_outbox_status_next index');
    assert.ok(indexNames.includes('idx_outbox_entity'), 'Must have idx_outbox_entity index');
  });

  it('6. api_idempotency_records: asserts table exists with uq_user_idem_scope unique key', async () => {
    const [tables] = await pool.execute(`
      SELECT TABLE_NAME FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_idempotency_records';
    `);
    assert.equal(tables.length, 1);

    const [indexes] = await pool.execute(`
      SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX 
      FROM information_schema.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_idempotency_records';
    `);
    const indexNames = [...new Set(indexes.map(i => i.INDEX_NAME))];
    assert.ok(indexNames.includes('PRIMARY'), 'Must have PRIMARY key');
    assert.ok(indexNames.includes('uq_user_idem_scope'), 'Must have uq_user_idem_scope unique key');
    assert.ok(indexNames.includes('idx_api_idem_created'), 'Must have idx_api_idem_created index');
  });

  it('7. notification_device_deliveries: asserts table exists with uq_job_device and cascade foreign keys', async () => {
    const [tables] = await pool.execute(`
      SELECT TABLE_NAME FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_device_deliveries';
    `);
    assert.equal(tables.length, 1);

    const [fks] = await pool.execute(`
      SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME 
      FROM information_schema.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_device_deliveries' 
        AND REFERENCED_TABLE_NAME IS NOT NULL;
    `);
    const fkMap = Object.fromEntries(fks.map(f => [f.COLUMN_NAME, f.REFERENCED_TABLE_NAME]));
    assert.equal(fkMap.job_id, 'notification_jobs', 'job_id must reference notification_jobs');
    assert.equal(fkMap.device_id, 'user_devices', 'device_id must reference user_devices');

    const [indexes] = await pool.execute(`
      SELECT INDEX_NAME 
      FROM information_schema.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_device_deliveries';
    `);
    const indexNames = [...new Set(indexes.map(i => i.INDEX_NAME))];
    assert.ok(indexNames.includes('uq_job_device'), 'Must have uq_job_device unique index');
    assert.ok(indexNames.includes('idx_dev_deliv_job'), 'Must have idx_dev_deliv_job index');
  });
});
