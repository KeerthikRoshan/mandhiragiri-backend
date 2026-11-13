const crypto = require('crypto');
const { pool } = require('../config/database');
const outboxModel = require('../models/outboxModel');
const notificationModel = require('../models/notificationModel');
const notificationService = require('./notificationService');
const { NOTIFICATION_EVENTS } = require('../constants/notificationConstants');

/**
 * Outbox Processor Service for Mandhiragiri Jothidam (Phase 5)
 * Claims pending business outbox events, generates bilingual (Tamil/English) content,
 * applies 4-combination channel preferences, creates notifications/recipients/push jobs,
 * and completes outbox events under ACID transaction fencing.
 */

/**
 * Generate bilingual Tamil and English titles and bodies for all 12 active Phase 4 events
 *
 * @param {string} eventType
 * @param {Object} payload
 * @returns {{ titleEn: string, bodyEn: string, titleTa: string, bodyTa: string, priority: string }}
 */
const generateBilingualContent = (eventType, payload = {}) => {
  const bNum = payload.bookingNumber || payload.bookingId || '';
  const title = payload.title || 'Pooja/Event';
  const clientName = payload.clientName || '';
  const dateKey = payload.dateKey || '';
  const timeSlot = payload.timeSlot || payload.startTime || '';
  const priestName = payload.staffNameEn || payload.priestName || 'Priest';
  const priestNameTa = payload.staffNameTa || payload.priestName || 'குருக்கள்';
  const staffId = payload.staffId || '';
  const staffName = payload.staffNameEn || payload.staffName || '';
  const staffNameTa = payload.staffNameTa || payload.staffName || '';

  switch (eventType) {
    case NOTIFICATION_EVENTS.BOOKING_CREATED:
      return {
        titleEn: 'New Booking Created',
        bodyEn: clientName
          ? `New booking created for ${clientName}: ${title} on ${dateKey} at ${timeSlot}.`
          : `Booking #${bNum} (${title}) has been created for ${dateKey} at ${timeSlot}.`,
        titleTa: 'புதிய முன்பதிவு பதிவு செய்யப்பட்டது',
        bodyTa: clientName
          ? `${clientName} என்பவருக்கான ${title} முன்பதிவு ${dateKey} அன்று ${timeSlot} மணிக்கு பதிவு செய்யப்பட்டுள்ளது.`
          : `முன்பதிவு #${bNum} (${title}) ${dateKey} அன்று ${timeSlot} மணிக்கு பதிவு செய்யப்பட்டுள்ளது.`,
        priority: 'normal'
      };

    case NOTIFICATION_EVENTS.BOOKING_ASSIGNED:
      return {
        titleEn: 'Booking Assigned',
        bodyEn: clientName
          ? `${clientName}'s ${title} booking on ${dateKey} has been assigned to ${priestName}.`
          : `Booking #${bNum} (${title}) on ${dateKey} has been assigned to ${priestName}.`,
        titleTa: 'முன்பதிவு பணிக்கப்பட்டது',
        bodyTa: clientName
          ? `${clientName} என்பவரின் ${title} முன்பதிவு ${dateKey} அன்று ${priestNameTa} அவர்களுக்கு பணிக்கப்பட்டுள்ளது.`
          : `முன்பதிவு #${bNum} (${title}) ${dateKey} அன்று ${priestNameTa} அவர்களுக்கு ஒதுக்கப்பட்டுள்ளது.`,
        priority: 'normal'
      };

    case NOTIFICATION_EVENTS.BOOKING_RESCHEDULED: {
      const newDate = payload.newDateKey || dateKey;
      const newTime = payload.timeSlot || payload.newStartTime || payload.startTime || '';
      return {
        titleEn: 'Booking Rescheduled',
        bodyEn: clientName
          ? `${clientName}'s ${title} booking has been rescheduled to ${newDate} at ${newTime}.`
          : `Booking #${bNum} (${title}) has been rescheduled to ${newDate} at ${newTime}.`,
        titleTa: 'முன்பதிவு தேதி மாற்றப்பட்டது',
        bodyTa: clientName
          ? `${clientName} என்பவரின் ${title} முன்பதிவு ${newDate} அன்று ${newTime} மணிக்கு மாற்றப்பட்டுள்ளது.`
          : `முன்பதிவு #${bNum} (${title}) ${newDate} அன்று ${newTime} மணிக்கு மாற்றப்பட்டுள்ளது.`,
        priority: 'high'
      };
    }

    case NOTIFICATION_EVENTS.BOOKING_CANCELLED:
      return {
        titleEn: 'Booking Cancelled',
        bodyEn: clientName
          ? `${clientName}'s ${title} booking scheduled for ${dateKey} has been cancelled.`
          : `Booking #${bNum} (${title}) scheduled for ${dateKey} has been cancelled.`,
        titleTa: 'முன்பதிவு ரத்து செய்யப்பட்டது',
        bodyTa: clientName
          ? `${clientName} என்பவரின் ${title} முன்பதிவு (${dateKey}) ரத்து செய்யப்பட்டுள்ளது.`
          : `முன்பதிவு #${bNum} (${title}) (${dateKey}) ரத்து செய்யப்பட்டுள்ளது.`,
        priority: 'high'
      };

    case NOTIFICATION_EVENTS.BOOKING_COMPLETED: {
      const bTitle = title || 'Pooja';
      const bodyEn = clientName
        ? `${clientName}'s ${bTitle} booking has been completed by ${priestName}.`
        : `Booking #${bNum} (${bTitle}) has been completed by ${priestName}.`;

      const bodyTa = clientName
        ? `${clientName} என்பவரின் ${bTitle} பதிவு ${priestNameTa} அவர்களால் நிறைவு செய்யப்பட்டது.`
        : `முன்பதிவு #${bNum} (${bTitle}) ${priestNameTa} அவர்களால் நிறைவு செய்யப்பட்டது.`;

      return {
        titleEn: 'Booking Completed',
        bodyEn,
        titleTa: 'பதிவு நிறைவு செய்யப்பட்டது',
        bodyTa,
        priority: 'high'
      };
    }

    case 'BOOKING_UPDATED':
      return {
        titleEn: 'Booking Updated',
        bodyEn: clientName
          ? `Details for ${clientName}'s ${title} booking have been updated.`
          : `Booking #${bNum} (${title}) details have been updated.`,
        titleTa: 'முன்பதிவு விவரம் மாற்றப்பட்டது',
        bodyTa: clientName
          ? `${clientName} என்பவரின் ${title} முன்பதிவு விவரங்கள் புதுப்பிக்கப்பட்டுள்ளன.`
          : `முன்பதிவு #${bNum} (${title}) விவரங்கள் புதுப்பிக்கப்பட்டுள்ளன.`,
        priority: 'normal'
      };

    case 'CLIENT_ADVANCE_RECEIVED': {
      const amount = payload.amount !== undefined ? `₹${payload.amount}` : '';
      return {
        titleEn: 'Client Advance Received',
        bodyEn: `Advance payment of ${amount} received for ${clientName ? `${clientName}'s ${title}` : `booking #${bNum} (${title})`}.`,
        titleTa: 'வாடிக்கையாளர் முன்பணம் பெறப்பட்டது',
        bodyTa: `${clientName ? `${clientName} என்பவரின் ${title}` : `முன்பதிவு #${bNum} (${title})`}-க்கான முன்பணம் ${amount} பெறப்பட்டது.`,
        priority: 'normal'
      };
    }

    case 'CLIENT_PAYMENT_UPDATED': {
      const amount = payload.amount !== undefined ? `₹${payload.amount}` : '';
      return {
        titleEn: 'Client Payment Updated',
        bodyEn: `Client payment for ${clientName ? `${clientName}'s ${title}` : `booking #${bNum}`} updated: ${amount} (${payload.updatedPaymentStatus || payload.status || 'Updated'}).`,
        titleTa: 'வாடிக்கையாளர் கட்டணம் புதுப்பிக்கப்பட்டது',
        bodyTa: `${clientName ? `${clientName} என்பவரின் ${title}` : `முன்பதிவு #${bNum}`} வாடிக்கையாளர் கட்டணம் புதுப்பிக்கப்பட்டது: ${amount}.`,
        priority: 'normal'
      };
    }

    case 'PRIEST_ADVANCE_PAID': {
      const amount = payload.amount !== undefined ? `₹${payload.amount}` : '';
      return {
        titleEn: 'Priest Advance Paid',
        bodyEn: `Advance of ${amount} paid to ${priestName} for booking #${bNum} (${title}).`,
        titleTa: 'குருக்கள் முன்பணம் வழங்கப்பட்டது',
        bodyTa: `முன்பதிவு #${bNum} (${title}) பூஜைக்காக குருக்கள் ${priestNameTa} அவர்களுக்கு முன்பணம் ${amount} வழங்கப்பட்டது.`,
        priority: 'normal'
      };
    }

    case 'PRIEST_REMUNERATION_UPDATED': {
      const amount = payload.amount !== undefined ? `₹${payload.amount}` : '';
      return {
        titleEn: 'Priest Remuneration Updated',
        bodyEn: `Remuneration for ${priestName} on booking #${bNum} (${title}) updated: ${amount}.`,
        titleTa: 'குருக்கள் ஊதியம் புதுப்பிக்கப்பட்டது',
        bodyTa: `முன்பதிவு #${bNum} (${title}) பூஜைக்காக குருக்கள் ${priestNameTa} ஊதியம் ${amount} என புதுப்பிக்கப்பட்டது.`,
        priority: 'normal'
      };
    }

    case NOTIFICATION_EVENTS.PAYMENT_UPDATED: {
      const party = payload.party === 'CLIENT' ? 'Client' : 'Priest';
      const partyTa = payload.party === 'CLIENT' ? 'வாடிக்கையாளர்' : 'குருக்கள்';
      const amount = payload.amount !== undefined ? `₹${payload.amount}` : '';
      return {
        titleEn: 'Payment Status Updated',
        bodyEn: `Payment for booking #${bNum} (${title}) has been updated: ${party} payment of ${amount} (${payload.updatedPaymentStatus || 'Updated'}).`,
        titleTa: 'கட்டண விவரம் புதுப்பிக்கப்பட்டது',
        bodyTa: `முன்பதிவு #${bNum} (${title}) கட்டண விவரம் புதுப்பிக்கப்பட்டது: ${partyTa} தொகை ${amount}.`,
        priority: 'normal'
      };
    }

    case NOTIFICATION_EVENTS.ATTENDANCE_ALERT:
      return {
        titleEn: 'Attendance Alert',
        bodyEn: `Staff attendance alert: ${staffName || `Staff #${staffId}`} marked as ${payload.status || 'ABSENT'} for ${dateKey}.`,
        titleTa: 'வருகை விழிப்புணர்வு எச்சரிக்கை',
        bodyTa: `ஊழியர் ${staffNameTa || `#${staffId}`} ${dateKey} அன்று ${payload.status === 'ABSENT' ? 'வராதவராக' : 'விடுப்பில்'} பதிவு செய்யப்பட்டுள்ளார்.`,
        priority: 'high'
      };

    case NOTIFICATION_EVENTS.LEAVE_REQUESTED:
      return {
        titleEn: 'New Leave Request',
        bodyEn: `${staffName || `Staff #${staffId}`} has submitted a ${payload.leaveType || 'leave'} request from ${payload.startDate} to ${payload.endDate}.`,
        titleTa: 'புதிய விடுப்பு விண்ணப்பம்',
        bodyTa: `ஊழியர் ${staffNameTa || `#${staffId}`} ${payload.startDate} முதல் ${payload.endDate} வரை ${payload.leaveType || 'விடுப்பு'} விண்ணப்பித்துள்ளார்.`,
        priority: 'normal'
      };

    case NOTIFICATION_EVENTS.LEAVE_APPROVED:
      return {
        titleEn: 'Leave Request Approved',
        bodyEn: `Your leave request from ${payload.startDate} to ${payload.endDate} has been approved.`,
        titleTa: 'விடுப்பு விண்ணப்பம் ஏற்கப்பட்டது',
        bodyTa: `உங்கள் விடுப்பு விண்ணப்பம் (${payload.startDate} முதல் ${payload.endDate}) நிர்வாகத்தால் ஏற்கப்பட்டது.`,
        priority: 'normal'
      };

    case NOTIFICATION_EVENTS.LEAVE_REJECTED:
      return {
        titleEn: 'Leave Request Rejected',
        bodyEn: `Your leave request from ${payload.startDate} to ${payload.endDate} has been rejected.`,
        titleTa: 'விடுப்பு விண்ணப்பம் நிராகரிக்கப்பட்டது',
        bodyTa: `உங்கள் விடுப்பு விண்ணப்பம் (${payload.startDate} முதல் ${payload.endDate}) நிர்வாகத்தால் நிராகரிக்கப்பட்டது.`,
        priority: 'high'
      };

    case 'BOOKING_24H_REMINDER':
      return {
        titleEn: 'Booking Reminder (24 Hours)',
        bodyEn: clientName
          ? `${clientName}'s ${title} booking is scheduled for tomorrow (${dateKey}) at ${timeSlot}.`
          : `Booking #${bNum} (${title}) is scheduled for tomorrow (${dateKey}) at ${timeSlot}.`,
        titleTa: 'முன்பதிவு நினைவூட்டல் (24 மணி நேரம்)',
        bodyTa: clientName
          ? `${clientName} என்பவரின் ${title} முன்பதிவு நாளை (${dateKey}) ${timeSlot} மணிக்கு தொடங்க உள்ளது.`
          : `முன்பதிவு #${bNum} (${title}) நாளை (${dateKey}) ${timeSlot} மணிக்கு தொடங்க உள்ளது.`,
        priority: 'high'
      };

    case 'BOOKING_1H_REMINDER':
      return {
        titleEn: 'Booking Reminder (1 Hour)',
        bodyEn: clientName
          ? `${clientName}'s ${title} booking begins in 1 hour at ${timeSlot}.`
          : `Booking #${bNum} (${title}) begins in 1 hour at ${timeSlot}.`,
        titleTa: 'முன்பதிவு நினைவூட்டல் (1 மணி நேரம்)',
        bodyTa: clientName
          ? `${clientName} என்பவரின் ${title} முன்பதிவு இன்னும் 1 மணி நேரத்தில் (${timeSlot}) தொடங்க உள்ளது.`
          : `முன்பதிவு #${bNum} (${title}) இன்னும் 1 மணி நேரத்தில் ${timeSlot} மணிக்கு தொடங்க உள்ளது.`,
        priority: 'urgent'
      };

    case 'BOOKING_5M_REMINDER':
      return {
        titleEn: 'Booking Reminder (5 Minutes)',
        bodyEn: clientName
          ? `${clientName}'s ${title} booking begins in 5 minutes at ${timeSlot}. Please be prepared.`
          : `Booking #${bNum} (${title}) begins in 5 minutes at ${timeSlot}. Please be prepared.`,
        titleTa: 'முன்பதிவு நினைவூட்டல் (5 நிமிடங்கள்)',
        bodyTa: clientName
          ? `${clientName} என்பவரின் ${title} முன்பதிவு இன்னும் 5 நிமிடங்களில் (${timeSlot}) தொடங்க உள்ளது. தயாராக இருக்கவும்.`
          : `முன்பதிவு #${bNum} (${title}) இன்னும் 5 நிமிடங்களில் ${timeSlot} மணிக்கு தொடங்க உள்ளது. தயாராக இருக்கவும்.`,
        priority: 'urgent'
      };

    // Generic fallbacks for declared-only constants
    case NOTIFICATION_EVENTS.ATTENDANCE_REMINDER:
      return {
        titleEn: 'Attendance Check Reminder',
        bodyEn: 'Please remember to mark your attendance for today in the Staff Portal.',
        titleTa: 'வருகை பதிவு நினைவூட்டல்',
        bodyTa: 'இன்றைய தினத்திற்கான வருகைப் பதிவை ஊழியர் பக்கத்தில் பதிவு செய்யவும்.',
        priority: 'normal'
      };

    case NOTIFICATION_EVENTS.SYSTEM_ANNOUNCEMENT:
    default:
      return {
        titleEn: payload.title || 'System Announcement',
        bodyEn: payload.message || payload.body || 'New notification received.',
        titleTa: payload.title || 'அறிவிப்பு',
        bodyTa: payload.message || payload.body || 'புதிய அறிவிப்பு வந்துள்ளது.',
        priority: payload.priority || 'normal'
      };
  }
};

