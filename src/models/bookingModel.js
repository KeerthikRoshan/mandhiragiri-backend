const { pool } = require('../config/database');
const { minutesTo12, minutesTo24, parseTimeToMinutes } = require('../utils/timeUtils');

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
const createBooking = async (booking) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

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
        priest_payment_status, created_by, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
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
      String(booking.priestId),
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
      const isPrimary = i === 0 ? 1 : 0;
      // Only insert if staff_id is numeric
      if (/^\d+$/.test(pIdStr)) {
        await connection.execute(`
          INSERT INTO booking_priests (booking_id, staff_id, is_primary, priest_pay, advance_paid)
          VALUES (?, ?, ?, ?, ?);
        `, [bookingId, parseInt(pIdStr, 10), isPrimary, isPrimary ? priestTotal : 0, isPrimary ? priestPaid : 0]);
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

    await connection.commit();
    return bookingId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Retrieve booking details by ID including transactions and assigned priests.
 */
const getBookingById = async (id) => {
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

  const [rows] = await pool.query(query, [id]);
  if (!rows || rows.length === 0) return null;

  const row = rows[0];

  // Fetch transactions
  const [transactions] = await pool.query(`
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
  const [priests] = await pool.query(`
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
  let whereClauses = ['b.is_deleted = 0'];
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

  if (filters.priestId) {
    const pIdStr = String(filters.priestId);
    if (/^\d+$/.test(pIdStr)) {
      whereClauses.push('(b.priest_id = ? OR b.id IN (SELECT booking_id FROM booking_priests WHERE staff_id = ?))');
      params.push(pIdStr, parseInt(pIdStr, 10));
    } else {
      whereClauses.push('b.priest_id = ?');
      params.push(pIdStr);
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
    ORDER BY b.date_key ASC, b.start_time ASC, b.id ASC;
  `;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Updates a booking with conflict checking.
 */
const updateBooking = async (id, updateData) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

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
        alternate_phone = COALESCE(?, alternate_phone),
        location = COALESCE(?, location),
        venue_type = COALESCE(?, venue_type),
        address = COALESCE(?, address),
        area = COALESCE(?, area),
        pincode = COALESCE(?, pincode),
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
        notes = COALESCE(?, notes),
        status = COALESCE(?, status),
        total_event_charge = ?,
        client_total_received = ?,
        client_payment_status = ?,
        priest_total_pay = ?,
        priest_advance_paid = ?,
        priest_payment_status = ?
      WHERE id = ?;
    `;

    const values = [
      updateData.title,
      updateData.eventTypeId,
      updateData.clientName,
      updateData.phone,
      updateData.alternatePhone,
      updateData.location,
      updateData.venueType,
      updateData.address,
      updateData.area,
      updateData.pincode,
      updateData.category,
      updateData.categoryLabelTamil,
      updateData.dateKey,
      updateData.startTime24,
      updateData.endTime24,
      updateData.durationMinutes,
      updateData.timeSlot,
      updateData.priestId ? String(updateData.priestId) : null,
      updateData.priestName,
      updateData.priestPhone,
      updateData.samagriBy,
      updateData.notes,
      updateData.status,
      clientTotal,
      clientRecv,
      clientStatus,
      priestTotal,
      priestPaid,
      priestStatus,
      id
    ];

    await connection.execute(query, values);

    // Sync booking_priests if priestIds provided
    if (updateData.priestIds && updateData.priestIds.length > 0) {
      await connection.execute('DELETE FROM booking_priests WHERE booking_id = ?', [id]);
      for (let i = 0; i < updateData.priestIds.length; i++) {
        const pIdStr = String(updateData.priestIds[i]);
        if (/^\d+$/.test(pIdStr)) {
          await connection.execute(`
            INSERT INTO booking_priests (booking_id, staff_id, is_primary, priest_pay, advance_paid)
            VALUES (?, ?, ?, ?, ?);
          `, [id, parseInt(pIdStr, 10), i === 0 ? 1 : 0, i === 0 ? priestTotal : 0, i === 0 ? priestPaid : 0]);
        }
      }
    }

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Soft deletes a booking.
 */
const deleteBooking = async (id) => {
  const [result] = await pool.execute(`
    UPDATE bookings
    SET is_deleted = 1, deleted_at = NOW(), status = 'cancelled'
    WHERE id = ? AND is_deleted = 0;
  `, [id]);
  return result.affectedRows > 0;
};

/**
 * Records a subsequent manual cash payment (Customer payment or Priest remuneration)
 * inside a database transaction and updates outstanding balance.
 */
const recordPayment = async ({ bookingId, party, amount, paymentMethod = 'cash', notes = null, staffId = null, createdBy = null }) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      'SELECT * FROM bookings WHERE id = ? AND is_deleted = 0 FOR UPDATE',
      [bookingId]
    );

    if (!rows || rows.length === 0) {
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

    await connection.commit();

    return {
      success: true,
      transactionId: res.insertId,
      bookingId,
      party: party.toUpperCase(),
      amount: payAmount,
      updatedTotalReceived: newTotalReceived,
      updatedPaymentStatus: newStatus
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
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

module.exports = {
  findConflicts,
  createBooking,
  getBookingById,
  listBookings,
  updateBooking,
  deleteBooking,
  recordPayment,
  listBookingPayments,
  listEventTypes
};
