const { pool } = require('../config/database');

const getDashboardOverview = async (userId) => {
  const [rows] = await pool.execute(`
    SELECT
      CURDATE() AS date_key,
      (SELECT COUNT(*) FROM bookings WHERE date_key = CURDATE() AND status != 'cancelled') AS today_events_count,
      (SELECT COUNT(*) FROM bookings WHERE date_key > CURDATE() AND date_key <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND status != 'cancelled') AS upcoming_seven_days_count,
      (SELECT COUNT(*) FROM leave_requests WHERE status = 'PENDING') AS pending_approval_count,
      (SELECT COUNT(*) FROM bookings WHERE status = 'completed') AS completed_total_count,
      (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0) AS unread_notifications_count;
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
  if (status && status !== 'all') {
    conditions.push('LOWER(s.status) = ?');
    params.push(status.toLowerCase());
  }
  if (search) {
    conditions.push('(s.name_english LIKE ? OR s.name_tamil LIKE ? OR s.designation LIKE ? OR s.tradition LIKE ? OR s.expertise LIKE ? OR s.languages_spoken LIKE ? OR s.staff_id LIKE ? OR s.phone LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term, term, term, term, term);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.execute(`
    SELECT s.*,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR)) AS total_bookings,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AND b.date_key < DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS this_week_bookings,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key = CURDATE() AND b.status != 'cancelled') AS conflicts_count,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key < CURDATE()) AS past_count,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key = CURDATE() AND b.status != 'completed' AND b.status != 'cancelled') AS active_count,
      (SELECT COUNT(*) FROM bookings b WHERE CAST(b.priest_id AS CHAR) = CAST(s.id AS CHAR) AND b.date_key > CURDATE() AND b.status != 'cancelled') AS upcoming_count
    FROM staff s ${where}
    ORDER BY s.id ASC;
  `, params);
  return rows;
};

const createStaff = async ({ user, staff }) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const roleName = String(staff.staffRole || 'PRIEST').toUpperCase().includes('ASSISTANT')
      ? 'ASSISTANT'
      : 'PRIEST';
    const [roles] = await connection.execute('SELECT id FROM roles WHERE name = ? LIMIT 1;', [roleName]);
    if (!roles.length) throw new Error('Configured staff role does not exist.');
    const roleId = roles[0].id;

    const [userResult] = await connection.execute(`
      INSERT INTO users (role_id, mobile, password_hash, name, email, status, must_change_password)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0);
    `, [roleId, user.mobile, user.passwordHash, staff.nameEnglish, user.email || null]);
    const userId = userResult.insertId;

    const normalizedStaffRole = roleName === 'ASSISTANT' ? 'Assistant' : 'Priest';
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

    await connection.execute('UPDATE staff SET staff_id = ? WHERE id = ?;', [generatedStaffCode, staffIdInt]);
    await connection.commit();

    const [createdRows] = await connection.execute('SELECT * FROM staff WHERE id = ? LIMIT 1;', [staffIdInt]);
    return { ...createdRows[0], userId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getStaffById = async (idOrStaffId) => {
  const [rows] = await pool.execute(
    'SELECT * FROM staff WHERE id = ? OR staff_id = ? LIMIT 1;',
    [idOrStaffId, idOrStaffId]
  );
  return rows[0] || null;
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

    const [existingRows] = await connection.execute(
      'SELECT * FROM staff WHERE id = ? OR staff_id = ? LIMIT 1 FOR UPDATE;',
      [idOrStaffId, idOrStaffId]
    );
    if (!existingRows.length) {
      await connection.rollback();
      return null;
    }
    const staff = existingRows[0];
    const staffId = staff.id;
    const userId = staff.user_id;

    if (staffUpdates.phone && staffUpdates.phone !== staff.phone) {
      const cleanMobile = String(staffUpdates.phone).replace(/\D/g, '').slice(-10);
      const pattern = `%${cleanMobile}`;
      const [dupStaff] = await connection.execute(
        'SELECT id FROM staff WHERE phone LIKE ? AND id != ? LIMIT 1;',
        [pattern, staffId]
      );
      if (dupStaff.length) {
        await connection.rollback();
        const err = new Error('Mobile number already registered to another staff member.');
        err.statusCode = 409;
        throw err;
      }
      if (userId) {
        const [dupUser] = await connection.execute(
          'SELECT id FROM users WHERE mobile LIKE ? AND id != ? LIMIT 1;',
          [pattern, userId]
        );
        if (dupUser.length) {
          await connection.rollback();
          const err = new Error('Mobile number already registered to another user account.');
          err.statusCode = 409;
          throw err;
        }
      }
    }

    const staffFields = [];
    const staffParams = [];
    for (const [col, val] of Object.entries(staffUpdates)) {
      staffFields.push(`${col} = ?`);
      staffParams.push(val);
    }
    if (staffFields.length > 0) {
      staffFields.push('updated_at = CURRENT_TIMESTAMP');
      staffParams.push(staffId);
      await connection.execute(
        `UPDATE staff SET ${staffFields.join(', ')} WHERE id = ?;`,
        staffParams
      );
    }

    if (userId && Object.keys(userUpdates).length > 0) {
      const userFields = [];
      const userParams = [];
      for (const [col, val] of Object.entries(userUpdates)) {
        userFields.push(`${col} = ?`);
        userParams.push(val);
      }
      userParams.push(userId);
      await connection.execute(
        `UPDATE users SET ${userFields.join(', ')} WHERE id = ?;`,
        userParams
      );
    }

    await connection.commit();

    const [updatedRows] = await connection.execute(
      'SELECT * FROM staff WHERE id = ? LIMIT 1;',
      [staffId]
    );
    return updatedRows[0];
  } catch (error) {
    await connection.rollback();
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
      s.designation, s.staff_role, a.status, a.submission_time, a.remarks,
      a.updated_at, updater.name AS updated_by
    FROM staff s
    LEFT JOIN attendance_records a ON a.staff_id = s.id AND a.date_key = ?
    LEFT JOIN users updater ON updater.id = a.updated_by
    WHERE LOWER(s.status) = 'active'
    ORDER BY s.name_english;
  `, [date]);
  return rows;
};

