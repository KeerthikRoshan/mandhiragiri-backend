const bookingService = require('../services/bookingService');
const projectModel = require('../models/projectModel');
const { pool } = require('../config/database');
const { executeWithIdempotency } = require('../services/apiIdempotencyService');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const isStaffRole = (role) => ['STAFF', 'PRIEST', 'ASSISTANT'].includes(String(role).toUpperCase());

const getIdempotencyKey = (req) => {
  return req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || null;
};

const createBooking = asyncHandler(async (req, res) => {
  console.log('📥 [POST /api/v1/bookings] Received createBooking payload:', JSON.stringify(req.body, null, 2));
  const idempotencyKey = getIdempotencyKey(req);
  const result = await executeWithIdempotency(
    pool,
    {
      userId: req.user?.id || 0,
      idempotencyKey,
      httpMethod: 'POST',
      requestPath: req.baseUrl ? `${req.baseUrl}${req.path}` : req.originalUrl.split('?')[0],
      query: req.query,
      body: req.body
    },
    async (conn) => {
      const created = await bookingService.createBooking(req.body, req.user?.id, conn);
      return {
        statusCode: 201,
        body: {
          status: 1,
          success: true,
          message: 'பூஜை பதிவு வெற்றிகரமாக சேர்க்கப்பட்டது (Booking registered successfully).',
          data: created,
          errors: null,
          timestamp: new Date().toISOString()
        }
      };
    }
  );

  if (result.isReplay) {
    res.setHeader('X-Cache-Lookup', 'HIT - Idempotent Replay');
  }
  return res.status(result.statusCode).json(result.body);
});

const listBookings = asyncHandler(async (req, res) => {
  const query = { ...req.query };

  // If caller is Staff, enforce strict ownership scoping
  if (req.user && isStaffRole(req.user.role)) {
    const uid = req.user.userId || req.user.id;
    let staff = await projectModel.getStaffByUserId(uid);
    if (!staff && req.user.id) {
      const [directStaff] = await pool.execute('SELECT * FROM staff WHERE id = ? OR staff_id = ? LIMIT 1;', [req.user.id, String(req.user.id)]);
      staff = directStaff[0] || null;
    }
    if (!staff) {
      throw ApiError.forbidden('Staff profile not found or inactive.');
    }
    // Scope query exclusively to this staff member
    query.staffId = staff.id;
    query.staffCode = staff.staff_id;
    query.staffUserId = req.user.id;
    query.priestId = staff.staff_id;
  }

  const result = await bookingService.listBookings(query);
  return sendSuccess(res, 'Bookings retrieved successfully.', {
    count: result.length,
    bookings: result
  }, 200);
});

const getBookingDetails = asyncHandler(async (req, res) => {
  const result = await bookingService.getBookingDetails(req.params.bookingId);

  // If caller is Staff, verify that the booking is assigned to them
  if (req.user && isStaffRole(req.user.role)) {
    const staff = await projectModel.getStaffByUserId(req.user.id);
    if (!staff) {
      throw ApiError.forbidden('Staff profile not found or inactive.');
    }

    const isAssigned =
      String(result.priestId) === String(staff.staff_id) ||
      String(result.priestId) === String(staff.id) ||
      (Array.isArray(result.priests) && result.priests.some(p => 
        String(p.staffId) === String(staff.id) || 
        String(p.staffId) === String(staff.staff_id)
      ));

    if (!isAssigned) {
      throw ApiError.forbidden('Access denied. You can only view bookings assigned to you.');
    }
  }

  return sendSuccess(res, 'Booking details retrieved successfully.', result, 200);
});

const getBookingBalance = asyncHandler(async (req, res) => {
  const result = await bookingService.getBookingBalance(req.params.bookingId);
  return sendSuccess(res, 'Booking balance retrieved successfully.', result, 200);
});

