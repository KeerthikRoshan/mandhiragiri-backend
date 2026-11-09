const { body, param, query, validationResult } = require('express-validator');
const { sendError } = require('../utils/response');

const validate = (rules) => async (req, res, next) => {
  for (const rule of rules) {
    await rule.run(req);
  }

  const result = validationResult(req);
  if (result.isEmpty()) {
    return next();
  }

  const errors = {};
  for (const error of result.array()) {
    if (!errors[error.path]) {
      errors[error.path] = error.msg;
    }
  }
  console.error(`❌ [bookingValidator] 400 Validation Error on ${req.method} ${req.originalUrl}`);
  console.error('❌ [bookingValidator] Field Errors:', JSON.stringify(errors, null, 2));
  console.error('❌ [bookingValidator] Incoming Body:', JSON.stringify(req.body, null, 2));
  return sendError(res, 'Validation failed for the submitted fields.', 400, errors);
};

const normalizeBookingBody = (req) => {
  const b = req.body || {};
  // Normalize date
  req.body.dateKey = b.dateKey || b.date || b.booking_date;
  // Normalize client name
  req.body.clientName = b.clientName || b.client_name;
  // Normalize phone
  req.body.phone = b.phone || b.clientPhone || b.client_phone || b.mobileNumber;
  // Normalize alternate phone
  req.body.alternatePhone = b.alternatePhone !== undefined ? b.alternatePhone : (b.alternate_phone !== undefined ? b.alternate_phone : null);
  // Normalize start time
  req.body.startTime = b.startTime || b.start_time;
  // Normalize duration
  req.body.durationMinutes = b.durationMinutes !== undefined ? b.durationMinutes : (b.duration_minutes !== undefined ? b.duration_minutes : 60);
  // Normalize venue
  req.body.venueType = b.venueType || b.venue_type || 'home';
  // Normalize category
  req.body.category = b.category || 'outdoor';
  // Normalize samagri
  req.body.samagriBy = b.samagriBy || b.samagri_by || 'customer';
  // Normalize address, area, pincode, notes
  if (b.address !== undefined) req.body.address = b.address;
  if (b.area !== undefined) req.body.area = b.area;
  if (b.pincode !== undefined) req.body.pincode = b.pincode;
  if (b.notes !== undefined) req.body.notes = b.notes;
  if (b.location !== undefined) req.body.location = b.location;

  // Normalize finances
  req.body.totalEventCharge = b.totalEventCharge !== undefined ? b.totalEventCharge : (b.total_event_charge !== undefined ? b.total_event_charge : 0);
  req.body.clientAdvanceAmount = b.clientAdvanceAmount !== undefined ? b.clientAdvanceAmount : (b.client_advance_amount !== undefined ? b.client_advance_amount : 0);
  req.body.clientTotalReceived = b.clientTotalReceived !== undefined ? b.clientTotalReceived : (b.client_total_received !== undefined ? b.client_total_received : req.body.clientAdvanceAmount);
  req.body.priestTotalPay = b.priestTotalPay !== undefined ? b.priestTotalPay : (b.priest_total_pay !== undefined ? b.priest_total_pay : 0);
  req.body.priestAdvancePaid = b.priestAdvancePaid !== undefined ? b.priestAdvancePaid : (b.priest_advance_paid !== undefined ? b.priest_advance_paid : 0);

  // Normalize priestId
  const rawPriests = b.priestId || b.priest_id || b.priestIds || b.priest_ids;
  if (Array.isArray(rawPriests) && rawPriests.length > 0) {
    req.body.priestId = String(rawPriests[0]);
    req.body.priestIds = rawPriests.map(String);
  } else if (rawPriests) {
    req.body.priestId = String(rawPriests);
    req.body.priestIds = [String(rawPriests)];
  }
};

