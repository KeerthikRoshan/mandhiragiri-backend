const bcrypt = require('bcrypt');
const crypto = require('crypto');
const projectModel = require('../models/projectModel');
const profileImageService = require('./profileImageService');
const ApiError = require('../utils/ApiError');

const amount = (value) => Number(Number(value || 0).toFixed(2));
const dateKeyToday = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const displayTime = (value) => {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value);
  const hour = Number(match[1]);
  return `${String(hour % 12 || 12).padStart(2, '0')}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
};

const dateIso = (value) => value instanceof Date ? value.toISOString() : value;

const parseProviderData = (value) => {
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

const getDashboardOverview = async (userId) => {
  const row = await projectModel.getDashboardOverview(userId);
  return {
    dateKey: row.date_key,
    todayEventsCount: Number(row.today_events_count || 0),
    upcomingSevenDaysCount: Number(row.upcoming_seven_days_count || 0),
    pendingApprovalCount: Number(row.pending_approval_count || 0),
    completedTotalCount: Number(row.completed_total_count || 0),
    unreadNotificationsCount: Number(row.unread_notifications_count || 0)
  };
};

const getPanchangam = async ({ date, location }) => {
  const row = await projectModel.getPanchangam(date, location);
  if (!row) throw ApiError.notFound('Panchangam data is not configured for this date and location.');
  return {
    dateKey: row.date_key,
    gregorianBadge: row.gregorian_badge,
    tamilDateBadge: row.tamil_date_badge,
    location: row.location,
    tithi: {
      titleTamil: row.tithi_title_tamil,
      titleEnglish: row.tithi_title_english,
      endTime: row.tithi_end_time
    },
    nakshatra: {
      titleTamil: row.nakshatra_title_tamil,
      titleEnglish: row.nakshatra_title_english,
      endTime: row.nakshatra_end_time
    },
    nallaNeram: {
      morning: row.nalla_neram_morning,
      evening: row.nalla_neram_evening,
      badge: 'சுபம்'
    },
    rahuKalam: {
      time: row.rahu_kalam_time,
      period: row.rahu_kalam_period,
      badge: 'விலக்குக'
    },
    dataSource: row.data_source || 'manual',
    calendarData: parseProviderData(row.provider_data)
  };
};

const savePanchangam = async (data, userId) => {
  const row = await projectModel.upsertPanchangam(data, userId);
  return getPanchangam({ date: data.dateKey, location: data.location });
};

const getSchedule = async ({ date, category }) => {
  const [rows, calendar] = await Promise.all([
    projectModel.getScheduleBookings(date, category),
    projectModel.getCalendarSettings(date)
  ]);
  const counts = { all: rows.length, jathagam: 0, temple: 0, outdoor: 0 };
  let confirmed = 0;
  let pending = 0;
  let completed = 0;
  const bookings = rows.map((row) => {
    counts[row.category] = (counts[row.category] || 0) + 1;
    if (row.status === 'confirmed') confirmed += 1;
    if (row.status === 'pending') pending += 1;
    if (row.status === 'completed') completed += 1;
    const timeParts = row.time_slot.split(' - ');
    const clientBalance = amount(row.total_event_charge) - amount(row.client_total_received);
    const priestBalance = amount(row.priest_total_pay) - amount(row.priest_advance_paid);
    return {
      id: String(row.id),
      date,
      timeSlot: row.time_slot,
      startTime: timeParts[0] || row.time_slot,
      endTime: timeParts[1] || null,
      titleTamil: row.title,
      titleEnglish: row.title,
      category: row.category,
      categoryLabelTamil: row.category_label_tamil,
      status: row.status,
      statusLabelTamil: row.status === 'completed' ? 'முடிவுற்றது' : row.status === 'pending' ? 'நிலுவையில்' : 'உறுதி செய்யப்பட்டது',
      clientName: row.client_name,
      clientPhone: row.client_phone,
      locationTamil: row.location,
      priestId: row.priest_id,
      priestNameTamil: row.staff_name_tamil || row.priest_name,
      priestPhone: row.priest_phone,
      notesTamil: row.completion_notes,
      totalEventCharge: amount(row.total_event_charge),
      clientTotalReceived: amount(row.client_total_received),
      clientBalanceAmount: clientBalance,
      priestTotalPay: amount(row.priest_total_pay),
      priestAdvancePaid: amount(row.priest_advance_paid),
      priestBalanceAmount: priestBalance
    };
  });
  return {
    dateKey: date,
    isMuhurtham: Boolean(calendar.is_muhurtham),
    isBlocked: Boolean(calendar.is_blocked),
    summary: {
      total: bookings.length,
      confirmed,
      pending,
      upcoming: bookings.filter((booking) => booking.status === 'confirmed' || booking.status === 'pending').length,
      completed
    },
    categoryCounts: counts,
    bookings
  };
};

const maskPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');

  return digits.length >= 5
    ? `${digits.slice(0, 5)}${'X'.repeat(digits.length - 5)}`
    : digits;
};

const formatStaff = (row) => ({
  id: String(row.id),
  staffId: row.staff_id || `MJSTF${String(row.id).padStart(5, '0')}`,
  userId: row.user_id ? String(row.user_id) : null,
  nameEnglish: row.name_english,
  nameTamil: row.name_tamil,
  staffRole: row.staff_role,
  designation: row.designation,
  phone: row.phone,
  phoneDisplay: maskPhone(row.phone),
  tradition: row.tradition,
  expertise: row.expertise,
  certification: row.certification,
  languagesSpoken: row.languages_spoken,
  avatarUrl: row.avatar_url,
  status: (row.status || 'Active').toLowerCase() === 'active' ? 'active' : 'inactive',
  userStatus: row.user_status ? String(row.user_status).toLowerCase() : 'active',
  isDeleted: row.user_status ? String(row.user_status).toUpperCase() === 'DELETED' : false,
  createdAt: row.created_at ? dateIso(row.created_at) : null,
  updatedAt: row.updated_at ? dateIso(row.updated_at) : null,
  // Backward-compatibility aliases for frontend
  designationTamil: row.designation,
  designationEnglish: row.designation,
  roleCategory: (row.staff_role || 'Priest').toUpperCase(),
  roleBadge: row.staff_role,
  fullTitleTamil: [row.name_tamil, row.designation].filter(Boolean).join(' - '),
  traditionTamil: row.tradition,
  certificationTamil: row.certification,
  expertiseTamil: row.expertise,
  languagesTamil: row.languages_spoken,
  metrics: {
    totalBookings: Number(row.total_bookings || 0),
    thisWeekBookings: Number(row.this_week_bookings || 0),
    conflictsCount: Number(row.conflicts_count || 0)
  },
  tabCounts: {
    past: Number(row.past_count || 0),
    active: Number(row.active_count || 0),
    upcoming: Number(row.upcoming_count || 0)
  }
});

const listStaff = async ({ status = 'all', search = '' }) => {
  const rows = await projectModel.listStaff({ status, search });
  const staff = rows.map(formatStaff);
  return {
    totalCount: staff.length,
    activeCount: staff.filter((entry) => entry.status === 'active').length,
    staff
  };
};

const createStaff = async (input) => {
  console.log('[CREATE_STAFF] [4/5] Service: Processing business logic');
  const phone = String(input.phone || '').replace(/[\s-]/g, '');
  if (!phone) {
    console.error('[CREATE_STAFF] Service: Validation error - Phone number missing');
    throw ApiError.badRequest('Mobile number is required.');
  }

  console.log('[CREATE_STAFF] Service: Checking for existing staff with phone:', phone);
  const duplicateStaff = await projectModel.findStaffByPhone(phone);
  if (duplicateStaff) {
    console.error('[CREATE_STAFF] Service: Duplicate found in staff table for phone:', phone);
    throw new ApiError(409, 'இந்த மொபைல் எண் ஏற்கனவே பணியாளராக பதிவு செய்யப்பட்டுள்ளது (Phone number already registered).', true, {
      phone: 'A staff member with this phone number already exists.'
    });
  }

  console.log('[CREATE_STAFF] Service: Checking for existing user account with mobile:', phone);
  const duplicateUser = await projectModel.findUserByMobile(phone);
  if (duplicateUser) {
    console.error('[CREATE_STAFF] Service: Duplicate found in users table for mobile:', phone);
    throw new ApiError(409, 'இந்த மொபைல் எண் ஏற்கனவே பயனராக பதிவு செய்யப்பட்டுள்ளது (User already exists).', true, {
      phone: 'A user account with this mobile number already exists.'
    });
  }

  // Priest or Assistant is the staff category; the main user role is always STAFF
  const rawRole = input.staffRole || input.staff_role || input.staffCategory || input.roleCategory || input.role || 'Priest';
  const staffRole = String(rawRole).toLowerCase().includes('assistant') ? 'Assistant' : 'Priest';
  console.log(`[CREATE_STAFF] Service: Resolved staff category: "${staffRole}" (User role will be: STAFF)`);

  const password = input.password || crypto.randomBytes(9).toString('base64url');
  console.log('[CREATE_STAFF] Service: Hashing staff user credentials...');
  const passwordHash = await bcrypt.hash(password, 12);

  const created = await projectModel.createStaff({
    user: {
      mobile: phone,
      email: input.email ? input.email.trim() : null,
      passwordHash
    },
    staff: {
      nameEnglish: (input.nameEnglish || input.name_english || '').trim(),
      nameTamil: (input.nameTamil || input.name_tamil || '').trim(),
      staffRole,
      designation: (input.designation || (staffRole === 'Assistant' ? 'Assistant' : 'Priest')).trim(),
      phone,
      tradition: input.tradition ? input.tradition.trim() : null,
      expertise: input.expertise ? input.expertise.trim() : null,
      certification: input.certification ? input.certification.trim() : null,
      languagesSpoken: (input.languagesSpoken || input.languages_spoken) ? (input.languagesSpoken || input.languages_spoken).trim() : null,
      avatarUrl: (input.avatarUrl || input.avatar_url) ? (input.avatarUrl || input.avatar_url).trim() : null,
      status: 'Active'
    }
  });

  const response = formatStaff(created);
  if (!input.password) {
    response.temporaryPassword = password;
  }
  return response;
};

const updateStaff = async (id, input) => {
  console.log('\n========================================');
  console.log('[UPDATE_STAFF] [1/3] Service: Processing staff update for identifier:', id);
  const sanitizedInput = { ...input };
  if (sanitizedInput.password) sanitizedInput.password = '******';
  console.log('Update payload:', JSON.stringify(sanitizedInput, null, 2));

  const existing = await projectModel.getStaffById(id);
  if (!existing) {
    console.error('[UPDATE_STAFF] Service: Staff member not found for ID/code:', id);
    throw new ApiError(404, 'பணியாளர் விவரம் கிடைக்கவில்லை (Staff member not found).', true);
  }
  console.log(`[UPDATE_STAFF] Service: Found existing staff record ID: ${existing.id}, Staff Code: ${existing.staff_id}, User ID: ${existing.user_id}`);

  const staffUpdates = {};
  const userUpdates = {};

  // 1. English Name
  if (input.nameEnglish !== undefined || input.name_english !== undefined) {
    const val = (input.nameEnglish !== undefined ? input.nameEnglish : input.name_english).trim();
    staffUpdates.name_english = val;
    userUpdates.name = val;
  }

  // 2. Tamil Name
  if (input.nameTamil !== undefined || input.name_tamil !== undefined) {
    const val = (input.nameTamil !== undefined ? input.nameTamil : input.name_tamil).trim();
    staffUpdates.name_tamil = val;
  }

  // 3. Staff Role / Category (Priest / Assistant)
  if (input.staffRole !== undefined || input.staff_role !== undefined || input.roleCategory !== undefined || input.staffCategory !== undefined || input.role !== undefined) {
    const rawRole = input.staffRole !== undefined
      ? input.staffRole
      : (input.staff_role !== undefined
        ? input.staff_role
        : (input.staffCategory !== undefined
          ? input.staffCategory
          : (input.roleCategory !== undefined
            ? input.roleCategory
            : input.role)));
    const roleEnum = String(rawRole).toLowerCase().includes('assistant') ? 'Assistant' : 'Priest';
    staffUpdates.staff_role = roleEnum;
    // Main user role in users table remains STAFF
    const staffRoleRow = await projectModel.getRoleByName('STAFF');
    if (staffRoleRow) {
      userUpdates.role_id = staffRoleRow.id;
    }
  }

  // 4. Designation
  if (input.designation !== undefined) {
    staffUpdates.designation = String(input.designation).trim();
  }

  // 5. Phone / Mobile Number
  if (input.phone !== undefined || input.mobile !== undefined || input.mobileNumber !== undefined) {
    const rawPhone = input.phone !== undefined ? input.phone : (input.mobile !== undefined ? input.mobile : input.mobileNumber);
    const cleanPhone = String(rawPhone).replace(/[\s-]/g, '');
    if (cleanPhone) {
      staffUpdates.phone = cleanPhone;
      userUpdates.mobile = cleanPhone;
    }
  }

  // 6. Tradition
  if (input.tradition !== undefined) {
    staffUpdates.tradition = input.tradition ? String(input.tradition).trim() : null;
  }

  // 7. Expertise
  if (input.expertise !== undefined) {
    staffUpdates.expertise = input.expertise ? String(input.expertise).trim() : null;
  }

  // 8. Certification
  if (input.certification !== undefined) {
    staffUpdates.certification = input.certification ? String(input.certification).trim() : null;
  }

  // 9. Languages Spoken
  if (input.languagesSpoken !== undefined || input.languages_spoken !== undefined) {
    const val = input.languagesSpoken !== undefined ? input.languagesSpoken : input.languages_spoken;
    staffUpdates.languages_spoken = val ? String(val).trim() : null;
  }

  // 10. Avatar / Profile Image URL
  if (input.avatarUrl !== undefined || input.avatar_url !== undefined) {
    const val = input.avatarUrl !== undefined ? input.avatarUrl : input.avatar_url;
    staffUpdates.avatar_url = val ? String(val).trim() : null;
  }

  // 11. Status and Soft Deletion Handling:
  // - Use staff.status for active/deactive status updates.
  // - Use users.status for staff account soft deletion.
  const isSoftDelete = input.isDeleted === true ||
    input.softDelete === true ||
    input.deleted === true ||
    (input.status !== undefined && String(input.status).toLowerCase() === 'deleted') ||
    (input.userStatus !== undefined && String(input.userStatus).toUpperCase() === 'DELETED');

  const isRestore = input.isDeleted === false ||
    input.softDelete === false ||
    input.deleted === false ||
    (input.userStatus !== undefined && String(input.userStatus).toUpperCase() === 'ACTIVE');

  if (isSoftDelete) {
    console.log('[UPDATE_STAFF] Service: Soft-deletion requested for staff account');
    userUpdates.status = 'DELETED';
    staffUpdates.status = 'Inactive';
  } else if (isRestore) {
    console.log('[UPDATE_STAFF] Service: Restoring soft-deleted staff account to ACTIVE');
    userUpdates.status = 'ACTIVE';
    if (input.status !== undefined) {
      const s = String(input.status).toLowerCase();
      staffUpdates.status = (s === 'inactive' || s === 'deactive') ? 'Inactive' : 'Active';
    } else {
      staffUpdates.status = 'Active';
    }
  } else if (input.status !== undefined) {
    // Active or Deactive update on staff.status only
    const s = String(input.status).toLowerCase();
    const statusEnum = (s === 'inactive' || s === 'deactive') ? 'Inactive' : 'Active';
    staffUpdates.status = statusEnum;
    console.log(`[UPDATE_STAFF] Service: Active/Deactive update -> staff.status = ${statusEnum}`);
  }

  // 12. Email
  if (input.email !== undefined) {
    userUpdates.email = input.email ? String(input.email).trim() : null;
  }

  // 13. Password
  if (input.password) {
    if (String(input.password).length < 6) {
      throw ApiError.badRequest('Password must be at least 6 characters long.');
    }
    console.log('[UPDATE_STAFF] Service: Hashing new password for authentication user');
    userUpdates.password_hash = await bcrypt.hash(input.password, 12);
  }

  console.log('[UPDATE_STAFF] [2/3] Service: Prepared database updates:');
  console.log('Staff Updates:', staffUpdates);
  console.log('User Updates:', userUpdates);

  const updatedStaff = await projectModel.updateStaff(existing.id, { userUpdates, staffUpdates });
  const formatted = formatStaff(updatedStaff);
  console.log('[UPDATE_STAFF] [3/3] Service: Staff update completed successfully:', {
    id: formatted.id,
    staffId: formatted.staffId,
    nameEnglish: formatted.nameEnglish,
    staffRole: formatted.staffRole,
    status: formatted.status,
    isDeleted: formatted.isDeleted
  });
  console.log('========================================\n');
  return formatted;
};

const getDailyAttendance = async ({ date, status, role, search }) => {
  const rows = await projectModel.getDailyAttendance(date);
  const formatted = rows.map((row) => ({
    id: `${row.staff_id}_${date}`,
    staffId: String(row.staff_id),
    staffCode: row.staff_code,
    staffNameEnglish: row.name_english,
    staffNameTamil: row.name_tamil,
    designation: row.designation,
    staffRole: row.staff_role,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    // Backward-compatibility aliases
    designationTamil: row.designation,
    designationEnglish: row.designation,
    roleCategory: (row.staff_role || 'Priest').toLowerCase(),
    status: row.status ? row.status.toLowerCase() : 'not_marked',
    isLeave: row.status ? row.status.toLowerCase() === 'leave' : false,
    submissionTime: displayTime(row.submission_time),
    remarks: row.remarks,
    updatedAt: row.updated_at ? dateIso(row.updated_at) : null,
    updatedBy: row.updated_by || (row.status ? 'Self (Staff Portal)' : null)
  }));
  const summary = {
    totalStaff: formatted.length,
    presentCount: formatted.filter((row) => row.status === 'present').length,
    absentCount: formatted.filter((row) => row.status === 'absent').length,
    leaveCount: formatted.filter((row) => row.status === 'leave').length,
    notMarkedCount: formatted.filter((row) => row.status === 'not_marked').length
  };
  const records = formatted.filter((row) =>
    (!status || status === 'all' || row.status === status) &&
    (!role || role === 'all' || row.roleCategory === role || (row.staffRole && row.staffRole.toLowerCase() === role.toLowerCase())) &&
    (!search || `${row.staffNameEnglish} ${row.staffNameTamil || ''} ${row.designation || ''}`.toLowerCase().includes(search.toLowerCase()))
  );
  return { dateKey: date, summary, records };
};

const parseTime = (value) => {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) throw ApiError.badRequest('Submission time must be in HH:mm or hh:mm AM/PM format.');
  let hour = Number(match[1]);
  const suffix = (match[3] || '').toUpperCase();
  if (suffix === 'PM' && hour < 12) hour += 12;
  if (suffix === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${match[2]}:00`;
};

