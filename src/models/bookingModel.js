const { pool } = require('../config/database');
const { minutesTo12, minutesTo24, parseTimeToMinutes } = require('../utils/timeUtils');
const outboxModel = require('./outboxModel');
const bookingReminderService = require('../services/bookingReminderService');
const { NOTIFICATION_EVENTS, generateEventIdempotencyKey } = require('../constants/notificationConstants');

/**
 * Find conflicting bookings for specified priests on a given date and time interval.
 * Conflict condition: existing.start_time < new.end_time AND existing.end_time > new.start_time
 * Excludes cancelled and soft-deleted bookings.
 * Excludes current booking ID when updating.
 */
const findConflicts = async ({ dateKey, startTime24, endTime24, priestIds = [], excludeBookingId = null }, connection = null) => {
  const conn = connection || pool;
  const pIds = Array.isArray(priestIds) ? priestIds.map(String).filter(Boolean) : [String(priestIds)].filter(Boolean);
  if (pIds.length === 0) return [];

  // Generate placeholders for IN clauses
  const inClause = pIds.map(() => '?').join(', ');

  let query = `
    SELECT DISTINCT
      b.id as booking_id,
      b.booking_number,
      b.title as event_name,
      b.priest_id,
      b.priest_name,
      CAST(b.date_key AS CHAR) as date_key,
      b.start_time,
      b.end_time,
      b.time_slot
    FROM bookings b
    LEFT JOIN booking_priests bp ON bp.booking_id = b.id
    WHERE b.date_key = ?
      AND b.status != 'cancelled'
      AND b.is_deleted = 0
      AND (b.priest_id IN (${inClause}) OR bp.staff_id IN (${inClause}))
      AND b.start_time < ?
      AND b.end_time > ?
  `;

  const params = [dateKey, ...pIds, ...pIds, endTime24, startTime24];

  if (excludeBookingId) {
    query += ' AND b.id != ?';
    params.push(excludeBookingId);
  }

  const [rows] = await conn.query(query, params);
  return rows.map(r => ({
    bookingId: r.booking_id,
    bookingNumber: r.booking_number,
    eventName: r.event_name,
    priestId: String(r.priest_id),
    priestName: r.priest_name,
    dateKey: r.date_key,
    startTime: r.start_time ? minutesTo12(parseTimeToMinutes(r.start_time)) : null,
    endTime: r.end_time ? minutesTo12(parseTimeToMinutes(r.end_time)) : null,
    timeSlot: r.time_slot
  }));
};

/**
 * Creates a new booking with priest assignments and initial cash advance transactions
 * inside a database transaction.
 */
const createBooking = async (booking, conn = null) => {
  const isExternalConn = Boolean(conn);
  const connection = conn || (await pool.getConnection());
  try {
    if (!isExternalConn) await connection.beginTransaction();

    // 1. Transactional conflict check (locking existing bookings on date)
    const priestIdsToCheck = booking.priestIds && booking.priestIds.length > 0
      ? booking.priestIds
      : [booking.priestId];

    const conflicts = await findConflicts(
      {
        dateKey: booking.dateKey,
        startTime24: booking.startTime24,
        endTime24: booking.endTime24,
        priestIds: priestIdsToCheck
      },
      connection
    );

    if (conflicts.length > 0) {
      const err = new Error('தேர்ந்தெடுக்கப்பட்ட நேரத்தில் ஏற்கனவே மற்றொரு நிகழ்வு முன்பதிவு செய்யப்பட்டுள்ளது.');
      err.statusCode = 409;
      err.isOperational = true;
      err.details = {
        collision: 'The assigned priest already has an active booking during this time slot.',
        conflicts
      };
      throw err;
    }

    // 2. Insert into bookings table
    const query = `
      INSERT INTO bookings (
        booking_number, date_key, title, event_type_id, client_name, client_phone,
        alternate_phone, location, venue_type, address, area, pincode,
        category, category_label_tamil, start_time, end_time, duration_minutes,
        time_slot, priest_id, priest_name, priest_phone, samagri_by, notes,
        total_event_charge, client_advance_amount, client_total_received,
        client_payment_status, priest_total_pay, priest_advance_paid,
        priest_payment_status, created_by, status, schedule_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1);
    `;

    const clientTotal = Number(booking.totalEventCharge || 0);
    const clientRecv = Number(booking.clientTotalReceived !== undefined ? booking.clientTotalReceived : booking.clientAdvanceAmount || 0);
    const clientStatus = clientRecv >= clientTotal && clientTotal > 0 ? 'paid' : (clientRecv > 0 ? 'partial' : 'pending');

    const priestTotal = Number(booking.priestTotalPay || 0);
    const priestPaid = Number(booking.priestAdvancePaid || 0);
    const priestStatus = priestPaid >= priestTotal && priestTotal > 0 ? 'paid' : (priestPaid > 0 ? 'partial' : 'pending');

    const values = [
      booking.bookingNumber,
      booking.dateKey,
      booking.title,
      booking.eventTypeId || booking.event_type_id || null,
      booking.clientName || booking.client_name,
      booking.clientPhone || booking.phone || booking.client_phone,
      booking.alternatePhone || booking.alternate_phone || null,
      booking.location || 'ஸ்ரீ மந்திரகிரி ஜோதிட பீடம்',
      booking.venueType || 'home',
      booking.address || null,
      booking.area || null,
      booking.pincode || null,
      booking.category || 'outdoor',
      booking.categoryLabelTamil || 'நிகழ்வு',
      booking.startTime24,
      booking.endTime24,
      booking.durationMinutes || 60,
      booking.timeSlot,
      booking.priestId && booking.priestId !== 'null' && booking.priestId !== 'undefined' ? String(booking.priestId) : null,
      booking.priestName,
      booking.priestPhone || null,
      booking.samagriBy || 'customer',
      booking.notes || null,
      clientTotal,
      Number(booking.clientAdvanceAmount || 0),
      clientRecv,
      clientStatus,
      priestTotal,
      priestPaid,
      priestStatus,
      booking.createdBy || null,
      'confirmed'
    ];

    const [result] = await connection.execute(query, values);
    const bookingId = result.insertId;

    // 3. Insert into booking_priests mapping table
    for (let i = 0; i < priestIdsToCheck.length; i++) {
      const pIdStr = String(priestIdsToCheck[i]);
      if (!pIdStr || pIdStr === 'null' || pIdStr === 'undefined') continue;
      const isPrimary = i === 0 ? 1 : 0;
      let staffNumericId = /^\d+$/.test(pIdStr) ? parseInt(pIdStr, 10) : null;
      if (!staffNumericId) {
        const [lookup] = await connection.execute('SELECT id FROM staff WHERE staff_id = ? LIMIT 1;', [pIdStr]);
        if (lookup[0]) staffNumericId = lookup[0].id;
      }
      if (staffNumericId) {
        await connection.execute(`
          INSERT INTO booking_priests (booking_id, staff_id, is_primary, priest_pay, advance_paid)
          VALUES (?, ?, ?, ?, ?);
        `, [bookingId, staffNumericId, isPrimary, isPrimary ? priestTotal : 0, isPrimary ? priestPaid : 0]);
      }
    }

    // 4. Record Initial Payment Transactions
    // A. Client Advance Payment
    if (clientRecv > 0) {
      await connection.execute(`
        INSERT INTO booking_transactions (booking_id, party, amount, payment_method, transaction_type, notes, created_by)
        VALUES (?, 'CLIENT', ?, 'cash', 'ADVANCE', 'முன்பதிவு முன்பணம் (Client Advance Cash Payment)', ?);
      `, [bookingId, clientRecv, booking.createdBy || null]);
    }

    // B. Priest Advance Payment
    if (priestPaid > 0) {
      const staffIdVal = /^\d+$/.test(String(booking.priestId)) ? parseInt(String(booking.priestId), 10) : null;
      await connection.execute(`
        INSERT INTO booking_transactions (booking_id, staff_id, party, amount, payment_method, transaction_type, notes, created_by)
        VALUES (?, ?, 'PRIEST', ?, 'cash', 'ADVANCE', 'புரோகிதர் முன்பணம் (Priest Advance Cash Remuneration)', ?);
      `, [bookingId, staffIdVal, priestPaid, booking.createdBy || null]);
    }

    // 5. Schedule 24H and 1H Booking Reminders (schedule_version = 1)
    await bookingReminderService.scheduleBookingReminders(connection, {
      bookingId,
      dateKey: booking.dateKey,
      startTime: booking.startTime24,
      scheduleVersion: 1
    });

    // 6. Insert Outbox Event: BOOKING_CREATED
    const eventKey = generateEventIdempotencyKey('BOOKING_CREATED', 'booking', bookingId);
    await outboxModel.insertEventTx(connection, {
      eventType: NOTIFICATION_EVENTS.BOOKING_CREATED,
      entityType: 'booking',
      entityId: bookingId,
      eventKey,
      payload: {
        bookingId,
        bookingNumber: booking.bookingNumber,
        title: booking.title,
        dateKey: booking.dateKey,
        startTime: booking.startTime24,
        endTime: booking.endTime24,
        timeSlot: booking.timeSlot,
        priestId: booking.priestId,
        priestName: booking.priestName,
        totalEventCharge: clientTotal,
        clientAdvanceAmount: Number(booking.clientAdvanceAmount || 0)
      }
    });

    if (!isExternalConn) await connection.commit();
    return bookingId;
  } catch (error) {
    if (!isExternalConn) await connection.rollback();
    throw error;
  } finally {
    if (!isExternalConn) connection.release();
  }
};