const updateBooking = asyncHandler(async (req, res) => {
  const idempotencyKey = getIdempotencyKey(req);
  const result = await executeWithIdempotency(
    pool,
    {
      userId: req.user?.id || 0,
      idempotencyKey,
      httpMethod: 'PUT',
      requestPath: req.baseUrl ? `${req.baseUrl}${req.path}` : req.originalUrl.split('?')[0],
      query: req.query,
      body: req.body
    },
    async (conn) => {
      const updated = await bookingService.updateBooking(req.params.bookingId, req.body, req.user?.id, conn);
      return {
        statusCode: 200,
        body: {
          status: 1,
          success: true,
          message: 'பூஜை பதிவு புதுப்பிக்கப்பட்டது (Booking updated successfully).',
          data: updated,
          errors: null,
          timestamp: new Date().toISOString()
        }
      };
    }
  );

  if (result.isReplay) {
    res.setHeader('X-Cache-Lookup', 'HIT - Idempotent Replay');
  }
  return res.status(result.statusCode).json(result.body);
});

const deleteBooking = asyncHandler(async (req, res) => {
  const idempotencyKey = getIdempotencyKey(req);
  const result = await executeWithIdempotency(
    pool,
    {
      userId: req.user?.id || 0,
      idempotencyKey,
      httpMethod: 'DELETE',
      requestPath: req.baseUrl ? `${req.baseUrl}${req.path}` : req.originalUrl.split('?')[0],
      query: req.query,
      body: {}
    },
    async (conn) => {
      const deleted = await bookingService.deleteBooking(req.params.bookingId, conn);
      return {
        statusCode: 200,
        body: {
          status: 1,
          success: true,
          message: deleted.message,
          data: null,
          errors: null,
          timestamp: new Date().toISOString()
        }
      };
    }
  );

  if (result.isReplay) {
    res.setHeader('X-Cache-Lookup', 'HIT - Idempotent Replay');
  }
  return res.status(result.statusCode).json(result.body);
});

const checkAvailability = asyncHandler(async (req, res) => {
  const result = await bookingService.checkAvailability(req.body);
  return sendSuccess(
    res,
    result.available
      ? 'தேர்ந்தெடுக்கப்பட்ட நேரம் முன்பதிவுக்கு கிடைக்கிறது (Slot is available).'
      : 'தேர்ந்தெடுக்கப்பட்ட நேரத்தில் மோதல் உள்ளது (Time slot collision detected).',
    result,
    200
  );
});

const getPriestBookings = asyncHandler(async (req, res) => {
  const query = { ...req.query };
  let requestedPriestId = req.params.priestId;

  // If caller is Staff, ensure they can only query their own bookings
  if (req.user && isStaffRole(req.user.role)) {
    const staff = await projectModel.getStaffByUserId(req.user.id);
    if (!staff) {
      throw ApiError.forbidden('Staff profile not found or inactive.');
    }
    // If requested priestId does not match this staff member, reject
    if (
      String(requestedPriestId) !== String(staff.id) &&
      String(requestedPriestId) !== String(staff.staff_id)
    ) {
      throw ApiError.forbidden('Access denied. You can only view bookings assigned to you.');
    }
    query.staffId = staff.id;
    query.staffCode = staff.staff_id;
    query.staffUserId = req.user.id;
    requestedPriestId = staff.staff_id;
  }

  const result = await bookingService.listBookings({
    priestId: requestedPriestId,
    ...query
  });
  return sendSuccess(res, 'Priest bookings retrieved successfully.', {
    priestId: requestedPriestId,
    count: result.length,
    bookings: result
  }, 200);
});

const recordPayment = asyncHandler(async (req, res) => {
  const idempotencyKey = getIdempotencyKey(req);
  const result = await executeWithIdempotency(
    pool,
    {
      userId: req.user?.id || 0,
      idempotencyKey,
      httpMethod: 'POST',
      requestPath: req.baseUrl ? `${req.baseUrl}${req.path}` : req.originalUrl.split('?')[0],
      query: req.query,
      body: req.body
    },
    async (conn) => {
      const paymentRes = await bookingService.recordPayment(req.params.bookingId, req.body, req.user?.id, conn);
      return {
        statusCode: 201,
        body: {
          status: 1,
          success: true,
          message: 'பணம் செலுத்துகை வெற்றிகரமாக பதிவு செய்யப்பட்டது (Payment recorded successfully).',
          data: paymentRes,
          errors: null,
          timestamp: new Date().toISOString()
        }
      };
    }
  );

  if (result.isReplay) {
    res.setHeader('X-Cache-Lookup', 'HIT - Idempotent Replay');
  }
  return res.status(result.statusCode).json(result.body);
});