const getCurrentTimeKolkata = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  const second = parts.find((p) => p.type === 'second')?.value || '00';
  return `${hour}:${minute}:${second}`;
};

const updateAttendance = async (input, updatedBy) => {
  const todayKolkata = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  if (input.dateKey > todayKolkata && input.status.toLowerCase() !== 'leave') {
    throw ApiError.badRequest('Future dates can only be marked as Leave.');
  }

  const staff = await projectModel.getStaffById(input.staffId);
  if (!staff) throw ApiError.notFound('Staff member not found.');
  const targetId = staff.id;

  const existingRecord = await projectModel.getAttendanceByStaffAndDate(targetId, input.dateKey);

  let finalSubmissionTime = null;
  const statusUpper = input.status.toUpperCase();

  if (statusUpper === 'PRESENT') {
    if (input.submissionTime) {
      finalSubmissionTime = parseTime(input.submissionTime);
    } else if (existingRecord?.submission_time) {
      finalSubmissionTime = existingRecord.submission_time;
    } else {
      finalSubmissionTime = getCurrentTimeKolkata();
    }
  } else {
    finalSubmissionTime = null;
  }

  const row = await projectModel.upsertAttendance({
    staffId: targetId,
    dateKey: input.dateKey,
    status: statusUpper,
    submissionTime: finalSubmissionTime,
    remarks: input.remarks !== undefined ? input.remarks : (existingRecord ? existingRecord.remarks : null),
    updatedBy
  });

  return {
    recordId: `${targetId}_${input.dateKey}`,
    staffId: String(targetId),
    staffCode: staff.staff_id,
    dateKey: input.dateKey,
    status: row.status.toLowerCase(),
    submissionTime: displayTime(row.submission_time),
    remarks: row.remarks,
    updatedAt: dateIso(row.updated_at),
    updatedBy: String(updatedBy)
  };
};

