const { pool } = require('../config/database');

const createBooking = async (booking) => {
  const query = `
    INSERT INTO bookings (
      booking_number, date_key, title, client_name, client_phone, location,
      category, category_label_tamil, time_slot, priest_id, priest_name,
      priest_phone, total_event_charge, client_advance_amount,
      client_total_received, priest_total_pay, priest_advance_paid, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `;
  const values = [
    booking.bookingNumber,
    booking.dateKey,
    booking.title,
    booking.clientName,
    booking.phone,
    booking.location,
    booking.category,
    booking.categoryLabelTamil,
    booking.timeSlot,
    booking.priestId,
    booking.priestName,
    booking.priestPhone || null,
    booking.totalEventCharge,
    booking.clientAdvanceAmount,
    booking.clientTotalReceived,
    booking.priestTotalPay,
    booking.priestAdvancePaid,
    booking.createdBy || null
  ];

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(query, values);
    const initialPayments = [
      ['CLIENT', Number(booking.clientTotalReceived)],
      ['PRIEST', Number(booking.priestAdvancePaid)]
    ];
    for (const [party, amount] of initialPayments) {
      if (amount > 0) {
        await connection.execute(`
          INSERT INTO booking_transactions (booking_id, party, amount, payment_method, notes, created_by)
          VALUES (?, ?, ?, 'cash', 'Initial amount entered when booking was created.', ?);
        `, [result.insertId, party, amount, booking.createdBy || null]);
      }
    }
    await connection.commit();
    return result.insertId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const findPriestBookingsOnDate = async (dateKey, priestId) => {
  const [rows] = await pool.execute(`
    SELECT id, time_slot FROM bookings
    WHERE date_key = ? AND priest_id = ? AND status != 'cancelled';
  `, [dateKey, priestId]);
  return rows;
};

const findBookingFinancialsById = async (id) => {
  const query = `
    SELECT
      id,
      booking_number,
      client_name,
      total_event_charge,
      client_total_received,
      priest_total_pay,
      priest_advance_paid
    FROM bookings
    WHERE id = ?
    LIMIT 1;
  `;
  const [rows] = await pool.execute(query, [id]);
  return rows.length ? rows[0] : null;
};

module.exports = {
  createBooking,
  findPriestBookingsOnDate,
  findBookingFinancialsById
};