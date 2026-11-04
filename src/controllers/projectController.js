const projectService = require('../services/projectService');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const dashboardOverview = asyncHandler(async (req, res) => {
  const data = await projectService.getDashboardOverview(req.user.id);
  return sendSuccess(res, 'Dashboard metrics retrieved successfully.', data);
});

const panchangamToday = asyncHandler(async (req, res) => {
  const date = req.query.date || projectService.dateKeyToday();
  const data = await projectService.getPanchangam({ date, location: req.query.location || 'Madurai' });
  return sendSuccess(res, "Today's Panchangam retrieved.", data);
});

const savePanchangam = asyncHandler(async (req, res) => {
  const data = await projectService.savePanchangam(req.body, req.user.id);
  return sendSuccess(res, 'Panchangam updated successfully.', data);
});

const scheduleBookings = asyncHandler(async (req, res) => {
  const data = await projectService.getSchedule(req.query);
  return sendSuccess(res, 'Schedule bookings retrieved successfully.', data);
});

const listStaff = asyncHandler(async (req, res) => {
  const data = await projectService.listStaff(req.query);
  return sendSuccess(res, 'Staff directory retrieved.', data);
});

const createStaff = asyncHandler(async (req, res) => {
  const data = await projectService.createStaff(req.body);
  return sendSuccess(res, 'புரோகிதர் வெற்றிகரமாக சேர்க்கப்பட்டார்.', data, 201);
});

const updateStaff = asyncHandler(async (req, res) => {
  const data = await projectService.updateStaff(req.params.id, req.body);
  return sendSuccess(res, 'பணியாளர் விவரங்கள் வெற்றிகரமாக புதுப்பிக்கப்பட்டன.', data);
});

const dailyAttendance = asyncHandler(async (req, res) => {
  const data = await projectService.getDailyAttendance(req.query);
  return sendSuccess(res, 'Daily attendance retrieved.', data);
});

const updateAttendance = asyncHandler(async (req, res) => {
  const data = await projectService.updateAttendance(req.body, req.user.id);
  return sendSuccess(res, 'வருகைப் பதிவு வெற்றிகரமாக திருத்தப்பட்டது.', data);
});

const submitAttendance = asyncHandler(async (req, res) => {
  const data = await projectService.submitAttendance(req.body, req.user.id);
  return sendSuccess(res, 'இன்றைய வருகை வெற்றிகரமாக பதிவானது (Attendance recorded).', data);
});

const allLeaveRequests = asyncHandler(async (req, res) => {
  const data = await projectService.getLeaveRequests(req.query.status || 'all');
  return sendSuccess(res, 'Staff leave applications retrieved.', data);
});

const decideLeave = asyncHandler(async (req, res) => {
  const data = await projectService.decideLeave({ ...req.body, leaveId: req.params.leaveId }, req.user);
  return sendSuccess(res, 'விடுப்பு விண்ணப்ப முடிவு பதிவு செய்யப்பட்டது.', data);
});

const applyLeave = asyncHandler(async (req, res) => {
  const data = await projectService.applyLeave(req.body, req.user.id);
  return sendSuccess(res, 'விடுப்பு விண்ணப்பம் நிர்வாகியின் ஒப்புதலுக்கு அனுப்பப்பட்டது.', data, 201);
});

const staffDashboard = asyncHandler(async (req, res) => {
  const data = await projectService.getStaffDashboard(req.user.id);
  return sendSuccess(res, 'Staff dashboard data retrieved.', data);
});

const completeEvent = asyncHandler(async (req, res) => {
  const data = await projectService.completeEvent({ ...req.body, eventId: req.params.eventId }, req.user.id);
  return sendSuccess(res, 'நிகழ்வு வெற்றிகரமாக முடிவுற்றதாக பதிவு செய்யப்பட்டது.', data);
});

const adminProfile = asyncHandler(async (req, res) => {
  const data = await projectService.getAdminProfile(req.user.id);
  return sendSuccess(res, 'Profile retrieved.', data);
});

const updateAdminProfile = asyncHandler(async (req, res) => {
  const data = await projectService.updateAdminProfile(req.body, req.user.id);
  return sendSuccess(res, 'சுயவிவரம் வெற்றிகரமாக மாற்றப்பட்டது (Profile updated successfully).', data);
});

const uploadAdminAvatar = asyncHandler(async (req, res) => {
  const data = await projectService.uploadAdminAvatar(req.user.id, req.file);
  return sendSuccess(res, 'Admin profile image uploaded successfully.', data);
});

const uploadStaffAvatar = asyncHandler(async (req, res) => {
  const data = await projectService.uploadStaffAvatar(req.params.staffId, req.file);
  return sendSuccess(res, 'Staff profile image uploaded successfully.', data);
});

const recordBookingPayment = asyncHandler(async (req, res) => {
  const data = await projectService.recordBookingPayment({ ...req.body, bookingId: req.params.bookingId }, req.user.id);
  return sendSuccess(res, 'Payment recorded successfully.', data, 201);
});

const bookingPayments = asyncHandler(async (req, res) => {
  const data = await projectService.getBookingPayments(req.params.bookingId);
  return sendSuccess(res, 'Booking payment history retrieved.', { payments: data });
});

const balanceReport = asyncHandler(async (req, res) => {
  const data = await projectService.getBalanceReport(req.query);
  return sendSuccess(res, 'Balance report retrieved successfully.', data);
});

module.exports = {
  dashboardOverview,
  panchangamToday,
  savePanchangam,
  scheduleBookings,
  listStaff,
  createStaff,
  updateStaff,
  dailyAttendance,
  updateAttendance,
  submitAttendance,
  allLeaveRequests,
  decideLeave,
  applyLeave,
  staffDashboard,
  completeEvent,
  adminProfile,
  updateAdminProfile,
  uploadAdminAvatar,
  uploadStaffAvatar,
  recordBookingPayment,
  bookingPayments,
  balanceReport
};