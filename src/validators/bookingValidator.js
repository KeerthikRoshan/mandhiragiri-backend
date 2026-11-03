const { body, param, validationResult } = require('express-validator');
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
  return sendError(res, 'Validation failed for the submitted fields.', 400, errors);
};

const bookingRules = [
  body('dateKey').isISO8601({ strict: true, strictSeparator: true })
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('dateKey must be a valid date in YYYY-MM-DD format.'),
  body('title').trim().isLength({ min: 2 }).withMessage('Title must be at least 2 characters.'),
  body('clientName').trim().isLength({ min: 2 }).withMessage('Client name must be at least 2 characters.'),
  body('phone').trim().matches(/^\+?[0-9\s-]{10,15}$/).withMessage('Enter a valid client phone number.'),
  body('location').trim().isLength({ min: 2 }).withMessage('Location must be at least 2 characters.'),
  body('category').isIn(['jathagam', 'temple', 'outdoor']).withMessage('Choose a valid booking category.'),
  body('categoryLabelTamil').trim().notEmpty().withMessage('Category label is required.'),
  body('timeSlot').trim().notEmpty().withMessage('Time slot is required.'),
  body('priestId').trim().notEmpty().withMessage('Priest ID is required.'),
  body('priestName').trim().notEmpty().withMessage('Priest name is required.'),
  body('priestPhone').optional({ values: 'falsy' }).trim().matches(/^\+?[0-9\s-]{10,15}$/)
    .withMessage('Enter a valid priest phone number.'),
  body('totalEventCharge').isFloat({ min: 0 }).toFloat().withMessage('Total event charge must be zero or more.'),
  body('clientAdvanceAmount').isFloat({ min: 0 }).toFloat()
    .withMessage('Client advance must be zero or more.')
    .bail()
    .custom((value, { req }) => value <= req.body.totalEventCharge)
    .withMessage('Client advance cannot exceed total event charge.'),
  body('clientTotalReceived').isFloat({ min: 0 }).toFloat()
    .withMessage('Client total received must be zero or more.')
    .bail()
    .custom((value, { req }) => value <= req.body.totalEventCharge)
    .withMessage('Client total received cannot exceed total event charge.'),
  body('priestTotalPay').isFloat({ min: 0 }).toFloat().withMessage('Priest total pay must be zero or more.'),
  body('priestAdvancePaid').isFloat({ min: 0 }).toFloat()
    .withMessage('Priest advance must be zero or more.')
    .bail()
    .custom((value, { req }) => value <= req.body.priestTotalPay)
    .withMessage('Priest advance cannot exceed priest total pay.')
];

module.exports = {
  validateBooking: validate(bookingRules),
  validateBookingId: validate([
    param('bookingId').isInt({ min: 1 }).withMessage('Booking ID must be a positive integer.')
  ])
};