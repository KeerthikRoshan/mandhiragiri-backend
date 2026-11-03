const crypto = require('crypto');
const bookingModel = require('../models/bookingModel');
const ApiError = require('../utils/ApiError');

const asAmount = (value) => Number(Number(value).toFixed(2));
const subtractAmounts = (total, paid) => Number((asAmount(total) - asAmount(paid)).toFixed(2));

const parseTimeSlot = (value) => {
  const match = String(value).match(/^(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))$/i);
  if (!match) return null;
  const toMinutes = (time) => {
    const parts = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    let hours = Number(parts[1]) % 12;
    if (parts[3].toUpperCase() === 'PM') hours += 12;
    return hours * 60 + Number(parts[2]);
  };
  return [toMinutes(match[1]), toMinutes(match[2])];
};

const createBooking = async (input, createdBy) => {
  const existingBookings = await bookingModel.findPriestBookingsOnDate(input.dateKey, input.priestId);
  const requestedSlot = parseTimeSlot(input.timeSlot);
  const hasCollision = existingBookings.some((booking) => {
    const existingSlot = parseTimeSlot(booking.time_slot);
    return requestedSlot && existingSlot
      ? requestedSlot[0] < existingSlot[1] && requestedSlot[1] > existingSlot[0]
      : input.timeSlot === booking.time_slot;
  });
  if (hasCollision) {
    throw new ApiError(409, 'தேர்ந்தெடுக்கப்பட்ட நேரத்தில் ஏற்கனவே மற்றொரு நிகழ்வு முன்பதிவு செய்யப்பட்டுள்ளது.', true, {
      collision: 'The assigned priest already has a booking during this time slot.'
    });
  }
  const bookingNumber = `MJ-${input.dateKey.slice(0, 4)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const booking = { ...input, bookingNumber, createdBy };
  const id = await bookingModel.createBooking(booking);

  return {
    id: String(id),
    bookingNumber,
    dateKey: input.dateKey,
    titleTamil: input.title,
    clientName: input.clientName,
    clientPhone: input.phone,
    locationTamil: input.location,
    category: input.category,
    status: 'confirmed',
    statusLabelTamil: 'உறுதி செய்யப்பட்டது',
    timeSlot: input.timeSlot,
    priestId: input.priestId,
    priestNameTamil: input.priestName,
    financials: {
      totalEventCharge: asAmount(input.totalEventCharge),
      clientAdvanceAmount: asAmount(input.clientAdvanceAmount),
      clientTotalReceived: asAmount(input.clientTotalReceived),
      clientBalanceAmount: subtractAmounts(input.totalEventCharge, input.clientTotalReceived),
      priestTotalPay: asAmount(input.priestTotalPay),
      priestAdvancePaid: asAmount(input.priestAdvancePaid),
      priestBalanceAmount: subtractAmounts(input.priestTotalPay, input.priestAdvancePaid)
    },
    createdAt: new Date().toISOString(),
    createdBy: String(createdBy)
  };
};

const getBookingBalance = async (id) => {
  const booking = await bookingModel.findBookingFinancialsById(id);
  if (!booking) {
    throw ApiError.notFound('Booking not found.');
  }

  const totalEventCharge = asAmount(booking.total_event_charge);
  const clientTotalReceived = asAmount(booking.client_total_received);
  const priestTotalPay = asAmount(booking.priest_total_pay);
  const priestAdvancePaid = asAmount(booking.priest_advance_paid);

  return {
    bookingId: String(booking.id),
    bookingNumber: booking.booking_number,
    clientName: booking.client_name,
    financials: {
      totalEventCharge,
      clientTotalReceived,
      clientBalanceAmount: subtractAmounts(totalEventCharge, clientTotalReceived),
      priestTotalPay,
      priestAdvancePaid,
      priestBalanceAmount: subtractAmounts(priestTotalPay, priestAdvancePaid)
    }
  };
};

module.exports = {
  createBooking,
  getBookingBalance
};