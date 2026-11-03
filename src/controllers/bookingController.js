const bookingService = require('../services/bookingService');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const createBooking = asyncHandler(async (req, res) => {
  const result = await bookingService.createBooking(req.body, req.user.id);
  return sendSuccess(
    res,
    'பூஜை பதிவு வெற்றிகரமாக சேர்க்கப்பட்டது (Booking registered successfully).',
    result,
    201
  );
});

const getBookingBalance = asyncHandler(async (req, res) => {
  const result = await bookingService.getBookingBalance(req.params.bookingId);
  return sendSuccess(res, 'Booking balance retrieved successfully.', result, 200);
});

module.exports = {
  createBooking,
  getBookingBalance
};