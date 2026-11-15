const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateBooking, validateUpdateBooking } = require('../src/validators/bookingValidator');

const runValidator = async (validatorMiddleware, body) => {
  const req = { body, method: 'POST', originalUrl: '/api/v1/bookings' };
  let nextCalled = false;
  let status = null;
  let responseData = null;

  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };

  const next = () => {
    nextCalled = true;
  };

  await validatorMiddleware(req, res, next);
  return { nextCalled, status, responseData, reqBody: req.body };
};

describe('Backend bookingValidator Unit Tests', () => {
  test('valid booking passes validation', async () => {
    const validBody = {
      dateKey: '2026-12-01',
      startTime: '06:30 AM',
      durationMinutes: 120,
      title: 'கணபதி ஹோமம் (Ganapathi Homam)',
      clientName: 'சுப்பிரமணியன் (Subramanian)',
      phone: '9840123456',
      priestId: '1',
      totalEventCharge: 5000,
      clientAdvanceAmount: 1000,
    };

    const res = await runValidator(validateBooking, validBody);
    assert.equal(res.nextCalled, true, 'Valid booking must call next()');
  });

  test('rejects whitespace-only title', async () => {
    const body = {
      dateKey: '2026-12-01',
      startTime: '06:30 AM',
      durationMinutes: 120,
      title: '     ',
      clientName: 'Devotee Name',
      phone: '9840123456',
      priestId: '1',
    };

    const res = await runValidator(validateBooking, body);
    assert.equal(res.nextCalled, false);
    assert.equal(res.status, 400);
    assert.ok(res.responseData.errors.title, 'Should have error on title');
  });

  test('rejects whitespace-only clientName', async () => {
    const body = {
      dateKey: '2026-12-01',
      startTime: '06:30 AM',
      durationMinutes: 120,
      title: 'Ganapathi Homam',
      clientName: '   \t  ',
      phone: '9840123456',
      priestId: '1',
    };

    const res = await runValidator(validateBooking, body);
    assert.equal(res.nextCalled, false);
    assert.equal(res.status, 400);
    assert.ok(res.responseData.errors.clientName, 'Should have error on clientName');
  });

  test('rejects invalid start time format', async () => {
    const body = {
      dateKey: '2026-12-01',
      startTime: '25:99',
      durationMinutes: 60,
      title: 'Ganapathi Homam',
      clientName: 'Devotee',
      phone: '9840123456',
      priestId: '1',
    };

    const res = await runValidator(validateBooking, body);
    assert.equal(res.nextCalled, false);
    assert.equal(res.status, 400);
    assert.ok(res.responseData.errors.startTime, 'Should have error on startTime');
  });

  test('rejects durationMinutes out of bounds (< 15 or > 1440)', async () => {
    const bodyTooLow = {
      dateKey: '2026-12-01',
      startTime: '06:30 AM',
      durationMinutes: 10,
      title: 'Ganapathi Homam',
      clientName: 'Devotee',
      phone: '9840123456',
      priestId: '1',
    };

    const res = await runValidator(validateBooking, bodyTooLow);
    assert.equal(res.nextCalled, false);
    assert.equal(res.status, 400);
    assert.ok(res.responseData.errors.durationMinutes, 'Should have error on durationMinutes');
  });

  test('rejects advance amount greater than total amount', async () => {
    const body = {
      dateKey: '2026-12-01',
      startTime: '06:30 AM',
      durationMinutes: 60,
      title: 'Ganapathi Homam',
      clientName: 'Devotee',
      phone: '9840123456',
      priestId: '1',
      totalEventCharge: 2000,
      clientAdvanceAmount: 5000,
    };

    const res = await runValidator(validateBooking, body);
    assert.equal(res.nextCalled, false);
    assert.equal(res.status, 400);
    assert.ok(res.responseData.errors.clientAdvanceAmount, 'Should have error on clientAdvanceAmount');
  });
});
