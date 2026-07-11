import { Pool } from 'pg';

// Initialize connection pool from environment variable (PostgreSQL connection string)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Enable SSL (required for remote connections to secure PostgreSQL instances, like on Vercel)
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

/**
 * Execute a query on the PostgreSQL database
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 */
export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    // Log query metrics in dev environment
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[db] Query executed in ${duration}ms:`, text.substring(0, 100));
    }
    return res;
  } catch (error) {
    console.error('[db] Database query error:', error);
    throw error;
  }
}

export default pool;
