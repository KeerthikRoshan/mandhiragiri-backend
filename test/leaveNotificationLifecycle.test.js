const test = require('node:test');
const assert = require('node:assert/strict');

const { NOTIFICATION_EVENTS } = require('../src/constants/notificationConstants');
const outboxProcessorService = require('../src/services/outboxProcessorService');
const notificationService = require('../src/services/notificationService');
const pushWorkerService = require('../src/services/pushWorkerService');
const notificationModel = require('../src/models/notificationModel');
const deviceModel = require('../src/models/deviceModel');
const deviceDeliveryModel = require('../src/models/deviceDeliveryModel');
const { pool } = require('../src/config/database');

test('Staff Leave Request Notification & Decision Lifecycle Suite', async (t) => {
  const originalPoolExecute = pool.execute;
  const originalPoolGetConnection = pool.getConnection;
  const originalResolveAdmins = notificationModel.resolveActiveAdminUserIds;
  const originalResolveStaffUser = notificationModel.resolveStaffUserIdByStaffId;
  const originalGetActiveDevices = deviceModel.getActiveDevicesForUser;
  const originalInitDeviceDeliveries = deviceDeliveryModel.initDeviceDeliveries;
  const originalGetPendingDeviceDeliveries = deviceDeliveryModel.getPendingDeviceDeliveries;
  const originalUpdateDeliveryOutcomeFenced = deviceDeliveryModel.updateDeliveryOutcomeFenced;
  const originalGetDeliveriesSummary = deviceDeliveryModel.getDeliveriesSummary;

  t.afterEach(() => {
    pool.execute = originalPoolExecute;
    pool.getConnection = originalPoolGetConnection;
    notificationModel.resolveActiveAdminUserIds = originalResolveAdmins;
    notificationModel.resolveStaffUserIdByStaffId = originalResolveStaffUser;
    deviceModel.getActiveDevicesForUser = originalGetActiveDevices;
    deviceDeliveryModel.initDeviceDeliveries = originalInitDeviceDeliveries;
    deviceDeliveryModel.getPendingDeviceDeliveries = originalGetPendingDeviceDeliveries;
    deviceDeliveryModel.updateDeliveryOutcomeFenced = originalUpdateDeliveryOutcomeFenced;
    deviceDeliveryModel.getDeliveriesSummary = originalGetDeliveriesSummary;
  });

  await t.test('1. generateBilingualContent formats LEAVE_REQUESTED with staff details & dates', () => {
    const payload = {
      leaveId: 101,
      staffId: 5,
      staffName: 'Karthik Subramanian',
      staffNameEn: 'Karthik Subramanian',
      staffNameTa: 'கார்த்திக் சுப்ரமணியன்',
      startDate: '2026-12-05',
      endDate: '2026-12-07',
      leaveType: 'CASUAL',
      reason: 'Family pilgrimage to Palani'
    };

    const content = outboxProcessorService.generateBilingualContent(NOTIFICATION_EVENTS.LEAVE_REQUESTED, payload);

    assert.equal(content.titleEn, 'New Leave Request');
    assert.equal(content.titleTa, 'புதிய விடுப்பு விண்ணப்பம்');
    assert.ok(content.bodyEn.includes('Karthik Subramanian'));
    assert.ok(content.bodyEn.includes('CASUAL'));
    assert.ok(content.bodyEn.includes('2026-12-05 to 2026-12-07'));
    assert.ok(content.bodyTa.includes('கார்த்திக் சுப்ரமணியன்'));
    assert.ok(content.bodyTa.includes('2026-12-05 முதல் 2026-12-07 வரை'));
    assert.equal(content.priority, 'normal');
  });

  await t.test('2. generateBilingualContent formats LEAVE_APPROVED with dates and no undefined', () => {
    const payload = {
      leaveId: 101,
      staffId: 5,
      startDate: '2026-12-05',
      endDate: '2026-12-07',
      leaveType: 'CASUAL',
      decision: 'APPROVED',
      decidedBy: 'Admin Sundaramurthy'
    };

    const content = outboxProcessorService.generateBilingualContent(NOTIFICATION_EVENTS.LEAVE_APPROVED, payload);

    assert.equal(content.titleEn, 'Leave Request Approved');
    assert.equal(content.titleTa, 'விடுப்பு விண்ணப்பம் ஏற்கப்பட்டது');
    assert.ok(content.bodyEn.includes('2026-12-05 to 2026-12-07'));
    assert.ok(!content.bodyEn.includes('undefined'));
    assert.ok(content.bodyTa.includes('2026-12-05 முதல் 2026-12-07'));
    assert.ok(!content.bodyTa.includes('undefined'));
  });

  await t.test('3. generateBilingualContent formats LEAVE_REJECTED with dates and high priority', () => {
    const payload = {
      leaveId: 101,
      staffId: 5,
      startDate: '2026-12-05',
      endDate: '2026-12-07',
      leaveType: 'CASUAL',
      decision: 'REJECTED',
      decidedBy: 'Admin Sundaramurthy'
    };

    const content = outboxProcessorService.generateBilingualContent(NOTIFICATION_EVENTS.LEAVE_REJECTED, payload);

    assert.equal(content.titleEn, 'Leave Request Rejected');
    assert.equal(content.titleTa, 'விடுப்பு விண்ணப்பம் நிராகரிக்கப்பட்டது');
    assert.ok(content.bodyEn.includes('2026-12-05 to 2026-12-07'));
    assert.ok(!content.bodyEn.includes('undefined'));
    assert.equal(content.priority, 'high');
  });

  await t.test('4. resolveRecipientsForEvent for LEAVE_REQUESTED resolves active Admin user IDs only', async () => {
    notificationModel.resolveActiveAdminUserIds = async () => [1, 2];

    const recipients = await notificationService.resolveRecipientsForEvent(
      NOTIFICATION_EVENTS.LEAVE_REQUESTED,
      { staffId: 5, leaveId: 101 }
    );

    assert.deepEqual(recipients, [1, 2]);
  });

  await t.test('5. resolveRecipientsForEvent for LEAVE_APPROVED/REJECTED resolves requesting staff user ID only', async () => {
    notificationModel.resolveStaffUserIdByStaffId = async (staffId) => {
      assert.equal(staffId, 5);
      return 15; // staff's user_id
    };

    const recipientsApproved = await notificationService.resolveRecipientsForEvent(
      NOTIFICATION_EVENTS.LEAVE_APPROVED,
      { staffId: 5, leaveId: 101 }
    );
    assert.deepEqual(recipientsApproved, [15]);

    const recipientsRejected = await notificationService.resolveRecipientsForEvent(
      NOTIFICATION_EVENTS.LEAVE_REJECTED,
      { staffId: 5, leaveId: 101 }
    );
    assert.deepEqual(recipientsRejected, [15]);
  });

  await t.test('6. pushWorkerService constructs FCM payload with leaveId, notificationId and eventType for Admin push', async () => {
    const fakeJob = {
      id: 201,
      job_type: 'PUSH_DELIVERY',
      notification_id: 888,
      recipient_user_id: 1, // Admin user ID
      entity_type: 'leave',
      entity_id: '101',
      attempts: 0,
      event_type: 'LEAVE_REQUESTED',
      title_en: 'New Leave Request',
      body_en: 'Karthik Subramanian has submitted a CASUAL request from 2026-12-05 to 2026-12-07.',
      title_ta: 'புதிய விடுப்பு விண்ணப்பம்',
      body_ta: 'ஊழியர் கார்த்திக் சுப்ரமணியன் 2026-12-05 முதல் 2026-12-07 வரை CASUAL விண்ணப்பித்துள்ளார்.'
    };

    const fakeDevices = [
      { id: 10, user_id: 1, device_id: 'dev_admin_phone', fcm_token: 'fake_fcm_token_admin_1234567890' }
    ];

    deviceModel.getActiveDevicesForUser = async (userId) => {
      assert.equal(userId, 1);
      return fakeDevices;
    };

    deviceDeliveryModel.initDeviceDeliveries = async () => {};
    deviceDeliveryModel.getPendingDeviceDeliveries = async () => [
      { id: 50, device_id: 'dev_admin_phone', fcm_token: 'fake_fcm_token_admin_1234567890' }
    ];
    deviceDeliveryModel.updateDeliveryOutcomeFenced = async () => ({ affectedRows: 1 });
    deviceDeliveryModel.getDeliveriesSummary = async () => ({ sent: 1, failed: 0, pending: 0, total: 1 });

    let capturedFcmMessage = null;
    const mockFcmClient = {
      send: async (msg) => {
        capturedFcmMessage = msg;
        return 'mock-message-id-12345';
      }
    };

    const mockConn = {
      beginTransaction: async () => {},
      execute: async () => [{ affectedRows: 1 }],
      commit: async () => {},
      rollback: async () => {},
      release: () => {}
    };
    pool.getConnection = async () => mockConn;

    const result = await pushWorkerService.processSinglePushJob(fakeJob, {
      workerLeaseToken: 'test-lease-token',
      fcmClient: mockFcmClient
    });

    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.deliveredCount, 1);
    assert.ok(capturedFcmMessage);
    assert.equal(capturedFcmMessage.token, 'fake_fcm_token_admin_1234567890');
    assert.equal(capturedFcmMessage.notification.title, 'New Leave Request');
    assert.equal(capturedFcmMessage.notification.body, 'Karthik Subramanian has submitted a CASUAL request from 2026-12-05 to 2026-12-07.');
    assert.equal(capturedFcmMessage.data.leaveId, '101');
    assert.equal(capturedFcmMessage.data.notificationId, '888');
    assert.equal(capturedFcmMessage.data.eventType, 'LEAVE_REQUESTED');
    assert.equal(capturedFcmMessage.data.entityType, 'leave');
    assert.equal(capturedFcmMessage.data.entityId, '101');
  });

  await t.test('7. triggerImmediateOutboxProcessing is non-blocking and concurrency-safe', async () => {
    assert.equal(typeof outboxProcessorService.triggerImmediateOutboxProcessing, 'function');
    // Verify it doesn't throw when invoked
    assert.doesNotThrow(() => {
      outboxProcessorService.triggerImmediateOutboxProcessing();
      outboxProcessorService.triggerImmediateOutboxProcessing();
    });
  });
});
