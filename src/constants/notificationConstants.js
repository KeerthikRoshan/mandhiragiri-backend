/**
 * Notification System Constants for Mandhiragiri Jothidam (Phase 2)
 */

const NOTIFICATION_EVENTS = Object.freeze({
  // Booking events
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_ASSIGNED: 'BOOKING_ASSIGNED',
  BOOKING_RESCHEDULED: 'BOOKING_RESCHEDULED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_REMINDER: 'BOOKING_REMINDER',
  BOOKING_COMPLETED: 'BOOKING_COMPLETED',

  // Staff & Leave events
  LEAVE_REQUESTED: 'LEAVE_REQUESTED',
  LEAVE_APPROVED: 'LEAVE_APPROVED',
  LEAVE_REJECTED: 'LEAVE_REJECTED',
  ATTENDANCE_REMINDER: 'ATTENDANCE_REMINDER',
  ATTENDANCE_ALERT: 'ATTENDANCE_ALERT',

  // Payments & System events
  PAYMENT_UPDATED: 'PAYMENT_UPDATED',
  SYSTEM_ANNOUNCEMENT: 'SYSTEM_ANNOUNCEMENT'
});

const REMINDER_EVENTS = Object.freeze({
  BOOKING_24H_REMINDER: 'BOOKING_24H_REMINDER',
  BOOKING_1H_REMINDER: 'BOOKING_1H_REMINDER',
  BOOKING_5M_REMINDER: 'BOOKING_5M_REMINDER'
});

const ALL_EVENT_TYPES = Object.freeze(Object.values(NOTIFICATION_EVENTS));

const ENTITY_TYPES = Object.freeze({
  BOOKING: 'booking',
  LEAVE: 'leave',
  ATTENDANCE: 'attendance',
  PAYMENT: 'payment',
  SYSTEM: 'system'
});

const DELIVERY_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'
});

const JOB_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

const JOB_TYPES = Object.freeze({
  PUSH_DELIVERY: 'PUSH_DELIVERY',
  BOOKING_24H_REMINDER: 'BOOKING_24H_REMINDER',
  BOOKING_1H_REMINDER: 'BOOKING_1H_REMINDER',
  BOOKING_5M_REMINDER: 'BOOKING_5M_REMINDER',
  ATTENDANCE_CHECK: 'ATTENDANCE_CHECK'
});

const PRIORITIES = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent'
});

const RECIPIENT_CATEGORIES = Object.freeze({
  ADMIN: 'ADMIN',
  PRIEST_AND_ASSISTANTS: 'PRIEST_AND_ASSISTANTS'
});

/**
 * Generate a granular business event idempotency key
 * Allows legitimate updates (reassignments, rescheduling) to create separate notifications.
 *
 * @param {string} eventType
 * @param {string} entityType
 * @param {string|number} entityId
 * @param {string|number} [qualifier] - E.g. priestId, dateKey, or new status
 * @returns {string}
 */
const generateEventIdempotencyKey = (eventType, entityType, entityId, qualifier = '') => {
  const cleanQualifier = qualifier ? `_${String(qualifier).trim()}` : '';
  return `${eventType.toLowerCase()}_${entityType}_${entityId}${cleanQualifier}`;
};

module.exports = {
  NOTIFICATION_EVENTS,
  REMINDER_EVENTS,
  ALL_EVENT_TYPES,
  ENTITY_TYPES,
  DELIVERY_STATUS,
  JOB_STATUS,
  JOB_TYPES,
  PRIORITIES,
  RECIPIENT_CATEGORIES,
  generateEventIdempotencyKey
};
