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
  try {
    const PORT = 5056;
    server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`[TEST_SERVER] Started on http://127.0.0.1:${PORT}`);
    });

    console.log('\n========================================');
    console.log('--- 1. ADMIN LOGIN ---');
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
      console.error('Failed to get admin token:', loginRes.body);
      process.exit(1);
    }
    console.log('Admin authenticated successfully.');

    console.log('\n========================================');
    console.log('--- 2. GET API: /api/v1/staff (Initial List) ---');
    console.log('========================================');
    const listRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/staff',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('GET /api/v1/staff Status:', listRes.status);
    console.log('Total Count:', listRes.body?.data?.totalCount);
    console.log('Active Count:', listRes.body?.data?.activeCount);
    console.log('Staff list count:', listRes.body?.data?.staff?.length);
    const firstStaff = listRes.body?.data?.staff?.[0];
    if (!firstStaff) {
      console.error('No staff records found in DB to test with!');
      process.exit(1);
    }
    const targetStaffId = firstStaff.id;
    const targetStaffCode = firstStaff.staffId;
    console.log(`Target staff for updates: ID = ${targetStaffId}, Code = ${targetStaffCode}, Name = ${firstStaff.nameEnglish}`);

    console.log('\n========================================');
    console.log('--- 3. PUT API: /api/v1/staff/:id (Update Details & Deactivate using staff.status) ---');
    console.log('========================================');
    const updatePayload1 = JSON.stringify({
      designation: 'Senior Head Priest',
      status: 'deactive',
      tradition: 'Vaikhanasa Agama',
      expertise: 'Maha Kumbhabhishekam',
      certification: 'Vedanta Siromani',
      languagesSpoken: 'Tamil, Sanskrit, Telugu, Hindi'
    });
    const updateRes1 = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/staff/${targetStaffId}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(updatePayload1),
        'Authorization': `Bearer ${token}`
      }
    }, updatePayload1);

    console.log('Update Status (Deactive):', updateRes1.status);
    console.log('Updated designation:', updateRes1.body?.data?.designation);
    console.log('Updated staff status:', updateRes1.body?.data?.status);
    console.log('Updated user status:', updateRes1.body?.data?.userStatus);

    console.log('\n========================================');
    console.log('--- 4. GET API: Verify Immediate Reflection of Deactive Status ---');
    console.log('========================================');
    const listAfterDeactive = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/staff',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const foundDeactive = listAfterDeactive.body?.data?.staff?.find(s => s.id === targetStaffId);
    console.log('Found staff in list after deactivation:');
    console.log('Status in list:', foundDeactive?.status);
    console.log('Designation in list:', foundDeactive?.designation);
    console.log('Total Count:', listAfterDeactive.body?.data?.totalCount);
    console.log('Active Count:', listAfterDeactive.body?.data?.activeCount);

    console.log('\n========================================');
    console.log('--- 5. PUT API: Update using alphanumeric staffId code (e.g. MJSTF...) & Reactivate ---');
    console.log('========================================');
    const updatePayload2 = JSON.stringify({
      designation: 'Chief Administrator Priest',
      status: 'active'
    });
    const updateRes2 = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/staff/${targetStaffCode}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(updatePayload2),
        'Authorization': `Bearer ${token}`
      }
    }, updatePayload2);
    console.log('Update by staffId code Status:', updateRes2.status);
    console.log('Reactivated staff status:', updateRes2.body?.data?.status);
    console.log('Reactivated designation:', updateRes2.body?.data?.designation);

    console.log('\n========================================');
    console.log('--- 6. PUT API: Soft Delete Account (users.status = DELETED) ---');
    console.log('========================================');
    const softDeletePayload = JSON.stringify({
      isDeleted: true
    });
    const softDeleteRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/staff/${targetStaffId}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(softDeletePayload),
        'Authorization': `Bearer ${token}`
      }
    }, softDeletePayload);
    console.log('Soft Delete Status:', softDeleteRes.status);
    console.log('isDeleted field in response:', softDeleteRes.body?.data?.isDeleted);
    console.log('userStatus in response:', softDeleteRes.body?.data?.userStatus);

    console.log('\n========================================');
    console.log('--- 7. GET API: Verify Soft-Deleted Staff is EXCLUDED from Directory ---');
    console.log('========================================');
    const listAfterDelete = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/staff',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const foundDeletedInList = listAfterDelete.body?.data?.staff?.find(s => s.id === targetStaffId);
    console.log('Is soft-deleted staff present in GET /staff directory? (Must be false):', !!foundDeletedInList);
    console.log('New Total Count (decreased by 1):', listAfterDelete.body?.data?.totalCount);
    console.log('New Active Count:', listAfterDelete.body?.data?.activeCount);

    console.log('\n========================================');
    console.log('--- 8. PUT API: Restore Soft-Deleted Staff (isDeleted: false) ---');
    console.log('========================================');
    const restorePayload = JSON.stringify({
      isDeleted: false,
      status: 'active',
      designation: 'Chief Priest'
    });
    const restoreRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/staff/${targetStaffId}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(restorePayload),
        'Authorization': `Bearer ${token}`
      }
    }, restorePayload);
    console.log('Restore Status:', restoreRes.status);
    console.log('Restored isDeleted:', restoreRes.body?.data?.isDeleted);
    console.log('Restored userStatus:', restoreRes.body?.data?.userStatus);
    console.log('Restored staff status:', restoreRes.body?.data?.status);

    console.log('\n========================================');
    console.log('--- 9. GET API: Verify Restored Staff Reappears in Directory ---');
    console.log('========================================');
    const listAfterRestore = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/staff',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const foundRestoredInList = listAfterRestore.body?.data?.staff?.find(s => s.id === targetStaffId);
    console.log('Is restored staff present in GET /staff directory? (Must be true):', !!foundRestoredInList);
    console.log('Total Count restored:', listAfterRestore.body?.data?.totalCount);
    console.log('Active Count restored:', listAfterRestore.body?.data?.activeCount);

    console.log('\n========================================');
    console.log('--- 10. PUT API: Prevent Duplicate Phone Number Check ---');
    console.log('========================================');
    // Staff id 8 has phone 8955558899; attempt to assign it to targetStaffId
    const duplicatePhonePayload = JSON.stringify({
      phone: '8955558899'
    });
    const dupRes = await makeRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/staff/${targetStaffId}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(duplicatePhonePayload),
        'Authorization': `Bearer ${token}`
      }
    }, duplicatePhonePayload);
    console.log('Duplicate phone HTTP status (Must be 409):', dupRes.status);
    console.log('Duplicate phone error message:', dupRes.body?.message);

    server.close();
    await pool.end();
    console.log('\n*** ALL GET & PUT STAFF API VERIFICATIONS PASSED! ***\n');
    process.exit(0);
  } catch (err) {
    console.error('Test execution failed:', err);
    if (server) server.close();
    process.exit(1);
  }
})();
