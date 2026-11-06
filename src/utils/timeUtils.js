/**
 * Time utility functions for booking calculations and conflict checking
 * Timezone: Asia/Kolkata
 */

/**
 * Parses any time string into total minutes from midnight (0 - 1439).
 * Accepts:
 * - "09:00 AM", "9:00 AM", "02:30 PM", "2:30 PM"
 * - "09:00", "14:30", "09:00:00", "14:30:00"
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const s = String(timeStr).trim();
  const match = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3] ? match[3].toUpperCase() : null;

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * Converts total minutes from midnight to 12-hour AM/PM string: e.g. "09:00 AM".
 */
function minutesTo12(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined) return null;
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  let h = Math.floor(norm / 60);
  const m = norm % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Converts total minutes from midnight to 24-hour SQL TIME string: e.g. "09:00:00".
 */
function minutesTo24(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined) return null;
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Calculates start time, end time, duration, and time slot.
 */
function calculateBookingTimings(startTimeStr, durationMinutesInput) {
  const startMins = parseTimeToMinutes(startTimeStr);
  if (startMins === null) {
    throw new Error('Invalid start time format. Use HH:mm AM/PM (e.g. 09:00 AM) or 24-hour HH:mm.');
  }

  const duration = parseInt(durationMinutesInput, 10);
  if (isNaN(duration) || duration <= 0) {
    throw new Error('Duration must be a positive number of minutes.');
  }

  const endMins = startMins + duration;
  const crossesMidnight = endMins >= 1440;

  const startTime24 = minutesTo24(startMins);
  const endTime24 = minutesTo24(endMins);
  const startTime12 = minutesTo12(startMins);
  const endTime12 = minutesTo12(endMins);
  const timeSlot = `${startTime12} - ${endTime12}`;

  return {
    startMinutes: startMins,
    endMinutes: endMins,
    startTime24,
    endTime24,
    startTime12,
    endTime12,
    timeSlot,
    durationMinutes: duration,
    crossesMidnight
  };
}

/**
 * Checks if two intervals [startA, endA) and [startB, endB) overlap.
 * Back-to-back intervals (endA === startB or endB === startA) do NOT overlap.
 */
function isIntervalOverlapping(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

module.exports = {
  parseTimeToMinutes,
  minutesTo12,
  minutesTo24,
  calculateBookingTimings,
  isIntervalOverlapping
};
