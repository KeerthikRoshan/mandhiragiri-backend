const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mandragiri_db'
  });

  const [b] = await conn.query('SELECT id, CAST(date_key AS CHAR) as date_key, start_time, end_time, priest_id FROM bookings WHERE id = 1');
  const dKey = b[0].date_key;
  console.log('Booking 1 date:', dKey, 'timing:', b[0].start_time, '-', b[0].end_time, 'priest:', b[0].priest_id);

  const query = `
    SELECT id, title, priest_id, priest_name, start_time, end_time
    FROM bookings
    WHERE date_key = ?
      AND (priest_id = ? OR id IN (SELECT booking_id FROM booking_priests WHERE staff_id = ?))
      AND status != 'cancelled'
      AND is_deleted = 0
      AND start_time < ?
      AND end_time > ?
  `;

  // Test 1: Overlapping slot (09:30 to 11:00) -> 1 conflict
  const [res1] = await conn.query(query, [dKey, '2', '2', '11:00:00', '09:30:00']);
  console.log('Test 1 Overlap (09:30-11:00) conflicts:', res1.length, res1);

  // Test 2: Back-to-back slot (10:30 to 12:00) -> 0 conflicts
  const [res2] = await conn.query(query, [dKey, '2', '2', '12:00:00', '10:30:00']);
  console.log('Test 2 Back-to-back (10:30-12:00) conflicts:', res2.length);

  // Test 3: Different priest (5) -> 0 conflicts
  const [res3] = await conn.query(query, [dKey, '5', '5', '10:30:00', '09:00:00']);
  console.log('Test 3 Different priest 5 conflicts:', res3.length);

  await conn.end();
})();