const bookingRules = [
  body().custom((val, { req }) => {
    normalizeBookingBody(req);
    return true;
  }),
  body('dateKey')
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('dateKey or booking_date must be a valid date in YYYY-MM-DD format.'),
  body('title').trim()
    .isLength({ min: 2, max: 150 })
    .withMessage('Title must be between 2 and 150 characters.'),
  body('clientName').trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Client name must be between 2 and 100 characters.'),
  body('phone').trim()
    .matches(/^[0-9+\s-]{10,15}$/)
    .withMessage('Enter a valid client phone number (10 to 15 digits).'),
  body('alternatePhone').optional({ values: 'falsy' }).trim()
    .matches(/^[0-9+\s-]{7,15}$/)
    .withMessage('Alternate phone number must be between 7 and 15 digits.'),
  body('location').optional({ values: 'falsy' }).trim().isLength({ max: 255 })
    .withMessage('Location cannot exceed 255 characters.'),
  body('address').optional({ values: 'falsy' }).trim().isLength({ max: 255 })
    .withMessage('Address cannot exceed 255 characters.'),
  body('area').optional({ values: 'falsy' }).trim().isLength({ max: 150 })
    .withMessage('Area cannot exceed 150 characters.'),
  body('pincode').optional({ values: 'falsy' }).trim().isLength({ max: 10 })
    .withMessage('Pincode cannot exceed 10 characters.'),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters.'),
  body('venueType').optional({ values: 'falsy' }).isIn(['home', 'temple', 'hall', 'other'])
    .withMessage('venueType must be one of: home, temple, hall, other.'),
  body('category').optional({ values: 'falsy' }),
  body('priestId').trim().notEmpty().withMessage('Priest ID is required.'),
  body('totalEventCharge').optional({ values: 'falsy' }).isFloat({ min: 0, max: 10000000 }).toFloat()
    .withMessage('Total event charge must be between 0 and 10,000,000.'),
  body('clientAdvanceAmount').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat()
    .withMessage('Client advance must be zero or more.'),
  body('priestTotalPay').optional({ values: 'falsy' }).isFloat({ min: 0, max: 10000000 }).toFloat()
    .withMessage('Priest total pay must be between 0 and 10,000,000.'),
  body('priestAdvancePaid').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat()
    .withMessage('Priest advance must be zero or more.'),
  body('clientAdvanceAmount').custom((val, { req }) => {
    const total = parseFloat(req.body.totalEventCharge || 0);
    const advance = parseFloat(val || 0);
    if (total > 0 && advance > total) {
      throw new Error('Client advance amount cannot exceed total event charge.');
    }
    return true;
  }),
  body('priestAdvancePaid').custom((val, { req }) => {
    const total = parseFloat(req.body.priestTotalPay || 0);
    const advance = parseFloat(val || 0);
    if (total > 0 && advance > total) {
      throw new Error('Priest advance paid cannot exceed priest total pay.');
    }
    return true;
  })
];

