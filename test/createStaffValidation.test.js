const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCreateStaff } = require('../src/validators/projectValidator');

const runCreateStaffValidation = async (body) => {
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

  await validateCreateStaff(
    { body, params: {}, query: {} },
    res,
    () => {
      nextCalled = true;
    }
  );

  return { nextCalled, res };
};

test('allows staff creation to generate a temporary password and default designation', async () => {
  const result = await runCreateStaffValidation({
    nameEnglish: 'Test Priest',
    nameTamil: 'சோதனை புரோகிதர்',
    phone: '9876543210',
    roleCategory: 'PRIEST'
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, null);
});

test('still rejects a supplied password shorter than six characters', async () => {
  const result = await runCreateStaffValidation({
    nameEnglish: 'Test Priest',
    nameTamil: 'சோதனை புரோகிதர்',
    phone: '9876543210',
    password: '12345'
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.equal(result.res.payload.errors.password, 'Password must be at least 6 characters long.');
});
