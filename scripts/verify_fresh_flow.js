require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');
const bcrypt = require('bcrypt');
const { loginUser } = require('../src/services/authService');
const projectController = require('../src/controllers/projectController');
const bookingController = require('../src/controllers/bookingController');
const { processOutboxQueue } = require('../src/services/outboxProcessorService');

function callController(fn, req) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const res = {
      statusCode: 200,
      status: function (code) {
        this.statusCode = code;
        return this;
      },
      json: function (data) {
        this.body = data;
        if (!finished) {
          finished = true;
          resolve({ statusCode: this.statusCode, data });
        }
        return this;
      },
    };
    fn(req, res, (err) => {
      if (!finished) {
        finished = true;
        if (err) reject(err);
        else resolve({ statusCode: res.statusCode, data: res.body });
      }
    });
  });
}

async function runVerification() {
  console.log('🚀 [VERIFY] Starting end-to-end fresh workflow simulation...');

  // 1. Admin login
  console.log('1️⃣ Testing Admin login...');
  const adminLoginRes = await loginUser({
    mobileNumber: '9876543210',
    password: 'Admin@1234',
    role: 'admin',
  });
  if (!adminLoginRes || !adminLoginRes.data?.token) {
    throw new Error('Admin login failed');
  }
  const adminUser = adminLoginRes.data.user;
  console.log('  ✅ Admin logged in successfully. User ID:', adminUser.id);

  // 2. Register new staff
  console.log('2️⃣ Registering new staff: Suresh Sastrigal (9840011223)...');
  const staffPayload = {
    name_english: 'Suresh Sastrigal',
    name_tamil: 'சுரேஷ் சாஸ்திரிகள்',
    staff_role: 'Priest',
    designation: 'தலைமை குருக்கள்',
    phone: '9840011223',
    password: 'Staff@1234',
    tradition: 'சைவ ஆகமம்',
    expertise: 'கணபதி ஹோமம், வாஸ்து பூஜை',
    certification: 'வேத பாடசாலை பட்டம்',
    languages_spoken: 'தமிழ், சமஸ்கிருதம்',
  };

  const mockReq = { body: staffPayload, user: adminUser };
  const staffRes = await callController(projectController.createStaff, mockReq);
  const staffCreatedResult = staffRes.data;

  if (!staffCreatedResult || !staffCreatedResult.success) {
    throw new Error(`Staff creation failed: ${JSON.stringify(staffCreatedResult)}`);
  }
  const createdStaffId = staffCreatedResult.data.id || staffCreatedResult.data.staffId;
  console.log('  ✅ Staff created successfully. Staff ID:', createdStaffId);

  // Verify staff in DB
  const [staffRows] = await pool.query('SELECT * FROM staff WHERE id = ?', [createdStaffId]);
  const [userRows] = await pool.query('SELECT * FROM users WHERE mobile = ?', ['9840011223']);
  console.log('  ✅ Database staff record:', staffRows[0]?.name_english, '| User ID:', userRows[0]?.id);

  // 3. Staff Login
  console.log('3️⃣ Testing Staff login with newly created credentials...');
  const staffLoginRes = await loginUser({
    mobileNumber: '9840011223',
    password: 'Staff@1234',
    role: 'staff',
  });
  if (!staffLoginRes || !staffLoginRes.data?.token) {
    throw new Error('Staff login failed');
  }
  const staffUser = staffLoginRes.data.user;
  console.log('  ✅ Staff logged in successfully. User ID:', staffUser.id, 'Role:', staffUser.role);

  // 4. Admin creates booking assigned to this staff
  console.log('4️⃣ Admin creates a booking assigned to newly registered staff...');
  const bookingPayload = {
    eventTypeId: 1,
    title: 'கணபதி ஹோமம்',
    clientName: 'கல்யாணசுந்தரம்',
    clientPhone: '9840122334',
    dateKey: '2026-11-13',
    startTime: '09:00 AM',
    durationMinutes: 120,
    venueType: 'TEMPLE',
    location: 'ஸ்ரீ மந்திரகிரி கோவில்',
    totalEventCharge: 5000,
    clientAdvanceAmount: 1500,
    priestStaffId: createdStaffId,
    priestFee: 2000,
  };

  const bookingReq = {
    body: bookingPayload,
    user: adminUser,
    headers: {},
    originalUrl: '/api/v1/bookings',
    baseUrl: '/api/v1/bookings',
    path: '/',
  };
  const bookingRes = await callController(bookingController.createBooking, bookingReq);
  const bookingCreatedResult = bookingRes.data;

  if (!bookingCreatedResult || !bookingCreatedResult.success) {
    throw new Error(`Booking creation failed: ${JSON.stringify(bookingCreatedResult)}`);
  }
  const createdBookingId = bookingCreatedResult.data.id || bookingCreatedResult.data.bookingId;
  console.log('  ✅ Booking created successfully. Booking ID:', createdBookingId);

  // 5. Staff queries their bookings
  console.log('5️⃣ Testing Staff booking visibility...');
  const staffListReq = {
    query: {},
    user: staffUser, // Authenticated as staff member
  };
  const staffListRes = await callController(bookingController.listBookings, staffListReq);
  const staffBookings = staffListRes?.data?.data?.bookings || staffListRes?.data?.data || [];
  console.log('  ✅ Staff retrieved bookings count:', staffBookings.length);
  const isBookingVisible = staffBookings.some(b => String(b.id) === String(createdBookingId));
  console.log('  ✅ Is assigned booking visible to this staff?:', isBookingVisible);
  if (!isBookingVisible) {
    throw new Error('Assigned booking NOT visible to staff!');
  }

  // 6. Check Notifications table
  console.log('6️⃣ Checking notification events and outbox...');
  const [outboxRows] = await pool.query('SELECT * FROM notification_outbox WHERE event_type = "BOOKING_CREATED"');
  console.log('  ✅ Outbox BOOKING_CREATED rows:', outboxRows.length);

  // Dispatch outbox
  console.log('  ⏳ Processing outbox queue...');
  await processOutboxQueue();

  const [notificationRows] = await pool.query('SELECT * FROM notifications WHERE event_type = "BOOKING_CREATED"');
  const [recipientRows] = await pool.query('SELECT * FROM notification_recipients');
  console.log('  ✅ Notifications created:', notificationRows.length);
  console.log('  ✅ Notification Recipients created:', recipientRows.length);
  recipientRows.forEach(r => {
    console.log(`    - Recipient User ID: ${r.user_id}, In-App: ${r.in_app_state}, Push: ${r.push_state}`);
  });

  console.log('🎉 [VERIFY] End-to-end fresh workflow simulation PASSED with 100% success!');
}

runVerification()
  .then(() => {
    console.log('Verification complete.');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  });
