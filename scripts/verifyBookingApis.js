require('dotenv').config();
const http = require('http');
const app = require('../src/app');

const TEST_PORT = 5059;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const fullPath = '/api/v1' + (path.startsWith('/') ? path : '/' + path);
    const options = {
      method,
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: fullPath,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, data: json });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  const server = app.listen(TEST_PORT, '127.0.0.1');

  try {
    console.log('========================================');
    console.log('--- TC-01: ADMIN LOGIN ---');
    console.log('========================================');
    const loginRes = await request('POST', '/auth/login', {
      mobileNumber: '9876543210',
      password: 'Admin@1234'
    });
    if (loginRes.status !== 200 || !loginRes.data?.data?.token) {
      throw new Error('Admin login failed: ' + JSON.stringify(loginRes.data));
    }
    const token = loginRes.data.data.token;
    console.log('✅ Admin login successful.');

    console.log('\n========================================');
    console.log('--- TC-02: LIST POOJA / EVENT TYPES ---');
    console.log('========================================');
    const etRes = await request('GET', '/event-types', null, token);
    console.log('Event types count:', etRes.data?.data?.count);
    if (etRes.status !== 200 || !etRes.data?.data?.eventTypes?.length) {
      throw new Error('Failed to list event types: ' + JSON.stringify(etRes.data));
    }
    console.log('✅ Sample event type:', etRes.data.data.eventTypes[0]);

    console.log('\n========================================');
    console.log('--- TC-03: CREATE BOOKING (Kalyanasundaram Ganapathi Homam) ---');
    console.log('========================================');
    const testDate = '2026-11-20';
    const createRes = await request('POST', '/bookings', {
      dateKey: testDate,
      title: 'கணபதி ஹோமம் & சங்கல்ப பூஜை',
      eventTypeId: 2,
      clientName: 'கல்யாணசுந்தரம்',
      phone: '+91 98401 22334',
      alternatePhone: '+91 98401 99887',
      venueType: 'home',
      location: 'Madurai North',
      address: '12, West Masi Street',
      area: 'Simmakkal',
      pincode: '625001',
      category: 'temple',
      categoryLabelTamil: 'கோவில்',
      startTime: '09:00 AM',
      durationMinutes: 120, // 2 Hours -> End time: 11:00 AM
      priestId: '2',
      priestIds: ['2'],
      samagriBy: 'customer',
      notes: 'Bring sacred brass vessels and samithu bundle.',
      totalEventCharge: 6000,
      clientAdvanceAmount: 2000,
      clientTotalReceived: 2000,
      priestTotalPay: 3000,
      priestAdvancePaid: 1000
    }, token);

    console.log('Create booking status:', createRes.status);
    if (createRes.status !== 201) {
      throw new Error('Create booking failed: ' + JSON.stringify(createRes.data));
    }
    const booking = createRes.data.data;
    console.log('✅ Booking created:', {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      startTime: booking.startTime,
      endTime: booking.endTime,
      durationMinutes: booking.durationMinutes,
      timeSlot: booking.timeSlot,
      financials: booking.financials
    });

    if (booking.startTime !== '09:00 AM' || booking.endTime !== '11:00 AM') {
      throw new Error(`Timing mismatch! Expected 09:00 AM - 11:00 AM, got ${booking.startTime} - ${booking.endTime}`);
    }
    if (booking.financials.clientBalanceAmount !== 4000 || booking.financials.priestBalanceAmount !== 2000) {
      throw new Error('Balance calculation mismatch: ' + JSON.stringify(booking.financials));
    }

    console.log('\n========================================');
    console.log('--- TC-04: CONFLICT CHECKING ---');
    console.log('========================================');

    // Test 4A: Overlapping slot for same priest (10:00 AM - 12:00 PM) -> MUST CONFLICT
    const confRes1 = await request('POST', '/bookings/check-availability', {
      booking_date: testDate,
      start_time: '10:00 AM',
      duration_minutes: 120,
      priest_ids: ['2']
    }, token);
    console.log('Overlap slot check:', { available: confRes1.data?.data?.available, conflicts: confRes1.data?.data?.conflicts?.length });
    if (confRes1.data?.data?.available !== false || confRes1.data?.data?.conflicts?.length === 0) {
      throw new Error('Expected conflict for overlapping slot but got available!');
    }
    console.log('✅ 4A Overlapping slot rejected properly with conflict details.');

    // Test 4B: Back-to-back slot for same priest (11:00 AM - 01:00 PM) -> MUST BE AVAILABLE
    const confRes2 = await request('POST', '/bookings/check-availability', {
      booking_date: testDate,
      start_time: '11:00 AM',
      duration_minutes: 120,
      priest_ids: ['2']
    }, token);
    console.log('Back-to-back slot check:', { available: confRes2.data?.data?.available, end_time: confRes2.data?.data?.calculated_end_time });
    if (confRes2.data?.data?.available !== true) {
      throw new Error('Expected back-to-back slot to be available, but got conflicts: ' + JSON.stringify(confRes2.data));
    }
    console.log('✅ 4B Back-to-back slot allowed properly.');

    // Test 4C: Different priest (Priest 3) at same time (09:00 AM - 11:00 AM) -> MUST BE AVAILABLE
    const confRes3 = await request('POST', '/bookings/check-availability', {
      booking_date: testDate,
      start_time: '09:00 AM',
      duration_minutes: 120,
      priest_ids: ['3']
    }, token);
    console.log('Different priest slot check:', { available: confRes3.data?.data?.available });
    if (confRes3.data?.data?.available !== true) {
      throw new Error('Expected different priest slot to be available, but got conflicts: ' + JSON.stringify(confRes3.data));
    }
    console.log('✅ 4C Different priest allowed at same time.');

    // Test 4D: Attempting to create booking with conflict -> MUST BE REJECTED WITH 409
    const conflictCreateRes = await request('POST', '/bookings', {
      dateKey: testDate,
      title: 'Conflicting Event',
      clientName: 'Ramanathan',
      phone: '+91 98401 55667',
      startTime: '09:30 AM',
      durationMinutes: 60,
      priestId: '2',
      totalEventCharge: 3000
    }, token);
    console.log('Conflict create HTTP status:', conflictCreateRes.status);
    if (conflictCreateRes.status !== 409) {
      throw new Error('Expected 409 Conflict, got: ' + conflictCreateRes.status);
    }
    console.log('✅ 4D Creation with conflict rejected with 409 Conflict.');

    console.log('\n========================================');
    console.log('--- TC-05: DATE-WISE AND PRIEST-WISE LISTING ---');
    console.log('========================================');
    const dateListRes = await request('GET', `/bookings?date=${testDate}`, null, token);
    console.log(`Bookings on ${testDate}:`, dateListRes.data?.data?.count);
    if (dateListRes.status !== 200 || dateListRes.data?.data?.count < 1) {
      throw new Error('Failed to retrieve date bookings');
    }

    const priestListRes = await request('GET', `/bookings/priest/2?date=${testDate}`, null, token);
    console.log('Priest 2 bookings count:', priestListRes.data?.data?.count);
    if (priestListRes.status !== 200 || priestListRes.data?.data?.count < 1) {
      throw new Error('Failed to retrieve priest bookings');
    }
    console.log('✅ Date-wise and Priest-wise listing verified.');

    console.log('\n========================================');
    console.log('--- TC-06: MANUAL CASH PAYMENT TRACKING ---');
    console.log('========================================');
    // 6A: Customer additional cash payment of ₹2000 (Remaining was ₹4000, will become ₹2000)
    const payClientRes = await request('POST', `/bookings/${booking.id}/payments`, {
      party: 'CLIENT',
      amount: 2000,
      paymentMethod: 'cash',
      notes: 'இரண்டாம் தவணை பணம் (Second cash installment received at temple office)'
    }, token);
    console.log('Client payment status:', payClientRes.status, payClientRes.data?.data?.financials);
    if (payClientRes.status !== 201 || payClientRes.data?.data?.financials?.clientBalanceAmount !== 2000) {
      throw new Error('Client payment recording failed: ' + JSON.stringify(payClientRes.data));
    }
    console.log('✅ 6A Client payment recorded and balance updated.');

    // 6B: Priest remuneration additional payment of ₹2000 (Remaining was ₹2000, will become ₹0 -> 'paid')
    const payPriestRes = await request('POST', `/bookings/${booking.id}/payments`, {
      party: 'PRIEST',
      amount: 2000,
      paymentMethod: 'cash',
      notes: 'பூஜை முடிவில் முழு ஊதியம் வழங்கப்பட்டது (Final remuneration settled in cash)'
    }, token);
    console.log('Priest remuneration status:', payPriestRes.status, payPriestRes.data?.data?.financials);
    if (payPriestRes.status !== 201 || payPriestRes.data?.data?.financials?.priestBalanceAmount !== 0 || payPriestRes.data?.data?.financials?.priestPaymentStatus !== 'paid') {
      throw new Error('Priest payment recording failed: ' + JSON.stringify(payPriestRes.data));
    }
    console.log('✅ 6B Priest remuneration recorded and settled to Paid.');

    // 6C: Attempt overpayment (Remaining client balance is ₹2000, attempt ₹5000) -> MUST FAIL WITH 422
    const overpayRes = await request('POST', `/bookings/${booking.id}/payments`, {
      party: 'CLIENT',
      amount: 5000
    }, token);
    console.log('Overpayment status:', overpayRes.status);
    if (overpayRes.status !== 422) {
      throw new Error('Expected 422 for overpayment, got: ' + overpayRes.status);
    }
    console.log('✅ 6C Overpayment rejected with 422 Unprocessable Entity.');

    // 6D: Retrieve transaction history
    const historyRes = await request('GET', `/bookings/${booking.id}/payments`, null, token);
    console.log('Transaction count:', historyRes.data?.data?.payments?.length);
    if (historyRes.data?.data?.payments?.length < 3) {
      throw new Error('Expected at least 3 transactions (2 advances + 2 payments), got: ' + historyRes.data?.data?.payments?.length);
    }
    console.log('✅ 6D Transaction history verified with full details.');

    console.log('\n========================================');
    console.log('--- TC-07: SOFT DELETE / CANCEL BOOKING ---');
    console.log('========================================');
    const delRes = await request('DELETE', `/bookings/${booking.id}`, null, token);
    console.log('Delete status:', delRes.status);
    if (delRes.status !== 200) {
      throw new Error('Delete booking failed: ' + JSON.stringify(delRes.data));
    }

    // Once cancelled, the slot should no longer conflict!
    const confAfterDel = await request('POST', '/bookings/check-availability', {
      booking_date: testDate,
      start_time: '09:00 AM',
      duration_minutes: 120,
      priest_ids: ['2']
    }, token);
    console.log('Availability after cancellation:', confAfterDel.data?.data?.available);
    if (confAfterDel.data?.data?.available !== true) {
      throw new Error('Cancelled booking still blocked slot!');
    }
    console.log('✅ 7 Cancelled booking does not block availability.');

    console.log('\n========================================');
    console.log('🎉 ALL BACKEND BOOKING & FINANCIAL TEST CASES PASSED!');
    console.log('========================================');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
