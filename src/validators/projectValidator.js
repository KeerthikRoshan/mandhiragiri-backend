const { body, param, query, validationResult } = require('express-validator');
const { sendError } = require('../utils/response');

const normalizeStaffBody = (req) => {
  if (req.body && typeof req.body === 'object') {
    // Names
    if (req.body.name_english !== undefined && req.body.nameEnglish === undefined) req.body.nameEnglish = req.body.name_english;
    if (req.body.name_tamil !== undefined && req.body.nameTamil === undefined) req.body.nameTamil = req.body.name_tamil;
    
    // Phone / Mobile aliases
    if (!req.body.phone) {
      if (req.body.mobileNumber) req.body.phone = req.body.mobileNumber;
      else if (req.body.mobile) req.body.phone = req.body.mobile;
      else if (req.body.mobile_number) req.body.phone = req.body.mobile_number;
    }

    // Languages & Avatar
    if (req.body.languages_spoken !== undefined && req.body.languagesSpoken === undefined) req.body.languagesSpoken = req.body.languages_spoken;
    if (req.body.avatar_url !== undefined && req.body.avatarUrl === undefined) req.body.avatarUrl = req.body.avatar_url;

    // Staff category / role normalization
    // Application user role is always STAFF for both Priests and Assistants.
    // The distinction between Priest and Assistant is the staff category ('Priest' | 'Assistant').
    const rawRole = req.body.staffRole !== undefined
      ? req.body.staffRole
      : (req.body.staff_role !== undefined
        ? req.body.staff_role
        : (req.body.staffCategory !== undefined
          ? req.body.staffCategory
          : (req.body.staff_category !== undefined
            ? req.body.staff_category
            : (req.body.roleCategory !== undefined
              ? req.body.roleCategory
              : (req.body.category !== undefined
                ? req.body.category
                : (req.body.role !== undefined ? req.body.role : null))))));

    const desig = String(req.body.designation || '').toLowerCase();
    let resolvedCategory = 'Priest';

    if (rawRole) {
      const lower = String(rawRole).trim().toLowerCase();
      if (lower.includes('assistant')) {
        resolvedCategory = 'Assistant';
      } else if (lower.includes('priest')) {
        resolvedCategory = 'Priest';
      } else if (lower === 'staff') {
        resolvedCategory = desig.includes('assistant') ? 'Assistant' : 'Priest';
      }
    } else if (desig.includes('assistant')) {
      resolvedCategory = 'Assistant';
    }

    req.body.staffRole = resolvedCategory;
    req.body.staff_role = resolvedCategory;
    req.body.staffCategory = resolvedCategory;
    req.body.roleCategory = resolvedCategory.toUpperCase();
  }
};