const upsertAttendance = async ({ staffId, dateKey, status, submissionTime, remarks, updatedBy }) => {
  await pool.execute(`
    INSERT INTO attendance_records (staff_id, date_key, status, submission_time, remarks, updated_by, is_sealed)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE status = VALUES(status), submission_time = VALUES(submission_time),
      remarks = VALUES(remarks), updated_by = VALUES(updated_by), is_sealed = 1;
  `, [staffId, dateKey, status.toUpperCase(), submissionTime || null, remarks || null, updatedBy]);
  const [rows] = await pool.execute(
    'SELECT * FROM attendance_records WHERE staff_id = ? AND date_key = ? LIMIT 1;',
    [staffId, dateKey]
  );
  return rows[0];
};

const submitAttendance = async ({ staffId, dateKey, status, submissionTime, remarks }) => {
  const [result] = await pool.execute(`
    INSERT INTO attendance_records (staff_id, date_key, status, submission_time, remarks, is_sealed)
    VALUES (?, ?, ?, ?, ?, 1);
  `, [staffId, dateKey, status.toUpperCase(), submissionTime, remarks || null]);
  return result.insertId;
};

const listLeaveRequests = async (status) => {
  const [counts] = await pool.execute(`
    SELECT COUNT(*) AS all_count,
      SUM(status = 'PENDING') AS pending_count,
      SUM(status = 'APPROVED') AS approved_count,
      SUM(status = 'REJECTED') AS rejected_count
    FROM leave_requests;
  `);
  const [leaves] = await pool.execute(`
    SELECT l.*, s.name_english, s.name_tamil, s.designation
    FROM leave_requests l
    INNER JOIN staff s ON s.id = l.staff_id
    WHERE (? = 'ALL' OR l.status = ?)
    ORDER BY l.created_at DESC;
  `, [status.toUpperCase(), status.toUpperCase()]);
  return { counts: counts[0], leaves };
};

