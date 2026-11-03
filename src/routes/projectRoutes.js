const express = require('express');
const controller = require('../controllers/projectController');
const validation = require('../validators/projectValidator');
const { authenticate, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();
const adminOnly = [authenticate, authorizeRoles('SUPER_ADMIN', 'ADMIN')];
const staffOnly = [authenticate, authorizeRoles('PRIEST', 'ASSISTANT')];

router.get('/dashboard/overview', ...adminOnly, controller.dashboardOverview);
router.get('/panchangam/today', validation.validatePanchangamQuery, controller.panchangamToday);
router.put('/admin/panchangam', ...adminOnly, validation.validatePanchangam, controller.savePanchangam);
router.get('/schedule/bookings', ...adminOnly, validation.validateSchedule, controller.scheduleBookings);
router.get('/staff', ...adminOnly, validation.validateStaffList, controller.listStaff);
router.post('/staff', ...adminOnly, validation.validateCreateStaff, controller.createStaff);
router.get('/attendance/daily', ...adminOnly, validation.validateAttendanceQuery, controller.dailyAttendance);
router.put('/attendance/record', ...adminOnly, validation.validateAttendanceRecord, controller.updateAttendance);
router.post('/attendance/self', ...staffOnly, validation.validateAttendanceSelf, controller.submitAttendance);
router.get('/leaves/admin/all', ...adminOnly, validation.validateLeaveList, controller.allLeaveRequests);
router.post('/leaves/admin/:leaveId/decision', ...adminOnly, validation.validateLeaveDecision, controller.decideLeave);
router.post('/staff/me/leaves', ...staffOnly, validation.validateLeaveApplication, controller.applyLeave);
router.get('/staff/me/dashboard', ...staffOnly, controller.staffDashboard);
router.post('/events/:eventId/complete', ...staffOnly, validation.validateEventCompletion, controller.completeEvent);
router.get('/admin/profile', ...adminOnly, controller.adminProfile);
router.put('/admin/profile', ...adminOnly, validation.validateAdminProfile, controller.updateAdminProfile);
router.get('/reports/balances', ...adminOnly, validation.validateBalanceReport, controller.balanceReport);

module.exports = router;