const crypto = require('crypto');
const bookingModel = require('../models/bookingModel');
const projectModel = require('../models/projectModel');
const ApiError = require('../utils/ApiError');
const { calculateBookingTimings, parseTimeToMinutes, minutesTo12 } = require('../utils/timeUtils');

const asAmount = (value) => Number(Number(value || 0).toFixed(2));
const subtractAmounts = (total, paid) => Number((asAmount(total) - asAmount(paid)).toFixed(2));

/**
 * Format a raw database booking row into a consistent API response.
 */
const formatBooking = (b) => {
  const totalCharge = asAmount(b.total_event_charge);
  const clientReceived = asAmount(b.client_total_received);
  const clientAdvance = asAmount(b.client_advance_amount);
  const clientBalance = subtractAmounts(totalCharge, clientReceived);

  const priestTotal = asAmount(b.priest_total_pay);
  const priestPaid = asAmount(b.priest_advance_paid);
  const priestBalance = subtractAmounts(priestTotal, priestPaid);

  const startTime12 = b.start_time ? minutesTo12(parseTimeToMinutes(b.start_time)) : null;
  const endTime12 = b.end_time ? minutesTo12(parseTimeToMinutes(b.end_time)) : null;

  return {
    id: String(b.id),
    bookingNumber: b.booking_number,
    dateKey: b.date_key,
    title: b.title,
    titleTamil: b.title,
    eventTypeId: b.event_type_id ? String(b.event_type_id) : null,
    eventTypeNameEnglish: b.event_type_name_english || null,
    eventTypeNameTamil: b.event_type_name_tamil || null,
    clientName: b.client_name,
    clientPhone: b.client_phone,
    alternatePhone: b.alternate_phone || null,
    location: b.location,
    locationTamil: b.location,
    venueType: b.venue_type || 'home',
    address: b.address || null,
    area: b.area || null,
    pincode: b.pincode || null,
    category: b.category,
    categoryLabelTamil: b.category_label_tamil,
    startTime: startTime12,
    endTime: endTime12,
    durationMinutes: b.duration_minutes || 60,
    timeSlot: b.time_slot,
    priestId: String(b.priest_id),
    priestName: b.priest_name,
    priestNameTamil: b.priest_name,
    priestPhone: b.priest_phone || null,
    samagriBy: b.samagri_by || 'customer',
    notes: b.notes || null,
    status: b.status,
    statusLabelTamil:
      b.status === 'completed'
        ? 'முடிவுற்றது'
        : b.status === 'pending'
        ? 'நிலுவையில்'
        : b.status === 'cancelled'
        ? 'ரத்து செய்யப்பட்டது'
        : 'உறுதி செய்யப்பட்டது',
    financials: {
      totalEventCharge: totalCharge,
      clientAdvanceAmount: clientAdvance,
      clientTotalReceived: clientReceived,
      clientBalanceAmount: clientBalance,
      clientPaymentStatus: b.client_payment_status || (clientReceived >= totalCharge ? 'paid' : (clientReceived > 0 ? 'partial' : 'pending')),
      priestTotalPay: priestTotal,
      priestAdvancePaid: priestPaid,
      priestBalanceAmount: priestBalance,
      priestPaymentStatus: b.priest_payment_status || (priestPaid >= priestTotal ? 'paid' : (priestPaid > 0 ? 'partial' : 'pending'))
    },
    transactions: b.transactions || [],
    assignedPriests: b.assignedPriests || [],
    createdAt: b.created_at ? new Date(b.created_at).toISOString() : new Date().toISOString(),
    createdBy: b.created_by ? String(b.created_by) : null
  };
};

/**
 * Check booking availability for given date, time, duration, and priest(s).
 */