const validate = (rules, options = {}) => async (req, res, next) => {
  if (options.isCreateStaff) {
    console.log('\n========================================');
    console.log('[CREATE_STAFF] [1/5] Incoming Request Payload');
    const sanitizedBody = { ...req.body };
    if (sanitizedBody.password) sanitizedBody.password = '******';
    console.log('Payload:', JSON.stringify(sanitizedBody, null, 2));
    console.log('Authenticated User:', req.user ? {
      id: req.user.id,
      role: req.user.role,
      nameEnglish: req.user.nameEnglish,
      phone: req.user.phone
    } : 'None (Unauthenticated)');
  } else if (options.isUpdateStaff) {
    console.log('\n========================================');
    console.log('[UPDATE_STAFF] [VALIDATION_START] Incoming Update Request for Staff ID:', req.params.id);
    const sanitizedBody = { ...req.body };
    if (sanitizedBody.password) sanitizedBody.password = '******';
    console.log('Update Payload:', JSON.stringify(sanitizedBody, null, 2));
    console.log('Authenticated User:', req.user ? {
      id: req.user.id,
      role: req.user.role,
      nameEnglish: req.user.nameEnglish,
      phone: req.user.phone
    } : 'None (Unauthenticated)');
  }

  normalizeStaffBody(req);
  for (const rule of rules) await rule.run(req);
  const result = validationResult(req);

  if (result.isEmpty()) {
    if (options.isCreateStaff) {
      console.log('[CREATE_STAFF] [2/5] Request Validation Results: PASSED (all fields validated)');
      console.log('Normalized Role/Category:', req.body.staffRole);
      console.log('========================================\n');
    } else if (options.isUpdateStaff) {
      console.log('[UPDATE_STAFF] [VALIDATION_SUCCESS] Request Validation Results: PASSED');
      console.log('========================================\n');
    }
    return next();
  }

  const errors = {};
  for (const error of result.array()) {
    if (!errors[error.path]) errors[error.path] = error.msg;
  }

  if (options.isCreateStaff) {
    console.error('[CREATE_STAFF] [2/5] Request Validation Results: FAILED');
    console.error('Validation Errors:', JSON.stringify(errors, null, 2));
    console.error('========================================\n');
  } else if (options.isUpdateStaff) {
    console.error('[UPDATE_STAFF] [VALIDATION_FAILED] Request Validation Results: FAILED');
    console.error('Validation Errors:', JSON.stringify(errors, null, 2));
    console.error('========================================\n');
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
    query('status').optional().isIn(['active', 'inactive', 'deactive', 'all']),
    query('search').optional().trim().isLength({ max: 100 })
  ]),
  validateCreateStaff: validate([
    body('nameEnglish')
      .trim()
      .notEmpty().withMessage('Name in English is required.')
      .isLength({ min: 2, max: 150 }).withMessage('Name in English must be between 2 and 150 characters.'),
    body('nameTamil')
      .trim()
      .notEmpty().withMessage('Name in Tamil is required.')
      .isLength({ min: 2, max: 150 }).withMessage('Name in Tamil must be between 2 and 150 characters.'),
    body('staffRole')
      .optional({ values: 'falsy' })
      .trim()
      .custom((val) => {
        const lower = String(val).toLowerCase();
        return ['priest', 'assistant', 'staff'].includes(lower) || lower.includes('priest') || lower.includes('assistant');
      })
      .withMessage('Staff role must be either Priest or Assistant.'),
    body('designation')
      .trim()
      .notEmpty().withMessage('Designation is required.')
      .isLength({ min: 1, max: 150 }).withMessage('Designation must be at most 150 characters.'),
    body('phone')
      .trim()
      .notEmpty().withMessage('Mobile number is required.')
      .matches(/^\+?[0-9\s-]{10,15}$/).withMessage('Enter a valid 10-15 digit phone number.'),
    body('password')
      .notEmpty().withMessage('Password is required.')
      .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long.'),
    body('tradition')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 255 }).withMessage('Tradition must be at most 255 characters.'),
    body('expertise')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 255 }).withMessage('Expertise must be at most 255 characters.'),
    body('certification')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 255 }).withMessage('Certification must be at most 255 characters.'),
    body('languagesSpoken')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 255 }).withMessage('Languages spoken must be at most 255 characters.'),
    body('avatarUrl')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 500 }).withMessage('Avatar URL must be at most 500 characters.'),
    body('email')
      .optional({ values: 'falsy' })
      .trim()
      .isEmail().withMessage('Enter a valid email address.')
  ], { isCreateStaff: true }),
  validateUpdateStaff: validate([
    param('id').notEmpty().withMessage('Staff ID is required.'),
    body('nameEnglish')
      .optional()
      .trim()
      .isLength({ min: 2, max: 150 }).withMessage('Name in English must be between 2 and 150 characters.'),
    body('nameTamil')
      .optional()
      .trim()
      .isLength({ min: 2, max: 150 }).withMessage('Name in Tamil must be between 2 and 150 characters.'),
    body('staffRole')
      .optional()
      .trim()
      .custom((val) => {
        const lower = String(val).toLowerCase();
        return ['priest', 'assistant', 'staff'].includes(lower) || lower.includes('priest') || lower.includes('assistant');
      })
      .withMessage('Staff role must be either Priest or Assistant.'),
    body('designation')
      .optional()
      .trim()
      .isLength({ min: 1, max: 150 }).withMessage('Designation must be at most 150 characters.'),
    body('phone')
      .optional()
      .trim()
      .matches(/^\+?[0-9\s-]{10,15}$/).withMessage('Enter a valid 10-15 digit phone number.'),
    body('password')
      .optional()
      .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long.'),
    body('tradition')
      .optional({ values: 'null' })
      .trim()
      .isLength({ max: 255 }).withMessage('Tradition must be at most 255 characters.'),
    body('expertise')
      .optional({ values: 'null' })
      .trim()
      .isLength({ max: 255 }).withMessage('Expertise must be at most 255 characters.'),
    body('certification')
      .optional({ values: 'null' })
      .trim()
      .isLength({ max: 255 }).withMessage('Certification must be at most 255 characters.'),
    body('languagesSpoken')
      .optional({ values: 'null' })
      .trim()
      .isLength({ max: 255 }).withMessage('Languages spoken must be at most 255 characters.'),
    body('avatarUrl')
      .optional({ values: 'null' })
      .trim()
      .isLength({ max: 500 }).withMessage('Avatar URL must be at most 500 characters.'),
    body('status')
      .optional()
      .custom((val) => ['active', 'inactive', 'deactive', 'deleted'].includes(String(val).toLowerCase()))
      .withMessage('Status must be Active, Inactive, Deactive, or Deleted.'),
    body('isDeleted')
      .optional()
      .isBoolean().withMessage('isDeleted must be a boolean (true or false).'),
    body('softDelete')
      .optional()
      .isBoolean().withMessage('softDelete must be a boolean (true or false).'),
    body('email')
      .optional({ values: 'falsy' })
      .trim()
      .isEmail().withMessage('Enter a valid email address.')
  ], { isUpdateStaff: true }),
  validateAttendanceQuery: validate([
    query('date').notEmpty().custom((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))),
    query('status').optional().isIn(['all', 'absent', 'present', 'leave', 'not_marked']),
    query('role').optional().isIn(['all', 'priest', 'assistant']),
    query('search').optional().trim().isLength({ max: 100 })
  ]),
  validateAttendanceRecord: validate([
    body('staffId').notEmpty().withMessage('staffId is required'),
    body('dateKey').custom((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))),
    body('status')
      .isIn(['present', 'absent', 'leave'])
      .custom((status, { req }) => {
        const todayKolkata = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        if (req.body.dateKey && req.body.dateKey > todayKolkata && status.toLowerCase() !== 'leave') {
          throw new Error('Future dates can only be marked as Leave.');
        }
        return true;
      }),
    body('submissionTime').optional({ values: 'falsy' }).isString(),
    body('remarks').optional({ values: 'null' }).isLength({ max: 500 })
  ]),
  validateMonthlyAttendance: validate([
    param('staffId').notEmpty().withMessage('Staff ID is required'),
    query('year').optional().isInt({ min: 2000, max: 2100 }),
    query('month').optional().isInt({ min: 1, max: 12 }),
    query('monthIndex').optional().isInt({ min: 0, max: 11 })
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