/**
 * Retrieve booking details by ID including transactions and assigned priests.
 */
const getBookingById = async (id, connection = null) => {
  const conn = connection || pool;
  const query = `
    SELECT
      b.id,
      b.booking_number,
      CAST(b.date_key AS CHAR) as date_key,
      b.title,
      b.event_type_id,
      et.name_english as event_type_name_english,
      et.name_tamil as event_type_name_tamil,
      b.client_name,
      b.client_phone,
      b.alternate_phone,
      b.location,
      b.venue_type,
      b.address,
      b.area,
      b.pincode,
      b.category,
      b.category_label_tamil,
      b.start_time,
      b.end_time,
      b.duration_minutes,
      b.time_slot,
      b.priest_id,
      b.priest_name,
      b.priest_phone,
      b.samagri_by,
      b.notes,
      b.status,
      b.total_event_charge,
      b.client_advance_amount,
      b.client_total_received,
      b.client_payment_status,
      b.priest_total_pay,
      b.priest_advance_paid,
      b.priest_payment_status,
      b.completion_notes,
      b.completed_at,
      b.created_by,
      b.created_at,
      b.updated_at
    FROM bookings b
    LEFT JOIN event_types et ON et.id = b.event_type_id
    WHERE b.id = ? AND b.is_deleted = 0
    LIMIT 1;
  `;

  const [rows] = await conn.query(query, [id]);
  if (!rows || rows.length === 0) return null;

  const row = rows[0];

  // Fetch transactions
  const [transactions] = await conn.query(`
    SELECT
      id,
      booking_id,
      staff_id,
      party,
      amount,
      payment_method,
      transaction_type,
      reference,
      notes,
      paid_at,
      created_by,
      created_at
    FROM booking_transactions
    WHERE booking_id = ?
    ORDER BY paid_at ASC;
  `, [id]);

  // Fetch assigned priests
  const [priests] = await conn.query(`
    SELECT
      bp.id,
      bp.staff_id,
      bp.is_primary,
      bp.priest_pay,
      bp.advance_paid,
      s.name_english as staff_name_english,
      s.name_tamil as staff_name_tamil,
      s.phone as staff_phone,
      s.staff_role
    FROM booking_priests bp
    LEFT JOIN staff s ON s.id = bp.staff_id
    WHERE bp.booking_id = ?
    ORDER BY bp.is_primary DESC, bp.id ASC;
  `, [id]);

  return {
    ...row,
    transactions: transactions.map(t => ({
      ...t,
      party: t.party.toLowerCase(),
      amount: Number(t.amount)
    })),
    assignedPriests: priests
  };
};

/**
 * List bookings with flexible filtering (date, priest, status, category, search).
 */
