const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const { pool } = require('../../src/config/database');

dotenv.config();

const ROLES = [
  { name: 'SUPER_ADMIN', description: 'Full system access and administrator management' },
  { name: 'ADMIN', description: 'Temple management, staff supervision, and bookings' },
  { name: 'PRIEST', description: 'Astrology consultations, poojas, and temple rituals' },
  { name: 'ASSISTANT', description: 'Ritual assistance, queue logistics, and schedule support' }
];

const PERMISSIONS = [
  { name: 'users:manage', module: 'USERS', description: 'Create and manage all users' },
  { name: 'admins:create', module: 'USERS', description: 'Create Admin accounts' },
  { name: 'staff:create', module: 'USERS', description: 'Create Priest and Assistant accounts' },
  { name: 'users:read', module: 'USERS', description: 'View user profiles' },
  { name: 'bookings:manage', module: 'BOOKINGS', description: 'Create, update, and cancel bookings' },
  { name: 'bookings:read', module: 'BOOKINGS', description: 'View bookings and appointments' },
  { name: 'panchangam:manage', module: 'PANCHANGAM', description: 'Manage Panchangam and calendar' },
  { name: 'panchangam:read', module: 'PANCHANGAM', description: 'Read Panchangam data' },
  { name: 'reports:view', module: 'REPORTS', description: 'View system and revenue reports' }
];

// Mapping permissions to roles
const ROLE_PERMISSIONS = {
  SUPER_ADMIN: [
    'users:manage',
    'admins:create',
    'staff:create',
    'users:read',
    'bookings:manage',
    'bookings:read',
    'panchangam:manage',
    'panchangam:read',
    'reports:view'
  ],
  ADMIN: [
    'staff:create',
    'users:read',
    'bookings:manage',
    'bookings:read',
    'panchangam:read',
    'reports:view'
  ],
  PRIEST: [
    'bookings:read',
    'panchangam:read'
  ],
  ASSISTANT: [
    'bookings:read'
  ]
};

const seed = async () => {
  const connection = await pool.getConnection();

  try {
    console.log('[Seeder] Starting Super Admin and RBAC Seeder...');
    await connection.beginTransaction();

    // 1. Seed Roles safely
    console.log('[Seeder] Seeding roles...');
    for (const role of ROLES) {
      await connection.query(
        `INSERT INTO \`roles\` (\`name\`, \`description\`)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE \`description\` = VALUES(\`description\`);`,
        [role.name, role.description]
      );
    }

    // Retrieve role map (name -> id)
    const [roleRows] = await connection.query('SELECT `id`, `name` FROM `roles`;');
    const roleMap = {};
    for (const r of roleRows) {
      roleMap[r.name] = r.id;
    }

    // 2. Seed Permissions safely
    console.log('[Seeder] Seeding permissions...');
    for (const perm of PERMISSIONS) {
      await connection.query(
        `INSERT INTO \`permissions\` (\`name\`, \`module\`, \`description\`)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE \`module\` = VALUES(\`module\`), \`description\` = VALUES(\`description\`);`,
        [perm.name, perm.module, perm.description]
      );
    }

    // Retrieve permission map (name -> id)
    const [permRows] = await connection.query('SELECT `id`, `name` FROM `permissions`;');
    const permMap = {};
    for (const p of permRows) {
      permMap[p.name] = p.id;
    }

    // 3. Seed Role-Permissions mappings safely
    console.log('[Seeder] Seeding role permissions...');
    for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const roleId = roleMap[roleName];
      if (!roleId) continue;

      for (const permName of permissions) {
        const permId = permMap[permName];
        if (!permId) continue;

        await connection.query(
          `INSERT IGNORE INTO \`role_permissions\` (\`role_id\`, \`permission_id\`)
           VALUES (?, ?);`,
          [roleId, permId]
        );
      }
    }

    // 4. Seed Super Admin user safely
    const adminMobile = process.env.SUPER_ADMIN_MOBILE || '9876543210';
    const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@1234';
    const adminName = process.env.SUPER_ADMIN_NAME || 'Super Admin';
    const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@mandhiragiri.com';
    const superAdminRoleId = roleMap['SUPER_ADMIN'];

    if (!superAdminRoleId) {
      throw new Error('SUPER_ADMIN role not found in database.');
    }

    const [existingUsers] = await connection.query(
      'SELECT `id`, `mobile` FROM `users` WHERE `mobile` = ? LIMIT 1;',
      [adminMobile]
    );

    if (existingUsers.length > 0) {
      console.log(`[Seeder] Super Admin with mobile ${adminMobile} already exists. Preserving existing password.`);
    } else {
      console.log(`[Seeder] Creating Super Admin account for mobile: ${adminMobile}...`);
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

      await connection.query(
        `INSERT INTO \`users\`
          (\`role_id\`, \`mobile\`, \`password_hash\`, \`name\`, \`email\`, \`status\`, \`must_change_password\`)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0);`,
        [superAdminRoleId, adminMobile, passwordHash, adminName, adminEmail]
      );
      console.log(`[Seeder] Super Admin created successfully.`);
    }

    await connection.commit();
    console.log('[Seeder] RBAC and Super Admin Seeder completed successfully.');
  } catch (error) {
    await connection.rollback();
    console.error('[Seeder Error]:', error.message);
    process.exit(1);
  } finally {
    connection.release();
    await pool.end();
  }
};

if (require.main === module) {
  seed();
}

module.exports = seed;
