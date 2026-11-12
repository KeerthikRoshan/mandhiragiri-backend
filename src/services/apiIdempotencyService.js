const crypto = require('crypto');
const ApiError = require('../utils/ApiError');

/**
 * API Request Idempotency Service (Phase 4)
 * Guarantees single-transaction execution of business logic, outbox persistence,
 * and response caching with InnoDB row-lock serialization and deterministic request hashing.
 */

/**
 * Produce canonical JSON string with sorted object keys
 *
 * @param {*} obj
 * @returns {string}
 */
const canonicalizeJson = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(k => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return '{' + pairs.join(',') + '}';
};

/**
 * Compute deterministic SHA-256 hash of query parameters and request body
 *
 * @param {Object} [query={}]
 * @param {Object} [body={}]
 * @returns {string} 64-character hex hash
 */
const computeRequestHash = (query = {}, body = {}) => {
  const normQuery = Object.keys(query || {})
    .sort()
    .reduce((acc, k) => {
      acc[k] = query[k];
      return acc;
    }, {});

  const canonicalString = `${JSON.stringify(normQuery)}|${canonicalizeJson(body || {})}`;
  return crypto.createHash('sha256').update(canonicalString).digest('hex');
};

/**
 * Execute a business operation with single-transaction idempotency
 *
 * @param {import('mysql2/promise').Pool} pool - Database pool
 * @param {Object} options
 * @param {number|string} options.userId - Authenticated user ID
 * @param {string|null} [options.idempotencyKey] - Client supplied Idempotency-Key header
 * @param {string} options.httpMethod - HTTP verb e.g. 'POST', 'PUT'
 * @param {string} options.requestPath - Target route path e.g. '/api/v1/bookings'
 * @param {Object} [options.query={}]
 * @param {Object} [options.body={}]
 * @param {function(import('mysql2/promise').Connection): Promise<{ statusCode: number, body: Object }>} businessFn
 * @returns {Promise<{ isReplay: boolean, statusCode: number, body: Object }>}
 */
const executeWithIdempotency = async (
  pool,
  { userId, idempotencyKey = null, httpMethod, requestPath, query = {}, body = {} },
  businessFn
) => {
  // If no idempotency key provided, execute business logic directly without transaction wrapper
  if (!idempotencyKey) {
    const result = await businessFn(null);
    return {
      isReplay: false,
      statusCode: result.statusCode || 200,
      body: result.body || result
    };
  }

  const requestHash = computeRequestHash(query, body);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    let isInitiator = false;
    try {
      // 1. Attempt uncommitted insert inside transaction.
      // InnoDB row-level locking causes concurrent requests with the same key to wait here.
      await conn.execute(
        `INSERT INTO api_idempotency_records (
          user_id, idempotency_key, http_method, request_path, request_hash,
          response_status, response_body, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NOW());`,
        [userId, idempotencyKey, httpMethod.toUpperCase(), requestPath, requestHash]
      );
      isInitiator = true;
    } catch (insertErr) {
      if (insertErr.code === 'ER_DUP_ENTRY') {
        // A prior request already committed or is currently in-flight
        await conn.rollback();

        // Query the authoritative record from pool
        const [existing] = await pool.execute(
          `SELECT request_hash, response_status, response_body
           FROM api_idempotency_records
           WHERE user_id = ? AND idempotency_key = ? AND http_method = ? AND request_path = ?;`,
          [userId, idempotencyKey, httpMethod.toUpperCase(), requestPath]
        );

        if (existing.length > 0 && existing[0].response_status !== null) {
          // Verify hash
          if (existing[0].request_hash !== requestHash) {
            throw ApiError.unprocessable('Idempotency key reused with different request payload');
          }

          // Return cached response
          let parsedBody = existing[0].response_body;
          if (typeof parsedBody === 'string') {
            try { parsedBody = JSON.parse(parsedBody); } catch (_) {}
          }

          return {
            isReplay: true,
            statusCode: existing[0].response_status,
            body: parsedBody
          };
        } else {
          // Row exists without response: concurrent request holding lock or uncommitted
          throw ApiError.conflict('A concurrent request with this Idempotency-Key is currently in progress. Please retry shortly.');
        }
      } else if (insertErr.code === 'ER_LOCK_WAIT_TIMEOUT') {
        await conn.rollback();
        throw ApiError.conflict('Concurrent request lock wait timeout. Please retry in a moment.');
      } else if (insertErr.code === 'ER_LOCK_DEADLOCK') {
        await conn.rollback();
        throw ApiError.conflict('Concurrent transaction deadlock encountered. Please retry.');
      }
      throw insertErr;
    }

    if (isInitiator) {
      // 2. Execute business operation passing the connection
      const { statusCode = 200, body: responseBody } = await businessFn(conn);

      // 3. Store final response status and body inside the same transaction
      await conn.execute(
        `UPDATE api_idempotency_records
         SET response_status = ?, response_body = ?
         WHERE user_id = ? AND idempotency_key = ? AND http_method = ? AND request_path = ?;`,
        [statusCode, JSON.stringify(responseBody), userId, idempotencyKey, httpMethod.toUpperCase(), requestPath]
      );

      // 4. Commit everything atomically
      await conn.commit();

      return {
        isReplay: false,
        statusCode,
        body: responseBody
      };
    }
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = {
  canonicalizeJson,
  computeRequestHash,
  executeWithIdempotency
};
