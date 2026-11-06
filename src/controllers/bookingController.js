const bookingService = require('../services/bookingService');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const createBooking = asyncHandler(async (req, res) => {
  console.log('📥 [POST /api/v1/bookings] Received createBooking payload:', JSON.stringify(req.body, null, 2));
  const result = await bookingService.createBooking(req.body, req.user?.id);
  console.log('✅ [POST /api/v1/bookings] Created successfully. ID:', result.id, 'Booking Number:', result.bookingNumber);
  return sendSuccess(
    res,
    'பூஜை பதிவு வெற்றிகரமாக சேர்க்கப்பட்டது (Booking registered successfully).',
    result,
    201
  );
});

const listBookings = asyncHandler(async (req, res) => {
  const result = await bookingService.listBookings(req.query);
  return sendSuccess(res, 'Bookings retrieved successfully.', {
    count: result.length,
    bookings: result
  }, 200);
});

const getBookingDetails = asyncHandler(async (req, res) => {
  const result = await bookingService.getBookingDetails(req.params.bookingId);
  return sendSuccess(res, 'Booking details retrieved successfully.', result, 200);
});

const getBookingBalance = asyncHandler(async (req, res) => {
  const result = await bookingService.getBookingBalance(req.params.bookingId);
  return sendSuccess(res, 'Booking balance retrieved successfully.', result, 200);
});

const updateBooking = asyncHandler(async (req, res) => {
  const result = await bookingService.updateBooking(req.params.bookingId, req.body, req.user?.id);
  return sendSuccess(res, 'பூஜை பதிவு புதுப்பிக்கப்பட்டது (Booking updated successfully).', result, 200);
});

const deleteBooking = asyncHandler(async (req, res) => {
  const result = await bookingService.deleteBooking(req.params.bookingId);
  return sendSuccess(res, result.message, null, 200);
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
  const result = await bookingService.listBookings({
    priestId: req.params.priestId,
    ...req.query
  });
  return sendSuccess(res, 'Priest bookings retrieved successfully.', {
    priestId: req.params.priestId,
    count: result.length,
    bookings: result
  }, 200);
});

const recordPayment = asyncHandler(async (req, res) => {
  const result = await bookingService.recordPayment(req.params.bookingId, req.body, req.user?.id);
  return sendSuccess(res, 'பணம் செலுத்துகை வெற்றிகரமாக பதிவு செய்யப்பட்டது (Payment recorded successfully).', result, 201);
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

module.exports = {
  createBooking,
  listBookings,
  getBookingDetails,
  getBookingBalance,
  updateBooking,
  deleteBooking,
  checkAvailability,
  getPriestBookings,
  recordPayment,
  getBookingPayments,
  listEventTypes
};
