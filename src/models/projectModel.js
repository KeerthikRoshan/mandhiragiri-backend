const { pool } = require('../config/database');
const outboxModel = require('./outboxModel');
const bookingReminderService = require('../services/bookingReminderService');
const { NOTIFICATION_EVENTS, generateEventIdempotencyKey } = require('../constants/notificationConstants');

const getDashboardOverview = async (userId) => {
  const [rows] = await pool.execute(`
    SELECT
      CURDATE() AS date_key,
      (SELECT COUNT(*) FROM bookings WHERE date_key = CURDATE() AND status != 'cancelled') AS today_events_count,
      (SELECT COUNT(*) FROM bookings WHERE date_key > CURDATE() AND date_key <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND status != 'cancelled') AS upcoming_seven_days_count,
      (SELECT COUNT(*) FROM leave_requests WHERE status = 'PENDING') AS pending_approval_count,
      (SELECT COUNT(*) FROM bookings WHERE status = 'completed') AS completed_total_count,
      (SELECT COUNT(*) FROM notification_recipients WHERE user_id = ? AND is_deleted = 0 AND in_app_visible = 1 AND read_at IS NULL) AS unread_notifications_count;
  `, [userId]);
  return rows[0];
};

const getPanchangam = async (date, location) => {
  const [rows] = await pool.execute(`
    SELECT * FROM panchangam_days WHERE date_key = ? AND location = ? LIMIT 1;
  `, [date, location]);
  return rows[0] || null;
};

const upsertPanchangam = async (data, updatedBy) => {
  await pool.execute(`
    INSERT INTO panchangam_days (
      date_key, location, gregorian_badge, tamil_date_badge,
      tithi_title_tamil, tithi_title_english, tithi_end_time,
      nakshatra_title_tamil, nakshatra_title_english, nakshatra_end_time,
      nalla_neram_morning, nalla_neram_evening, rahu_kalam_time,
      rahu_kalam_period, provider_data, data_source, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'manual', ?)
    ON DUPLICATE KEY UPDATE
      gregorian_badge = VALUES(gregorian_badge),
      tamil_date_badge = VALUES(tamil_date_badge),
      tithi_title_tamil = VALUES(tithi_title_tamil),
      tithi_title_english = VALUES(tithi_title_english),
      tithi_end_time = VALUES(tithi_end_time),
      nakshatra_title_tamil = VALUES(nakshatra_title_tamil),
      nakshatra_title_english = VALUES(nakshatra_title_english),
      nakshatra_end_time = VALUES(nakshatra_end_time),
      nalla_neram_morning = VALUES(nalla_neram_morning),
      nalla_neram_evening = VALUES(nalla_neram_evening),
      rahu_kalam_time = VALUES(rahu_kalam_time),
      rahu_kalam_period = VALUES(rahu_kalam_period),
      provider_data = NULL,
      data_source = 'manual',
      updated_by = VALUES(updated_by);
  `, [
    data.dateKey, data.location, data.gregorianBadge || null, data.tamilDateBadge || null,
    data.tithiTitleTamil || null, data.tithiTitleEnglish || null, data.tithiEndTime || null,
    data.nakshatraTitleTamil || null, data.nakshatraTitleEnglish || null, data.nakshatraEndTime || null,
    data.nallaNeramMorning || null, data.nallaNeramEvening || null,
    data.rahuKalamTime || null, data.rahuKalamPeriod || null, updatedBy
  ]);
  return getPanchangam(data.dateKey, data.location);
};

const getCalendarSettings = async (date) => {
  const [rows] = await pool.execute(
    'SELECT is_muhurtham, is_blocked FROM calendar_day_settings WHERE date_key = ? LIMIT 1;',
    [date]
  );
  return rows[0] || { is_muhurtham: 0, is_blocked: 0 };
};

const getScheduleBookings = async (date, category) => {
  const categoryFilter = category && category !== 'all' ? 'AND b.category = ?' : '';
  const params = categoryFilter ? [date, category] : [date];
  const [rows] = await pool.execute(`
    SELECT b.*, s.name_english AS staff_name_english, s.name_tamil AS staff_name_tamil
    FROM bookings b
    LEFT JOIN staff s ON CAST(s.id AS CHAR) COLLATE utf8mb4_unicode_ci = b.priest_id COLLATE utf8mb4_unicode_ci
    WHERE b.date_key = ? AND b.status != 'cancelled' ${categoryFilter}
    ORDER BY b.time_slot ASC, b.id ASC;
  `, params);
  return rows;
};

