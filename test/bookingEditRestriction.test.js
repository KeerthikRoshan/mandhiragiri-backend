const test = require('node:test');
const assert = require('node:assert/strict');
const bookingService = require('../src/services/bookingService');
const bookingModel = require('../src/models/bookingModel');

test('Booking edit restriction unit tests', async (t) => {
  const originalGetBookingById = bookingModel.getBookingById;
  const originalUpdateBooking = bookingModel.updateBooking;

  t.after(() => {
    bookingModel.getBookingById = originalGetBookingById;
    bookingModel.updateBooking = originalUpdateBooking;
  });

  const now = new Date();
  const formatYMD = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  await t.test('rejects editing completed booking', async () => {
    bookingModel.getBookingById = async () => ({
      id: 1,
      date_key: formatYMD(new Date(Date.now() + 5 * 24 * 3600 * 1000)),
      start_time: '10:00:00',
      status: 'completed',
    });

    await assert.rejects(
      () => bookingService.updateBooking(1, { title: 'Updated' }),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /Completed or cancelled/i);
        return true;
      }
    );
  });

  await t.test('rejects editing cancelled booking', async () => {
    bookingModel.getBookingById = async () => ({
      id: 2,
      date_key: formatYMD(new Date(Date.now() + 5 * 24 * 3600 * 1000)),
      start_time: '10:00:00',
      status: 'cancelled',
    });

    await assert.rejects(
      () => bookingService.updateBooking(2, { title: 'Updated' }),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /Completed or cancelled/i);
        return true;
      }
    );
  });

  await t.test('rejects editing booking scheduled for today', async () => {
    bookingModel.getBookingById = async () => ({
      id: 3,
      date_key: formatYMD(now),
      start_time: '23:59:00',
      status: 'confirmed',
    });

    await assert.rejects(
      () => bookingService.updateBooking(3, { title: 'Updated' }),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /24 மணி நேரத்திற்கு முன்பு/i);
        return true;
      }
    );
  });

  await t.test('rejects editing booking scheduled within next 24 hours', async () => {
    // 5 hours from now tomorrow
    const inFiveHours = new Date(Date.now() + 5 * 3600 * 1000);
    bookingModel.getBookingById = async () => ({
      id: 4,
      date_key: formatYMD(inFiveHours),
      start_time: `${String(inFiveHours.getHours()).padStart(2, '0')}:00:00`,
      status: 'confirmed',
    });

    await assert.rejects(
      () => bookingService.updateBooking(4, { title: 'Updated' }),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /24 மணி நேரத்திற்கு முன்பு/i);
        return true;
      }
    );
  });

  await t.test('rejects editing past booking', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    bookingModel.getBookingById = async () => ({
      id: 5,
      date_key: formatYMD(yesterday),
      start_time: '10:00:00',
      status: 'confirmed',
    });

    await assert.rejects(
      () => bookingService.updateBooking(5, { title: 'Updated' }),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /24 மணி நேரத்திற்கு முன்பு/i);
        return true;
      }
    );
  });

  await t.test('allows editing booking scheduled > 24 hours in future', async () => {
    const futureDate = new Date(Date.now() + 48 * 3600 * 1000);
    let updatedPayload = null;

    bookingModel.getBookingById = async (id) => ({
      id,
      date_key: formatYMD(futureDate),
      start_time: '10:00:00',
      status: 'confirmed',
      title: 'Original Title',
      duration_minutes: 60,
      total_event_charge: 5000,
      client_advance_amount: 1000,
      client_total_received: 1000,
      priest_total_pay: 2000,
      priest_advance_paid: 500,
    });

    bookingModel.updateBooking = async (id, data) => {
      updatedPayload = data;
      return true;
    };

    const result = await bookingService.updateBooking(6, {
      title: 'Updated Pooja Title',
    });

    assert.equal(result.id, '6');
    assert.ok(updatedPayload);
    assert.equal(updatedPayload.title, 'Updated Pooja Title');
  });

  await t.test('normalizes and updates all editable fields (devotee, address, priest, fees)', async () => {
    let capturedData = null;
    const futureDate = new Date(Date.now() + 48 * 3600 * 1000);

    bookingModel.getBookingById = async (id) => ({
      id,
      date_key: formatYMD(futureDate),
      start_time: '07:00:00',
      status: 'confirmed',
      title: 'Original Homam',
      client_name: 'Original Client',
      client_phone: '9840111111',
      duration_minutes: 60,
      total_event_charge: 5000,
      client_advance_amount: 1000,
      client_total_received: 1000,
      priest_total_pay: 2000,
      priest_advance_paid: 500,
    });

    bookingModel.updateBooking = async (id, data) => {
      capturedData = data;
      return true;
    };

    const updateInput = {
      title: 'Ganapati Homam Updated',
      clientName: 'Keerthik Devotee',
      phone: '9840122222',
      alternatePhone: '9840133333',
      venueType: 'other',
      address: '124 South Car St',
      area: 'Chengam',
      pincode: '606701',
      notes: 'Special Sankalpam notes',
      totalEventCharge: 6000,
      clientAdvanceAmount: 1500,
      priestTotalPay: 3000,
      priestAdvancePaid: 1000,
    };

    const result = await bookingService.updateBooking(6, updateInput);
    assert.equal(result.id, '6');
    assert.ok(capturedData);
    assert.equal(capturedData.title, 'Ganapati Homam Updated');
    assert.equal(capturedData.clientName, 'Keerthik Devotee');
    assert.equal(capturedData.clientPhone, '9840122222');
    assert.equal(capturedData.alternatePhone, '9840133333');
    assert.equal(capturedData.venueType, 'other');
    assert.equal(capturedData.address, '124 South Car St');
    assert.equal(capturedData.area, 'Chengam');
    assert.equal(capturedData.pincode, '606701');
    assert.equal(capturedData.notes, 'Special Sankalpam notes');
    assert.equal(capturedData.totalEventCharge, 6000);
    assert.equal(capturedData.clientAdvanceAmount, 1500);
    assert.equal(capturedData.priestTotalPay, 3000);
    assert.equal(capturedData.priestAdvancePaid, 1000);
  });
});
