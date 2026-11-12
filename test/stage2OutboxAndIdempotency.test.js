const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/database');
const outboxModel = require('../src/models/outboxModel');
const {
  canonicalizeJson,
  computeRequestHash,
  executeWithIdempotency
} = require('../src/services/apiIdempotencyService');

describe('Stage 2: Transactional Outbox & API Idempotency Service Tests', () => {
  const testUserId = 99901;
  const testEventKeyPrefix = `test_stage2_${Date.now()}`;

  before(async () => {
    // Ensure clean state before outbox batch claim tests
    await pool.execute(`DELETE FROM notification_outbox WHERE status = 'PENDING';`);
  });

  after(async () => {
    // Clean up test records
    await pool.execute(
      `DELETE FROM notification_outbox WHERE event_key LIKE '${testEventKeyPrefix}%';`
    );
    await pool.execute(
      `DELETE FROM api_idempotency_records WHERE user_id = ?;`,
      [testUserId]
    );
    await closePool();
  });

  describe('A. Outbox Model & Lease Fencing Tests', () => {
    it('1. insertEventTx: commits event within transaction and rolls back on failure', async () => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const eventKey = `${testEventKeyPrefix}_tx_commit`;
        const res = await outboxModel.insertEventTx(conn, {
          eventType: 'BOOKING_CREATED',
          entityType: 'booking',
          entityId: 101,
          eventKey,
          payload: { bookingId: 101, test: true }
        });
        assert.ok(res.id > 0);
        assert.equal(res.eventKey, eventKey);
        await conn.commit();

        // Verify row exists in DB
        const saved = await outboxModel.findOutboxEventByKey(eventKey);
        assert.ok(saved !== null);
        assert.equal(saved.status, 'PENDING');
        assert.equal(saved.attempts, 0);
      } finally {
        conn.release();
      }

      // Test Rollback
      const connRollback = await pool.getConnection();
      try {
        await connRollback.beginTransaction();
        const rollbackKey = `${testEventKeyPrefix}_tx_rollback`;
        await outboxModel.insertEventTx(connRollback, {
          eventType: 'BOOKING_CREATED',
          entityType: 'booking',
          entityId: 102,
          eventKey: rollbackKey,
          payload: { bookingId: 102 }
        });
        await connRollback.rollback();

        const notSaved = await outboxModel.findOutboxEventByKey(rollbackKey);
        assert.equal(notSaved, null, 'Rolled back event must not exist in DB');
      } finally {
        connRollback.release();
      }
    });

    it('2. claimOutboxBatch: atomically acquires lease token and sets status to PROCESSING', async () => {
      const workerToken = `worker_lease_${Date.now()}`;
      const claimed = await outboxModel.claimOutboxBatch({
        workerLeaseToken: workerToken,
        batchSize: 5
      });

      assert.ok(claimed.length >= 1, 'Should claim at least the pending test event');
      const testEvent = claimed.find(e => e.event_key.startsWith(testEventKeyPrefix));
      assert.ok(testEvent, 'Claimed batch must contain test event');
      assert.equal(testEvent.attempts, 1);

      // Verify row in database has lease token and PROCESSING status
      const saved = await outboxModel.findOutboxEventByKey(testEvent.event_key);
      assert.equal(saved.status, 'PROCESSING');
      assert.equal(saved.lease_token, workerToken);
      assert.ok(saved.lease_expires_at !== null);
    });

    it('3. completeOutboxEventTx: completes event with lease fencing and rejects expired/stale tokens', async () => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Find the event claimed in previous test
        const saved = await outboxModel.findOutboxEventByKey(`${testEventKeyPrefix}_tx_commit`);
        assert.ok(saved);
        const validToken = saved.lease_token;

        // Attempt completion with INVALID lease token -> must return false
        const wrongResult = await outboxModel.completeOutboxEventTx(conn, {
          eventId: saved.id,
          workerLeaseToken: 'invalid_token_xyz'
        });
        assert.equal(wrongResult, false, 'Completion with invalid lease token must fail');

        // Attempt completion with VALID lease token -> must return true
        const validResult = await outboxModel.completeOutboxEventTx(conn, {
          eventId: saved.id,
          workerLeaseToken: validToken
        });
        assert.equal(validResult, true, 'Completion with valid lease token must succeed');

        await conn.commit();

        const completed = await outboxModel.findOutboxEventByKey(saved.event_key);
        assert.equal(completed.status, 'COMPLETED');
        assert.equal(completed.lease_token, null);
        assert.equal(completed.lease_expires_at, null);
      } finally {
        conn.release();
      }
    });

    it('4. failOutboxEvent: handles retry backoff and transitions to FAILED on max attempts', async () => {
      const conn = await pool.getConnection();
      let eventId;
      const failKey = `${testEventKeyPrefix}_fail_test`;
      try {
        await conn.beginTransaction();
        const res = await outboxModel.insertEventTx(conn, {
          eventType: 'PAYMENT_UPDATED',
          entityType: 'payment',
          entityId: 201,
          eventKey: failKey,
          payload: { amount: 500 }
        });
        eventId = res.id;
        await conn.commit();
      } finally {
        conn.release();
      }

      // Claim it
      const workerToken = 'worker_token_fail_test';
      const claimed = await outboxModel.claimOutboxBatch({ workerLeaseToken: workerToken, batchSize: 10 });
      const target = claimed.find(c => c.id === eventId);
      assert.ok(target);

      // Attempt 1 failure -> status back to PENDING with backoff
      const failed1 = await outboxModel.failOutboxEvent({
        eventId,
        workerLeaseToken: workerToken,
        errorMessage: 'Temporary network issue'
      });
      assert.equal(failed1, true);

      const afterFail1 = await outboxModel.findOutboxEventByKey(failKey);
      assert.equal(afterFail1.status, 'PENDING');
      assert.ok(afterFail1.next_attempt_at !== null);

      // Simulate reaching attempt 5
      await pool.execute(
        `UPDATE notification_outbox 
         SET attempts = 5, status = 'PROCESSING', lease_token = ?, lease_expires_at = NOW() + INTERVAL 5 MINUTE
         WHERE id = ?;`,
        [workerToken, eventId]
      );

      const failedFinal = await outboxModel.failOutboxEvent({
        eventId,
        workerLeaseToken: workerToken,
        errorMessage: 'Fatal non-recoverable error'
      });
      assert.equal(failedFinal, true);

      const afterFailFinal = await outboxModel.findOutboxEventByKey(failKey);
      assert.equal(afterFailFinal.status, 'FAILED');
      assert.equal(afterFailFinal.lease_token, null);
      assert.equal(afterFailFinal.next_attempt_at, null);
      assert.ok(afterFailFinal.last_error.includes('Fatal non-recoverable error'));
    });
  });

  describe('B. Request Hashing & Canonicalization Tests', () => {
    it('1. canonicalizeJson: produces identical strings regardless of object key order', () => {
      const obj1 = { z: 10, a: 1, m: { y: 'test', b: 20 } };
      const obj2 = { a: 1, m: { b: 20, y: 'test' }, z: 10 };

      assert.equal(canonicalizeJson(obj1), canonicalizeJson(obj2));
      assert.equal(canonicalizeJson(obj1), '{"a":1,"m":{"b":20,"y":"test"},"z":10}');
    });

    it('2. computeRequestHash: generates identical SHA-256 for differently ordered query and body keys', () => {
      const query1 = { page: '1', limit: '10', sort: 'asc' };
      const query2 = { sort: 'asc', page: '1', limit: '10' };

      const body1 = { customerName: 'Ravi', amount: 5000, notes: null };
      const body2 = { notes: null, amount: 5000, customerName: 'Ravi' };

      const hash1 = computeRequestHash(query1, body1);
      const hash2 = computeRequestHash(query2, body2);

      assert.equal(hash1, hash2);
      assert.equal(typeof hash1, 'string');
      assert.equal(hash1.length, 64);
    });
  });

  describe('C. API Request Idempotency Single-Transaction Tests', () => {
    it('1. executeWithIdempotency: executes business operation once and returns cached response on replay', async () => {
      const idemKey = `idem_${Date.now()}`;
      let businessExecutionCount = 0;

      const callApi = async () => {
        return await executeWithIdempotency(
          pool,
          {
            userId: testUserId,
            idempotencyKey: idemKey,
            httpMethod: 'POST',
            requestPath: '/api/v1/bookings',
            query: { ref: 'app' },
            body: { bookingType: 'Pooja', price: 1500 }
          },
          async (conn) => {
            businessExecutionCount++;
            // Simulate business write using connection
            const outboxRes = await outboxModel.insertEventTx(conn, {
              eventType: 'BOOKING_CREATED',
              entityType: 'booking',
              entityId: 9001,
              eventKey: `${testEventKeyPrefix}_idem_b9001`,
              payload: { bookingId: 9001 }
            });

            return {
              statusCode: 201,
              body: { success: true, bookingId: 9001, outboxId: outboxRes.id }
            };
          }
        );
      };

      // Call 1: Initial execution
      const res1 = await callApi();
      assert.equal(res1.isReplay, false);
      assert.equal(res1.statusCode, 201);
      assert.equal(res1.body.bookingId, 9001);
      assert.equal(businessExecutionCount, 1);

      // Call 2: Replay with identical key & payload
      const res2 = await callApi();
      assert.equal(res2.isReplay, true, 'Second call must be flagged as replay');
      assert.equal(res2.statusCode, 201);
      assert.equal(res2.body.bookingId, 9001);
      assert.equal(businessExecutionCount, 1, 'Business logic must NOT execute a second time');
    });

    it('2. executeWithIdempotency: rejects reused key with different request payload with HTTP 422', async () => {
      const idemKey = `idem_mismatch_${Date.now()}`;

      // First call
      await executeWithIdempotency(
        pool,
        {
          userId: testUserId,
          idempotencyKey: idemKey,
          httpMethod: 'POST',
          requestPath: '/api/v1/bookings',
          query: {},
          body: { amount: 100 }
        },
        async () => ({ statusCode: 200, body: { ok: true } })
      );

      // Second call with altered payload
      await assert.rejects(
        async () => {
          await executeWithIdempotency(
            pool,
            {
              userId: testUserId,
              idempotencyKey: idemKey,
              httpMethod: 'POST',
              requestPath: '/api/v1/bookings',
              query: {},
              body: { amount: 200 } // Changed amount!
            },
            async () => ({ statusCode: 200, body: { ok: true } })
          );
        },
        (err) => {
          assert.equal(err.statusCode, 422);
          assert.ok(err.message.includes('Idempotency key reused with different request payload'));
          return true;
        }
      );
    });

    it('3. executeWithIdempotency: concurrent requests serialize via InnoDB row-level locking', async () => {
      const idemKey = `idem_concurrent_${Date.now()}`;
      let executionCount = 0;

      const triggerRequest = () => {
        return executeWithIdempotency(
          pool,
          {
            userId: testUserId,
            idempotencyKey: idemKey,
            httpMethod: 'POST',
            requestPath: '/api/v1/concurrent-test',
            query: {},
            body: { test: 'concurrency' }
          },
          async (conn) => {
            executionCount++;
            // Introduce a short simulated query latency
            await conn.execute('SELECT SLEEP(0.05);');
            return {
              statusCode: 201,
              body: { success: true, count: executionCount }
            };
          }
        );
      };

      // Fire 2 concurrent requests simultaneously
      const [resultA, resultB] = await Promise.all([
        triggerRequest(),
        triggerRequest()
      ]);

      // Exactly one request was the initiator and one was the replay
      const replays = [resultA.isReplay, resultB.isReplay];
      assert.ok(replays.includes(false), 'One request must be initial execution');
      assert.ok(replays.includes(true), 'Concurrent request must receive cached replay');

      // Both must receive identical HTTP status and body
      assert.equal(resultA.statusCode, 201);
      assert.equal(resultB.statusCode, 201);
      assert.equal(resultA.body.success, true);
      assert.equal(resultB.body.success, true);

      // Business logic executed exactly once!
      assert.equal(executionCount, 1, 'Business operation must execute exactly once');
    });
  });
});