const checkAvailability = async (input) => {
  const dateKey = input.booking_date || input.dateKey;
  if (!dateKey) {
    throw ApiError.badRequest('dateKey or booking_date is required.');
  }

  const rawStartTime = input.start_time || input.startTime;
  if (!rawStartTime) {
    throw ApiError.badRequest('start_time or startTime is required.');
  }

  const durationMinutes = input.duration_minutes || input.durationMinutes || 60;
  const timings = calculateBookingTimings(rawStartTime, durationMinutes);

  const rawPriests = input.priest_ids || input.priestIds || input.priest_id || input.priestId;
  const priestIds = Array.isArray(rawPriests)
    ? rawPriests.map(String).filter(Boolean)
    : [String(rawPriests)].filter(Boolean);

  if (priestIds.length === 0) {
    throw ApiError.badRequest('At least one priestId or priest_ids must be provided.');
  }

  const excludeBookingId = input.exclude_booking_id || input.excludeBookingId || null;

  const conflicts = await bookingModel.findConflicts({
    dateKey,
    startTime24: timings.startTime24,
    endTime24: timings.endTime24,
    priestIds,
    excludeBookingId
  });

  return {
    available: conflicts.length === 0,
    calculated_end_time: timings.endTime12,
    calculated_end_time_24: timings.endTime24,
    time_slot: timings.timeSlot,
    duration_minutes: timings.durationMinutes,
    conflicts
  };
};

/**
 * Create a new dynamic booking.
 */
