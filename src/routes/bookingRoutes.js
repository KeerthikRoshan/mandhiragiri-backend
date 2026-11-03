const express = require('express');
const bookingController = require('../controllers/bookingController');
const projectController = require('../controllers/projectController');
const { validateBooking, validateBookingId } = require('../validators/bookingValidator');
const { validateBookingPayment } = require('../validators/projectValidator');
const { authenticate, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();
const adminOnly = [authenticate, authorizeRoles('SUPER_ADMIN', 'ADMIN')];

router.post('/', ...adminOnly, validateBooking, bookingController.createBooking);
router.get('/:bookingId/balance', ...adminOnly, validateBookingId, bookingController.getBookingBalance);
router.post('/:bookingId/payments', ...adminOnly, validateBookingPayment, projectController.recordBookingPayment);
router.get('/:bookingId/payments', ...adminOnly, validateBookingId, projectController.bookingPayments);

module.exports = router;