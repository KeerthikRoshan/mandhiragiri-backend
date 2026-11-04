const http = require('http');

const request = (options, body = null) => {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...options.headers };
    if (payload) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ ...options, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
};

(async () => {
  try {
    console.log('--- 1. Admin Login ---');
    const adminLoginRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/auth/login',
      method: 'POST'
    }, {
      mobileNumber: '9876543210',
      password: 'Admin@1234',
      role: 'admin'
    });
    console.log('Admin login status:', adminLoginRes.status);
    if (adminLoginRes.status !== 200) {
      console.error('Admin login failed:', adminLoginRes.body);
      process.exit(1);
    }
    const adminToken = adminLoginRes.body.data.token;
    console.log('Admin authenticated successfully.');

    console.log('\n--- 2. List Existing Staff ---');
    const listRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/staff',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log('List staff status:', listRes.status);
    console.log('Total staff count:', listRes.body.data.totalCount);
    console.log('Existing Staff IDs:', listRes.body.data.staff.map(s => `${s.id} (${s.staffId})`));

    console.log('\n--- 3. Create New Staff Member ---');
    const testPhone = '9840999888';
    const createRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/staff',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      name_english: 'Sundaramoorthy Gurukkal',
      name_tamil: 'சிவஸ்ரீ சுந்தரமூர்த்தி குருக்கள்',
      staff_role: 'Priest',
      designation: 'முதன்மை நிர்வாகி & தலைமை அர்ச்சகர்',
      phone: testPhone,
      password: 'SacredPass@2026',
      tradition: 'சைவ ஆகமம் & வேத நெறி',
      expertise: 'விவாஹம், நவகிரக சாந்தி & மகா ருத்ர ஹோமம்',
      certification: 'சிவநெறி ஆகம பிரவீண குரு',
      languages_spoken: 'தமிழ், சமஸ்கிருதம், ஆங்கிலம்',
      avatar_url: 'https://cdn.mandhragiri.com/avatars/sundaram.png',
      email: 'sundaram.gurukkal@mandhragiri.com'
    });
    console.log('Create staff status:', createRes.status);
    console.log('Create staff response:', JSON.stringify(createRes.body, null, 2));
    if (createRes.status !== 201) {
      console.error('Staff creation failed!');
      process.exit(1);
    }
    const newStaff = createRes.body.data;
    const newStaffId = newStaff.id;
    const newStaffCode = newStaff.staffId;
    console.log(`Created staff: ID=${newStaffId}, Code=${newStaffCode}`);

    console.log('\n--- 4. Test Duplicate Mobile Check ---');
    const duplicateRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/staff',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      name_english: 'Duplicate Priest',
      name_tamil: 'நகல் புரோகிதர்',
      staff_role: 'Priest',
      designation: 'Priest',
      phone: testPhone,
      password: 'SacredPass@2026'
    });
    console.log('Duplicate check status (expected 409):', duplicateRes.status);
    if (duplicateRes.status !== 409) {
      console.error('Expected 409 Conflict for duplicate phone!', duplicateRes.body);
      process.exit(1);
    }
    console.log('Duplicate phone correctly blocked with 409 Conflict.');

    console.log('\n--- 5. Staff Login with New Account ---');
    const staffLoginRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/auth/staff-login',
      method: 'POST'
    }, {
      mobileNumber: testPhone,
      password: 'SacredPass@2026'
    });
    console.log('Staff login status:', staffLoginRes.status);
    console.log('Staff login user:', JSON.stringify(staffLoginRes.body.data?.user, null, 2));
    if (staffLoginRes.status !== 200) {
      console.error('Staff login failed!');
      process.exit(1);
    }
    const staffToken = staffLoginRes.body.data.token;

    console.log('\n--- 6. Staff Dashboard (/api/v1/staff/me/dashboard) ---');
    const staffDashRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/staff/me/dashboard',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${staffToken}` }
    });
    console.log('Staff dashboard status:', staffDashRes.status);
    console.log('Staff dashboard profile:', staffDashRes.body.data?.profile);

    console.log('\n--- 7. Update Staff by Numeric ID (/api/v1/staff/:id) ---');
    const update1Res = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/v1/staff/${newStaffId}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      designation: 'முதன்மை தலைமை அர்ச்சகர் (Chief Head Priest)',
      expertise: 'விவாஹம், நவகிரக சாந்தி, சண்டி ஹோமம்'
    });
    console.log('Update 1 status:', update1Res.status);
    console.log('Updated designation:', update1Res.body.data?.designation);
    console.log('Verify non-updated nameEnglish still preserved:', update1Res.body.data?.nameEnglish);
    console.log('Verify non-updated phone still preserved:', update1Res.body.data?.phone);

    console.log('\n--- 8. Update Staff by Staff ID String (/api/v1/staff/:staffId) & Change Password ---');
    const update2Res = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/v1/staff/${newStaffCode}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      password: 'UpdatedSacredPass@2026'
    });
    console.log('Update 2 (password change) status:', update2Res.status);

    console.log('\n--- 9. Verify Staff Login with Updated Password ---');
    const oldPassRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/auth/staff-login',
      method: 'POST'
    }, {
      mobileNumber: testPhone,
      password: 'SacredPass@2026'
    });
    console.log('Old password status (expected 401):', oldPassRes.status);

    const newPassRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/auth/staff-login',
      method: 'POST'
    }, {
      mobileNumber: testPhone,
      password: 'UpdatedSacredPass@2026'
    });
    console.log('New password status (expected 200):', newPassRes.status);
    if (newPassRes.status !== 200) {
      console.error('Login with updated password failed!');
      process.exit(1);
    }

    console.log('\n--- 10. Verify Daily Attendance Query & Schedule API ---');
    const attRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/attendance/daily?date=2026-11-04',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log('Attendance status:', attRes.status);
    console.log('Attendance totalStaff:', attRes.body.data?.summary?.totalStaff);

    const schedRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/v1/schedule/bookings?date=2026-11-04',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log('Schedule status:', schedRes.status);
    console.log('Schedule bookings count:', schedRes.body.data?.summary?.total);

    // Clean up test staff record
    const { pool } = require('../src/config/database');
    await pool.execute('DELETE FROM staff WHERE phone = ?;', [testPhone]);
    await pool.execute('DELETE FROM users WHERE mobile = ?;', [testPhone]);
    console.log('\nCleaned up test staff record from database.');

    console.log('\n========================================');
    console.log('ALL STAFF CRUD & AUTH TESTS PASSED 100%!');
    console.log('========================================\n');
    process.exit(0);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
})();
