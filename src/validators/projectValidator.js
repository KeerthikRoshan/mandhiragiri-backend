const { body, param, query, validationResult } = require('express-validator');
const { sendError } = require('../utils/response');

const validate = (rules) => async (req, res, next) => {
  for (const rule of rules) await rule.run(req);
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const errors = {};
  for (const error of result.array()) {
    if (!errors[error.path]) errors[error.path] = error.msg;
  }
  return sendError(res, 'Validation failed for the submitted fields.', 400, errors);
};

const dateRule = (field) => field.matches(/^\d{4}-\d{2}-\d{2}$/).isISO8601({ strict: true, strictSeparator: true });

module.exports = {
  validateSchedule: validate([
    query('date').notEmpty().withMessage('date is required.').bail().custom((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))).withMessage('date must use YYYY-MM-DD format.'),
    query('category').optional().isIn(['all', 'jathagam', 'temple', 'outdoor']),
    query('viewMode').optional().isIn(['time', 'priest'])
  ]),
  validateStaffList: validate([
    query('status').optional().isIn(['active', 'inactive', 'all']),
    query('search').optional().trim().isLength({ max: 100 })
  ]),
  validateCreateStaff: validate([
    body('nameEnglish').trim().isLength({ min: 2, max: 150 }),
    body('phone').trim().matches(/^\+?[0-9\s-]{10,15}$/),
    body('roleCategory').optional().isIn(['PRIEST', 'ASSISTANT']),
    body('email').optional({ values: 'falsy' }).isEmail(),
    body('nameTamil').optional().trim().isLength({ max: 150 }),
    body('designationTamil').optional().trim().isLength({ max: 100 }),
    body('designationEnglish').optional().trim().isLength({ max: 100 }),
    body('password').optional().isLength({ min: 6 })
  ]),
  validateAttendanceQuery: validate([
    query('date').notEmpty().custom((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))),
    query('status').optional().isIn(['all', 'absent', 'present', 'not_marked']),
    query('role').optional().isIn(['all', 'priest', 'assistant']),
    query('search').optional().trim().isLength({ max: 100 })
  ]),
  validateAttendanceRecord: validate([
    body('staffId').isInt({ min: 1 }),
    body('dateKey').custom((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))),
    body('status').isIn(['present', 'absent']),
    body('submissionTime').optional({ values: 'falsy' }).isString(),
    body('remarks').optional({ values: 'null' }).isLength({ max: 500 })
  ]),
  validateAttendanceSelf: validate([
    body('dateKey').custom((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))),
    body('status').isIn(['present', 'absent']),
    body('remarks').optional({ values: 'null' }).isLength({ max: 500 })
  ]),
  validateLeaveList: validate([query('status').optional().isIn(['all', 'pending', 'approved', 'rejected'])]),
  validateLeaveDecision: validate([
    param('leaveId').isInt({ min: 1 }),
    body('decision').isIn(['approved', 'rejected']),
    body('adminRemarks').optional({ values: 'null' }).isLength({ max: 1000 })
  ]),
  validateLeaveApplication: validate([
    body('startDate').custom((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))),
    body('endDate').custom((value, { req }) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && value >= req.body.startDate),
    body('leaveType').trim().notEmpty().isLength({ max: 40 }),
    body('reason').trim().notEmpty().isLength({ max: 1000 })
  ]),
  validateEventCompletion: validate([
    param('eventId').isInt({ min: 1 }),
    body('completionNotes').optional({ values: 'null' }).isLength({ max: 2000 })
  ]),
  validateAdminProfile: validate([
    body('phone').trim().matches(/^\+?[0-9\s-]{10,15}$/),
    body('email').optional({ values: 'falsy' }).isEmail(),
    body('addressTamil').optional({ values: 'null' }).isLength({ max: 1000 })
  ]),
  validateStaffAvatar: validate([param('staffId').isInt({ min: 1 })]),
  validatePanchangam: validate([
    body('dateKey').custom((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))),
    body('location').trim().notEmpty().isLength({ max: 100 }),
    body('gregorianBadge').optional({ values: 'null' }).isLength({ max: 80 }),
    body('tamilDateBadge').optional({ values: 'null' }).isLength({ max: 80 })
  ]),
  validatePanchangamQuery: validate([
    query('date').optional().custom((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))),
    query('location').optional().trim().isLength({ min: 1, max: 100 })
  ]),
  validateBookingId: validate([param('bookingId').isInt({ min: 1 })]),
  validateBookingPayment: validate([
    param('bookingId').isInt({ min: 1 }),
    body('party').isIn(['client', 'priest']),
    body('amount').isFloat({ min: 0.01 }).toFloat(),
    body('paymentMethod').optional().isIn(['cash', 'upi', 'card', 'bank_transfer', 'other']),
    body('reference').optional({ values: 'null' }).isLength({ max: 150 }),
    body('notes').optional({ values: 'null' }).isLength({ max: 500 })
  ]),
  validateBalanceReport: validate([
    query('fromDate').custom((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))),
    query('toDate').custom((value, { req }) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && value >= req.query.fromDate)
  ])
};