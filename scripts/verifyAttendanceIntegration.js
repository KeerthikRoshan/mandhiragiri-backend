const http = require('http');
const app = require('../src/app');
const { pool } = require('../src/config/database');

const makeRequest = (options, postData) => {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
};

(async () => {
  let server;
  let exitCode = 0;
  try {
    const PORT = 5057;
    server = app.listen(PORT, '127.0.0.1');

    console.log('\n========================================');
    console.log('--- TC-01: ADMIN LOGIN ---');
    console.log('========================================');
    const loginPayload = JSON.stringify({
      mobileNumber: '9876543210',
      password: 'Admin@1234'
    });
    const loginRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginPayload)
      }
    }, loginPayload);

    const token = loginRes.body?.data?.token;
    if (!token) {
      throw new Error(`Failed to authenticate admin: ${JSON.stringify(loginRes.body)}`);
    }
    console.log('✅ Admin authenticated successfully.');

    // Fetch a staff record to test with
    const staffListRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/staff',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const testStaff = staffListRes.body?.data?.staff?.[0];
    if (!testStaff) {
      throw new Error('No staff records found in database.');
    }
    const staffId = testStaff.id;
    console.log(`Using test staff: ID ${staffId}, Code: ${testStaff.staffId}, Name: ${testStaff.nameEnglish}`);

    console.log('\n========================================');
    console.log('--- TC-02: DAILY ATTENDANCE OVERVIEW (2026-11-05) ---');
    console.log('========================================');
    const dailyRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/attendance/daily?date=2026-11-05',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Status:', dailyRes.status);
    console.log('Summary:', dailyRes.body?.data?.summary);
    if (dailyRes.status !== 200 || !dailyRes.body?.data?.summary) {
      throw new Error('TC-02 Failed');
    }
    console.log('✅ TC-02 Passed.');

    console.log('\n========================================');
    console.log('--- TC-03: DAILY ATTENDANCE FILTER BY STATUS (present) ---');
    console.log('========================================');
    const statusRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/attendance/daily?date=2026-11-05&status=present',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Status:', statusRes.status, 'Record count:', statusRes.body?.data?.records?.length);
    if (statusRes.status !== 200) throw new Error('TC-03 Failed');
    console.log('✅ TC-03 Passed.');

    console.log('\n========================================');
    console.log('--- TC-04: DAILY ATTENDANCE FILTER BY ROLE (priest) ---');
    console.log('========================================');
    const roleRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/attendance/daily?date=2026-11-05&role=priest',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Status:', roleRes.status, 'Record count:', roleRes.body?.data?.records?.length);
    if (roleRes.status !== 200) throw new Error('TC-04 Failed');
    console.log('✅ TC-04 Passed.');

    console.log('\n========================================');
    console.log('--- TC-05: DAILY ATTENDANCE SEARCH QUERY ---');
    console.log('========================================');
    const searchRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/attendance/daily?date=2026-11-05&search=${encodeURIComponent(testStaff.nameEnglish)}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Status:', searchRes.status, 'Found records:', searchRes.body?.data?.records?.length);
    if (searchRes.status !== 200) throw new Error('TC-05 Failed');
    console.log('✅ TC-05 Passed.');

    console.log('\n========================================');
    console.log('--- TC-06: PAST DATE MARK PRESENT (2026-11-01) ---');
    console.log('========================================');
    const pastPresentPayload = JSON.stringify({
      staffId: staffId,
      dateKey: '2026-11-01',
      status: 'present',
      submissionTime: '08:00 AM',
      remarks: 'Past date present duty'
    });
    const pastPresentRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/attendance/record',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, pastPresentPayload);
    console.log('Status:', pastPresentRes.status, 'Body:', pastPresentRes.body?.data?.status);
    if (pastPresentRes.status !== 200 || pastPresentRes.body?.data?.status !== 'present') throw new Error('TC-06 Failed');
    console.log('✅ TC-06 Passed.');

    console.log('\n========================================');
    console.log('--- TC-07: PAST DATE MARK ABSENT (2026-11-02) ---');
    console.log('========================================');
    const pastAbsentPayload = JSON.stringify({
      staffId: staffId,
      dateKey: '2026-11-02',
      status: 'absent',
      remarks: 'Past date sick'
    });
    const pastAbsentRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/attendance/record',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, pastAbsentPayload);
    console.log('Status:', pastAbsentRes.status, 'Body:', pastAbsentRes.body?.data?.status);
    if (pastAbsentRes.status !== 200 || pastAbsentRes.body?.data?.status !== 'absent') throw new Error('TC-07 Failed');
    console.log('✅ TC-07 Passed.');

    console.log('\n========================================');
    console.log('--- TC-08: PAST DATE MARK LEAVE (2026-11-03) ---');
    console.log('========================================');
    const pastLeavePayload = JSON.stringify({
      staffId: staffId,
      dateKey: '2026-11-03',
      status: 'leave',
      remarks: 'Past date official leave'
    });
    const pastLeaveRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/attendance/record',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, pastLeavePayload);
    console.log('Status:', pastLeaveRes.status, 'Body:', pastLeaveRes.body?.data?.status);
    if (pastLeaveRes.status !== 200 || pastLeaveRes.body?.data?.status !== 'leave') throw new Error('TC-08 Failed');
    console.log('✅ TC-08 Passed.');

    const todayKolkata = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    console.log('\n========================================');
    console.log(`--- TC-09, 10, 11: TODAY ATTENDANCE (Today = ${todayKolkata}) ---`);
    console.log('========================================');
    const todayPayload = JSON.stringify({
      staffId: staffId,
      dateKey: todayKolkata,
      status: 'present',
      submissionTime: '08:30 AM',
      remarks: 'Today on duty'
    });
    const todayRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/attendance/record',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, todayPayload);
    console.log('Status:', todayRes.status, 'Status:', todayRes.body?.data?.status);
    if (todayRes.status !== 200) throw new Error('TC-09/Today Failed');
    console.log('✅ Today attendance passed.');

    console.log('\n========================================');
    console.log('--- TC-12: FUTURE DATE ATTEMPT PRESENT (Must Fail with 400) ---');
    console.log('========================================');
    const futurePresentPayload = JSON.stringify({
      staffId: staffId,
      dateKey: '2026-11-28',
      status: 'present',
      remarks: 'Invalid future present'
    });
    const futurePresentRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/attendance/record',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, futurePresentPayload);
    console.log('Status:', futurePresentRes.status, 'Response:', futurePresentRes.body?.message || futurePresentRes.body?.errors);
    if (futurePresentRes.status !== 400) throw new Error(`TC-12 Failed: Expected 400 but got ${futurePresentRes.status}`);
    console.log('✅ TC-12 Passed: Future present rejected with 400.');

    console.log('\n========================================');
    console.log('--- TC-13: FUTURE DATE ATTEMPT ABSENT (Must Fail with 400) ---');
    console.log('========================================');
    const futureAbsentPayload = JSON.stringify({
      staffId: staffId,
      dateKey: '2026-11-28',
      status: 'absent',
      remarks: 'Invalid future absent'
    });
    const futureAbsentRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/attendance/record',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, futureAbsentPayload);
    console.log('Status:', futureAbsentRes.status, 'Response:', futureAbsentRes.body?.message || futureAbsentRes.body?.errors);
    if (futureAbsentRes.status !== 400) throw new Error(`TC-13 Failed: Expected 400 but got ${futureAbsentRes.status}`);
    console.log('✅ TC-13 Passed: Future absent rejected with 400.');

    console.log('\n========================================');
    console.log('--- TC-14: FUTURE DATE MARK LEAVE (Must Succeed 200) ---');
    console.log('========================================');
    const futureLeavePayload = JSON.stringify({
      staffId: staffId,
      dateKey: '2026-11-28',
      status: 'leave',
      remarks: 'Official Future Leave'
    });
    const futureLeaveRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/attendance/record',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, futureLeavePayload);
    console.log('Status:', futureLeaveRes.status, 'Status:', futureLeaveRes.body?.data?.status);
    if (futureLeaveRes.status !== 200 || futureLeaveRes.body?.data?.status !== 'leave') {
      throw new Error(`TC-14 Failed: ${JSON.stringify(futureLeaveRes.body)}`);
    }
    console.log('✅ TC-14 Passed: Future leave permitted with 200.');

    console.log('\n========================================');
    console.log('--- TC-15: STAFF MONTHLY ATTENDANCE HEATMAP & METRICS ---');
    console.log('========================================');
    const monthlyRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/attendance/${staffId}/monthly?year=2026&month=11`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Status:', monthlyRes.status);
    const mData = monthlyRes.body?.data;
    console.log(`Month Stats: Total Days=${mData.totalDaysInMonth}, Present=${mData.presentCount}, Absent=${mData.absentCount}, Leave=${mData.leaveCount}, NotMarked=${mData.notMarkedCount}`);
    const sum = mData.presentCount + mData.absentCount + mData.leaveCount + mData.notMarkedCount;
    console.log(`Sum of all categories: ${sum} (Must equal ${mData.totalDaysInMonth})`);
    if (sum !== mData.totalDaysInMonth) {
      throw new Error(`TC-15 Failed: Sum of categories (${sum}) != totalDaysInMonth (${mData.totalDaysInMonth})`);
    }
    console.log('✅ TC-15 Passed: 4-segment monthly distribution is perfectly consistent.');

    // Check staff_attendance_audit table
    const [auditRows] = await pool.execute(
      'SELECT * FROM staff_attendance_audit WHERE staff_id = ? ORDER BY id DESC LIMIT 5;',
      [staffId]
    );
    console.log(`Audit log records count: ${auditRows.length}`);
    if (auditRows.length === 0) throw new Error('No audit log entries recorded!');
    console.log('Sample audit record:', {
      staff_id: auditRows[0].staff_id,
      date_key: auditRows[0].date_key,
      previous_status: auditRows[0].previous_status,
      new_status: auditRows[0].new_status,
      action_type: auditRows[0].action_type
    });
    console.log('✅ Audit log verified.');

    console.log('\n========================================');
    console.log('🎉 ALL 15 BACKEND ATTENDANCE TEST SCENARIOS PASSED!');
    console.log('========================================');
  } catch (err) {
    console.error('❌ Test execution error:', err.message);
    exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
    await pool.end();
    process.exit(exitCode);
  }
})();