const createBooking = async (input, createdBy) => {
  const dateKey = input.dateKey || input.date || input.booking_date;
  if (!dateKey) {
    throw ApiError.badRequest('dateKey is required.');
  }

  // Timing resolution: start time & duration
  let startTimeStr = input.startTime || input.start_time;
  let durationMins = input.durationMinutes !== undefined ? input.durationMinutes : input.duration_minutes;

  if (!startTimeStr && input.timeSlot) {
    const parts = input.timeSlot.split('-');
    startTimeStr = parts[0]?.trim();
    if (parts[1]) {
      const endMins = parseTimeToMinutes(parts[1].trim());
      const startMins = parseTimeToMinutes(startTimeStr);
      if (endMins !== null && startMins !== null && endMins > startMins) {
        durationMins = endMins - startMins;
      }
    }
  }

  if (!startTimeStr) {
    throw ApiError.badRequest('startTime or timeSlot is required.');
  }

  durationMins = Number(durationMins) || 60;
  const timings = calculateBookingTimings(startTimeStr, durationMins);

  // Priest resolution
  const rawPriests = input.priestId || input.priest_id || input.priestIds || input.priest_ids;
  let priestId = Array.isArray(rawPriests) ? String(rawPriests[0]) : (rawPriests ? String(rawPriests) : null);
  let priestName = input.priestName || input.priest_name;
  let priestPhone = input.priestPhone || input.priest_phone;
  let priestIds = Array.isArray(rawPriests) ? rawPriests.map(String) : (priestId ? [priestId] : []);

  if (!priestName && priestId) {
    const staff = await projectModel.getStaffById(priestId);
    if (staff) {
      priestName = staff.name_tamil || staff.name_english;
      priestPhone = staff.phone;
    }
  }

  // Financial calculations
  const totalCharge = asAmount(input.totalEventCharge !== undefined ? input.totalEventCharge : input.total_event_charge);
  const clientAdvance = asAmount(input.clientAdvanceAmount !== undefined ? input.clientAdvanceAmount : input.client_advance_amount);
  const clientRecv = asAmount(input.clientTotalReceived !== undefined ? input.clientTotalReceived : (input.client_total_received !== undefined ? input.client_total_received : clientAdvance));
  const priestTotal = asAmount(input.priestTotalPay !== undefined ? input.priestTotalPay : input.priest_total_pay);
  const priestAdvance = asAmount(input.priestAdvancePaid !== undefined ? input.priestAdvancePaid : input.priest_advance_paid);

  const bookingNumber = `MJ-${dateKey.slice(0, 4)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  const bookingData = {
    ...input,
    dateKey,
    title: input.title || 'பூஜை நிகழ்வு',
    clientName: input.clientName || input.client_name,
    clientPhone: input.phone || input.clientPhone || input.client_phone || input.mobileNumber,
    alternatePhone: input.alternatePhone || input.alternate_phone || null,
    location: input.location || 'ஸ்ரீ மந்திரகிரி ஜோதிட பீடம்',
    venueType: input.venueType || input.venue_type || 'home',
    category: input.category || 'outdoor',
    categoryLabelTamil: input.categoryLabelTamil || input.category_label_tamil || 'நிகழ்வு',
    samagriBy: input.samagriBy || input.samagri_by || 'customer',
    bookingNumber,
    startTime24: timings.startTime24,
    endTime24: timings.endTime24,
    durationMinutes: timings.durationMinutes,
    timeSlot: timings.timeSlot,
    priestId,
    priestName: priestName || 'தலைமை புரோகிதர்',
    priestPhone,
    priestIds,
    totalEventCharge: totalCharge,
    clientAdvanceAmount: clientAdvance,
    clientTotalReceived: clientRecv,
    priestTotalPay: priestTotal,
    priestAdvancePaid: priestAdvance,
    createdBy
  };

  const id = await bookingModel.createBooking(bookingData);
  const created = await bookingModel.getBookingById(id);
  return formatBooking(created);
};

/**
 * List bookings with filtering.
 */
const listBookings = async (filters) => {
  const rows = await bookingModel.listBookings(filters);
  return rows.map(formatBooking);
};

/**
 * Get booking details by ID.
 */
const getBookingDetails = async (id) => {
  const booking = await bookingModel.getBookingById(id);
  if (!booking) {
    throw ApiError.notFound('Booking not found.');
  }
  return formatBooking(booking);
};

/**
 * Get balance information for a booking.
 */
const getBookingBalance = async (id) => {
  const booking = await bookingModel.getBookingById(id);
  if (!booking) {
    throw ApiError.notFound('Booking not found.');
  }

  const formatted = formatBooking(booking);
  return {
    bookingId: formatted.id,
    bookingNumber: formatted.bookingNumber,
    clientName: formatted.clientName,
    financials: formatted.financials
  };
};

/**
 * Update existing booking with strict 24-hour edit restriction.
 */
const updateBooking = async (id, input, updatedBy) => {
  const existing = await bookingModel.getBookingById(id);
  if (!existing) {
    throw ApiError.notFound('Booking not found.');
  }

  // 1. Prohibit editing completed or cancelled bookings
  if (existing.status === 'completed' || existing.status === 'cancelled') {
    throw ApiError.forbidden('முடிவுற்ற அல்லது ரத்து செய்யப்பட்ட பதிவுகளை திருத்த முடியாது (Completed or cancelled bookings cannot be edited).');
  }

  // 2. Strict 24-Hour Edit Restriction:
  // Must be MORE THAN 24 HOURS in the future.
  // Prohibit:
  // - Bookings scheduled within the next 24 hours.
  // - All bookings scheduled for today.
  // - Currently running / LIVE bookings.
  // - Past bookings.
  const dateKey = existing.date_key; // Format: 'YYYY-MM-DD'
  const startTime = existing.start_time || '00:00:00'; // Format: 'HH:MM:SS' or 'HH:MM'

  if (dateKey) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    const totalMins = parseTimeToMinutes(startTime) || 0;
    const eventStart = new Date(year, month - 1, day, Math.floor(totalMins / 60), totalMins % 60, 0);

    const now = new Date();
    const diffHours = (eventStart.getTime() - now.getTime()) / (1000 * 60 * 60);

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const bookingDay = new Date(year, month - 1, day, 0, 0, 0);

    if (bookingDay.getTime() <= todayStart.getTime() || diffHours <= 24) {
      throw ApiError.forbidden('நிகழ்விற்கு 24 மணி நேரத்திற்கு முன்பு மட்டுமே திருத்த முடியும் (Editing is available only 24 hours before the event).');
    }
  }

  let updateData = { ...input };

  // Normalize date
  if (input.dateKey || input.date || input.booking_date) {
    updateData.dateKey = input.dateKey || input.date || input.booking_date;
  }

  // Normalize timing
  const startTimeInput = input.startTime || input.start_time;
  const durationInput = input.durationMinutes !== undefined ? input.durationMinutes : input.duration_minutes;

  if (startTimeInput) {
    const duration = durationInput !== undefined ? durationInput : (existing.duration_minutes || 60);
    const timings = calculateBookingTimings(startTimeInput, duration);
    updateData.startTime24 = timings.startTime24;
    updateData.endTime24 = timings.endTime24;
    updateData.durationMinutes = timings.durationMinutes;
    updateData.timeSlot = timings.timeSlot;
  } else if (durationInput !== undefined && existing.start_time) {
    const existingStart12 = minutesTo12(parseTimeToMinutes(existing.start_time));
    const timings = calculateBookingTimings(existingStart12, durationInput);
    updateData.startTime24 = timings.startTime24;
    updateData.endTime24 = timings.endTime24;
    updateData.durationMinutes = timings.durationMinutes;
    updateData.timeSlot = timings.timeSlot;
  }

  // Normalize text fields
  if (input.title) {
    updateData.title = String(input.title).trim();
  }
  if (input.clientName || input.client_name) {
    updateData.clientName = String(input.clientName || input.client_name).trim();
  }
  const phoneVal = input.phone || input.clientPhone || input.client_phone || input.mobileNumber;
  if (phoneVal) {
    updateData.phone = String(phoneVal).trim();
    updateData.clientPhone = updateData.phone;
  }
  if (input.alternatePhone !== undefined || input.alternate_phone !== undefined) {
    const alt = input.alternatePhone !== undefined ? input.alternatePhone : input.alternate_phone;
    updateData.alternatePhone = alt ? String(alt).trim() : null;
  }
  if (input.location) {
    updateData.location = String(input.location).trim();
  }
  if (input.address !== undefined) {
    updateData.address = input.address ? String(input.address).trim() : null;
  }
  if (input.area !== undefined) {
    updateData.area = input.area ? String(input.area).trim() : null;
  }
  if (input.pincode !== undefined) {
    updateData.pincode = input.pincode ? String(input.pincode).trim() : null;
  }
  if (input.category) {
    updateData.category = input.category;
  }
  if (input.categoryLabelTamil || input.category_label_tamil) {
    updateData.categoryLabelTamil = input.categoryLabelTamil || input.category_label_tamil;
  }
  if (input.venueType || input.venue_type) {
    updateData.venueType = input.venueType || input.venue_type;
  }
  if (input.samagriBy || input.samagri_by) {
    updateData.samagriBy = input.samagriBy || input.samagri_by;
  }
  if (input.notes !== undefined) {
    updateData.notes = input.notes ? String(input.notes).trim() : null;
  }
  if (input.eventTypeId !== undefined || input.event_type_id !== undefined) {
    updateData.eventTypeId = input.eventTypeId || input.event_type_id || null;
  }

  // Normalize priest info
  const rawPriests = input.priestId || input.priest_id || input.priestIds || input.priest_ids;
  if (rawPriests) {
    const pId = Array.isArray(rawPriests) ? String(rawPriests[0]) : String(rawPriests);
    const staff = await projectModel.getStaffById(pId);
    if (staff) {
      updateData.priestId = String(staff.staff_id || staff.id);
      updateData.priestName = staff.name_tamil || staff.name_english;
      updateData.priestPhone = staff.phone || null;
      updateData.priestIds = [String(staff.id)];
    } else {
      updateData.priestId = pId;
      updateData.priestName = input.priestName || input.priest_name || existing.priest_name;
      updateData.priestPhone = input.priestPhone || input.priest_phone || existing.priest_phone;
      updateData.priestIds = [pId];
    }
  }

  // Financials
  if (input.totalEventCharge !== undefined || input.total_event_charge !== undefined) {
    updateData.totalEventCharge = Number(input.totalEventCharge !== undefined ? input.totalEventCharge : input.total_event_charge) || 0;
  }
  if (input.clientAdvanceAmount !== undefined || input.client_advance_amount !== undefined) {
    updateData.clientAdvanceAmount = Number(input.clientAdvanceAmount !== undefined ? input.clientAdvanceAmount : input.client_advance_amount) || 0;
  }
  if (input.clientTotalReceived !== undefined || input.client_total_received !== undefined) {
    updateData.clientTotalReceived = Number(input.clientTotalReceived !== undefined ? input.clientTotalReceived : input.client_total_received) || 0;
  }
  if (input.priestTotalPay !== undefined || input.priest_total_pay !== undefined) {
    updateData.priestTotalPay = Number(input.priestTotalPay !== undefined ? input.priestTotalPay : input.priest_total_pay) || 0;
  }
  if (input.priestAdvancePaid !== undefined || input.priest_advance_paid !== undefined) {
    updateData.priestAdvancePaid = Number(input.priestAdvancePaid !== undefined ? input.priestAdvancePaid : input.priest_advance_paid) || 0;
  }

  await bookingModel.updateBooking(id, updateData);
  const updated = await bookingModel.getBookingById(id);
  return formatBooking(updated);
};

/**
 * Soft delete or cancel a booking.
 */
const deleteBooking = async (id) => {
  const success = await bookingModel.deleteBooking(id);
  if (!success) {
    throw ApiError.notFound('Booking not found.');
  }
  return { success: true, message: 'முன்பதிவு நீக்கப்பட்டது (Booking cancelled/deleted successfully).' };
};

/**
 * Record a manual cash payment transaction.
 */
const recordPayment = async (bookingId, input, userId) => {
  const result = await bookingModel.recordPayment({
    bookingId,
    party: input.party,
    amount: input.amount,
    paymentMethod: input.paymentMethod || 'cash',
    notes: input.notes,
    staffId: input.staffId || null,
    createdBy: userId
  });

  if (result.notFound) throw ApiError.notFound('Booking not found.');
  if (result.exceedsBalance) {
    throw ApiError.unprocessable('Payment exceeds the outstanding balance.', {
      amount: `Remaining ${result.party} balance is ₹${result.balance}.`
    });
  }

  const updatedBooking = await bookingModel.getBookingById(bookingId);

  return {
    transactionId: String(result.transactionId),
    bookingId: String(bookingId),
    party: result.party.toLowerCase(),
    amount: result.amount,
    paymentMethod: input.paymentMethod || 'cash',
    updatedTotalReceived: result.updatedTotalReceived,
    updatedPaymentStatus: result.updatedPaymentStatus,
    financials: formatBooking(updatedBooking).financials,
    recordedAt: new Date().toISOString()
  };
};

/**
 * Get all payment transactions for a booking.
 */
const getBookingPayments = async (bookingId) => {
  const rows = await bookingModel.listBookingPayments(bookingId);
  return rows.map(r => ({
    id: String(r.id),
    bookingId: String(r.booking_id),
    staffId: r.staff_id ? String(r.staff_id) : null,
    staffNameTamil: r.staff_name_tamil || null,
    staffNameEnglish: r.staff_name_english || null,
    party: r.party.toLowerCase(),
    amount: Number(r.amount),
    paymentMethod: r.payment_method,
    transactionType: r.transaction_type,
    reference: r.reference,
    notes: r.notes,
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
    createdBy: r.created_by ? String(r.created_by) : null,
    createdByName: r.created_by_name || null
  }));
};

/**
 * List all configured Pooja / Event types.
 */
const listEventTypes = async () => {
  const rows = await bookingModel.listEventTypes();
  return rows.map(r => ({
    id: String(r.id),
    nameEnglish: r.name_english,
    nameTamil: r.name_tamil,
    category: r.category,
    defaultDurationMinutes: r.default_duration_minutes,
    basePrice: Number(r.base_price)
  }));
};

/**
 * Get comprehensive financial audit summary and outstanding client receivables.
 */
const getFinancialAuditSummary = async (filters = {}) => {
  const summary = await bookingModel.getFinancialAuditSummary(filters);
  const receivables = await bookingModel.getClientReceivables(filters);
  return {
    summary,
    receivables,
    count: receivables.length
  };
};

/**
 * Get priest compensation and pending settlement status.
 */
const getPriestSettlements = async (filters = {}) => {
  const settlements = await bookingModel.getPriestSettlements(filters);
  return {
    settlements,
    count: settlements.length
  };
};

/**
 * Get financial audit transaction ledger.
 */
const getFinancialAuditTransactions = async (filters = {}) => {
  const transactions = await bookingModel.getFinancialAuditTransactions(filters);
  return {
    transactions,
    count: transactions.length
  };
};

module.exports = {
  checkAvailability,
  createBooking,
  listBookings,
  getBookingDetails,
  getBookingBalance,
  updateBooking,
  deleteBooking,
  recordPayment,
  getBookingPayments,
  listEventTypes,
  getFinancialAuditSummary,
  getPriestSettlements,
  getFinancialAuditTransactions
};
