const express = require('express');
const bookingController = require('../controllers/bookingController');
const {
  validateBooking,
  validateUpdateBooking,
  validateBookingId,
  validateAvailability,
  validatePayment
} = require('../validators/bookingValidator');
const { authenticate, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();
const adminOnly = [authenticate, authorizeRoles('SUPER_ADMIN', 'ADMIN')];

// 1. Pooja / Event Types Configuration
router.get('/event-types', ...adminOnly, bookingController.listEventTypes);

// 2. Availability & Conflict Checking
router.post('/check-availability', ...adminOnly, validateAvailability, bookingController.checkAvailability);
router.post('/checkAvailability', ...adminOnly, validateAvailability, bookingController.checkAvailability);

// 3. Create & List Bookings
router.post('/', ...adminOnly, validateBooking, bookingController.createBooking);
router.get('/', ...adminOnly, bookingController.listBookings);

// 4. Date-wise & Priest-wise queries
router.get('/date/:date', ...adminOnly, (req, res, next) => {
  req.query.date = req.params.date;
  bookingController.listBookings(req, res, next);
});
router.get('/priest/:priestId', ...adminOnly, bookingController.getPriestBookings);

// 5. Financial Audits & Settlement Endpoints
router.get('/financial-audits/summary', ...adminOnly, bookingController.getFinancialAuditSummary);
router.get('/financial-audits/settlements', ...adminOnly, bookingController.getPriestSettlements);
router.get('/financial-audits/transactions', ...adminOnly, bookingController.getFinancialAuditTransactions);

// 6. Booking Details, Update, Delete & Financials
router.get('/:bookingId', ...adminOnly, validateBookingId, bookingController.getBookingDetails);
router.put('/:bookingId', ...adminOnly, validateBookingId, validateUpdateBooking, bookingController.updateBooking);
router.delete('/:bookingId', ...adminOnly, validateBookingId, bookingController.deleteBooking);
router.get('/:bookingId/balance', ...adminOnly, validateBookingId, bookingController.getBookingBalance);

// 7. Manual Cash Payments & Transactions
router.post('/:bookingId/payments', ...adminOnly, validateBookingId, validatePayment, bookingController.recordPayment);
router.get('/:bookingId/payments', ...adminOnly, validateBookingId, bookingController.getBookingPayments);

module.exports = router;