const getBookingPayments = asyncHandler(async (req, res) => {
  const result = await bookingService.getBookingPayments(req.params.bookingId);
  return sendSuccess(res, 'Booking payment transactions retrieved.', { payments: result }, 200);
});

const listEventTypes = asyncHandler(async (req, res) => {
  const result = await bookingService.listEventTypes();
  return sendSuccess(res, 'Pooja and event types retrieved successfully.', {
    count: result.length,
    eventTypes: result
  }, 200);
});

const getFinancialAuditSummary = asyncHandler(async (req, res) => {
  const result = await bookingService.getFinancialAuditSummary(req.query);
  return sendSuccess(res, 'Financial audit summary retrieved successfully.', result, 200);
});

const getPriestSettlements = asyncHandler(async (req, res) => {
  const result = await bookingService.getPriestSettlements(req.query);
  return sendSuccess(res, 'Priest compensation settlements retrieved successfully.', result, 200);
});

const getFinancialAuditTransactions = asyncHandler(async (req, res) => {
  const result = await bookingService.getFinancialAuditTransactions(req.query);
  return sendSuccess(res, 'Financial audit transactions retrieved successfully.', result, 200);
});

/**
 * Development test booking helper for rapid 5-minute reminder verification
 * POST /api/v1/bookings/dev-test-reminder
 */
const createDevTestReminderBooking = asyncHandler(async (req, res) => {
  const minutesInFuture = Number(req.body.minutesInFuture || 6);
  const title = req.body.title || 'Dev Test 5M Reminder Pooja';

  const now = new Date();
  const targetStartTime = new Date(now.getTime() + minutesInFuture * 60 * 1000);

  // Convert to IST wall-clock representation (+05:30)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(targetStartTime.getTime() + istOffsetMs);
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = `${istDate.getUTCFullYear()}-${pad(istDate.getUTCMonth() + 1)}-${pad(istDate.getUTCDate())}`;
  const startTime = `${pad(istDate.getUTCHours())}:${pad(istDate.getUTCMinutes())}:00`;

  let priestId = req.body.priestId;
  if (!priestId) {
    const [priestRows] = await pool.execute(
      `SELECT id, staff_id, name_tamil FROM staff WHERE status = 'Active' ORDER BY id ASC LIMIT 1;`
    );
    if (priestRows.length > 0) {
      priestId = priestRows[0].staff_id || priestRows[0].id;
    } else {
      priestId = '1';
    }
  }

  const payload = {
    title,
    category: 'temple',
    clientName: 'Dev Test Client',
    clientPhone: '9840123456',
    dateKey,
    startTime,
    durationMinutes: 60,
    location: 'மந்திரகிரி கோவில் (Mandhiragiri Temple)',
    venueType: 'temple',
    priestId: String(priestId),
    totalEventCharge: 1000,
    clientAdvanceAmount: 500,
    priestTotalPay: 500,
    priestAdvancePaid: 250,
    notes: 'Dev-test booking created for quick 5-minute reminder verification.'
  };

  const created = await bookingService.createBooking(payload, req.user?.id || 1);

  const scheduledAt5mUtc = new Date(targetStartTime.getTime() - 5 * 60 * 1000).toISOString();
  const dueInSeconds = Math.max(0, Math.round((new Date(scheduledAt5mUtc).getTime() - Date.now()) / 1000));

  return sendSuccess(res, 'Dev test booking created successfully with short reminder trigger.', {
    booking: created,
    dateKey,
    startTime,
    minutesInFuture,
    scheduledAt5mUtc,
    dueInSeconds,
    instructions: `5-minute reminder is scheduled at ${scheduledAt5mUtc} (due in ~${dueInSeconds} seconds). Run cronRunner or wait for the scheduled tick to trigger push and in-app notifications.`
  }, 201);
});

module.exports = {
  createBooking,
  createDevTestReminderBooking,
  listBookings,
  getBookingDetails,
  getBookingBalance,
  updateBooking,
  deleteBooking,
  checkAvailability,
  getPriestBookings,
  recordPayment,
  getBookingPayments,
  listEventTypes,
  getFinancialAuditSummary,
  getPriestSettlements,
  getFinancialAuditTransactions
};