const updateBookingRules = [
  body().custom((val, { req }) => {
    normalizeBookingBody(req);
    return true;
  }),
  body('dateKey').optional({ values: 'falsy' })
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('dateKey must be a valid date in YYYY-MM-DD format.'),
  body('title').optional({ values: 'falsy' }).trim()
    .isLength({ min: 2, max: 150 })
    .withMessage('Title must be between 2 and 150 characters.'),
  body('clientName').optional({ values: 'falsy' }).trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Client name must be between 2 and 100 characters.'),
  body('phone').optional({ values: 'falsy' }).trim()
    .matches(/^[0-9+\s-]{10,15}$/)
    .withMessage('Enter a valid client phone number (10 to 15 digits).'),
  body('alternatePhone').optional({ values: 'falsy' }).trim()
    .matches(/^[0-9+\s-]{7,15}$/)
    .withMessage('Alternate phone number must be between 7 and 15 digits.'),
  body('location').optional({ values: 'falsy' }).trim().isLength({ max: 255 })
    .withMessage('Location cannot exceed 255 characters.'),
  body('address').optional({ values: 'falsy' }).trim().isLength({ max: 255 })
    .withMessage('Address cannot exceed 255 characters.'),
  body('area').optional({ values: 'falsy' }).trim().isLength({ max: 150 })
    .withMessage('Area cannot exceed 150 characters.'),
  body('pincode').optional({ values: 'falsy' }).trim().isLength({ max: 10 })
    .withMessage('Pincode cannot exceed 10 characters.'),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters.'),
  body('venueType').optional({ values: 'falsy' }).isIn(['home', 'temple', 'hall', 'other'])
    .withMessage('venueType must be one of: home, temple, hall, other.'),
  body('category').optional({ values: 'falsy' }),
  body('priestId').optional({ values: 'falsy' }).trim().notEmpty()
    .withMessage('Priest ID cannot be empty.'),
  body('totalEventCharge').optional({ values: 'falsy' }).isFloat({ min: 0, max: 10000000 }).toFloat()
    .withMessage('Total event charge must be between 0 and 10,000,000.'),
  body('clientAdvanceAmount').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat()
    .withMessage('Client advance must be zero or more.'),
  body('priestTotalPay').optional({ values: 'falsy' }).isFloat({ min: 0, max: 10000000 }).toFloat()
    .withMessage('Priest total pay must be between 0 and 10,000,000.'),
  body('priestAdvancePaid').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat()
    .withMessage('Priest advance must be zero or more.'),
  body('clientAdvanceAmount').custom((val, { req }) => {
    const total = parseFloat(req.body.totalEventCharge || 0);
    const advance = parseFloat(val || 0);
    if (total > 0 && advance > total) {
      throw new Error('Client advance amount cannot exceed total event charge.');
    }
    return true;
  }),
  body('priestAdvancePaid').custom((val, { req }) => {
    const total = parseFloat(req.body.priestTotalPay || 0);
    const advance = parseFloat(val || 0);
    if (total > 0 && advance > total) {
      throw new Error('Priest advance paid cannot exceed priest total pay.');
    }
    return true;
  })
];

const checkAvailabilityRules = [
  body().custom((val, { req }) => {
    const b = req.body || {};
    req.body.booking_date = b.booking_date || b.dateKey || b.date;
    req.body.start_time = b.start_time || b.startTime;
    req.body.duration_minutes = b.duration_minutes !== undefined ? b.duration_minutes : (b.durationMinutes !== undefined ? b.durationMinutes : 60);

    const rawPriests = b.priest_ids || b.priestIds || b.priest_id || b.priestId;
    if (Array.isArray(rawPriests) && rawPriests.length > 0) {
      req.body.priest_ids = rawPriests.map(String);
    } else if (rawPriests) {
      req.body.priest_ids = [String(rawPriests)];
    }

    if (!req.body.booking_date || !/^\d{4}-\d{2}-\d{2}$/.test(req.body.booking_date)) {
      throw new Error('Valid booking_date or dateKey (YYYY-MM-DD) is required.');
    }
    if (!req.body.start_time) {
      throw new Error('start_time or startTime is required.');
    }
    if (!req.body.priest_ids || req.body.priest_ids.length === 0) {
      throw new Error('priest_ids or priestId is required.');
    }
    return true;
  })
];

const paymentRules = [
  body('party').trim().toUpperCase().isIn(['CLIENT', 'PRIEST'])
    .withMessage('party must be either CLIENT or PRIEST.'),
  body('amount').isFloat({ min: 0.01 }).toFloat()
    .withMessage('amount must be greater than zero.'),
  body('paymentMethod').optional({ values: 'falsy' }).trim(),
  body('notes').optional({ values: 'falsy' }).trim()
];

module.exports = {
  validateBooking: validate(bookingRules),
  validateUpdateBooking: validate(updateBookingRules),
  validateBookingId: validate([
    param('bookingId').isInt({ min: 1 }).withMessage('Booking ID must be a positive integer.')
  ]),
  validateAvailability: validate(checkAvailabilityRules),
  validatePayment: validate(paymentRules)
};
