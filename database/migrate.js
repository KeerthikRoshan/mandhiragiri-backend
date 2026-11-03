const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const runMigrations = async () => {
  const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  };

  const dbName = process.env.DB_NAME || 'mandhiragiri_db';

  console.log(`[Migration] Connecting to MySQL at ${dbConfig.host}:${dbConfig.port}...`);
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);

    // 1. Ensure database exists
    console.log(`[Migration] Ensuring database '${dbName}' exists...`);
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    await connection.query(`USE \`${dbName}\`;`);

    // 2. Ensure schema_migrations tracker table exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(255) NOT NULL UNIQUE,
        \`applied_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Find migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('[Migration] No migrations directory found.');
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const [rows] = await connection.query(
        'SELECT `id` FROM `schema_migrations` WHERE `name` = ?',
        [file]
      );

      if (rows.length > 0) {
        console.log(`[Migration] Skipped (already applied): ${file}`);
        continue;
      }

      console.log(`[Migration] Applying: ${file}...`);
      const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await connection.query(sqlContent);
      await connection.query(
        'INSERT INTO `schema_migrations` (`name`) VALUES (?)',
        [file]
      );

      console.log(`[Migration] Successfully applied: ${file}`);
    }

    console.log('[Migration] All migrations completed successfully.');
  } catch (error) {
    console.error('[Migration Error]:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;