const listBookings = async (filters = {}) => {
  let whereClauses = [];
  if (filters.view === 'history' || filters.view === 'past' || filters.status === 'cancelled' || filters.includeDeleted) {
    whereClauses.push('(b.is_deleted = 0 OR b.status = \'cancelled\')');
  } else {
    whereClauses.push('b.is_deleted = 0');
  }
  const params = [];

  if (filters.date || filters.dateKey) {
    whereClauses.push('b.date_key = ?');
    params.push(filters.date || filters.dateKey);
  } else if (filters.fromDate && filters.toDate) {
    whereClauses.push('b.date_key BETWEEN ? AND ?');
    params.push(filters.fromDate, filters.toDate);
  } else if (filters.fromDate) {
    whereClauses.push('b.date_key >= ?');
    params.push(filters.fromDate);
  } else if (filters.toDate) {
    whereClauses.push('b.date_key <= ?');
    params.push(filters.toDate);
  }

  if (filters.staffId || filters.staffCode) {
    const sId = filters.staffId ? parseInt(filters.staffId, 10) : 0;
    const sCode = filters.staffCode ? String(filters.staffCode) : String(sId);
    whereClauses.push(`(
      b.priest_id = ? 
      OR b.priest_id = ?
      OR b.id IN (SELECT booking_id FROM booking_priests WHERE staff_id = ?)
    )`);
    params.push(sCode, String(sId), sId);
  } else if (filters.priestId) {
    const pIdStr = String(filters.priestId);
    whereClauses.push(`(
      b.priest_id = ? 
      OR b.priest_id IN (SELECT staff_id FROM staff WHERE id = ? OR staff_id = ?)
      OR b.id IN (SELECT booking_id FROM booking_priests WHERE staff_id IN (SELECT id FROM staff WHERE id = ? OR staff_id = ?))
    )`);
    params.push(pIdStr, pIdStr, pIdStr, pIdStr, pIdStr);
  }

  if (filters.view) {
    const view = String(filters.view).toLowerCase();
    if (view === 'today') {
      whereClauses.push("b.date_key = CURDATE() AND b.status != 'cancelled'");
    } else if (view === 'upcoming') {
      whereClauses.push("b.date_key > CURDATE() AND b.status != 'cancelled'");
    } else if (view === 'completed') {
      whereClauses.push("b.status = 'completed'");
    } else if (view === 'past' || view === 'history') {
      whereClauses.push("(b.date_key < CURDATE() OR b.status IN ('completed', 'cancelled'))");
    }
  }

  if (filters.status) {
    whereClauses.push('b.status = ?');
    params.push(filters.status);
  }

  if (filters.category && filters.category !== 'all') {
    whereClauses.push('b.category = ?');
    params.push(filters.category);
  }

  if (filters.eventTypeId) {
    whereClauses.push('b.event_type_id = ?');
    params.push(filters.eventTypeId);
  }

  if (filters.search) {
    const term = `%${String(filters.search).trim()}%`;
    whereClauses.push('(b.client_name LIKE ? OR b.client_phone LIKE ? OR b.title LIKE ? OR b.priest_name LIKE ?)');
    params.push(term, term, term, term);
  }

  const query = `
    SELECT
      b.id,
      b.booking_number,
      CAST(b.date_key AS CHAR) as date_key,
      b.title,
      b.event_type_id,
      et.name_english as event_type_name_english,
      et.name_tamil as event_type_name_tamil,
      b.client_name,
      b.client_phone,
      b.alternate_phone,
      b.location,
      b.venue_type,
      b.address,
      b.area,
      b.pincode,
      b.category,
      b.category_label_tamil,
      b.start_time,
      b.end_time,
      b.duration_minutes,
      b.time_slot,
      b.priest_id,
      b.priest_name,
      b.priest_phone,
      b.samagri_by,
      b.notes,
      b.status,
      b.total_event_charge,
      b.client_advance_amount,
      b.client_total_received,
      b.client_payment_status,
      b.priest_total_pay,
      b.priest_advance_paid,
      b.priest_payment_status,
      b.created_by,
      b.created_at,
      b.updated_at
    FROM bookings b
    LEFT JOIN event_types et ON et.id = b.event_type_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY ${
      (filters.view && ['completed', 'past', 'history'].includes(String(filters.view).toLowerCase()))
        ? 'b.date_key DESC, b.start_time DESC, b.id DESC'
        : 'b.date_key ASC, b.start_time ASC, b.id ASC'
    };
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Updates a booking with conflict checking.
 */
const updateBooking = async (id, updateData, conn = null) => {
  const isExternalConn = Boolean(conn);
  const connection = conn || (await pool.getConnection());
  try {
    if (!isExternalConn) await connection.beginTransaction();

    const [existing] = await connection.query(
      'SELECT * FROM bookings WHERE id = ? AND is_deleted = 0 FOR UPDATE',
      [id]
    );
    if (!existing || existing.length === 0) {
      const err = new Error('Booking not found.');
      err.statusCode = 404;
      err.isOperational = true;
      throw err;
    }

    const current = existing[0];
    const newDateKey = updateData.dateKey || current.date_key;
    const newStartTime24 = updateData.startTime24 || current.start_time;
    const newEndTime24 = updateData.endTime24 || current.end_time;
    const newPriestIds = updateData.priestIds || [updateData.priestId || current.priest_id];

    // Check conflicts if date, timing or priest changed
    const conflicts = await findConflicts(
      {
        dateKey: newDateKey,
        startTime24: newStartTime24,
        endTime24: newEndTime24,
        priestIds: newPriestIds,
        excludeBookingId: id
      },
      connection
    );

    if (conflicts.length > 0) {
      const err = new Error('தேர்ந்தெடுக்கப்பட்ட நேரத்தில் ஏற்கனவே மற்றொரு நிகழ்வு முன்பதிவு செய்யப்பட்டுள்ளது.');
      err.statusCode = 409;
      err.isOperational = true;
      err.details = {
        collision: 'The assigned priest already has an active booking during this time slot.',
        conflicts
      };
      throw err;
    }

    // Determine timing changes
    const currentDateKeyStr = current.date_key instanceof Date
      ? current.date_key.toISOString().slice(0, 10)
      : String(current.date_key).slice(0, 10);
    const newDateKeyStr = newDateKey instanceof Date
      ? newDateKey.toISOString().slice(0, 10)
      : String(newDateKey).slice(0, 10);

    const timingChanged = Boolean(
      (updateData.dateKey && newDateKeyStr !== currentDateKeyStr) ||
      (updateData.startTime24 && String(updateData.startTime24).slice(0, 5) !== String(current.start_time).slice(0, 5)) ||
      (updateData.endTime24 && String(updateData.endTime24).slice(0, 5) !== String(current.end_time).slice(0, 5)) ||
      (updateData.timeSlot && updateData.timeSlot !== current.time_slot)
    );

    const currentPriestId = current.priest_id ? String(current.priest_id) : null;
    const newPriestId = updateData.priestId ? String(updateData.priestId) : (updateData.priestIds ? String(updateData.priestIds[0]) : null);
    const priestChanged = Boolean(newPriestId && newPriestId !== currentPriestId);

    const currentScheduleVersion = Number(current.schedule_version || 1);
    const newScheduleVersion = timingChanged ? currentScheduleVersion + 1 : currentScheduleVersion;

    const clientTotal = updateData.totalEventCharge !== undefined ? Number(updateData.totalEventCharge) : Number(current.total_event_charge);
    const clientRecv = updateData.clientTotalReceived !== undefined ? Number(updateData.clientTotalReceived) : Number(current.client_total_received);
    const clientStatus = clientRecv >= clientTotal && clientTotal > 0 ? 'paid' : (clientRecv > 0 ? 'partial' : 'pending');

    const priestTotal = updateData.priestTotalPay !== undefined ? Number(updateData.priestTotalPay) : Number(current.priest_total_pay);
    const priestPaid = updateData.priestAdvancePaid !== undefined ? Number(updateData.priestAdvancePaid) : Number(current.priest_advance_paid);
    const priestStatus = priestPaid >= priestTotal && priestTotal > 0 ? 'paid' : (priestPaid > 0 ? 'partial' : 'pending');

    const query = `
      UPDATE bookings SET
        title = COALESCE(?, title),
        event_type_id = COALESCE(?, event_type_id),
        client_name = COALESCE(?, client_name),
        client_phone = COALESCE(?, client_phone),
        alternate_phone = ?,
        location = COALESCE(?, location),
        venue_type = COALESCE(?, venue_type),
        address = ?,
        area = ?,
        pincode = ?,
        category = COALESCE(?, category),
        category_label_tamil = COALESCE(?, category_label_tamil),
        date_key = COALESCE(?, date_key),
        start_time = COALESCE(?, start_time),
        end_time = COALESCE(?, end_time),
        duration_minutes = COALESCE(?, duration_minutes),
        time_slot = COALESCE(?, time_slot),
        priest_id = COALESCE(?, priest_id),
        priest_name = COALESCE(?, priest_name),
        priest_phone = COALESCE(?, priest_phone),
        samagri_by = COALESCE(?, samagri_by),
        notes = ?,
        status = COALESCE(?, status),
        client_advance_amount = COALESCE(?, client_advance_amount),
        total_event_charge = ?,
        client_total_received = ?,
        client_payment_status = ?,
        priest_total_pay = ?,
        priest_advance_paid = ?,
        priest_payment_status = ?,
        schedule_version = ?,
        updated_at = NOW()
      WHERE id = ?;
    `;

    const clientAdvance = updateData.clientAdvanceAmount !== undefined ? Number(updateData.clientAdvanceAmount) : null;
    const clientPhone = updateData.clientPhone || updateData.phone || null;

    const values = [
      updateData.title ?? null,
      updateData.eventTypeId ?? null,
      updateData.clientName ?? null,
      clientPhone,
      updateData.alternatePhone !== undefined ? updateData.alternatePhone : current.alternate_phone,
      updateData.location ?? null,
      updateData.venueType ?? null,
      updateData.address !== undefined ? updateData.address : current.address,
      updateData.area !== undefined ? updateData.area : current.area,
      updateData.pincode !== undefined ? updateData.pincode : current.pincode,
      updateData.category ?? null,
      updateData.categoryLabelTamil ?? null,
      updateData.dateKey ?? null,
      updateData.startTime24 ?? null,
      updateData.endTime24 ?? null,
      updateData.durationMinutes ?? null,
      updateData.timeSlot ?? null,
      updateData.priestId ? String(updateData.priestId) : null,
      updateData.priestName ?? null,
      updateData.priestPhone ?? null,
      updateData.samagriBy ?? null,
      updateData.notes !== undefined ? updateData.notes : current.notes,
      updateData.status ?? null,
      clientAdvance,
      clientTotal,
      clientRecv,
      clientStatus,
      priestTotal,
      priestPaid,
      priestStatus,
      newScheduleVersion,
      id
    ];

    await connection.execute(query, values);

    // Sync booking_priests if priestIds provided
    if (updateData.priestIds && updateData.priestIds.length > 0) {
      await connection.execute('DELETE FROM booking_priests WHERE booking_id = ?', [id]);
      for (let i = 0; i < updateData.priestIds.length; i++) {
        const pIdStr = String(updateData.priestIds[i]);
        let staffNumericId = /^\d+$/.test(pIdStr) ? parseInt(pIdStr, 10) : null;
        if (!staffNumericId) {
          const [sRows] = await connection.execute(
            'SELECT id FROM staff WHERE id = ? OR staff_id = ? LIMIT 1;',
            [pIdStr, pIdStr]
          );
          if (sRows && sRows[0] && sRows[0].id) {
            staffNumericId = parseInt(String(sRows[0].id), 10);
          }
        }
        if (staffNumericId) {
          await connection.execute(`
            INSERT INTO booking_priests (booking_id, staff_id, is_primary, priest_pay, advance_paid)
            VALUES (?, ?, ?, ?, ?);
          `, [id, staffNumericId, i === 0 ? 1 : 0, i === 0 ? priestTotal : 0, i === 0 ? priestPaid : 0]);
        }
      }
    }

    // Reminders & Outbox Events:
    if (timingChanged) {
      // 1. Invalidate previous pending reminders
      await bookingReminderService.cancelBookingReminders(connection, {
        bookingId: id,
        reason: 'Booking rescheduled'
      });

      // 2. Schedule reminders with incremented schedule_version
      await bookingReminderService.scheduleBookingReminders(connection, {
        bookingId: id,
        dateKey: newDateKeyStr,
        startTime: newStartTime24,
        scheduleVersion: newScheduleVersion
      });

      // 3. Insert BOOKING_RESCHEDULED outbox event
      const reschedEventKey = generateEventIdempotencyKey('BOOKING_RESCHEDULED', 'booking', id, `v${newScheduleVersion}`);
      await outboxModel.insertEventTx(connection, {
        eventType: NOTIFICATION_EVENTS.BOOKING_RESCHEDULED,
        entityType: 'booking',
        entityId: id,
        eventKey: reschedEventKey,
        payload: {
          bookingId: id,
          bookingNumber: current.booking_number,
          title: updateData.title || current.title,
          oldDateKey: currentDateKeyStr,
          newDateKey: newDateKeyStr,
          oldStartTime: current.start_time,
          newStartTime: newStartTime24,
          timeSlot: updateData.timeSlot || current.time_slot,
          priestId: newPriestId || current.priest_id,
          scheduleVersion: newScheduleVersion
        }
      });
    }

    // If priest was assigned/changed, emit BOOKING_ASSIGNED outbox event
    if (priestChanged) {
      const assignEventKey = generateEventIdempotencyKey('BOOKING_ASSIGNED', 'booking', id, `priest_${newPriestId}`);
      await outboxModel.insertEventTx(connection, {
        eventType: NOTIFICATION_EVENTS.BOOKING_ASSIGNED,
        entityType: 'booking',
        entityId: id,
        eventKey: assignEventKey,
        payload: {
          bookingId: id,
          bookingNumber: current.booking_number,
          title: updateData.title || current.title,
          priestId: newPriestId,
          priestName: updateData.priestName || current.priest_name,
          dateKey: newDateKeyStr,
          startTime: newStartTime24,
          timeSlot: updateData.timeSlot || current.time_slot
        }
      });
    }

    if (!isExternalConn) await connection.commit();
    return true;
  } catch (error) {
    if (!isExternalConn) await connection.rollback();
    throw error;
  } finally {
    if (!isExternalConn) connection.release();
  }
};

/**
 * Soft deletes a booking.
 */
const deleteBooking = async (id, conn = null) => {
  const isExternalConn = Boolean(conn);
  const connection = conn || (await pool.getConnection());
  try {
    if (!isExternalConn) await connection.beginTransaction();

    const [existing] = await connection.query(
      'SELECT * FROM bookings WHERE id = ? AND is_deleted = 0 FOR UPDATE;',
      [id]
    );

    if (!existing || existing.length === 0) {
      if (!isExternalConn) await connection.commit();
      return false;
    }

    const current = existing[0];

    const [result] = await connection.execute(`
      UPDATE bookings
      SET is_deleted = 1, deleted_at = NOW(), status = 'cancelled'
      WHERE id = ? AND is_deleted = 0;
    `, [id]);

    if (result.affectedRows === 0) {
      if (!isExternalConn) await connection.commit();
      return false;
    }

    // 1. Cancel pending reminder jobs
    await bookingReminderService.cancelBookingReminders(connection, {
      bookingId: id,
      reason: 'Booking cancelled'
    });

    // 2. Insert outbox event BOOKING_CANCELLED
    const eventKey = generateEventIdempotencyKey('BOOKING_CANCELLED', 'booking', id);
    await outboxModel.insertEventTx(connection, {
      eventType: NOTIFICATION_EVENTS.BOOKING_CANCELLED,
      entityType: 'booking',
      entityId: id,
      eventKey,
      payload: {
        bookingId: id,
        bookingNumber: current.booking_number,
        title: current.title,
        dateKey: current.date_key,
        priestId: current.priest_id,
        priestName: current.priest_name
      }
    });

    if (!isExternalConn) await connection.commit();
    return true;
  } catch (error) {
    if (!isExternalConn) await connection.rollback();
    throw error;
  } finally {
    if (!isExternalConn) connection.release();
  }
};

/**
 * Records a subsequent manual cash payment (Customer payment or Priest remuneration)
 * inside a database transaction and updates outstanding balance.
 */
const recordPayment = async ({ bookingId, party, amount, paymentMethod = 'cash', notes = null, staffId = null, createdBy = null }, conn = null) => {
  const isExternalConn = Boolean(conn);
  const connection = conn || (await pool.getConnection());
  try {
    if (!isExternalConn) await connection.beginTransaction();

    const [rows] = await connection.query(
      'SELECT * FROM bookings WHERE id = ? AND is_deleted = 0 FOR UPDATE',
      [bookingId]
    );

    if (!rows || rows.length === 0) {
      if (!isExternalConn) await connection.rollback();
      return { notFound: true };
    }

    const booking = rows[0];
    const isClient = party.toUpperCase() === 'CLIENT';
    const payAmount = Number(Number(amount).toFixed(2));

    if (payAmount <= 0) {
      const err = new Error('Payment amount must be greater than zero.');
      err.statusCode = 422;
      err.isOperational = true;
      throw err;
    }

    let newTotalReceived = 0;
    let newStatus = 'pending';

    if (isClient) {
      const currentTotal = Number(booking.total_event_charge || 0);
      const currentReceived = Number(booking.client_total_received || 0);
      const remainingBalance = Number((currentTotal - currentReceived).toFixed(2));

      if (payAmount > remainingBalance) {
        if (!isExternalConn) await connection.rollback();
        return {
          exceedsBalance: true,
          balance: remainingBalance,
          party: 'CLIENT'
        };
      }

      newTotalReceived = Number((currentReceived + payAmount).toFixed(2));
      newStatus = newTotalReceived >= currentTotal ? 'paid' : 'partial';

      await connection.execute(`
        UPDATE bookings
        SET client_total_received = ?, client_payment_status = ?, updated_at = NOW()
        WHERE id = ?;
      `, [newTotalReceived, newStatus, bookingId]);
    } else {
      const currentPay = Number(booking.priest_total_pay || 0);
      const currentPaid = Number(booking.priest_advance_paid || 0);
      const remainingBalance = Number((currentPay - currentPaid).toFixed(2));

      if (payAmount > remainingBalance) {
        if (!isExternalConn) await connection.rollback();
        return {
          exceedsBalance: true,
          balance: remainingBalance,
          party: 'PRIEST'
        };
      }

      newTotalReceived = Number((currentPaid + payAmount).toFixed(2));
      newStatus = newTotalReceived >= currentPay ? 'paid' : 'partial';

      await connection.execute(`
        UPDATE bookings
        SET priest_advance_paid = ?, priest_payment_status = ?, updated_at = NOW()
        WHERE id = ?;
      `, [newTotalReceived, newStatus, bookingId]);
    }

    const [res] = await connection.execute(`
      INSERT INTO booking_transactions (booking_id, staff_id, party, amount, payment_method, transaction_type, notes, created_by)
      VALUES (?, ?, ?, ?, ?, 'ADDITIONAL_PAYMENT', ?, ?);
    `, [bookingId, staffId || null, party.toUpperCase(), payAmount, paymentMethod, notes || 'கூடுதல் பணம் செலுத்துகை (Additional Cash Payment)', createdBy || null]);

    const transactionId = res.insertId;

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
        amount: payAmount,
        paymentMethod,
        priestId: !isClient ? (staffId || booking.priest_id) : null,
        staffId: staffId || null,
        updatedPaymentStatus: newStatus
      }
    });

    if (!isExternalConn) await connection.commit();

    return {
      success: true,
      transactionId,
      bookingId,
      party: party.toUpperCase(),
      amount: payAmount,
      updatedTotalReceived: newTotalReceived,
      updatedPaymentStatus: newStatus
    };
  } catch (error) {
    if (!isExternalConn) await connection.rollback();
    throw error;
  } finally {
    if (!isExternalConn) connection.release();
  }
};

/**
 * List all payments for a booking.
 */
const listBookingPayments = async (bookingId) => {
  const [rows] = await pool.query(`
    SELECT
      bt.id,
      bt.booking_id,
      bt.staff_id,
      s.name_tamil as staff_name_tamil,
      s.name_english as staff_name_english,
      bt.party,
      bt.amount,
      bt.payment_method,
      bt.transaction_type,
      bt.reference,
      bt.notes,
      bt.paid_at,
      bt.created_by,
      u.name as created_by_name
    FROM booking_transactions bt
    LEFT JOIN staff s ON s.id = bt.staff_id
    LEFT JOIN users u ON u.id = bt.created_by
    WHERE bt.booking_id = ?
    ORDER BY bt.paid_at ASC, bt.id ASC;
  `, [bookingId]);
  return rows;
};

/**
 * List all configured Pooja / Event types.
 */
const listEventTypes = async () => {
  const [rows] = await pool.query(`
    SELECT
      id,
      name_english,
      name_tamil,
      category,
      default_duration_minutes,
      base_price,
      status
    FROM event_types
    WHERE status = 'ACTIVE'
    ORDER BY id ASC;
  `);
  return rows;
};

/**
 * Aggregates overall financial audit totals and breakdown counts.
 */
const getFinancialAuditSummary = async (filters = {}) => {
  let where = ['is_deleted = 0'];
  const params = [];

  if (filters.fromDate && filters.toDate) {
    where.push('date_key BETWEEN ? AND ?');
    params.push(filters.fromDate, filters.toDate);
  } else if (filters.fromDate) {
    where.push('date_key >= ?');
    params.push(filters.fromDate);
  } else if (filters.toDate) {
    where.push('date_key <= ?');
    params.push(filters.toDate);
  } else if (filters.date) {
    where.push('date_key = ?');
    params.push(filters.date);
  } else if (filters.month) {
    where.push('DATE_FORMAT(date_key, "%Y-%m") = ?');
    params.push(filters.month);
  }

  const query = `
    SELECT
      COUNT(*) AS total_bookings,
      COALESCE(SUM(total_event_charge), 0) AS total_billed,
      COALESCE(SUM(client_total_received), 0) AS total_collected,
      COALESCE(SUM(total_event_charge - client_total_received), 0) AS client_outstanding,
      COALESCE(SUM(priest_total_pay), 0) AS priest_total_due,
      COALESCE(SUM(priest_advance_paid), 0) AS priest_settled,
      COALESCE(SUM(priest_total_pay - priest_advance_paid), 0) AS priest_pending_settlement,
      COUNT(CASE WHEN client_payment_status = 'paid' THEN 1 END) AS fully_paid_count,
      COUNT(CASE WHEN client_payment_status = 'partial' THEN 1 END) AS partial_paid_count,
      COUNT(CASE WHEN client_payment_status = 'pending' THEN 1 END) AS pending_paid_count,
      COUNT(CASE WHEN priest_payment_status = 'paid' THEN 1 END) AS priest_settled_count,
      COUNT(CASE WHEN priest_payment_status != 'paid' AND (priest_total_pay - priest_advance_paid) > 0 THEN 1 END) AS priest_pending_count
    FROM bookings
    WHERE ${where.join(' AND ')};
  `;

  const [rows] = await pool.query(query, params);
  const row = rows[0] || {};

  const totalBilled = Number(row.total_billed || 0);
  const totalCollected = Number(row.total_collected || 0);
  const clientOutstanding = Number((totalBilled - totalCollected).toFixed(2));
  const priestTotalDue = Number(row.priest_total_due || 0);
  const priestSettled = Number(row.priest_settled || 0);
  const priestPendingSettlement = Number((priestTotalDue - priestSettled).toFixed(2));
  const netPeedamMargin = Number((totalCollected - priestSettled).toFixed(2));

  return {
    totalBookings: Number(row.total_bookings || 0),
    totalBilled,
    totalCollected,
    clientOutstanding,
    priestTotalDue,
    priestSettled,
    priestPendingSettlement,
    netPeedamMargin,
    fullyPaidCount: Number(row.fully_paid_count || 0),
    partialPaidCount: Number(row.partial_paid_count || 0),
    pendingPaidCount: Number(row.pending_paid_count || 0),
    priestSettledCount: Number(row.priest_settled_count || 0),
    priestPendingCount: Number(row.priest_pending_count || 0)
  };
};

/**
 * Lists bookings with outstanding client balances (Client Receivables).
 */
const getClientReceivables = async (filters = {}) => {
  let where = ['b.is_deleted = 0', 'b.total_event_charge > b.client_total_received'];
  const params = [];

  if (filters.fromDate && filters.toDate) {
    where.push('b.date_key BETWEEN ? AND ?');
    params.push(filters.fromDate, filters.toDate);
  } else if (filters.fromDate) {
    where.push('b.date_key >= ?');
    params.push(filters.fromDate);
  } else if (filters.toDate) {
    where.push('b.date_key <= ?');
    params.push(filters.toDate);
  } else if (filters.search) {
    const term = `%${String(filters.search).trim()}%`;
    where.push('(b.client_name LIKE ? OR b.client_phone LIKE ? OR b.booking_number LIKE ?)');
    params.push(term, term, term);
  }

  const query = `
    SELECT
      b.id,
      b.booking_number,
      CAST(b.date_key AS CHAR) AS date_key,
      b.title,
      b.client_name,
      b.client_phone,
      b.location,
      b.priest_name,
      b.total_event_charge,
      b.client_advance_amount,
      b.client_total_received,
      (b.total_event_charge - b.client_total_received) AS client_balance,
      b.client_payment_status,
      b.status
    FROM bookings b
    WHERE ${where.join(' AND ')}
    ORDER BY client_balance DESC, b.date_key ASC;
  `;

  const [rows] = await pool.query(query, params);
  return rows.map(r => ({
    id: String(r.id),
    bookingNumber: r.booking_number,
    dateKey: r.date_key,
    title: r.title,
    clientName: r.client_name,
    clientPhone: r.client_phone,
    location: r.location,
    priestName: r.priest_name,
    totalEventCharge: Number(r.total_event_charge),
    clientAdvanceAmount: Number(r.client_advance_amount),
    clientTotalReceived: Number(r.client_total_received),
    clientBalanceAmount: Number(r.client_balance),
    clientPaymentStatus: r.client_payment_status,
    status: r.status
  }));
};

/**
 * Summarizes priest compensation and settlement balances.
 * When filters.groupBy === 'priest', returns aggregate per priest.
 * Otherwise, returns individual pending per-booking priest settlements.
 */
const getPriestSettlements = async (filters = {}) => {
  let where = ['b.is_deleted = 0'];
  const params = [];

  if (filters.fromDate && filters.toDate) {
    where.push('b.date_key BETWEEN ? AND ?');
    params.push(filters.fromDate, filters.toDate);
  } else if (filters.fromDate) {
    where.push('b.date_key >= ?');
    params.push(filters.fromDate);
  } else if (filters.toDate) {
    where.push('b.date_key <= ?');
    params.push(filters.toDate);
  }

  if (filters.groupBy === 'priest') {
    const query = `
      SELECT
        b.priest_id,
        b.priest_name,
        s.name_tamil AS staff_name_tamil,
        s.name_english AS staff_name_english,
        s.phone AS staff_phone,
        s.staff_role,
        COUNT(b.id) AS booking_count,
        COALESCE(SUM(b.priest_total_pay), 0) AS total_pay,
        COALESCE(SUM(b.priest_advance_paid), 0) AS advance_paid,
        COALESCE(SUM(b.priest_total_pay - b.priest_advance_paid), 0) AS balance_due
      FROM bookings b
      LEFT JOIN staff s ON (s.id = CAST(b.priest_id AS UNSIGNED) AND b.priest_id REGEXP '^[0-9]+$')
      WHERE ${where.join(' AND ')}
      GROUP BY b.priest_id, b.priest_name, s.name_tamil, s.name_english, s.phone, s.staff_role
      ORDER BY balance_due DESC, total_pay DESC;
    `;

    const [rows] = await pool.query(query, params);
    return rows.map(r => ({
      priestId: String(r.priest_id),
      priestName: r.staff_name_english || r.priest_name || 'சுவாமி',
      priestNameTamil: r.staff_name_tamil || r.priest_name || 'சுவாமி',
      phone: r.staff_phone || null,
      staffRole: r.staff_role || 'priest',
      bookingCount: Number(r.booking_count),
      totalPay: Number(r.total_pay),
      advancePaid: Number(r.advance_paid),
      balanceDue: Number(r.balance_due),
      settlementStatus: Number(r.balance_due) <= 0 && Number(r.total_pay) > 0 ? 'settled' : (Number(r.advance_paid) > 0 ? 'partial' : 'pending')
    }));
  }

  // Per-booking pending settlements
  const bookingWhere = [...where, 'b.priest_total_pay > 0', 'b.priest_payment_status != "paid"', '(b.priest_total_pay - b.priest_advance_paid) > 0'];
  const query = `
    SELECT
      b.id,
      b.booking_number,
      CAST(b.date_key AS CHAR) AS date_key,
      b.title,
      b.priest_id,
      b.priest_name,
      s.name_tamil AS staff_name_tamil,
      s.name_english AS staff_name_english,
      s.phone AS staff_phone,
      s.staff_role,
      b.priest_total_pay AS total_pay,
      b.priest_advance_paid AS advance_paid,
      (b.priest_total_pay - b.priest_advance_paid) AS balance_due,
      b.priest_payment_status
    FROM bookings b
    LEFT JOIN staff s ON (s.id = CAST(b.priest_id AS UNSIGNED) AND b.priest_id REGEXP '^[0-9]+$')
    WHERE ${bookingWhere.join(' AND ')}
    ORDER BY balance_due DESC, b.date_key ASC;
  `;

  const [rows] = await pool.query(query, params);
  return rows.map(r => ({
    id: String(r.id),
    bookingId: String(r.id),
    bookingNumber: r.booking_number,
    dateKey: r.date_key,
    title: r.title,
    priestId: String(r.priest_id),
    priestName: r.staff_name_english || r.priest_name || 'சுவாமி',
    priestNameTamil: r.staff_name_tamil || r.priest_name || 'சுவாமி',
    phone: r.staff_phone || null,
    staffRole: r.staff_role || 'priest',
    bookingCount: 1,
    totalPay: Number(r.total_pay),
    advancePaid: Number(r.advance_paid),
    balanceDue: Number(r.balance_due),
    settlementStatus: Number(r.balance_due) <= 0 && Number(r.total_pay) > 0 ? 'settled' : (Number(r.advance_paid) > 0 ? 'partial' : 'pending')
  }));
};

/**
 * Retrieves all completed financial settlements (both Priest Settlements and Client Receivables).
 */
const getCompletedSettlements = async (filters = {}) => {
  let where = ['b.is_deleted = 0', '(b.client_payment_status = "paid" OR b.priest_payment_status = "paid")'];
  const params = [];

  if (filters.fromDate && filters.toDate) {
    where.push('b.date_key BETWEEN ? AND ?');
    params.push(filters.fromDate, filters.toDate);
  } else if (filters.fromDate) {
    where.push('b.date_key >= ?');
    params.push(filters.fromDate);
  } else if (filters.toDate) {
    where.push('b.date_key <= ?');
    params.push(filters.toDate);
  }

  const query = `
    SELECT
      b.id AS booking_id,
      b.booking_number,
      CAST(b.date_key AS CHAR) AS date_key,
      b.title,
      b.client_name,
      b.client_phone,
      b.priest_name,
      b.total_event_charge,
      b.client_total_received,
      b.client_payment_status,
      b.priest_total_pay,
      b.priest_advance_paid,
      b.priest_payment_status,
      COALESCE(b.completed_at, b.updated_at) AS completed_at
    FROM bookings b
    WHERE ${where.join(' AND ')}
    ORDER BY b.updated_at DESC;
  `;

  const [rows] = await pool.query(query, params);
  const results = [];

  for (const r of rows) {
    // 1. Completed Client Receivable
    if (r.client_payment_status === 'paid' && Number(r.total_event_charge) > 0) {
      if (!filters.type || String(filters.type).toUpperCase() === 'CLIENT') {
        results.push({
          id: `client_${r.booking_id}`,
          bookingId: String(r.booking_id),
          bookingNumber: r.booking_number,
          dateKey: r.date_key,
          title: r.title,
          settlementType: 'CLIENT',
          personName: r.client_name || 'வாடிக்கையாளர்',
          phone: r.client_phone || null,
          totalAmount: Number(r.total_event_charge),
          previouslyPaidAmount: Number(r.client_total_received),
          finalSettledAmount: Number(r.total_event_charge),
          completionDate: r.completed_at,
          settlementStatus: 'completed'
        });
      }
    }

    // 2. Completed Priest Settlement
    if (r.priest_payment_status === 'paid' && Number(r.priest_total_pay) > 0) {
      if (!filters.type || String(filters.type).toUpperCase() === 'PRIEST') {
        results.push({
          id: `priest_${r.booking_id}`,
          bookingId: String(r.booking_id),
          bookingNumber: r.booking_number,
          dateKey: r.date_key,
          title: r.title,
          settlementType: 'PRIEST',
          personName: r.priest_name || 'புரோகிதர்',
          phone: null,
          totalAmount: Number(r.priest_total_pay),
          previouslyPaidAmount: Number(r.priest_advance_paid),
          finalSettledAmount: Number(r.priest_total_pay),
          completionDate: r.completed_at,
          settlementStatus: 'completed'
        });
      }
    }
  }

  return results;
};

/**
 * Marks a client receivable or priest settlement as completed in the database.
 * If there is an outstanding balance, it records the final settlement transaction and sets status = 'paid'.
 * Fully idempotent: if already settled, returns success safely.
 */
const completeSettlement = async ({ bookingId, party, notes, createdBy }, conn = null) => {
  const isExternalConn = Boolean(conn);
  const connection = conn || (await pool.getConnection());
  try {
    if (!isExternalConn) await connection.beginTransaction();

    const [rows] = await connection.query(
      'SELECT * FROM bookings WHERE id = ? AND is_deleted = 0 FOR UPDATE',
      [bookingId]
    );

    if (!rows || rows.length === 0) {
      if (!isExternalConn) await connection.rollback();
      return { notFound: true };
    }

    const booking = rows[0];
    const isClient = String(party).toUpperCase() === 'CLIENT';
    let settledAmount = 0;

    if (isClient) {
      const currentTotal = Number(booking.total_event_charge || 0);
      const currentReceived = Number(booking.client_total_received || 0);
      const remainingBalance = Number((currentTotal - currentReceived).toFixed(2));

      if (remainingBalance > 0) {
        settledAmount = remainingBalance;
        await connection.execute(`
          INSERT INTO booking_transactions (booking_id, party, amount, payment_method, transaction_type, notes, created_by)
          VALUES (?, 'CLIENT', ?, 'cash', 'ADDITIONAL_PAYMENT', ?, ?);
        `, [bookingId, remainingBalance, notes || 'வாடிக்கையாளர் முழு தீர்வு (Client Settlement Completed)', createdBy || null]);

        await connection.execute(`
          UPDATE bookings
          SET client_total_received = ?, client_payment_status = 'paid', updated_at = NOW()
          WHERE id = ?;
        `, [currentTotal, bookingId]);
      } else {
        await connection.execute(`
          UPDATE bookings
          SET client_payment_status = 'paid', updated_at = NOW()
          WHERE id = ?;
        `, [bookingId]);
      }
    } else {
      const currentPay = Number(booking.priest_total_pay || 0);
      const currentPaid = Number(booking.priest_advance_paid || 0);
      const remainingBalance = Number((currentPay - currentPaid).toFixed(2));

      if (remainingBalance > 0) {
        settledAmount = remainingBalance;
        const targetStaffId = booking.priest_id && !isNaN(booking.priest_id) ? Number(booking.priest_id) : null;
        await connection.execute(`
          INSERT INTO booking_transactions (booking_id, staff_id, party, amount, payment_method, transaction_type, notes, created_by)
          VALUES (?, ?, 'PRIEST', ?, 'cash', 'ADDITIONAL_PAYMENT', ?, ?);
        `, [bookingId, targetStaffId, remainingBalance, notes || 'புரோகிதர் முழு தீர்வு (Priest Settlement Completed)', createdBy || null]);

        await connection.execute(`
          UPDATE bookings
          SET priest_advance_paid = ?, priest_payment_status = 'paid', updated_at = NOW()
          WHERE id = ?;
        `, [currentPay, bookingId]);
      } else {
        await connection.execute(`
          UPDATE bookings
          SET priest_payment_status = 'paid', updated_at = NOW()
          WHERE id = ?;
        `, [bookingId]);
      }
    }

    if (!isExternalConn) await connection.commit();

    return {
      success: true,
      bookingId: String(bookingId),
      party: isClient ? 'CLIENT' : 'PRIEST',
      settledAmount,
      completedAt: new Date().toISOString()
    };
  } catch (err) {
    if (!isExternalConn) await connection.rollback();
    throw err;
  } finally {
    if (!isExternalConn) connection.release();
  }
};

/**
 * Retrieves the unified cash and transaction ledger for financial audit.
 */
const getFinancialAuditTransactions = async (filters = {}) => {
  let where = ['b.is_deleted = 0'];
  const params = [];

  if (filters.party) {
    where.push('bt.party = ?');
    params.push(String(filters.party).toUpperCase());
  }

  if (filters.fromDate && filters.toDate) {
    where.push('DATE(bt.paid_at) BETWEEN ? AND ?');
    params.push(filters.fromDate, filters.toDate);
  } else if (filters.fromDate) {
    where.push('DATE(bt.paid_at) >= ?');
    params.push(filters.fromDate);
  } else if (filters.toDate) {
    where.push('DATE(bt.paid_at) <= ?');
    params.push(filters.toDate);
  }

  if (filters.search) {
    const term = `%${String(filters.search).trim()}%`;
    where.push('(b.booking_number LIKE ? OR b.client_name LIKE ? OR s.name_tamil LIKE ? OR s.name_english LIKE ?)');
    params.push(term, term, term, term);
  }

  const limit = Math.min(parseInt(filters.limit, 10) || 50, 200);

  const query = `
    SELECT
      bt.id,
      bt.booking_id,
      b.booking_number,
      b.title,
      b.client_name,
      bt.staff_id,
      s.name_tamil AS staff_name_tamil,
      s.name_english AS staff_name_english,
      bt.party,
      bt.amount,
      bt.payment_method,
      bt.transaction_type,
      bt.reference,
      bt.notes,
      bt.paid_at,
      u.name AS created_by_name
    FROM booking_transactions bt
    JOIN bookings b ON b.id = bt.booking_id
    LEFT JOIN staff s ON s.id = bt.staff_id
    LEFT JOIN users u ON u.id = bt.created_by
    WHERE ${where.join(' AND ')}
    ORDER BY bt.paid_at DESC, bt.id DESC
    LIMIT ${limit};
  `;

  const [rows] = await pool.query(query, params);
  return rows.map(r => ({
    id: String(r.id),
    bookingId: String(r.booking_id),
    bookingNumber: r.booking_number,
    title: r.title,
    clientName: r.client_name,
    staffId: r.staff_id ? String(r.staff_id) : null,
    staffName: r.staff_name_english || r.staff_name_tamil || null,
    staffNameTamil: r.staff_name_tamil || null,
    party: r.party.toLowerCase(),
    amount: Number(r.amount),
    paymentMethod: r.payment_method,
    transactionType: r.transaction_type,
    reference: r.reference,
    notes: r.notes,
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
    createdByName: r.created_by_name || null
  }));
};

module.exports = {
  findConflicts,
  createBooking,
  getBookingById,
  listBookings,
  updateBooking,
  deleteBooking,
  recordPayment,
  listBookingPayments,
  listEventTypes,
  getFinancialAuditSummary,
  getClientReceivables,
  getPriestSettlements,
  getCompletedSettlements,
  completeSettlement,
  getFinancialAuditTransactions
};