const createLeaveRequest = async ({ staffId, startDate, endDate, leaveType, reason }) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM staff WHERE id = ? FOR UPDATE;', [staffId]);
    const [overlaps] = await connection.execute(`
      SELECT id FROM leave_requests
      WHERE staff_id = ? AND status IN ('PENDING', 'APPROVED')
        AND start_date <= ? AND end_date >= ? LIMIT 1;
    `, [staffId, endDate, startDate]);
    if (overlaps.length) {
      await connection.rollback();
      return { conflict: true };
    }
    const [result] = await connection.execute(`
      INSERT INTO leave_requests (staff_id, start_date, end_date, leave_type, reason)
      VALUES (?, ?, ?, ?, ?);
    `, [staffId, startDate, endDate, leaveType, reason]);
    await connection.commit();
    return { id: result.insertId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const decideLeaveRequest = async ({ leaveId, decision, remarks, decidedBy }) => {
  const [result] = await pool.execute(`
    UPDATE leave_requests
    SET status = ?, admin_remarks = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'PENDING';
  `, [decision.toUpperCase(), remarks || null, decidedBy, leaveId]);
  if (!result.affectedRows) return null;
  const [rows] = await pool.execute('SELECT * FROM leave_requests WHERE id = ? LIMIT 1;', [leaveId]);
  return rows[0] || null;
};

const getStaffDashboard = async (staffId, date) => {
  const [staffRows] = await pool.execute('SELECT * FROM staff WHERE id = ? LIMIT 1;', [staffId]);
  if (!staffRows.length) return null;
  const [attendanceRows] = await pool.execute(`
    SELECT * FROM attendance_records WHERE staff_id = ? AND date_key = ? LIMIT 1;
  `, [staffId, date]);
  const [counts] = await pool.execute(`
    SELECT
      SUM(date_key = ? AND status != 'cancelled') AS today_count,
      SUM(date_key > ? AND status != 'cancelled') AS upcoming_count,
      SUM(date_key <= ? AND status IN ('confirmed', 'pending')) AS pending_completion_count
    FROM bookings WHERE CAST(priest_id AS CHAR) = CAST(? AS CHAR);
  `, [date, date, date, staffId]);
  const [events] = await pool.execute(`
    SELECT id, date_key, time_slot, title, category, category_label_tamil,
      client_name, client_phone, location, status
    FROM bookings WHERE CAST(priest_id AS CHAR) = CAST(? AS CHAR)
      AND date_key = ? AND status != 'cancelled' ORDER BY time_slot;
  `, [staffId, date]);
  const [reminders] = await pool.execute(`
    SELECT id, title_tamil, description_tamil, reminder_time, status
    FROM staff_reminders WHERE staff_id = ? AND date_key = ? ORDER BY reminder_time;
  `, [staffId, date]);
  return {
    staff: staffRows[0],
    attendance: attendanceRows[0] || null,
    counts: counts[0],
    events,
    reminders
  };
};

const completeEvent = async ({ eventId, staffId, notes }) => {
  const [result] = await pool.execute(`
    UPDATE bookings SET status = 'completed', completion_notes = ?, completed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND CAST(priest_id AS CHAR) = CAST(? AS CHAR) AND status IN ('confirmed', 'pending');
  `, [notes || null, eventId, staffId]);
  if (!result.affectedRows) return null;
  const [rows] = await pool.execute('SELECT id, status, completed_at, completion_notes FROM bookings WHERE id = ?;', [eventId]);
  return rows[0] || null;
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

const updateAdminProfile = async ({ userId, phone, email, addressTamil }) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('UPDATE users SET mobile = ?, email = ? WHERE id = ?;', [phone, email || null, userId]);
    await connection.execute(`
      INSERT INTO admin_profiles (user_id, address_tamil) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE address_tamil = VALUES(address_tamil);
    `, [userId, addressTamil || null]);
    await connection.commit();
    return getAdminProfile(userId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const recordBookingPayment = async ({ bookingId, party, amount, paymentMethod, reference, notes, createdBy }) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [bookings] = await connection.execute(
      'SELECT * FROM bookings WHERE id = ? FOR UPDATE;', [bookingId]
    );
    if (!bookings.length) {
      await connection.rollback();
      return { notFound: true };
    }
    const booking = bookings[0];
    const total = Number(party === 'CLIENT' ? booking.total_event_charge : booking.priest_total_pay);
    const received = Number(party === 'CLIENT' ? booking.client_total_received : booking.priest_advance_paid);
    if (Number(amount) > total - received) {
      await connection.rollback();
      return { exceedsBalance: true, balance: total - received };
    }
    const updateColumn = party === 'CLIENT' ? 'client_total_received' : 'priest_advance_paid';
    await connection.execute(`UPDATE bookings SET ${updateColumn} = ${updateColumn} + ? WHERE id = ?;`, [amount, bookingId]);
    const [transaction] = await connection.execute(`
      INSERT INTO booking_transactions (booking_id, party, amount, payment_method, reference, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `, [bookingId, party, amount, paymentMethod || 'cash', reference || null, notes || null, createdBy]);
    await connection.commit();
    return { transactionId: transaction.insertId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
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
  upsertAttendance,
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