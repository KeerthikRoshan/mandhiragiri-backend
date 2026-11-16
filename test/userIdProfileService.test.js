const test = require('node:test');
const assert = require('node:assert/strict');
const projectModel = require('../src/models/projectModel');
const projectService = require('../src/services/projectService');
const { validateUserId } = require('../src/validators/projectValidator');

const runUserIdValidation = async (userId) => {
  let nextCalled = false;
  const res = {
    statusCode: null,
    payload: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };

  await validateUserId(
    { params: { user_id: userId }, body: {}, query: {} },
    res,
    () => {
      nextCalled = true;
    }
  );

  return { nextCalled, res };
};

test('validates user IDs as positive integers', async () => {
  const valid = await runUserIdValidation('42');
  const invalid = await runUserIdValidation('0');

  assert.equal(valid.nextCalled, true);
  assert.equal(invalid.nextCalled, false);
  assert.equal(invalid.res.statusCode, 400);
});

test('returns admin profile details with the requested user ID', async () => {
  const originalGetAdminProfile = projectModel.getAdminProfile;
  projectModel.getAdminProfile = async (userId) => ({
    id: userId,
    user_id: userId,
    name_english: 'Admin Name',
    name_tamil: 'நிர்வாகி',
    years_experience: '10',
    horoscope_count: '20',
    avatar_url: '/uploads/admin/test-admin-uuid.png'
  });

  try {
    const profile = await projectService.getAdminProfile('42');
    assert.equal(profile.userId, '42');
    assert.equal(profile.nameEnglish, 'Admin Name');
    assert.equal(profile.avatarUrl, '/uploads/admin/test-admin-uuid.png');
    assert.equal(profile.metrics.yearsExperience, '10');
    assert.equal(profile.metrics.horoscopeCount, '20');
  } finally {
    projectModel.getAdminProfile = originalGetAdminProfile;
  }
});

test('returns staff details and email for the requested user ID', async () => {
  const originalGetStaffProfileByUserId = projectModel.getStaffProfileByUserId;
  projectModel.getStaffProfileByUserId = async (userId) => ({
    id: 8,
    user_id: userId,
    staff_id: 'MJSTF00008',
    name_english: 'Staff Name',
    staff_role: 'Priest',
    designation: 'Priest',
    phone: '9876543210',
    avatar_url: '/uploads/staff/test-staff-uuid.png',
    status: 'Active',
    user_status: 'ACTIVE',
    user_email: 'staff@example.com'
  });

  try {
    const profile = await projectService.getStaffProfileByUserId('42');
    assert.equal(profile.userId, '42');
    assert.equal(profile.nameEnglish, 'Staff Name');
    assert.equal(profile.email, 'staff@example.com');
    assert.equal(profile.avatarUrl, '/uploads/staff/test-staff-uuid.png');
  } finally {
    projectModel.getStaffProfileByUserId = originalGetStaffProfileByUserId;
  }
});

test('updateAdminProfile returns complete admin profile including avatarUrl', async () => {
  const originalUpdateAdminProfile = projectModel.updateAdminProfile;
  const originalGetAdminProfile = projectModel.getAdminProfile;
  projectModel.updateAdminProfile = async ({ userId, phone, email }) => ({
    id: userId,
    mobile: phone,
    email
  });
  projectModel.getAdminProfile = async (userId) => ({
    id: userId,
    user_id: userId,
    name_english: 'Admin Name',
    name_tamil: 'நிர்வாகி',
    mobile: '9876543210',
    email: 'admin@example.com',
    avatar_url: '/uploads/admin/updated-avatar.png'
  });

  try {
    const result = await projectService.updateAdminProfile({ phone: '9876543210', email: 'admin@example.com' }, '42');
    assert.equal(result.userId, '42');
    assert.equal(result.avatarUrl, '/uploads/admin/updated-avatar.png');
    assert.equal(result.email, 'admin@example.com');
  } finally {
    projectModel.updateAdminProfile = originalUpdateAdminProfile;
    projectModel.getAdminProfile = originalGetAdminProfile;
  }
});

test('returns not found when a user has no staff profile', async () => {
  const originalGetStaffProfileByUserId = projectModel.getStaffProfileByUserId;
  projectModel.getStaffProfileByUserId = async () => null;

  try {
    await assert.rejects(
      projectService.getStaffProfileByUserId('42'),
      (error) => error.statusCode === 404
    );
  } finally {
    projectModel.getStaffProfileByUserId = originalGetStaffProfileByUserId;
  }
});