const listStaff = async ({ status, search }) => {
  const conditions = [];
  const params = [];

  // Exclude soft-deleted staff accounts using users.status
  conditions.push("(u.status IS NULL OR UPPER(u.status) != 'DELETED')");

  // Use staff.status to filter active vs deactive/inactive
  if (status && status !== 'all') {
    const s = String(status).toLowerCase();
    if (s === 'active') {
      conditions.push("LOWER(s.status) = 'active'");
    } else if (s === 'inactive' || s === 'deactive') {
      conditions.push("LOWER(s.status) IN ('inactive', 'deactive')");
    }
  }

  if (search) {
    conditions.push('(s.name_english LIKE ? OR s.name_tamil LIKE ? OR s.designation LIKE ? OR s.tradition LIKE ? OR s.expertise LIKE ? OR s.languages_spoken LIKE ? OR s.staff_id LIKE ? OR s.phone LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term, term, term, term, term);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.execute(`
    SELECT s.*, u.status AS user_status, u.email AS user_email,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR)) AS total_bookings,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AND b.date_key < DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS this_week_bookings,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key = CURDATE() AND b.status != 'cancelled') AS conflicts_count,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key < CURDATE()) AS past_count,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key = CURDATE() AND b.status != 'completed' AND b.status != 'cancelled') AS active_count,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key > CURDATE() AND b.status != 'cancelled') AS upcoming_count
    FROM staff s
    LEFT JOIN users u ON u.id = s.user_id
    ${where}
    ORDER BY s.id ASC;
  `, params);
  return rows;
};

const createStaff = async ({ user, staff }) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    console.log('[CREATE_STAFF] [5/5] Database Execution: Started transaction');

    // The application has 3 main user roles: SUPER_ADMIN, ADMIN, and STAFF.
    // Both Priests and Assistants are created under the STAFF role.
    console.log('[CREATE_STAFF] DB Query: Resolving role_id for "STAFF" in roles table...');
    let [roles] = await connection.execute('SELECT id, name FROM roles WHERE name = ? LIMIT 1;', ['STAFF']);
    if (!roles.length) {
      console.warn('[CREATE_STAFF] DB Warning: "STAFF" role not found in roles table, checking fallback...');
      const fallbackRole = String(staff.staffRole || 'PRIEST').toUpperCase().includes('ASSISTANT') ? 'ASSISTANT' : 'PRIEST';
      [roles] = await connection.execute('SELECT id, name FROM roles WHERE name = ? LIMIT 1;', [fallbackRole]);
    }
    if (!roles.length) {
      throw new Error('Configured staff role does not exist in roles table.');
    }
    const roleId = roles[0].id;
    console.log(`[CREATE_STAFF] DB Query Result: Assigned user role_id = ${roleId} (${roles[0].name})`);

    console.log('[CREATE_STAFF] DB Query: Executing INSERT INTO users...');
    const [userResult] = await connection.execute(`
      INSERT INTO users (role_id, mobile, password_hash, name, email, status, must_change_password)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0);
    `, [roleId, user.mobile, user.passwordHash, staff.nameEnglish, user.email || null]);
    const userId = userResult.insertId;
    console.log(`[CREATE_STAFF] DB Insert Result: User record inserted with ID: ${userId}`);

    // Category in staff table: Priest or Assistant
    const normalizedStaffRole = String(staff.staffRole || 'Priest').toLowerCase().includes('assistant') ? 'Assistant' : 'Priest';
    console.log(`[CREATE_STAFF] DB Query: Executing INSERT INTO staff (user_id: ${userId}, category: "${normalizedStaffRole}")...`);
    const [staffResult] = await connection.execute(`
      INSERT INTO staff (
        user_id, staff_id, name_english, name_tamil, staff_role, designation,
        phone, tradition, expertise, certification, languages_spoken, avatar_url, status
      ) VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `, [
      userId,
      staff.nameEnglish,
      staff.nameTamil,
      normalizedStaffRole,
      staff.designation,
      staff.phone,
      staff.tradition || null,
      staff.expertise || null,
      staff.certification || null,
      staff.languagesSpoken || null,
      staff.avatarUrl || null,
      staff.status || 'Active'
    ]);
    const staffIdInt = staffResult.insertId;
    const generatedStaffCode = `MJSTF${String(staffIdInt).padStart(5, '0')}`;
    console.log(`[CREATE_STAFF] DB Generated Staff Code: ${generatedStaffCode} (Auto-increment ID: ${staffIdInt})`);

    console.log('[CREATE_STAFF] DB Query: Updating staff_id code in staff record...');
    await connection.execute('UPDATE staff SET staff_id = ? WHERE id = ?;', [generatedStaffCode, staffIdInt]);
    await connection.commit();
    console.log('[CREATE_STAFF] DB Transaction: Successfully committed all records.');

    const [createdRows] = await connection.execute('SELECT * FROM staff WHERE id = ? LIMIT 1;', [staffIdInt]);
    const finalRecord = { ...createdRows[0], userId };
    console.log('[CREATE_STAFF] DB Insertion Results:', {
      id: finalRecord.id,
      staffId: finalRecord.staff_id,
      userId: finalRecord.userId,
      nameEnglish: finalRecord.name_english,
      nameTamil: finalRecord.name_tamil,
      staffRole: finalRecord.staff_role,
      designation: finalRecord.designation,
      phone: finalRecord.phone,
      status: finalRecord.status
    });
    return finalRecord;
  } catch (error) {
    await connection.rollback();
    console.error('\n========================================');
    console.error('[CREATE_STAFF] [DB_ERROR] Database operation failed during staff creation:');
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    if (error.code) console.error('SQL Error Code:', error.code);
    if (error.sqlMessage) console.error('SQL Message:', error.sqlMessage);
    if (error.sql) console.error('SQL Query:', error.sql);
    console.error('Stack Trace:', error.stack);
    console.error('========================================\n');
    throw error;
  } finally {
    connection.release();
  }
};

const getStaffById = async (idOrStaffId) => {
  const [rows] = await pool.execute(
    `SELECT s.*, u.status AS user_status, u.email AS user_email
     FROM staff s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.id = ? OR s.staff_id = ?
     LIMIT 1;`,
    [idOrStaffId, idOrStaffId]
  );
  if (rows[0]) return rows[0];

  // Fallback for mock IDs like "p-murugan" -> matches name_english "Murugan"
  const cleanName = String(idOrStaffId).replace(/^p-/, '').toLowerCase();
  const [fallbackRows] = await pool.execute(
    `SELECT s.*, u.status AS user_status, u.email AS user_email
     FROM staff s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE LOWER(s.name_english) = ? OR LOWER(s.name_english) LIKE ?
     LIMIT 1;`,
    [cleanName, `%${cleanName}%`]
  );
  return fallbackRows[0] || null;
};

const findStaffByPhone = async (phone) => {
  const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);
  const pattern = `%${cleanMobile}`;
  const [rows] = await pool.execute('SELECT id, staff_id, phone, user_id FROM staff WHERE phone LIKE ? LIMIT 1;', [pattern]);
  return rows[0] || null;
};

const findUserByMobile = async (mobile) => {
  const cleanMobile = String(mobile).replace(/\D/g, '').slice(-10);
  const pattern = `%${cleanMobile}`;
  const [rows] = await pool.execute('SELECT id, mobile, role_id, status FROM users WHERE mobile LIKE ? LIMIT 1;', [pattern]);
  return rows[0] || null;
};

const getRoleByName = async (roleName) => {
  const [rows] = await pool.execute('SELECT id, name FROM roles WHERE name = ? LIMIT 1;', [roleName]);
  return rows[0] || null;
};

const updateStaff = async (idOrStaffId, { userUpdates = {}, staffUpdates = {} }) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    console.log('[UPDATE_STAFF] [DB_START] Starting database transaction for staff identifier:', idOrStaffId);

    const [existingRows] = await connection.execute(
      `SELECT s.*, u.status AS user_status
       FROM staff s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.id = ? OR s.staff_id = ?
       LIMIT 1 FOR UPDATE;`,
      [idOrStaffId, idOrStaffId]
    );
    if (!existingRows.length) {
      await connection.rollback();
      return null;
    }
    const staff = existingRows[0];
    const staffId = staff.id;
    const userId = staff.user_id;

    // Duplicate Phone Check in both staff and users
    if (staffUpdates.phone && staffUpdates.phone !== staff.phone) {
      const cleanMobile = String(staffUpdates.phone).replace(/\D/g, '').slice(-10);
      const pattern = `%${cleanMobile}`;
      console.log('[UPDATE_STAFF] DB: Checking duplicate phone in staff table:', cleanMobile);
      const [dupStaff] = await connection.execute(
        'SELECT id, staff_id FROM staff WHERE phone LIKE ? AND id != ? LIMIT 1;',
        [pattern, staffId]
      );
      if (dupStaff.length) {
        await connection.rollback();
        const err = new Error('இந்த மொபைல் எண் ஏற்கனவே மற்றொரு பணியாளருக்கு பதிவு செய்யப்பட்டுள்ளது (Phone number already registered).');
        err.statusCode = 409;
        err.errors = { phone: 'Mobile number already registered to another staff member.' };
        throw err;
      }
      if (userId) {
        console.log('[UPDATE_STAFF] DB: Checking duplicate mobile in users table:', cleanMobile);
        const [dupUser] = await connection.execute(
          'SELECT id FROM users WHERE mobile LIKE ? AND id != ? LIMIT 1;',
          [pattern, userId]
        );
        if (dupUser.length) {
          await connection.rollback();
          const err = new Error('இந்த மொபைல் எண் ஏற்கனவே மற்றொரு பயனருக்கு பதிவு செய்யப்பட்டுள்ளது (Mobile already registered).');
          err.statusCode = 409;
          err.errors = { phone: 'Mobile number already registered to another user account.' };
          throw err;
        }
      }
    }

    // Update staff table fields
    const staffFields = [];
    const staffParams = [];
    for (const [col, val] of Object.entries(staffUpdates)) {
      staffFields.push(`${col} = ?`);
      staffParams.push(val);
    }
    if (staffFields.length > 0) {
      staffFields.push('updated_at = CURRENT_TIMESTAMP');
      staffParams.push(staffId);
      console.log(`[UPDATE_STAFF] DB: Updating staff table (id: ${staffId}) -> fields: ${Object.keys(staffUpdates).join(', ')}`);
      await connection.execute(
        `UPDATE staff SET ${staffFields.join(', ')} WHERE id = ?;`,
        staffParams
      );
    }

    // Update users table fields
    if (userId && Object.keys(userUpdates).length > 0) {
      const userFields = [];
      const userParams = [];
      for (const [col, val] of Object.entries(userUpdates)) {
        userFields.push(`${col} = ?`);
        userParams.push(val);
      }
      userFields.push('updated_at = CURRENT_TIMESTAMP');
      userParams.push(userId);
      console.log(`[UPDATE_STAFF] DB: Updating users table (id: ${userId}) -> fields: ${Object.keys(userUpdates).join(', ')}`);
      await connection.execute(
        `UPDATE users SET ${userFields.join(', ')} WHERE id = ?;`,
        userParams
      );
    }

    await connection.commit();
    console.log('[UPDATE_STAFF] DB: Successfully committed staff and user updates.');

    // Fetch freshly updated database row with user join and booking metrics
    const [updatedRows] = await connection.execute(
      `SELECT s.*, u.status AS user_status, u.email AS user_email,
        (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR)) AS total_bookings,
        (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AND b.date_key < DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS this_week_bookings,
        (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key = CURDATE() AND b.status != 'cancelled') AS conflicts_count,
        (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key < CURDATE()) AS past_count,
        (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key = CURDATE() AND b.status != 'completed' AND b.status != 'cancelled') AS active_count,
        (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key > CURDATE() AND b.status != 'cancelled') AS upcoming_count
       FROM staff s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.id = ?
       LIMIT 1;`,
      [staffId]
    );
    const finalRow = updatedRows[0];
    console.log('[UPDATE_STAFF] DB Insertion Results:', {
      id: finalRow.id,
      staffId: finalRow.staff_id,
      nameEnglish: finalRow.name_english,
      staffStatus: finalRow.status,
      userStatus: finalRow.user_status,
      phone: finalRow.phone
    });
    return finalRow;
  } catch (error) {
    await connection.rollback();
    console.error('\n========================================');
    console.error('[UPDATE_STAFF] [DB_ERROR] Database update failed, transaction rolled back:');
    console.error('Error Code:', error.code || 'N/A');
    console.error('Error Message:', error.message);
    if (error.sql) console.error('SQL:', error.sql);
    console.error('Stack:', error.stack);
    console.error('========================================\n');
    throw error;
  } finally {
    connection.release();
  }
};

const getStaffByUserId = async (userId) => {
  const [rows] = await pool.execute('SELECT * FROM staff WHERE user_id = ? LIMIT 1;', [userId]);
  return rows[0] || null;
};

const updateStaffAvatar = async (staffId, avatarUrl) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT avatar_url, id FROM staff WHERE id = ? OR staff_id = ? FOR UPDATE;',
      [staffId, staffId]
    );
    if (!rows.length) {
      await connection.rollback();
      return { notFound: true };
    }
    await connection.execute('UPDATE staff SET avatar_url = ? WHERE id = ?;', [avatarUrl, rows[0].id]);
    await connection.commit();
    return { imageUrl: avatarUrl, previousImageUrl: rows[0].avatar_url };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getDailyAttendance = async (date) => {
  const [rows] = await pool.execute(`
    SELECT s.id AS staff_id, s.staff_id AS staff_code, s.name_english, s.name_tamil,
      s.designation, s.staff_role, s.phone, s.avatar_url,
      a.status, a.submission_time, a.remarks,
      a.updated_at, updater.name AS updated_by
    FROM staff s
    LEFT JOIN attendance_records a ON a.staff_id = s.id AND a.date_key = ?
    LEFT JOIN users updater ON updater.id = a.updated_by
    WHERE LOWER(s.status) = 'active'
    ORDER BY s.name_english;
  `, [date]);
  return rows;
};

const getAttendanceByStaffAndDate = async (staffId, dateKey) => {
  const staff = await getStaffById(staffId);
  const targetId = staff ? staff.id : staffId;
  const [rows] = await pool.execute(
    'SELECT * FROM attendance_records WHERE staff_id = ? AND date_key = ? LIMIT 1;',
    [targetId, dateKey]
  );
  return rows[0] || null;
};

const upsertAttendance = async ({ staffId, dateKey, status, submissionTime, remarks, updatedBy }, conn = null) => {
  const isExternalConn = Boolean(conn);
  const connection = conn || (await pool.getConnection());

  try {
    if (!isExternalConn) await connection.beginTransaction();

    const staff = await getStaffById(staffId);
    const targetId = staff ? staff.id : staffId;

    const [prevRows] = await connection.execute(
      'SELECT * FROM attendance_records WHERE staff_id = ? AND date_key = ? LIMIT 1;',
      [targetId, dateKey]
    );
    const prev = prevRows[0];
    const prevStatus = prev ? prev.status : 'NOT_MARKED';
    const prevRemarks = prev ? prev.remarks : null;

    await connection.execute(`
      INSERT INTO attendance_records (staff_id, date_key, status, submission_time, remarks, updated_by, is_sealed)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE status = VALUES(status), submission_time = VALUES(submission_time),
        remarks = VALUES(remarks), updated_by = VALUES(updated_by), is_sealed = 1;
    `, [targetId, dateKey, status.toUpperCase(), submissionTime || null, remarks || null, updatedBy]);

    const [rows] = await connection.execute(
      'SELECT * FROM attendance_records WHERE staff_id = ? AND date_key = ? LIMIT 1;',
      [targetId, dateKey]
    );
    const updatedRecord = rows[0];

    try {
      await connection.execute(`
        INSERT INTO staff_attendance_audit (
          attendance_record_id, staff_id, date_key, previous_status, new_status,
          previous_remarks, new_remarks, action_type, changed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ADMIN_OVERRIDE', ?);
      `, [
        updatedRecord ? updatedRecord.id : null,
        targetId,
        dateKey,
        prevStatus,
        status.toUpperCase(),
        prevRemarks,
        remarks || null,
        updatedBy
      ]);
    } catch (auditErr) {
      console.warn('[AUDIT_WARNING] Failed to record attendance audit:', auditErr.message);
    }

    // Attendance alerts for ABSENT or LEAVE status (notifies all Admins)
    if (['ABSENT', 'LEAVE'].includes(status.toUpperCase())) {
      const eventKey = generateEventIdempotencyKey('ATTENDANCE_ALERT', 'attendance', `${targetId}_${dateKey}_${status.toUpperCase()}`);
      await outboxModel.insertEventTx(connection, {
        eventType: NOTIFICATION_EVENTS.ATTENDANCE_ALERT,
        entityType: 'attendance',
        entityId: `${targetId}_${dateKey}`,
        eventKey,
        payload: {
          staffId: targetId,
          dateKey,
          status: status.toUpperCase(),
          remarks: remarks || null,
          updatedBy
        }
      });
    }

    if (!isExternalConn) await connection.commit();
    return updatedRecord;
  } catch (error) {
    if (!isExternalConn) await connection.rollback();
    throw error;
  } finally {
    if (!isExternalConn) connection.release();
  }
};

const getStaffMonthlyAttendance = async (staffIdOrCode, startDate, endDate) => {
  const staff = await getStaffById(staffIdOrCode);
  if (!staff) return null;

  const [attendanceRows] = await pool.execute(`
    SELECT a.*, updater.name AS updater_name
    FROM attendance_records a
    LEFT JOIN users updater ON updater.id = a.updated_by
    WHERE a.staff_id = ? AND a.date_key BETWEEN ? AND ?
    ORDER BY a.date_key ASC;
  `, [staff.id, startDate, endDate]);

  const [leaveRows] = await pool.execute(`
    SELECT * FROM leave_requests
    WHERE staff_id = ? AND status = 'APPROVED'
      AND ((start_date BETWEEN ? AND ?) OR (end_date BETWEEN ? AND ?) OR (start_date <= ? AND end_date >= ?));
  `, [staff.id, startDate, endDate, startDate, endDate, startDate, endDate]);

  return {
    staff,
    attendanceRows,
    leaveRows
  };
};

const submitAttendance = async ({ staffId, dateKey, status, submissionTime, remarks }) => {
  const [result] = await pool.execute(`
    INSERT INTO attendance_records (staff_id, date_key, status, submission_time, remarks, is_sealed)
    VALUES (?, ?, ?, ?, ?, 1);
  `, [staffId, dateKey, status.toUpperCase(), submissionTime, remarks || null]);
  return result.insertId;
};

const listLeaveRequests = async (status = 'ALL', staffId = null) => {
  const whereClauses = [];
  const params = [];

  if (status && status.toUpperCase() !== 'ALL') {
    whereClauses.push('l.status = ?');
    params.push(status.toUpperCase());
  }

  if (staffId) {
    whereClauses.push('l.staff_id = ?');
    params.push(staffId);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const [counts] = await pool.execute(`
    SELECT COUNT(*) AS all_count,
      SUM(status = 'PENDING') AS pending_count,
      SUM(status = 'APPROVED') AS approved_count,
      SUM(status = 'REJECTED') AS rejected_count
    FROM leave_requests l
    ${staffId ? 'WHERE l.staff_id = ?' : ''};
  `, staffId ? [staffId] : []);

  const [leaves] = await pool.execute(`
    SELECT l.*, s.name_english, s.name_tamil, s.designation
    FROM leave_requests l
    INNER JOIN staff s ON s.id = l.staff_id
    ${whereSql}
    ORDER BY l.created_at DESC;
  `, params);

  return { counts: counts[0], leaves };
};

const createLeaveRequest = async ({ staffId, startDate, endDate, leaveType, reason }, conn = null) => {
  const isExternalConn = Boolean(conn);
  const connection = conn || (await pool.getConnection());
  try {
    if (!isExternalConn) await connection.beginTransaction();

    const [staffRows] = await connection.execute('SELECT id, staff_id, name_english, name_tamil FROM staff WHERE id = ? FOR UPDATE;', [staffId]);
    const staffMember = staffRows[0] || null;
    const [overlaps] = await connection.execute(`
      SELECT id FROM leave_requests
      WHERE staff_id = ? AND status IN ('PENDING', 'APPROVED')
        AND start_date <= ? AND end_date >= ? LIMIT 1;
    `, [staffId, endDate, startDate]);
    if (overlaps.length) {
      if (!isExternalConn) await connection.rollback();
      return { conflict: true };
    }
    const [result] = await connection.execute(`
      INSERT INTO leave_requests (staff_id, start_date, end_date, leave_type, reason, decision_version)
      VALUES (?, ?, ?, ?, ?, 0);
    `, [staffId, startDate, endDate, leaveType, reason]);

    const leaveId = result.insertId;

    // Outbox Event: LEAVE_REQUESTED (notifies all Admins)
    const eventKey = generateEventIdempotencyKey('LEAVE_REQUESTED', 'leave', leaveId);
    await outboxModel.insertEventTx(connection, {
      eventType: NOTIFICATION_EVENTS.LEAVE_REQUESTED,
      entityType: 'leave',
      entityId: leaveId,
      eventKey,
      payload: {
        leaveId,
        staffId,
        staffName: staffMember?.name_english || '',
        staffNameEn: staffMember?.name_english || '',
        staffNameTa: staffMember?.name_tamil || staffMember?.name_english || '',
        startDate,
        endDate,
        leaveType,
        reason
      }
    });

    if (!isExternalConn) await connection.commit();
    return { id: leaveId };
  } catch (error) {
    if (!isExternalConn) await connection.rollback();
    throw error;
  } finally {
    if (!isExternalConn) connection.release();
  }
};

const decideLeaveRequest = async ({ leaveId, decision, remarks, decidedBy }, conn = null) => {
  const isExternalConn = Boolean(conn);
  const connection = conn || (await pool.getConnection());
  try {
    if (!isExternalConn) await connection.beginTransaction();

    // Atomic update with decision_version concurrency guard
    const [result] = await connection.execute(`
      UPDATE leave_requests
      SET status = ?, admin_remarks = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP, decision_version = decision_version + 1
      WHERE id = ? AND status = 'PENDING';
    `, [decision.toUpperCase(), remarks || null, decidedBy, leaveId]);

    if (!result.affectedRows) {
      if (!isExternalConn) await connection.rollback();
      return null;
    }

    const [rows] = await connection.execute('SELECT * FROM leave_requests WHERE id = ? LIMIT 1;', [leaveId]);
    const leaveRow = rows[0];

    // Outbox Event: LEAVE_APPROVED or LEAVE_REJECTED (notifies requesting staff member only)
    const eventType = decision.toUpperCase() === 'APPROVED'
      ? NOTIFICATION_EVENTS.LEAVE_APPROVED
      : NOTIFICATION_EVENTS.LEAVE_REJECTED;

    const newVersion = leaveRow.decision_version || 1;
    const eventKey = generateEventIdempotencyKey(eventType, 'leave', leaveId, `v${newVersion}`);

    await outboxModel.insertEventTx(connection, {
      eventType,
      entityType: 'leave',
      entityId: leaveId,
      eventKey,
      payload: {
        leaveId,
        staffId: leaveRow.staff_id,
        decision: decision.toUpperCase(),
        adminRemarks: remarks || null,
        decidedBy,
        decisionVersion: newVersion
      }
    });

    if (!isExternalConn) await connection.commit();
    return leaveRow;
  } catch (error) {
    if (!isExternalConn) await connection.rollback();
    throw error;
  } finally {
    if (!isExternalConn) connection.release();
  }
};

const getStaffDashboard = async (staffId, date) => {
  const [staffRows] = await pool.execute('SELECT * FROM staff WHERE id = ? LIMIT 1;', [staffId]);
  if (!staffRows.length) return null;
  const staff = staffRows[0];
  const sId = staff.id;
  const sCode = staff.staff_id || String(sId);

  const [attendanceRows] = await pool.execute(`
    SELECT * FROM attendance_records WHERE staff_id = ? AND date_key = ? LIMIT 1;
  `, [staffId, date]);
  const [counts] = await pool.execute(`
    SELECT
      SUM(date_key = ? AND status != 'cancelled') AS today_count,
      SUM(date_key > ? AND status != 'cancelled') AS upcoming_count,
      SUM(date_key <= ? AND status IN ('confirmed', 'pending')) AS pending_completion_count
    FROM bookings 
    WHERE (priest_id = ? OR priest_id = ? OR id IN (SELECT booking_id FROM booking_priests WHERE staff_id = ?));
  `, [date, date, date, sCode, String(sId), sId]);
  const [events] = await pool.execute(`
    SELECT id, date_key, time_slot, title, category, category_label_tamil,
      client_name, client_phone, location, status
    FROM bookings 
    WHERE (priest_id = ? OR priest_id = ? OR id IN (SELECT booking_id FROM booking_priests WHERE staff_id = ?))
      AND date_key = ? AND status != 'cancelled' ORDER BY time_slot;
  `, [sCode, String(sId), sId, date]);
  const [reminders] = await pool.execute(`
    SELECT id, title_tamil, description_tamil, reminder_time, status
    FROM staff_reminders WHERE staff_id = ? AND date_key = ? ORDER BY reminder_time;
  `, [staffId, date]);
  return {
    staff,
    attendance: attendanceRows[0] || null,
    counts: counts[0],
    events,
    reminders
  };
};

const completeEvent = async ({ eventId, staffId, notes }, conn = null) => {
  const isExternalConn = Boolean(conn);
  const connection = conn || (await pool.getConnection());
  try {
    if (!isExternalConn) await connection.beginTransaction();

    const [staffRows] = await connection.execute('SELECT id, staff_id, name_english, name_tamil FROM staff WHERE id = ? LIMIT 1;', [staffId]);
    const staffMember = staffRows[0] || null;
    const staffCode = staffMember ? staffMember.staff_id : String(staffId);

    const [existing] = await connection.execute(`
      SELECT id, booking_number, title, date_key, client_name, client_phone, priest_id, priest_name, status
      FROM bookings
      WHERE id = ? 
        AND (priest_id = ? OR priest_id = ? OR id IN (SELECT booking_id FROM booking_priests WHERE staff_id = ?))
        AND status IN ('confirmed', 'pending')
      FOR UPDATE;
    `, [eventId, staffCode, String(staffId), staffId]);

    if (!existing || existing.length === 0) {
      if (!isExternalConn) await connection.rollback();
      return null;
    }

    const booking = existing[0];

    const [result] = await connection.execute(`
      UPDATE bookings
      SET status = 'completed', completion_notes = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('confirmed', 'pending');
    `, [notes || null, eventId]);

    if (!result.affectedRows) {
      if (!isExternalConn) await connection.rollback();
      return null;
    }

    // 1. Invalidate pending reminder jobs
    await bookingReminderService.cancelBookingReminders(connection, {
      bookingId: eventId,
      reason: 'Booking completed'
    });

    // 2. Insert outbox event BOOKING_COMPLETED
    const eventKey = generateEventIdempotencyKey('BOOKING_COMPLETED', 'booking', eventId);
    await outboxModel.insertEventTx(connection, {
      eventType: NOTIFICATION_EVENTS.BOOKING_COMPLETED,
      entityType: 'booking',
      entityId: eventId,
      eventKey,
      payload: {
        bookingId: eventId,
        bookingNumber: booking.booking_number,
        title: booking.title,
        clientName: booking.client_name || null,
        staffId,
        staffNameEn: staffMember ? staffMember.name_english : (booking.priest_name || 'Staff'),
        staffNameTa: staffMember ? staffMember.name_tamil : (booking.priest_name || 'பணியாளர்'),
        priestId: booking.priest_id,
        priestName: booking.priest_name || (staffMember ? staffMember.name_english : 'Staff'),
        dateKey: booking.date_key,
        notes: notes || null
      }
    });

    const [rows] = await connection.execute('SELECT id, status, completed_at, completion_notes FROM bookings WHERE id = ?;', [eventId]);

    if (!isExternalConn) await connection.commit();
    return rows[0] || null;
  } catch (error) {
    if (!isExternalConn) await connection.rollback();
    throw error;
  } finally {
    if (!isExternalConn) connection.release();
  }
};

const getAdminProfile = async (userId) => {
  const [rows] = await pool.execute(`
    SELECT u.id, u.name AS name_english, u.mobile, u.email,
      p.name_tamil, p.title_tamil, p.address_tamil, p.years_experience,
      p.horoscope_count, p.homam_count, p.accuracy_rate,
      p.peedam_name_tamil, p.morning_hours, p.evening_hours, p.avatar_url, p.updated_at
    FROM users u LEFT JOIN admin_profiles p ON p.user_id = u.id
    WHERE u.id = ? LIMIT 1;
  `, [userId]);
  return rows[0] || null;
};

const updateAdminAvatar = async (userId, avatarUrl) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [profiles] = await connection.execute(
      'SELECT avatar_url FROM admin_profiles WHERE user_id = ? FOR UPDATE;',
      [userId]
    );
    await connection.execute(`
      INSERT INTO admin_profiles (user_id, avatar_url) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE avatar_url = VALUES(avatar_url);
    `, [userId, avatarUrl]);
    await connection.commit();
    return {
      imageUrl: avatarUrl,
      previousImageUrl: profiles[0]?.avatar_url || null
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const updateAdminProfile = async ({ userId, phone, email, addressTamil, nameEnglish, nameTamil }) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const userUpdates = [];
    const userParams = [];
    if (phone) { userUpdates.push('mobile = ?'); userParams.push(phone); }
    if (email !== undefined) { userUpdates.push('email = ?'); userParams.push(email || null); }
    if (nameEnglish) { userUpdates.push('name = ?'); userParams.push(nameEnglish); }

    if (userUpdates.length > 0) {
      await connection.execute(`UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?;`, [...userParams, userId]);
    }

    await connection.execute(`
      INSERT INTO admin_profiles (user_id, address_tamil, name_tamil) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        address_tamil = COALESCE(VALUES(address_tamil), address_tamil),
        name_tamil = COALESCE(VALUES(name_tamil), name_tamil);
    `, [userId, addressTamil || null, nameTamil || null]);

    await connection.commit();
    return getAdminProfile(userId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const recordBookingPayment = async ({ bookingId, party, amount, paymentMethod, reference, notes, createdBy }, conn = null) => {
  const isExternalConn = Boolean(conn);
  const connection = conn || (await pool.getConnection());
  try {
    if (!isExternalConn) await connection.beginTransaction();
    const [bookings] = await connection.execute(
      'SELECT * FROM bookings WHERE id = ? FOR UPDATE;', [bookingId]
    );
    if (!bookings.length) {
      if (!isExternalConn) await connection.rollback();
      return { notFound: true };
    }
    const booking = bookings[0];
    const total = Number(party === 'CLIENT' ? booking.total_event_charge : booking.priest_total_pay);
    const received = Number(party === 'CLIENT' ? booking.client_total_received : booking.priest_advance_paid);
    if (Number(amount) > total - received) {
      if (!isExternalConn) await connection.rollback();
      return { exceedsBalance: true, balance: total - received };
    }
    const updateColumn = party === 'CLIENT' ? 'client_total_received' : 'priest_advance_paid';
    const statusColumn = party === 'CLIENT' ? 'client_payment_status' : 'priest_payment_status';
    const newTotalReceived = received + Number(amount);
    const newStatus = newTotalReceived >= total && total > 0 ? 'paid' : (newTotalReceived > 0 ? 'partial' : 'pending');

    await connection.execute(`UPDATE bookings SET ${updateColumn} = ?, ${statusColumn} = ? WHERE id = ?;`, [newTotalReceived, newStatus, bookingId]);
    const [transaction] = await connection.execute(`
      INSERT INTO booking_transactions (booking_id, party, amount, payment_method, reference, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `, [bookingId, party, amount, paymentMethod || 'cash', reference || null, notes || null, createdBy]);

    const transactionId = transaction.insertId;

    // Outbox Event: PAYMENT_UPDATED
    const eventKey = generateEventIdempotencyKey('PAYMENT_UPDATED', 'payment', transactionId);
    await outboxModel.insertEventTx(connection, {
      eventType: NOTIFICATION_EVENTS.PAYMENT_UPDATED,
      entityType: 'payment',
      entityId: transactionId,
      eventKey,
      payload: {
        bookingId,
        bookingNumber: booking.booking_number,
        transactionId,
        party: party.toUpperCase(),
        amount: Number(amount),
        paymentMethod: paymentMethod || 'cash',
        priestId: party.toUpperCase() !== 'CLIENT' ? booking.priest_id : null,
        updatedPaymentStatus: newStatus
      }
    });

    if (!isExternalConn) await connection.commit();
    return { transactionId };
  } catch (error) {
    if (!isExternalConn) await connection.rollback();
    throw error;
  } finally {
    if (!isExternalConn) connection.release();
  }
};

const listBookingPayments = async (bookingId) => {
  const [rows] = await pool.execute(`
    SELECT id, party, amount, payment_method, reference, notes, paid_at, created_by
    FROM booking_transactions WHERE booking_id = ? ORDER BY paid_at DESC, id DESC;
  `, [bookingId]);
  return rows;
};

const getBalanceReport = async ({ fromDate, toDate }) => {
  const [rows] = await pool.execute(`
    SELECT COUNT(*) AS booking_count,
      COALESCE(SUM(total_event_charge), 0) AS total_event_charge,
      COALESCE(SUM(client_total_received), 0) AS client_total_received,
      COALESCE(SUM(total_event_charge - client_total_received), 0) AS client_balance_amount,
      COALESCE(SUM(priest_total_pay), 0) AS priest_total_pay,
      COALESCE(SUM(priest_advance_paid), 0) AS priest_advance_paid,
      COALESCE(SUM(priest_total_pay - priest_advance_paid), 0) AS priest_balance_amount
    FROM bookings WHERE date_key BETWEEN ? AND ? AND status != 'cancelled';
  `, [fromDate, toDate]);
  return rows[0];
};

module.exports = {
  getDashboardOverview,
  getPanchangam,
  upsertPanchangam,
  getCalendarSettings,
  getScheduleBookings,
  listStaff,
  createStaff,
  getStaffById,
  findStaffByPhone,
  findUserByMobile,
  getRoleByName,
  updateStaff,
  getStaffByUserId,
  updateStaffAvatar,
  getDailyAttendance,
  getAttendanceByStaffAndDate,
  upsertAttendance,
  getStaffMonthlyAttendance,
  submitAttendance,
  listLeaveRequests,
  createLeaveRequest,
  decideLeaveRequest,
  getStaffDashboard,
  completeEvent,
  getAdminProfile,
  updateAdminAvatar,
  updateAdminProfile,
  recordBookingPayment,
  listBookingPayments,
  getBalanceReport
};