/**
 * Process a single claimed outbox event within a single ACID database transaction
 *
 * @param {Object} outboxEvent - Claimed notification_outbox row
 * @param {Object} options
 * @param {string} options.workerLeaseToken
 * @returns {Promise<{ success: boolean, notificationId: number, recipientCount: number, pushJobCount: number }>}
 */
const processSingleOutboxEvent = async (outboxEvent, { workerLeaseToken }) => {
  const payload = typeof outboxEvent.payload === 'string'
    ? JSON.parse(outboxEvent.payload)
    : (outboxEvent.payload || {});

  const content = generateBilingualContent(outboxEvent.event_type, payload);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. In-transaction lease verification & row lock
    const [claimedCheck] = await conn.execute(
      `SELECT id, status, lease_token 
       FROM notification_outbox 
       WHERE id = ? 
         AND lease_token = ? 
         AND status = 'PROCESSING' 
         AND lease_expires_at >= UTC_TIMESTAMP() 
       FOR UPDATE;`,
      [outboxEvent.id, workerLeaseToken]
    );

    if (claimedCheck.length === 0) {
      throw new Error(`Outbox lease expired or reclaimed for event ${outboxEvent.id}`);
    }

    // 2. Insert or retrieve canonical notification record (idempotency_key = event_key)
    let notificationId;
    const [existingNotif] = await conn.execute(
      'SELECT id FROM notifications WHERE idempotency_key = ? LIMIT 1;',
      [outboxEvent.event_key]
    );

    if (existingNotif.length > 0) {
      notificationId = existingNotif[0].id;
    } else {
      const [insertRes] = await conn.execute(
        `INSERT INTO notifications (
          event_type, idempotency_key, title_en, body_en, title_ta, body_ta,
          entity_type, entity_id, data, priority, created_by, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, 1, UTC_TIMESTAMP()
        );`,
        [
          outboxEvent.event_type,
          outboxEvent.event_key,
          content.titleEn,
          content.bodyEn,
          content.titleTa,
          content.bodyTa,
          outboxEvent.entity_type || 'booking',
          String(outboxEvent.entity_id || payload.bookingId || ''),
          JSON.stringify(payload),
          content.priority
        ]
      );
      notificationId = insertRes.insertId;
    }

    // 3. Resolve eligible recipients
    let candidateUserIds = [];
    if (Array.isArray(payload.recipientUserIds) && payload.recipientUserIds.length > 0) {
      candidateUserIds = payload.recipientUserIds;
    } else {
      candidateUserIds = await notificationService.resolveRecipientsForEvent(outboxEvent.event_type, payload);
    }

    const numericIds = candidateUserIds.map(Number).filter((id) => id > 0);
    let activeRecipientIds = [];

    if (numericIds.length > 0) {
      const uPlaceholders = numericIds.map(() => '?').join(',');
      const [validUsers] = await conn.execute(
        `SELECT id FROM users WHERE id IN (${uPlaceholders}) AND status = 'ACTIVE';`,
        numericIds
      );
      activeRecipientIds = validUsers.map((u) => u.id);
    }

    let recipientCount = 0;
    let pushJobCount = 0;

    // 4. Insert notification_recipients and queue push jobs per recipient
    for (const userId of activeRecipientIds) {
      // Query channel preferences (defaulting to enabled if not explicitly configured)
      const [prefRows] = await conn.execute(
        'SELECT push_enabled, in_app_enabled FROM notification_preferences WHERE user_id = ? AND event_type = ? LIMIT 1;',
        [userId, outboxEvent.event_type]
      );

      const inAppEnabled = prefRows.length > 0 ? Boolean(prefRows[0].in_app_enabled) : true;
      const pushEnabled = prefRows.length > 0 ? Boolean(prefRows[0].push_enabled) : true;

      // 4-Combination Channel Preferences Truth Table:
      // Combination 1 (In-App ON + Push ON): in_app_visible = 1, delivery_status = 'PENDING', push job created
      // Combination 2 (In-App ON + Push OFF): in_app_visible = 1, delivery_status = 'SKIPPED', zero push jobs
      // Combination 3 (In-App OFF + Push ON): in_app_visible = 0 (hidden from feed), delivery_status = 'PENDING', push job created
      // Combination 4 (In-App OFF + Push OFF): in_app_visible = 0, delivery_status = 'SKIPPED', zero push jobs
      const inAppVisible = inAppEnabled ? 1 : 0;
      const deliveryStatus = pushEnabled ? 'PENDING' : 'SKIPPED';

      await conn.execute(
        `INSERT INTO notification_recipients (
          notification_id, user_id, delivery_status, in_app_visible, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP()
        ) ON DUPLICATE KEY UPDATE
          in_app_visible = VALUES(in_app_visible),
          delivery_status = IF(delivery_status = 'PENDING', VALUES(delivery_status), delivery_status),
          updated_at = UTC_TIMESTAMP();`,
        [notificationId, userId, deliveryStatus, inAppVisible]
      );
      recipientCount++;

      if (pushEnabled) {
        const pushJobKey = `push_${notificationId}_u${userId}`;
        await conn.execute(
          `INSERT INTO notification_jobs (
            job_type, notification_id, recipient_user_id, entity_type, entity_id,
            schedule_version, scheduled_at, status, attempts, idempotency_key, created_at, updated_at
          ) VALUES (
            'PUSH_DELIVERY', ?, ?, ?, ?,
            1, UTC_TIMESTAMP(), 'PENDING', 0, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP()
          ) ON DUPLICATE KEY UPDATE
            status = IF(status = 'PENDING', VALUES(status), status);`,
          [
            notificationId,
            userId,
            outboxEvent.entity_type || 'booking',
            String(outboxEvent.entity_id || payload.bookingId || ''),
            pushJobKey
          ]
        );
        pushJobCount++;
      }
    }

    // 5. Complete outbox event atomically with lease fencing
    const [completeRes] = await conn.execute(
      `UPDATE notification_outbox
       SET status = 'COMPLETED',
           lease_token = NULL,
           lease_expires_at = NULL,
           processed_at = UTC_TIMESTAMP(),
           updated_at = UTC_TIMESTAMP(),
           last_error = NULL
       WHERE id = ? 
         AND lease_token = ? 
         AND status = 'PROCESSING';`,
      [outboxEvent.id, workerLeaseToken]
    );

    if (completeRes.affectedRows !== 1) {
      throw new Error(`Outbox fencing violation on completion for event ${outboxEvent.id}`);
    }

    await conn.commit();
    return {
      success: true,
      notificationId,
      recipientCount,
      pushJobCount
    };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    // Safely fail outbox event with backoff outside transaction
    await outboxModel.failOutboxEvent({
      eventId: outboxEvent.id,
      workerLeaseToken,
      errorMessage: err.message
    });
    throw err;
  } finally {
    conn.release();
  }
};

