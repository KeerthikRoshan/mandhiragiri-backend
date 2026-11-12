const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'mandhiragiri_db',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true
});

// Wrap corePool.getConnection to guarantee UTC initialization across pool.getConnection,
// pool.query, pool.execute, newly created sockets, and reconnected physical sockets.
const corePool = pool.pool;
const origCoreGetConnection = corePool.getConnection.bind(corePool);

corePool.getConnection = function (cb) {
  origCoreGetConnection((err, conn) => {
    if (err) return cb(err);
    if (!conn._utcInitialized) {
      conn.query("SET time_zone = '+00:00';", (err2) => {
        if (err2) {
          try {
            conn.destroy();
          } catch (_) {}
          return cb(err2);
        }
        conn._utcInitialized = true;
        cb(null, conn);
      });
    } else {
      cb(null, conn);
    }
  });
};


/**
 * Test MySQL connection and verify UTC session timezone
 * @returns {Promise<boolean>}
 */
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    const [tzRows] = await connection.query("SELECT @@session.time_zone AS tz;");
    connection.release();
    return tzRows[0]?.tz === '+00:00';
  } catch (error) {
    console.error('MySQL connection failed:', error.message);
    return false;
  }
};

/**
 * Close connection pool (for graceful shutdown)
 */
const closePool = async () => {
  try {
    await pool.end();
    console.log('MySQL connection pool closed.');
  } catch (error) {
    console.error('Error closing MySQL pool:', error.message);
  }
};

module.exports = {
  pool,
  testConnection,
  closePool
};
