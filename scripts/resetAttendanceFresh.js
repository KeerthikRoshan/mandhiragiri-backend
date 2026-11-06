require('dotenv').config();
const mysql = require('mysql2/promise');

async function resetAttendance() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mandragiri_db',
  });

  console.log('Connected to MySQL database.');

  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  await connection.query('TRUNCATE TABLE attendance_records');
  console.log('✅ Cleared attendance_records');

  try {
    await connection.query('TRUNCATE TABLE staff_attendance_audit');
    console.log('✅ Cleared staff_attendance_audit');
  } catch (err) {
    console.log('Note on audit table:', err.message);
  }

  await connection.query('SET FOREIGN_KEY_CHECKS = 1');

  const [attRows] = await connection.query('SELECT COUNT(*) as count FROM attendance_records');
  const [audRows] = await connection.query('SELECT COUNT(*) as count FROM staff_attendance_audit');

  console.log(`Current state: attendance_records = ${attRows[0].count}, staff_attendance_audit = ${audRows[0].count}`);
  await connection.end();
  console.log('Database attendance tables reset to 100% fresh base.');
}

resetAttendance().catch(err => {
  console.error('Error resetting attendance data:', err);
  process.exit(1);
});
