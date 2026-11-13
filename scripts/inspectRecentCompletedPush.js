const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { pool, closePool } = require('../src/config/database');

async function inspectNotifs() {
  const [j] = await pool.query('SELECT j.*, n.event_type, n.title_en, n.title_ta FROM notification_jobs j LEFT JOIN notifications n ON j.notification_id = n.id WHERE j.id IN (1000397, 1000398)');
  console.log('JOBS 1000397 & 1000398:');
  console.log(JSON.stringify(j, null, 2));

  await closePool();
}

inspectNotifs();
