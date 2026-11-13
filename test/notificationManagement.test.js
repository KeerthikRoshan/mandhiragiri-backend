const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const firebase = require('../src/config/firebase');
const {
  NOTIFICATION_EVENTS,
  ALL_EVENT_TYPES,
  ENTITY_TYPES,
  DELIVERY_STATUS,
  JOB_STATUS,
  JOB_TYPES,
  PRIORITIES,
  generateEventIdempotencyKey
} = require('../src/constants/notificationConstants');
const {
  validateListNotifications,
  validateNotificationId,
  validateUpdatePreferences
} = require('../src/validators/notificationValidator');
const notificationService = require('../src/services/notificationService');
const notificationModel = require('../src/models/notificationModel');
const deviceModel = require('../src/models/deviceModel');

describe('Notification Management System Tests (Phase 2)', () => {
  describe('Constants and Idempotency Key Generator', () => {
    it('normalizes SQL and Date timestamps to strict UTC ISO 8601 strings', () => {
      const sqlTime = '2026-11-13 17:35:10';
      const iso = notificationModel.toUtcIso(sqlTime);
      assert.equal(iso, '2026-11-13T17:35:10.000Z');

      const alreadyIso = '2026-11-13T17:35:10.000Z';
      assert.equal(notificationModel.toUtcIso(alreadyIso), '2026-11-13T17:35:10.000Z');

      const dateObj = new Date('2026-11-13T17:35:10.000Z');
      assert.equal(notificationModel.toUtcIso(dateObj), '2026-11-13T17:35:10.000Z');

      assert.equal(notificationModel.toUtcIso(null), null);
      assert.equal(notificationModel.toUtcIso(undefined), null);
    });

    it('contains all core event types', () => {
      assert.equal(ALL_EVENT_TYPES.length, 13);
      assert.ok(ALL_EVENT_TYPES.includes('BOOKING_CREATED'));
      assert.ok(ALL_EVENT_TYPES.includes('BOOKING_ASSIGNED'));
      assert.ok(ALL_EVENT_TYPES.includes('BOOKING_RESCHEDULED'));
      assert.ok(ALL_EVENT_TYPES.includes('BOOKING_CANCELLED'));
      assert.ok(ALL_EVENT_TYPES.includes('BOOKING_REMINDER'));
      assert.ok(ALL_EVENT_TYPES.includes('BOOKING_COMPLETED'));
      assert.ok(ALL_EVENT_TYPES.includes('LEAVE_REQUESTED'));
      assert.ok(ALL_EVENT_TYPES.includes('LEAVE_APPROVED'));
      assert.ok(ALL_EVENT_TYPES.includes('LEAVE_REJECTED'));
      assert.ok(ALL_EVENT_TYPES.includes('ATTENDANCE_REMINDER'));
      assert.ok(ALL_EVENT_TYPES.includes('ATTENDANCE_ALERT'));
      assert.ok(ALL_EVENT_TYPES.includes('PAYMENT_UPDATED'));
      assert.ok(ALL_EVENT_TYPES.includes('SYSTEM_ANNOUNCEMENT'));
    });

    it('generates idempotency key without qualifier', () => {
      const key = generateEventIdempotencyKey(
        NOTIFICATION_EVENTS.BOOKING_CREATED,
        ENTITY_TYPES.BOOKING,
        105
      );
      assert.equal(key, 'booking_created_booking_105');
    });

    it('generates idempotency key with qualifier', () => {
      const key = generateEventIdempotencyKey(
        NOTIFICATION_EVENTS.BOOKING_ASSIGNED,
        ENTITY_TYPES.BOOKING,
        105,
        'priest_12'
      );
      assert.equal(key, 'booking_assigned_booking_105_priest_12');
    });

    it('trims qualifier and converts event name to lowercase', () => {
      const key = generateEventIdempotencyKey('PAYMENT_UPDATED', 'payment', 99, '  status_paid  ');
      assert.equal(key, 'payment_updated_payment_99_status_paid');
    });
  });

  describe('Notification Validators', () => {
    const runValidator = async (validatorMiddleware, { query = {}, params = {}, body = {} } = {}) => {
      const req = { query, params, body };
      let responseStatusCode = null;
      let responseBody = null;
      const res = {
        status: (code) => {
          responseStatusCode = code;
          return {
            json: (payload) => {
              responseBody = payload;
              return payload;
            }
          };
        }
      };
      let nextCalled = false;
      const next = (err) => {
        if (!err) nextCalled = true;
      };

      await validatorMiddleware(req, res, next);
      return { nextCalled, responseStatusCode, responseBody };
    };

    it('validateListNotifications rejects negative page', async () => {
      const result = await runValidator(validateListNotifications, {
        query: { page: '-1' }
      });
      assert.equal(result.nextCalled, false);
      assert.equal(result.responseStatusCode, 400);
      assert.ok(result.responseBody.errors.page);
    });

    it('validateListNotifications rejects limit over 50', async () => {
      const result = await runValidator(validateListNotifications, {
        query: { limit: '100' }
      });
      assert.equal(result.nextCalled, false);
      assert.equal(result.responseStatusCode, 400);
      assert.ok(result.responseBody.errors.limit);
    });

    it('validateListNotifications rejects invalid eventType', async () => {
      const result = await runValidator(validateListNotifications, {
        query: { eventType: 'INVALID_EVENT_NAME' }
      });
      assert.equal(result.nextCalled, false);
      assert.equal(result.responseStatusCode, 400);
      assert.ok(result.responseBody.errors.eventType);
    });

    it('validateListNotifications passes with valid filters', async () => {
      const result = await runValidator(validateListNotifications, {
        query: {
          page: '1',
          limit: '20',
          unreadOnly: 'true',
          eventType: 'BOOKING_CREATED',
          startDate: '2026-11-01',
          endDate: '2026-11-30'
        }
      });
      assert.equal(result.nextCalled, true);
    });

    it('validateNotificationId rejects non-numeric or zero id', async () => {
      const result1 = await runValidator(validateNotificationId, { params: { id: 'abc' } });
      assert.equal(result1.nextCalled, false);
      assert.equal(result1.responseStatusCode, 400);

      const result2 = await runValidator(validateNotificationId, { params: { id: '0' } });
      assert.equal(result2.nextCalled, false);
      assert.equal(result2.responseStatusCode, 400);
    });

    it('validateNotificationId passes with valid numeric id', async () => {
      const result = await runValidator(validateNotificationId, { params: { id: '123' } });
      assert.equal(result.nextCalled, true);
    });

    it('validateUpdatePreferences rejects empty or non-array preferences', async () => {
      const result1 = await runValidator(validateUpdatePreferences, { body: { preferences: [] } });
      assert.equal(result1.nextCalled, false);
      assert.equal(result1.responseStatusCode, 400);

      const result2 = await runValidator(validateUpdatePreferences, { body: { preferences: 'invalid' } });
      assert.equal(result2.nextCalled, false);
      assert.equal(result2.responseStatusCode, 400);
    });

    it('validateUpdatePreferences rejects invalid preference item eventType', async () => {
      const result = await runValidator(validateUpdatePreferences, {
        body: {
          preferences: [{ eventType: 'NOT_REAL', pushEnabled: true }]
        }
      });
      assert.equal(result.nextCalled, false);
      assert.equal(result.responseStatusCode, 400);
    });

    it('validateUpdatePreferences passes with valid preference payload', async () => {
      const result = await runValidator(validateUpdatePreferences, {
        body: {
          preferences: [
            { eventType: 'BOOKING_CREATED', pushEnabled: true, inAppEnabled: true },
            { eventType: 'BOOKING_ASSIGNED', pushEnabled: false, inAppEnabled: true }
          ]
        }
      });
      assert.equal(result.nextCalled, true);
    });
  });

  describe('resolveRecipientsForEvent Logic', () => {
    const origResolveAdmins = notificationModel.resolveActiveAdminUserIds;
    const origResolvePriest = notificationModel.resolveBookingAssignedStaffUserId;
    const origResolveStaff = notificationModel.resolveStaffUserIdByStaffId;
    const origResolveAllStaff = notificationModel.resolveAllActiveStaffUserIds;

    const restoreMocks = () => {
      notificationModel.resolveActiveAdminUserIds = origResolveAdmins;
      notificationModel.resolveBookingAssignedStaffUserId = origResolvePriest;
      notificationModel.resolveStaffUserIdByStaffId = origResolveStaff;
      notificationModel.resolveAllActiveStaffUserIds = origResolveAllStaff;
    };

    it('respects targetUserIds override directly', async () => {
      const recipients = await notificationService.resolveRecipientsForEvent(
        NOTIFICATION_EVENTS.BOOKING_CREATED,
        { targetUserIds: [10, '20', 10, '30'] }
      );
      assert.deepEqual(recipients.sort((a, b) => a - b), [10, 20, 30]);
    });

    it('BOOKING_CREATED notifies only active Administrators', async () => {
      notificationModel.resolveActiveAdminUserIds = async () => [1, 2];
      try {
        const recipients = await notificationService.resolveRecipientsForEvent(
          NOTIFICATION_EVENTS.BOOKING_CREATED
        );
        assert.deepEqual(recipients.sort(), [1, 2]);
      } finally {
        restoreMocks();
      }
    });

    it('BOOKING_ASSIGNED notifies Admins and assigned Priest/Assistant', async () => {
      notificationModel.resolveActiveAdminUserIds = async () => [1, 2];
      notificationModel.resolveBookingAssignedStaffUserId = async (priestId) => {
        return priestId === 5 ? 15 : null;
      };

      try {
        const recipients = await notificationService.resolveRecipientsForEvent(
          NOTIFICATION_EVENTS.BOOKING_ASSIGNED,
          { priestId: 5 }
        );
        assert.deepEqual(recipients.sort((a, b) => a - b), [1, 2, 15]);
      } finally {
        restoreMocks();
      }
    });

    it('BOOKING_COMPLETED and BOOKING_UPDATED notify Admins and assigned Priest', async () => {
      notificationModel.resolveActiveAdminUserIds = async () => [1, 2];
      notificationModel.resolveBookingAssignedStaffUserId = async (priestId) => {
        return priestId === 5 ? 15 : null;
      };

      try {
        const completedRecipients = await notificationService.resolveRecipientsForEvent(
          NOTIFICATION_EVENTS.BOOKING_COMPLETED,
          { priestId: 5 }
        );
        assert.deepEqual(completedRecipients.sort((a, b) => a - b), [1, 2, 15]);

        const updatedRecipients = await notificationService.resolveRecipientsForEvent(
          'BOOKING_UPDATED',
          { priestId: 5 }
        );
        assert.deepEqual(updatedRecipients.sort((a, b) => a - b), [1, 2, 15]);
      } finally {
        restoreMocks();
      }
    });

    it('Time-based reminders (24H, 1H, 5M) notify Admins and assigned Priest', async () => {
      notificationModel.resolveActiveAdminUserIds = async () => [1, 2];
      notificationModel.resolveBookingAssignedStaffUserId = async (priestId) => {
        return priestId === 9 ? 29 : null;
      };

      try {
        for (const remEvent of ['BOOKING_24H_REMINDER', 'BOOKING_1H_REMINDER', 'BOOKING_5M_REMINDER']) {
          const recs = await notificationService.resolveRecipientsForEvent(remEvent, { priestId: 9 });
          assert.deepEqual(recs.sort((a, b) => a - b), [1, 2, 29]);
        }
      } finally {
        restoreMocks();
      }
    });

    it('Payment events: CLIENT advances notify Admins ONLY; PRIEST remuneration notifies Admins + Priest', async () => {
      notificationModel.resolveActiveAdminUserIds = async () => [1, 2];
      notificationModel.resolveBookingAssignedStaffUserId = async (priestId) => {
        return priestId === 9 ? 29 : null;
      };

      try {
        // Client advance / payment update: Admin only
        const clientAdvanceRecs = await notificationService.resolveRecipientsForEvent(
          'CLIENT_ADVANCE_RECEIVED',
          { priestId: 9, customerPhone: '9876543210' }
        );
        assert.deepEqual(clientAdvanceRecs.sort((a, b) => a - b), [1, 2]);

        const clientPaymentRecs = await notificationService.resolveRecipientsForEvent(
          'CLIENT_PAYMENT_UPDATED',
          { priestId: 9 }
        );
        assert.deepEqual(clientPaymentRecs.sort((a, b) => a - b), [1, 2]);

        // Priest advance / remuneration: Admins + Priest
        const priestAdvanceRecs = await notificationService.resolveRecipientsForEvent(
          'PRIEST_ADVANCE_PAID',
          { priestId: 9, party: 'PRIEST' }
        );
        assert.deepEqual(priestAdvanceRecs.sort((a, b) => a - b), [1, 2, 29]);

        const priestRemunRecs = await notificationService.resolveRecipientsForEvent(
          'PRIEST_REMUNERATION_UPDATED',
          { priestId: 9, party: 'PRIEST' }
        );
        assert.deepEqual(priestRemunRecs.sort((a, b) => a - b), [1, 2, 29]);
      } finally {
        restoreMocks();
      }
    });

    it('BOOKING_REMINDER notifies assigned Priest or Admins if unassigned', async () => {
      notificationModel.resolveActiveAdminUserIds = async () => [1, 2];
      notificationModel.resolveBookingAssignedStaffUserId = async (priestId) => {
        return priestId === 9 ? 29 : null;
      };

      try {
        const assignedRecipients = await notificationService.resolveRecipientsForEvent(
          NOTIFICATION_EVENTS.BOOKING_REMINDER,
          { priestId: 9 }
        );
        assert.deepEqual(assignedRecipients, [29]);

        const unassignedRecipients = await notificationService.resolveRecipientsForEvent(
          NOTIFICATION_EVENTS.BOOKING_REMINDER,
          { priestId: null }
        );
        assert.deepEqual(unassignedRecipients.sort(), [1, 2]);
      } finally {
        restoreMocks();
      }
    });

    it('LEAVE_APPROVED notifies only the specific Staff member', async () => {
      notificationModel.resolveStaffUserIdByStaffId = async (staffId) => {
        return staffId === 88 ? 44 : null;
      };

      try {
        const recipients = await notificationService.resolveRecipientsForEvent(
          NOTIFICATION_EVENTS.LEAVE_APPROVED,
          { staffId: 88 }
        );
        assert.deepEqual(recipients, [44]);
      } finally {
        restoreMocks();
      }
    });

    it('ATTENDANCE_REMINDER notifies all active Staff', async () => {
      notificationModel.resolveAllActiveStaffUserIds = async () => [10, 11, 12];

      try {
        const recipients = await notificationService.resolveRecipientsForEvent(
          NOTIFICATION_EVENTS.ATTENDANCE_REMINDER
        );
        assert.deepEqual(recipients.sort(), [10, 11, 12]);
      } finally {
        restoreMocks();
      }
    });

    it('SYSTEM_ANNOUNCEMENT notifies both Admins and all Staff without duplication', async () => {
      notificationModel.resolveActiveAdminUserIds = async () => [1, 2];
      notificationModel.resolveAllActiveStaffUserIds = async () => [2, 3, 4];

      try {
        const recipients = await notificationService.resolveRecipientsForEvent(
          NOTIFICATION_EVENTS.SYSTEM_ANNOUNCEMENT
        );
        assert.deepEqual(recipients.sort((a, b) => a - b), [1, 2, 3, 4]);
      } finally {
        restoreMocks();
      }
    });
  });

  describe('Durable Push Delivery Job Processing & Multi-Device Aggregation', () => {
    const origClaim = notificationModel.claimDeliveryJob;
    const origComplete = notificationModel.completeDeliveryJob;
    const origGetActiveDevices = deviceModel.getActiveDevicesForUser;
    const origDeactivateToken = deviceModel.deactivateStaleToken;
    const origMessagingSend = firebase.messaging.send;

    const restoreAll = () => {
      notificationModel.claimDeliveryJob = origClaim;
      notificationModel.completeDeliveryJob = origComplete;
      deviceModel.getActiveDevicesForUser = origGetActiveDevices;
      deviceModel.deactivateStaleToken = origDeactivateToken;
      firebase.messaging.send = origMessagingSend;
    };

    it('returns CLAIM_FAILED if atomic lease claim is unsuccessful', async () => {
      notificationModel.claimDeliveryJob = async () => false;

      try {
        const result = await notificationService.processPushDeliveryJob({
          id: 101,
          notification_id: 50,
          recipient_user_id: 5
        });
        assert.equal(result.success, false);
        assert.equal(result.deliveryStatus, 'CLAIM_FAILED');
      } finally {
        restoreAll();
      }
    });

    it('marks SKIPPED when user has no active registered devices', async () => {
      notificationModel.claimDeliveryJob = async () => true;
      deviceModel.getActiveDevicesForUser = async () => [];

      let completedPayload = null;
      notificationModel.completeDeliveryJob = async (payload) => {
        completedPayload = payload;
      };

      try {
        const result = await notificationService.processPushDeliveryJob({
          id: 102,
          notification_id: 51,
          recipient_user_id: 7
        });

        assert.equal(result.success, false);
        assert.equal(result.deliveryStatus, 'SKIPPED');
        assert.ok(completedPayload);
        assert.equal(completedPayload.isSkipped, true);
      } finally {
        restoreAll();
      }
    });

    it('aggregates multi-device push: marked SENT if at least one device succeeds', async () => {
      notificationModel.claimDeliveryJob = async () => true;
      deviceModel.getActiveDevicesForUser = async () => [
        { fcm_token: 'token_device_1_success' },
        { fcm_token: 'token_device_2_failure' }
      ];

      firebase.messaging.send = async (message) => {
        if (message.token === 'token_device_2_failure') {
          const err = new Error('Network timeout');
          err.code = 'messaging/server-unavailable';
          throw err;
        }
        return 'projects/mandhiragiri-jothidam/messages/msg_123';
      };

      let completedPayload = null;
      notificationModel.completeDeliveryJob = async (payload) => {
        completedPayload = payload;
      };

      try {
        const result = await notificationService.processPushDeliveryJob({
          id: 103,
          notification_id: 52,
          recipient_user_id: 9,
          attempts: 1
        });

        assert.equal(result.success, true);
        assert.equal(result.deliveryStatus, 'SENT');
        assert.ok(completedPayload);
        assert.equal(completedPayload.success, true);
        assert.ok(completedPayload.error.includes('Network timeout'));
      } finally {
        restoreAll();
      }
    });

    it('flags permanent error and deactivates token when all devices fail with registration-token-not-registered', async () => {
      notificationModel.claimDeliveryJob = async () => true;
      deviceModel.getActiveDevicesForUser = async () => [
        { fcm_token: 'stale_token_1' },
        { fcm_token: 'stale_token_2' }
      ];

      const deactivatedTokens = [];
      deviceModel.deactivateStaleToken = async (token) => {
        deactivatedTokens.push(token);
      };

      firebase.messaging.send = async () => {
        const err = new Error('Token expired');
        err.code = 'messaging/registration-token-not-registered';
        throw err;
      };

      let completedPayload = null;
      notificationModel.completeDeliveryJob = async (payload) => {
        completedPayload = payload;
      };

      try {
        const result = await notificationService.processPushDeliveryJob({
          id: 104,
          notification_id: 53,
          recipient_user_id: 11,
          attempts: 1
        });

        assert.equal(result.success, false);
        assert.equal(result.deliveryStatus, 'FAILED');
        assert.ok(completedPayload);
        assert.equal(completedPayload.success, false);
        assert.equal(completedPayload.isPermanentError, true);
        assert.deepEqual(deactivatedTokens, ['stale_token_1', 'stale_token_2']);
      } finally {
        restoreAll();
      }
    });
  });

  describe('createNotificationEvent Integration & Channel Preferences', () => {
    const origResolveAdmins = notificationModel.resolveActiveAdminUserIds;
    const origGetPreferences = notificationModel.getUserPreferences;
    const origCreateTransaction = notificationModel.createNotificationTransaction;

    const restoreAll = () => {
      notificationModel.resolveActiveAdminUserIds = origResolveAdmins;
      notificationModel.getUserPreferences = origGetPreferences;
      notificationModel.createNotificationTransaction = origCreateTransaction;
    };

    it('skips notification when no recipients resolve', async () => {
      notificationModel.resolveActiveAdminUserIds = async () => [];

      try {
        const result = await notificationService.createNotificationEvent({
          eventType: NOTIFICATION_EVENTS.BOOKING_CREATED,
          titleEn: 'Test',
          bodyEn: 'Test'
        });

        assert.equal(result.isSkipped, true);
        assert.equal(result.recipientCount, 0);
        assert.equal(result.notification, null);
      } finally {
        restoreAll();
      }
    });

    it('skips notification when all recipients have disabled both push and inApp channels', async () => {
      notificationModel.resolveActiveAdminUserIds = async () => [5];
      notificationModel.getUserPreferences = async () => [
        {
          eventType: NOTIFICATION_EVENTS.BOOKING_CREATED,
          pushEnabled: false,
          inAppEnabled: false
        }
      ];

      try {
        const result = await notificationService.createNotificationEvent({
          eventType: NOTIFICATION_EVENTS.BOOKING_CREATED,
          titleEn: 'Test',
          bodyEn: 'Test'
        });

        assert.equal(result.isSkipped, true);
        assert.equal(result.recipientCount, 0);
      } finally {
        restoreAll();
      }
    });

    it('returns existing duplicate without creating new notification if idempotencyKey matches', async () => {
      notificationModel.resolveActiveAdminUserIds = async () => [1];
      notificationModel.getUserPreferences = async () => [];
      notificationModel.createNotificationTransaction = async () => ({
        notification: { id: 77, idempotency_key: 'booking_created_booking_100' },
        recipientCount: 0,
        jobCount: 0,
        isDuplicate: true
      });

      try {
        const result = await notificationService.createNotificationEvent({
          eventType: NOTIFICATION_EVENTS.BOOKING_CREATED,
          idempotencyKey: 'booking_created_booking_100',
          titleEn: 'Booking Created',
          bodyEn: 'Body'
        });

        assert.equal(result.isDuplicate, true);
        assert.equal(result.notification.id, 77);
      } finally {
        restoreAll();
      }
    });
  });
});
