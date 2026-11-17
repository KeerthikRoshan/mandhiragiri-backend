const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || '@12345mandhiragiri@KAK!';
process.env.JWT_REFRESH_EXPIRY_DAYS = process.env.JWT_REFRESH_EXPIRY_DAYS || '7';

const authModel = require('../src/models/authModel');
const authService = require('../src/services/authService');
const { pool } = require('../src/config/database');

test('Staff Login & Collation Test Suite', async (t) => {
  const originalPoolExecute = pool.execute;
  const originalFindUser = authModel.findUserByMobileAndRole;
  const originalGetStaffProfile = authModel.getStaffProfile;
  const originalCreateSession = authModel.createSession;

  t.afterEach(() => {
    pool.execute = originalPoolExecute;
    authModel.findUserByMobileAndRole = originalFindUser;
    authModel.getStaffProfile = originalGetStaffProfile;
    authModel.createSession = originalCreateSession;
  });

  await t.test('1. getStaffProfile with phone constructs query with COLLATE and eliminates illegal <> operation', async () => {
    let capturedQuery = null;
    let capturedParams = null;

    pool.execute = async (query, params) => {
      capturedQuery = query;
      capturedParams = params;
      return [[{
        id: 10,
        user_id: 5,
        staff_id: 'STF001',
        name_english: 'Priest Kumar',
        name_tamil: 'குமார் குருக்கள்',
        staff_role: 'Priest',
        designation: 'Chief Priest',
        phone: '9876543210',
        status: 'Active'
      }]];
    };

    const result = await authModel.getStaffProfile(5, '9876543210');

    assert.ok(result);
    assert.equal(result.staff_id, 'STF001');
    assert.equal(capturedParams.length, 2);
    assert.equal(capturedParams[0], 5);
    assert.equal(capturedParams[1], '%9876543210');

    // Assert that the illegal mix-prone condition (? != '' or ? <> '') is completely gone
    assert.ok(!capturedQuery.includes("? != ''"), "Query should not contain '? != \"\"'");
    assert.ok(!capturedQuery.includes("? <> ''"), "Query should not contain '? <> \"\"'");
    assert.ok(capturedQuery.includes("COLLATE utf8mb4_unicode_ci"), "Query should explicitly specify COLLATE utf8mb4_unicode_ci");
  });

  await t.test('2. getStaffProfile without phone uses clean single-parameter integer lookup', async () => {
    let capturedQuery = null;
    let capturedParams = null;

    pool.execute = async (query, params) => {
      capturedQuery = query;
      capturedParams = params;
      return [[{
        id: 10,
        user_id: 5,
        staff_id: 'STF001',
        name_english: 'Priest Kumar',
        status: 'Active'
      }]];
    };

    const result = await authModel.getStaffProfile(5);

    assert.ok(result);
    assert.equal(result.user_id, 5);
    assert.equal(capturedParams.length, 1);
    assert.equal(capturedParams[0], 5);
    assert.ok(capturedQuery.includes("WHERE user_id = ?"), "Query should use user_id lookup only");
    assert.ok(!capturedQuery.includes("phone LIKE"), "Query without phone should not touch phone column");
  });

  await t.test('3. loginUser succeeds for active staff with valid credentials', async () => {
    const passwordHash = await bcrypt.hash('Staff@123', 10);

    authModel.findUserByMobileAndRole = async (mobile, role) => ({
      id: 5,
      role: 'PRIEST',
      mobile_number: '9876543210',
      country_code: '+91',
      password_hash: passwordHash,
      name_english: 'Priest Kumar',
      name_tamil: 'குமார் குருக்கள்',
      status: 'active'
    });

    authModel.createSession = async () => 1;

    authModel.getStaffProfile = async (userId, mobile) => ({
      id: 10,
      user_id: 5,
      staff_id: 'STF001',
      name_english: 'Priest Kumar',
      name_tamil: 'குமார் குருக்கள்',
      staff_role: 'Priest',
      designation: 'Astrologer & Priest',
      phone: '+919876543210',
      tradition: 'Saiva Siddhanta',
      certification: 'Veda Agama Patashala',
      expertise: 'Horoscope, Homam',
      languages_spoken: 'Tamil, English',
      avatar_url: '/uploads/staff/sample.jpg',
      status: 'Active'
    });

    const result = await authService.loginUser({
      mobileNumber: '9876543210',
      password: 'Staff@123',
      role: 'staff',
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0'
    });

    assert.ok(result);
    assert.ok(result.data.token);
    assert.ok(result.data.refreshToken);
    assert.equal(result.data.user.role, 'staff');
    assert.equal(result.data.user.staffRole, 'Priest');
    assert.equal(result.data.user.staffId, 'STF001');
    assert.equal(result.data.user.nameEnglish, 'Priest Kumar');
  });

  await t.test('4. loginUser rejects invalid password with 401', async () => {
    const passwordHash = await bcrypt.hash('CorrectPassword', 10);

    authModel.findUserByMobileAndRole = async () => ({
      id: 5,
      role: 'PRIEST',
      mobile_number: '9876543210',
      password_hash: passwordHash,
      status: 'active'
    });

    await assert.rejects(
      async () => {
        await authService.loginUser({
          mobileNumber: '9876543210',
          password: 'WrongPassword',
          role: 'staff'
        });
      },
      (err) => {
        assert.equal(err.statusCode, 401);
        assert.ok(err.message.includes('கடவுச்சொல் தவறானது'));
        return true;
      }
    );
  });

  await t.test('5. loginUser rejects non-existent mobile with 401', async () => {
    authModel.findUserByMobileAndRole = async () => null;

    await assert.rejects(
      async () => {
        await authService.loginUser({
          mobileNumber: '9999999999',
          password: 'AnyPassword',
          role: 'staff'
        });
      },
      (err) => {
        assert.equal(err.statusCode, 401);
        return true;
      }
    );
  });

  await t.test('6. loginUser rejects inactive staff account with 403', async () => {
    const passwordHash = await bcrypt.hash('Staff@123', 10);

    authModel.findUserByMobileAndRole = async () => ({
      id: 5,
      role: 'PRIEST',
      mobile_number: '9876543210',
      password_hash: passwordHash,
      status: 'inactive'
    });

    await assert.rejects(
      async () => {
        await authService.loginUser({
          mobileNumber: '9876543210',
          password: 'Staff@123',
          role: 'staff'
        });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.ok(err.message.includes('முடக்கப்பட்டுள்ளது'));
        return true;
      }
    );
  });

  await t.test('7. loginUser handles missing staff table record gracefully by falling back to user details', async () => {
    const passwordHash = await bcrypt.hash('Staff@123', 10);

    authModel.findUserByMobileAndRole = async () => ({
      id: 5,
      role: 'STAFF',
      mobile_number: '9876543210',
      country_code: '+91',
      password_hash: passwordHash,
      name_english: 'Fallback Staff',
      name_tamil: 'பணியாளர்',
      title: 'Assistant',
      email: 'staff@mandhiragiri.com',
      avatar_url: null,
      status: 'active'
    });

    authModel.createSession = async () => 1;
    // Simulate staff record missing from staff table
    authModel.getStaffProfile = async () => null;

    const result = await authService.loginUser({
      mobileNumber: '9876543210',
      password: 'Staff@123',
      role: 'staff'
    });

    assert.ok(result);
    assert.ok(result.data.token);
    assert.equal(result.data.user.role, 'staff');
    assert.equal(result.data.user.id, 5);
    assert.equal(result.data.user.nameEnglish, 'Fallback Staff');
  });
});