/**
 * Process a batch of pending outbox events
 *
 * @param {Object} [options={}]
 * @param {string} [options.workerLeaseToken]
 * @param {number} [options.batchSize=25]
 * @param {Function} [options.isTimeBudgetAvailable]
 * @returns {Promise<{ processedCount: number, claimedCount: number, results: Array<Object> }>}
 */
const processOutboxQueue = async ({
  workerLeaseToken = crypto.randomUUID(),
  batchSize = 25,
  isTimeBudgetAvailable = () => true
} = {}) => {
  if (!isTimeBudgetAvailable()) {
    return { processedCount: 0, claimedCount: 0, results: [] };
  }

  const claimedEvents = await outboxModel.claimOutboxBatch({
    workerLeaseToken,
    batchSize
  });

  const results = [];

  for (const event of claimedEvents) {
    if (!isTimeBudgetAvailable()) {
      break;
    }

    try {
      const outcome = await processSingleOutboxEvent(event, { workerLeaseToken });
      results.push({ eventId: event.id, status: 'COMPLETED', ...outcome });
    } catch (err) {
      results.push({ eventId: event.id, status: 'FAILED', error: err.message });
    }
  }

  return {
    processedCount: results.length,
    claimedCount: claimedEvents.length,
    results
  };
};

module.exports = {
  generateBilingualContent,
  processSingleOutboxEvent,
  processOutboxQueue
};
