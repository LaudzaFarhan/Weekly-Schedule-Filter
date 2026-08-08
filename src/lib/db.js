import { Pool } from 'pg';

// The connection string comes from the environment. Without it, `pg` silently
// falls back to localhost:5432 and every query fails with a confusing
// "ECONNREFUSED 127.0.0.1:5432". Detect that up front so the API returns a
// clear, actionable message instead.
const CONNECTION_STRING = process.env.DATABASE_URL;

// Lazily create the pool so a missing DATABASE_URL doesn't crash the whole
// serverless function at import time — only the routes that actually hit the
// DB will surface the configuration error.
// Lazily create the pool as a global singleton so Next.js HMR/dev reloads
// do not instantiate multiple pools and exceed PostgreSQL client limits ("too many clients").
let pool = globalThis.postgresPool || null;

function getPool() {
  if (!CONNECTION_STRING) {
    throw new Error(
      'DATABASE_URL is not set. Add your PostgreSQL connection string to the ' +
      'environment (Vercel → Project → Settings → Environment Variables for ' +
      'production, or .env.local for local dev), then redeploy. See setup_vps.sh ' +
      'for the connection string format.'
    );
  }
  if (!pool) {
    pool = new Pool({
      connectionString: CONNECTION_STRING,
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      // Enable SSL for remote/secure PostgreSQL instances.
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    // Prevent idle client connection drops from throwing uncaught errors
    pool.on('error', (err) => {
      console.warn('[db] Unexpected error on idle client:', err?.message || err);
    });
    if (process.env.NODE_ENV !== 'production') {
      globalThis.postgresPool = pool;
    }
  }
  return pool;
}

/**
 * Execute a query on the PostgreSQL database
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 */
export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await getPool().query(text, params);
    const duration = Date.now() - start;
    // Log query metrics in dev environment
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[db] Query executed in ${duration}ms:`, text.substring(0, 100));
    }
    return res;
  } catch (error) {
    const isConnErr = error?.message && (
      error.message.includes('Connection terminated') ||
      error.message.includes('closed') ||
      error.message.includes('ended') ||
      error.message.includes('ECONNRESET')
    );
    if (isConnErr) {
      console.warn('[db] Connection dropped, retrying query once:', text.substring(0, 80));
      try {
        const res = await getPool().query(text, params);
        return res;
      } catch (retryErr) {
        console.error('[db] Query retry failed:', retryErr.message);
        throw retryErr;
      }
    }
    console.error('[db] Database query error:', error.message);
    throw error;
  }
}

/** Default deadline for a transaction, in milliseconds (Req 6.8). */
export const DEFAULT_TRANSACTION_TIMEOUT_MS = 30000;

/**
 * Raised when a transaction has not committed within its deadline.
 *
 * Carries a recognisable `name` in addition to being an `Error` subclass so the
 * API route can map it to the specific 30-second message (Req 6.8) even across
 * module instances where `instanceof` can be unreliable.
 */
export class WipeTimeoutError extends Error {
  constructor(timeoutMs = DEFAULT_TRANSACTION_TIMEOUT_MS) {
    super(
      `The operation exceeded its ${Math.round(timeoutMs / 1000)}-second time limit ` +
      'and was rolled back. No records were changed.'
    );
    this.name = 'WipeTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Validate a caller-supplied timeout before it reaches SQL text.
 *
 * `SET LOCAL statement_timeout` does not accept a bind parameter, so the value
 * is interpolated. Coercing to a positive integer here is what keeps that
 * interpolation from being an injection vector.
 */
function normaliseTimeoutMs(timeoutMs) {
  const value = Number(timeoutMs);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(
      `withTransaction: timeoutMs must be a positive integer number of milliseconds, received ${JSON.stringify(timeoutMs)}`
    );
  }
  return value;
}

/**
 * Run `fn` inside one transaction on one pooled client.
 *
 * Commits on resolve, rolls back on reject or on the deadline, always releases
 * the client. Two timeout layers are applied because neither alone bounds the
 * whole unit of work: `statement_timeout` bounds each individual statement,
 * while the race deadline bounds the transaction as a whole, including time
 * spent between statements (Req 6.1, 6.2, 6.3, 6.8).
 *
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn - Work to run inside the transaction.
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<any>} Whatever `fn` resolved with.
 */
export async function withTransaction(fn, { timeoutMs = DEFAULT_TRANSACTION_TIMEOUT_MS } = {}) {
  const deadlineMs = normaliseTimeoutMs(timeoutMs);
  const client = await getPool().connect();
  let timer = null;
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${deadlineMs}`);
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new WipeTimeoutError(deadlineMs)), deadlineMs);
    });
    const result = await Promise.race([fn(client), deadline]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // The connection may already be gone, in which case PostgreSQL has
    // discarded the uncommitted transaction for us.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[db] Rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    // Clear the race timer so a fast transaction leaves no pending timer
    // holding the process open.
    if (timer) clearTimeout(timer);
    client.release();
  }
}

export default getPool;
