import { Pool } from 'pg';

// The connection string comes from the environment. Without it, `pg` silently
// falls back to localhost:5432 and every query fails with a confusing
// "ECONNREFUSED 127.0.0.1:5432". Detect that up front so the API returns a
// clear, actionable message instead.
const CONNECTION_STRING = process.env.DATABASE_URL;

// Lazily create the pool so a missing DATABASE_URL doesn't crash the whole
// serverless function at import time — only the routes that actually hit the
// DB will surface the configuration error.
let pool = null;
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
      // Enable SSL for remote/secure PostgreSQL instances.
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
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
    console.error('[db] Database query error:', error.message);
    throw error;
  }
}

export default getPool;