const getStaffMonthlyAttendance = async (staffIdOrCode, { year, month, monthIndex }) => {
  const now = new Date();
  const targetYear = year ? Number(year) : now.getFullYear();
  let mIndex = 0;
  if (monthIndex !== undefined && monthIndex !== null && monthIndex !== '') {
    mIndex = Number(monthIndex);
  } else if (month) {
    mIndex = Number(month) - 1;
  } else {
    mIndex = now.getMonth();
  }

  const totalDaysInMonth = new Date(targetYear, mIndex + 1, 0).getDate();
  const startDate = `${targetYear}-${String(mIndex + 1).padStart(2, '0')}-01`;
  const endDate = `${targetYear}-${String(mIndex + 1).padStart(2, '0')}-${String(totalDaysInMonth).padStart(2, '0')}`;

  const result = await projectModel.getStaffMonthlyAttendance(staffIdOrCode, startDate, endDate);
  if (!result || !result.staff) {
    throw ApiError.notFound('Staff member not found.');
  }

  const { staff, attendanceRows, leaveRows } = result;

  const recordMap = new Map();
  for (const att of attendanceRows) {
    const dKey = String(att.date_key).slice(0, 10);
    recordMap.set(dKey, att);
  }

  const approvedLeaveDates = new Set();
  for (const l of leaveRows) {
    const start = new Date(l.start_date);
    const end = new Date(l.end_date);
    for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
      approvedLeaveDates.add(cur.toISOString().slice(0, 10));
    }
  }

  let presentCount = 0;
  let absentCount = 0;
  let leaveCount = 0;
  let notMarkedCount = 0;

  const records = [];

  for (let day = 1; day <= totalDaysInMonth; day++) {
    const dKey = `${targetYear}-${String(mIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const existing = recordMap.get(dKey);

    let status = 'not_marked';
    let submissionTime = null;
    let remarks = null;
    let updatedAt = null;
    let updatedBy = null;
    let isLeave = false;

    if (existing) {
      status = existing.status.toLowerCase();
      submissionTime = displayTime(existing.submission_time);
      remarks = existing.remarks;
      updatedAt = existing.updated_at ? dateIso(existing.updated_at) : null;
      updatedBy = existing.updater_name || null;
      if (status === 'leave') isLeave = true;
    } else if (approvedLeaveDates.has(dKey)) {
      status = 'leave';
      isLeave = true;
      remarks = 'அங்கீகரிக்கப்பட்ட விடுப்பு (Approved Leave)';
    }

    if (status === 'present') presentCount++;
    else if (status === 'absent') absentCount++;
    else if (status === 'leave') leaveCount++;
    else notMarkedCount++;

    records.push({
      id: `${staff.id}_${dKey}`,
      staffId: String(staff.id),
      dateKey: dKey,
      dayNumber: day,
      status,
      submissionTime,
      remarks,
      isLeave,
      updatedAt,
      updatedBy
    });
  }

  const markedDaysCount = presentCount + absentCount + leaveCount;
  const attendancePercentage = markedDaysCount > 0
    ? Math.round((presentCount / markedDaysCount) * 100)
    : 0;

  return {
    staff: {
      id: String(staff.id),
      staffId: staff.staff_id,
      staffCode: staff.staff_id,
      nameEnglish: staff.name_english,
      nameTamil: staff.name_tamil,
      designation: staff.designation,
      designationEnglish: staff.designation,
      designationTamil: staff.designation,
      staffRole: staff.staff_role,
      roleCategory: (staff.staff_role || 'Priest').toLowerCase(),
      phone: staff.phone,
      avatarUrl: staff.avatar_url,
      status: staff.status
    },
    year: targetYear,
    monthIndex: mIndex,
    totalDaysInMonth,
    markedDaysCount,
    presentCount,
    absentCount,
    leaveCount,
    notMarkedCount,
    attendancePercentage,
    records
  };
};

const submitAttendance = async (input, userId) => {
  const staff = await projectModel.getStaffByUserId(userId);
  if (!staff) throw ApiError.forbidden('Only a registered staff member can submit attendance.');
  if (input.dateKey !== dateKeyToday()) throw ApiError.badRequest('Attendance can only be submitted for today.');
  const now = new Date();
  const submissionTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
  try {
    const id = await projectModel.submitAttendance({
      staffId: staff.id,
      dateKey: input.dateKey,
      status: input.status,
      submissionTime,
      remarks: input.remarks
    });
    return {
      id: `${staff.id}_${input.dateKey}`,
      staffId: String(staff.id),
      dateKey: input.dateKey,
      status: input.status,
      submissionTime: displayTime(submissionTime),
      isSealed: true,
      recordId: String(id)
    };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new ApiError(409, 'இன்றைய வருகைப் பதிவு ஏற்கனவே முடிந்துள்ளது. மீண்டும் பதிவு செய்ய இயலாது.', true, {
        attendance: 'Attendance has already been recorded for today (Strict Once-Per-Day Rule).'
      });
    }
    throw error;
  }
};

const formatLeave = (row) => {
  const start = new Date(`${row.start_date}T00:00:00Z`);
  const end = new Date(`${row.end_date}T00:00:00Z`);
  return {
    id: String(row.id),
    staffId: String(row.staff_id),
    staffNameEnglish: row.name_english,
    staffNameTamil: row.name_tamil,
    designation: row.designation,
    designationTamil: row.designation,
    startDate: String(row.start_date).slice(0, 10),
    endDate: String(row.end_date).slice(0, 10),
    totalDays: Math.floor((end - start) / 86400000) + 1,
    leaveType: row.leave_type,
    leaveTypeLabelTamil: row.leave_type,
    reason: row.reason,
    status: row.status.toLowerCase(),
    appliedAt: String(row.created_at).slice(0, 10),
    adminRemarks: row.admin_remarks
  };
};

const getLeaveRequests = async (status = 'all') => {
  const data = await projectModel.listLeaveRequests(status);
  return {
    counts: {
      all: Number(data.counts.all_count || 0),
      pending: Number(data.counts.pending_count || 0),
      approved: Number(data.counts.approved_count || 0),
      rejected: Number(data.counts.rejected_count || 0)
    },
    leaves: data.leaves.map(formatLeave)
  };
};

const applyLeave = async (input, userId) => {
  const staff = await projectModel.getStaffByUserId(userId);
  if (!staff) throw ApiError.forbidden('Only a registered staff member can apply for leave.');
  const result = await projectModel.createLeaveRequest({ ...input, staffId: staff.id });
  if (result.conflict) {
    throw new ApiError(409, 'குறிப்பிட்ட தேதிகளில் ஏற்கனவே மற்றொரு விடுப்பு விண்ணப்பம் பதிவில் உள்ளது.', true, {
      dateRange: 'You already have an active leave request covering these dates.'
    });
  }
  const totalDays = Math.floor((new Date(`${input.endDate}T00:00:00Z`) - new Date(`${input.startDate}T00:00:00Z`)) / 86400000) + 1;
  return {
    id: String(result.id),
    staffId: String(staff.id),
    startDate: input.startDate,
    endDate: input.endDate,
    totalDays,
    leaveType: input.leaveType,
    reason: input.reason,
    status: 'pending',
    appliedAt: dateKeyToday()
  };
};

const decideLeave = async ({ leaveId, decision, adminRemarks }, user) => {
  const row = await projectModel.decideLeaveRequest({
    leaveId,
    decision,
    remarks: adminRemarks,
    decidedBy: user.id
  });
  if (!row) throw new ApiError(409, 'Leave request is not pending.');
  return {
    leaveId: String(row.id),
    status: row.status.toLowerCase(),
    decidedAt: dateIso(row.decided_at),
    decidedBy: user.nameTamil || user.nameEnglish || String(user.id),
    adminRemarks: row.admin_remarks
  };
};

const getStaffDashboard = async (userId) => {
  const staff = await projectModel.getStaffByUserId(userId);
  if (!staff) throw ApiError.forbidden('Staff profile is not configured.');
  const data = await projectModel.getStaffDashboard(staff.id, dateKeyToday());
  return {
    profile: {
      id: String(staff.id),
      staffId: staff.staff_id || `MJSTF${String(staff.id).padStart(5, '0')}`,
      nameTamil: staff.name_tamil || staff.name_english,
      nameEnglish: staff.name_english,
      staffRole: staff.staff_role,
      designation: staff.designation,
      tradition: staff.tradition,
      // Backward-compatibility aliases
      designationTamil: staff.designation,
      traditionTamil: staff.tradition
    },
    todayAttendance: {
      isMarked: Boolean(data.attendance),
      status: data.attendance ? data.attendance.status.toLowerCase() : null,
      submissionTime: data.attendance ? displayTime(data.attendance.submission_time) : null,
      isSealed: Boolean(data.attendance && data.attendance.is_sealed)
    },
    counts: {
      todayCount: Number(data.counts.today_count || 0),
      upcomingCount: Number(data.counts.upcoming_count || 0),
      pendingCompletionCount: Number(data.counts.pending_completion_count || 0)
    },
    todayEvents: data.events.map((row) => ({
      id: String(row.id),
      date: String(row.date_key).slice(0, 10),
      timeSlot: row.time_slot,
      titleTamil: row.title,
      category: row.category,
      categoryLabelTamil: row.category_label_tamil,
      clientName: row.client_name,
      clientPhone: row.client_phone,
      locationTamil: row.location,
      status: row.status
    })),
    todayReminders: data.reminders.map((row) => ({
      id: String(row.id),
      titleTamil: row.title_tamil,
      descriptionTamil: row.description_tamil,
      time: row.reminder_time,
      status: row.status.toLowerCase()
    }))
  };
};

const completeEvent = async ({ eventId, completionNotes }, userId) => {
  const staff = await projectModel.getStaffByUserId(userId);
  if (!staff) throw ApiError.forbidden('Only registered staff can complete an event.');
  const row = await projectModel.completeEvent({ eventId, staffId: staff.id, notes: completionNotes });
  if (!row) throw ApiError.notFound('Assigned event was not found or is already completed.');
  return {
    eventId: String(row.id),
    status: row.status,
    statusLabelTamil: 'முடிவுற்றது',
    completedAt: dateIso(row.completed_at),
    completedBy: String(staff.id),
    completionNotes: row.completion_notes
  };
};

const getAdminProfile = async (userId) => {
  const row = await projectModel.getAdminProfile(userId);
  if (!row) throw ApiError.notFound('Administrator profile not found.');
  return {
    id: String(row.id),
    nameTamil: row.name_tamil || row.name_english,
    titleTamil: row.title_tamil,
    phone: row.mobile,
    email: row.email,
    avatarUrl: row.avatar_url,
    addressTamil: row.address_tamil,
    metrics: {
      yearsExperience: row.years_experience,
      horoscopeCount: row.horoscope_count,
      homamCount: row.homam_count,
      accuracyRate: row.accuracy_rate
    },
    ashramDetails: {
      peedamNameTamil: row.peedam_name_tamil,
      morningHours: row.morning_hours,
      eveningHours: row.evening_hours
    }
  };
};

const uploadAdminAvatar = async (userId, file) => profileImageService.uploadProfileImage({
  category: 'admin',
  userId,
  file
});

const uploadStaffAvatar = async (staffId, file) => profileImageService.uploadProfileImage({
  category: 'staff',
  staffId,
  file
});

const updateAdminProfile = async (input, userId) => {
  const row = await projectModel.updateAdminProfile({ ...input, userId });
  return {
    phone: row.mobile,
    email: row.email,
    addressTamil: row.address_tamil,
    updatedAt: dateIso(row.updated_at)
  };
};

const recordBookingPayment = async (input, userId) => {
  const result = await projectModel.recordBookingPayment({
    ...input,
    party: input.party.toUpperCase(),
    createdBy: userId
  });
  if (result.notFound) throw ApiError.notFound('Booking not found.');
  if (result.exceedsBalance) {
    throw ApiError.unprocessable('Payment exceeds the outstanding balance.', {
      amount: `Remaining balance is ${result.balance}.`
    });
  }
  return {
    transactionId: String(result.transactionId),
    bookingId: String(input.bookingId),
    party: input.party.toLowerCase(),
    amount: amount(input.amount),
    paymentMethod: input.paymentMethod || 'cash',
    recordedAt: new Date().toISOString()
  };
};

const getBookingPayments = async (bookingId) => {
  const rows = await projectModel.listBookingPayments(bookingId);
  return rows.map((row) => ({
    id: String(row.id),
    party: row.party.toLowerCase(),
    amount: amount(row.amount),
    paymentMethod: row.payment_method,
    reference: row.reference,
    notes: row.notes,
    paidAt: dateIso(row.paid_at),
    createdBy: row.created_by ? String(row.created_by) : null
  }));
};

const getBalanceReport = async ({ fromDate, toDate }) => {
  const row = await projectModel.getBalanceReport({ fromDate, toDate });
  return {
    fromDate,
    toDate,
    bookingCount: Number(row.booking_count || 0),
    totalEventCharge: amount(row.total_event_charge),
    clientTotalReceived: amount(row.client_total_received),
    clientBalanceAmount: amount(row.client_balance_amount),
    priestTotalPay: amount(row.priest_total_pay),
    priestAdvancePaid: amount(row.priest_advance_paid),
    priestBalanceAmount: amount(row.priest_balance_amount)
  };
};

module.exports = {
  dateKeyToday,
  getDashboardOverview,
  getPanchangam,
  savePanchangam,
  getSchedule,
  listStaff,
  createStaff,
  updateStaff,
  getDailyAttendance,
  updateAttendance,
  getStaffMonthlyAttendance,
  submitAttendance,
  getLeaveRequests,
  applyLeave,
  decideLeave,
  getStaffDashboard,
  completeEvent,
  getAdminProfile,
  uploadAdminAvatar,
  uploadStaffAvatar,
    updateAdminProfile,
  recordBookingPayment,
  getBookingPayments,
  getBalanceReport
};