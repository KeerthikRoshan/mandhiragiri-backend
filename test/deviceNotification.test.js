const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { maskToken } = require('../src/services/notificationService');
const {
  validateRegisterDevice,
  validateUpdateToken,
  validateUnregisterDevice,
  validateTestNotification
} = require('../src/validators/deviceValidator');

describe('Device Registration & FCM Push Notification Tests', () => {
  describe('maskToken utility', () => {
    it('returns [empty] for null or undefined tokens', () => {
      assert.equal(maskToken(null), '[empty]');
      assert.equal(maskToken(undefined), '[empty]');
      assert.equal(maskToken(''), '[empty]');
    });

    it('returns *** for short tokens <= 10 characters', () => {
      assert.equal(maskToken('12345'), '***');
    });

    it('correctly masks long FCM tokens', () => {
      const sampleToken = 'c_X7890abcdef1234567890abcdef1234567890abcdef_xyz99';
      const masked = maskToken(sampleToken);
      assert.equal(masked.startsWith('c_X789'), true);
      assert.equal(masked.endsWith('yz99'), true);
      assert.equal(masked.includes('...'), true);
      assert.notEqual(masked, sampleToken);
    });
  });

  describe('Device Validators', () => {
    const runValidator = async (validatorMiddleware, body) => {
      const req = { body };
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

    it('validateRegisterDevice rejects empty fcmToken', async () => {
      const result = await runValidator(validateRegisterDevice, {
        platform: 'android'
      });
      assert.equal(result.nextCalled, false);
      assert.equal(result.responseStatusCode, 400);
      assert.ok(result.responseBody.errors.fcmToken);
    });

    it('validateRegisterDevice rejects invalid platform', async () => {
      const result = await runValidator(validateRegisterDevice, {
        fcmToken: 'valid_length_fcm_token_1234567890',
        platform: 'windows_phone'
      });
      assert.equal(result.nextCalled, false);
      assert.equal(result.responseStatusCode, 400);
      assert.ok(result.responseBody.errors.platform);
    });

    it('validateRegisterDevice passes with valid parameters', async () => {
      const result = await runValidator(validateRegisterDevice, {
        fcmToken: 'valid_length_fcm_token_1234567890_abcdef',
        platform: 'android',
        deviceId: 'device-test-123',
        appVersion: '0.0.1'
      });
      assert.equal(result.nextCalled, true);
    });

    it('validateUpdateToken rejects empty token', async () => {
      const result = await runValidator(validateUpdateToken, {});
      assert.equal(result.nextCalled, false);
      assert.equal(result.responseStatusCode, 400);
    });

    it('validateUnregisterDevice rejects when neither fcmToken nor deviceId is given', async () => {
      const result = await runValidator(validateUnregisterDevice, {});
      assert.equal(result.nextCalled, false);
      assert.equal(result.responseStatusCode, 400);
    });

    it('validateUnregisterDevice passes with fcmToken only', async () => {
      const result = await runValidator(validateUnregisterDevice, {
        fcmToken: 'valid_length_fcm_token_1234567890'
      });
      assert.equal(result.nextCalled, true);
    });

    it('validateUnregisterDevice passes with deviceId only', async () => {
      const result = await runValidator(validateUnregisterDevice, {
        deviceId: 'dev_unique_999'
      });
      assert.equal(result.nextCalled, true);
    });
  });
});
