// Integration tests for the student bulk wipe, against a REAL PostgreSQL
// database. Feature: student-data-bulk-wipe, task 12.1.
//
// ---------------------------------------------------------------------------
// THESE TESTS DELETE EVERY ROW IN THE TABLES THEY TOUCH.
// ---------------------------------------------------------------------------
//
// They are deliberately kept out of the unit suite (`npm run test`, whose glob
// is `src/**/*.{test,spec}.{js,jsx}`) and they refuse to run unless a dedicated
// connection string is supplied in `WIPE_TEST_DATABASE_URL`. `DATABASE_URL` is
// never used as the target: requiring a second, differently-named variable is
// what stops an accidental run from emptying the production registry.
//
// How to run
// ----------
// 1. Start a throwaway PostgreSQL (nothing else must depend on it):
//
//      docker run --rm -d --name wipe-test-pg \
//        -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=wipe_test \
//        -p 55432:5432 postgres:16
//
// 2. Point the tests at it and run them:
//
//      # bash / zsh
//      WIPE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/wipe_test \
//        npm run test:integration
//
//      # PowerShell
//      $env:WIPE_TEST_DATABASE_URL="postgres://postgres:postgres@localhost:55432/wipe_test"
//      npm run test:integration
//
// 3. Throw the database away:
//
//      docker stop wipe-test-pg
//
// With `WIPE_TEST_DATABASE_URL` unset the whole suite skips, which is the
// default in CI and on a developer machine. Two further guards run before any
// statement is sent: the target must not equal `DATABASE_URL`, and its database
// name must contain `test`. Either check failing aborts the run loudly rather
// than deleting real data.
//
// Set `WIPE_TEST_DATABASE_SSL=true` if the throwaway server needs SSL.
//
// What is covered
// ---------------
// - A seeded confirmed wipe through the API route: registry empty, keyed side
//   data gone, orphan history and unmatched progress intact, all five protected
//   tables unchanged. This is what checks the in-memory model behind Property 7
//   against real SQL (Req 4.1–4.5, 4.13).
// - Two concurrent confirmed wipes serialised by `pg_advisory_xact_lock`
//   (Req 9.6) — the only place that claim can be tested, since row locks cannot
//   serialise a table the first transaction has already emptied.
// - The same unconfirmed request admitted as `Sec-Fetch-Site: same-origin` and
//   as `x-api-key`, both 400 (Req 5.8).
// - A forced mid-transaction failure, against real rollback semantics
//   (Req 6.2, 6.3).
//
// Examples only, 1–3 per behaviour. No property runs here.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

const TARGET_URL = process.env.WIPE_TEST_DATABASE_URL;
const APPLICATION_URL = process.env.DATABASE_URL;
const TEST_API_KEY = 'wipe-integration-test-key';

/** Database name from a PostgreSQL connection string, or '' when unreadable. */
function databaseNameFrom(connectionString) {
  try {
    return new URL(connectionString).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

/**
 * Refuse to run against anything that might be real data.
 *
 * Throws rather than skips: a misconfigured target is a mistake worth shouting
 * about, and silence here is exactly how a production registry gets emptied.
 */
function assertDisposableTarget(target, applicationUrl) {
  if (!target) {
    throw new Error('WIPE_TEST_DATABASE_URL is not set.');
  }
  if (applicationUrl && target === applicationUrl) {
    throw new Error(
      'Refusing to run: WIPE_TEST_DATABASE_URL is the same connection string as '
      + 'DATABASE_URL. These tests delete every student record, so they must '
      + 'target a disposable database, never the one the application uses.'
    );
  }
  const name = databaseNameFrom(target);
  if (!name) {
    throw new Error(
      `Refusing to run: could not read a database name from WIPE_TEST_DATABASE_URL. `
      + 'Expected a URL of the form postgres://user:pass@host:port/dbname.'
    );
  }
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run: the target database is named "${name}", which does not `
      + 'contain "test". Point WIPE_TEST_DATABASE_URL at a throwaway database.'
    );
  }
}

// Tables created and dropped by this suite, so the database is disposable.
// Column definitions mirror init_db.sql and src/lib/ensureSchema.js; triggers
// and indexes are omitted because no assertion here depends on them.
const TABLES = [
  'internal_students',
  'internal_student_history',
  'internal_live_progress',
  'internal_classes',
  'internal_instructors',
  'internal_leaves',
  'internal_operationals',
  'new_crm_leads',
];

const DDL = [
  `CREATE TABLE internal_students (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      level VARCHAR(255) NOT NULL,
      branch_name VARCHAR(255) NOT NULL,
      parent_name VARCHAR(255),
      contact VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'Active' NOT NULL,
      remarks TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE internal_student_history (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL,
      student_name VARCHAR(255),
      branch_name VARCHAR(255) NOT NULL,
      note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE internal_live_progress (
      id SERIAL PRIMARY KEY,
      student_name VARCHAR(255) NOT NULL,
      program_code VARCHAR(100) NOT NULL,
      category VARCHAR(50),
      attendance JSONB DEFAULT '{}'::jsonb NOT NULL,
      videos JSONB DEFAULT '{}'::jsonb NOT NULL,
      continuation VARCHAR(50) DEFAULT 'Not Decide Yet' NOT NULL,
      continuation_note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT internal_live_progress_student_program_key
          UNIQUE (student_name, program_code)
  )`,
  `CREATE TABLE internal_classes (
      id SERIAL PRIMARY KEY,
      day VARCHAR(50) NOT NULL,
      time VARCHAR(100) NOT NULL,
      program VARCHAR(255) NOT NULL,
      student VARCHAR(255) NOT NULL,
      teacher VARCHAR(255) NOT NULL,
      branch_name VARCHAR(255) NOT NULL,
      class_type VARCHAR(50) DEFAULT 'Regular' NOT NULL,
      remarks TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE internal_instructors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      level VARCHAR(255) NOT NULL,
      branches TEXT[] NOT NULL,
      contact VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'Active' NOT NULL,
      remarks TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE internal_leaves (
      id SERIAL PRIMARY KEY,
      instructor_name VARCHAR(255) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      reason TEXT,
      status VARCHAR(50) DEFAULT 'Approved' NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE internal_operationals (
      id SERIAL PRIMARY KEY,
      branch_name VARCHAR(255) NOT NULL,
      day VARCHAR(50) NOT NULL,
      is_open BOOLEAN DEFAULT TRUE NOT NULL,
      open_time VARCHAR(10),
      close_time VARCHAR(10),
      slots JSONB DEFAULT '[]'::jsonb NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT internal_operationals_branch_day_key UNIQUE (branch_name, day)
  )`,
  `CREATE TABLE new_crm_leads (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(255) NOT NULL,
      message TEXT,
      status VARCHAR(50) DEFAULT 'interest_trial' NOT NULL,
      branch VARCHAR(255),
      trial_date VARCHAR(100),
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`,
];

const FAIL_TRIGGER_FN = `
  CREATE OR REPLACE FUNCTION wipe_integration_force_failure()
  RETURNS TRIGGER AS $$
  BEGIN
      RAISE EXCEPTION 'forced mid-transaction failure';
  END;
  $$ LANGUAGE plpgsql;
`;

describe.skipIf(!TARGET_URL)('bulk student wipe against real PostgreSQL', () => {
  /** @type {import('pg').Pool} A second pool, independent of the app's. */
  let observer;
  let query;
  let bulkWipeStudents;
  let WIPE_LOCK_KEY;
  let WIPE_CONFIRMATION_PHRASE;
  let DELETE;
  let middleware;
  let closeAppPool;

  beforeAll(async () => {
    assertDisposableTarget(TARGET_URL, APPLICATION_URL);

    // src/lib/db.js reads DATABASE_URL once at import time, so the redirection
    // has to happen before the first dynamic import below. The guard above has
    // already proved this is not the application's database.
    process.env.DATABASE_URL = TARGET_URL;
    process.env.DATABASE_SSL = process.env.WIPE_TEST_DATABASE_SSL === 'true' ? 'true' : 'false';
    // Make the API guard active so the same-origin / API-key split is real.
    process.env.NEW_OPS_API_KEY = TEST_API_KEY;

    const db = await import('@/lib/db');
    query = db.query;
    closeAppPool = async () => {
      const pool = db.default();
      await pool.end();
    };
    ({ bulkWipeStudents, WIPE_LOCK_KEY } = await import('@/lib/bulkWipeStudents'));
    ({ WIPE_CONFIRMATION_PHRASE } = await import('@/lib/wipeConfirmation'));
    ({ DELETE } = await import('@/app/api/new/students/route'));
    ({ middleware } = await import('@/middleware'));

    observer = new Pool({
      connectionString: TARGET_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });

    await query(`DROP TABLE IF EXISTS ${TABLES.join(', ')} CASCADE`);
    for (const statement of DDL) await query(statement);
    await query(FAIL_TRIGGER_FN);
  });

  afterAll(async () => {
    if (query) {
      await query(`DROP TABLE IF EXISTS ${TABLES.join(', ')} CASCADE`);
      await query('DROP FUNCTION IF EXISTS wipe_integration_force_failure() CASCADE');
    }
    if (observer) await observer.end();
    if (closeAppPool) await closeAppPool();
  });

  beforeEach(async () => {
    await query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY`);
  });

  // -------------------------------------------------------------------------
  // Seeding and reading helpers
  // -------------------------------------------------------------------------

  const rows = async (sql) => (await query(sql)).rows;
  const countOf = async (table) =>
    Number((await query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

  async function seedStudent(name, branch = 'Bintaro', status = 'Active') {
    const res = await query(
      `INSERT INTO internal_students (name, level, branch_name, parent_name, contact, status, remarks)
       VALUES ($1, 'Kinder 1', $2, 'Parent', '0800', $3, 'seeded') RETURNING id`,
      [name, branch, status]
    );
    return res.rows[0].id;
  }

  async function seedProtectedTables() {
    await query(
      `INSERT INTO internal_classes (day, time, program, student, teacher, branch_name, class_type)
       VALUES ('Monday', '13:00', 'Kinder 1', 'Ada Lovelace', 'Budi', 'Bintaro', 'Regular'),
              ('Tuesday', '15:00', 'Junior 2', 'Grace Hopper', 'Citra', 'Serpong', 'Replacement')`
    );
    await query(
      `INSERT INTO internal_instructors (name, level, branches, contact, status)
       VALUES ('Ada Lovelace', 'Senior', ARRAY['Bintaro'], '0811', 'Active')`
    );
    await query(
      `INSERT INTO internal_leaves (instructor_name, start_date, end_date, reason)
       VALUES ('Budi', '2026-01-01', '2026-01-03', 'Holiday')`
    );
    await query(
      `INSERT INTO internal_operationals (branch_name, day, is_open, open_time, close_time, slots)
       VALUES ('Bintaro', 'Monday', TRUE, '09:00', '17:00', '[{"type":"kinder"}]'::jsonb)`
    );
    await query(
      `INSERT INTO new_crm_leads (name, phone, message, status)
       VALUES ('Grace Hopper', '0899', 'interested', 'interest_trial')`
    );
  }

  /** Full contents of the five protected tables, for a byte-level comparison. */
  async function protectedSnapshot() {
    const snapshot = {};
    for (const table of [
      'internal_classes',
      'internal_instructors',
      'internal_leaves',
      'internal_operationals',
      'new_crm_leads',
    ]) {
      snapshot[table] = await rows(`SELECT * FROM ${table} ORDER BY id`);
    }
    return JSON.parse(JSON.stringify(snapshot));
  }

  /** A request the API route can read, carrying real admission headers. */
  function deleteRequest(headers, body) {
    return new NextRequest('http://localhost:3000/api/new/students', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  // -------------------------------------------------------------------------
  // 1. A confirmed wipe on a seeded database
  // -------------------------------------------------------------------------

  it('deletes the registry and exactly its keyed side data, leaving protected tables untouched', async () => {
    // Names cover the awkward cases the SQL has to fold: padding, letter case,
    // a duplicate and a whitespace-only name (Req 4.11, 4.12).
    const adaId = await seedStudent('Ada Lovelace');
    const graceId = await seedStudent('  Grace Hopper  ', 'Serpong', 'Inactive');
    const duplicateId = await seedStudent('ada lovelace');
    const blankId = await seedStudent('   ');

    await query(
      `INSERT INTO internal_student_history (student_id, student_name, branch_name, note)
       VALUES ($1, 'Ada Lovelace', 'Bintaro', 'joined'),
              ($2, 'Grace Hopper', 'Serpong', 'moved'),
              ($3, 'ada lovelace', 'Bintaro', 'duplicate'),
              ($4, 'blank', 'Bintaro', 'blank name'),
              (999999, 'Long Gone', 'Bintaro', 'orphan')`,
      [adaId, graceId, duplicateId, blankId]
    );

    await query(
      `INSERT INTO internal_live_progress (student_name, program_code, category)
       VALUES ('ADA LOVELACE', 'K1', 'kinder'),
              ('  ada lovelace  ', 'K2', 'kinder'),
              ('Grace Hopper', 'J2', 'junior'),
              ('Zoe Unmatched', 'K1', 'kinder'),
              ('   ', 'K3', 'kinder')`
    );

    await seedProtectedTables();
    const protectedBefore = await protectedSnapshot();

    const res = await DELETE(
      deleteRequest({ 'sec-fetch-site': 'same-origin' }, { confirm: WIPE_CONFIRMATION_PHRASE })
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      deletedStudents: 4,
      deletedHistory: 4,   // the four matched rows, not the orphan (Req 4.2, 4.13)
      deletedProgress: 3,  // folded and padded matches, blank name excluded (Req 4.3, 4.12)
    });

    // Registry empty (Req 4.1, 4.8).
    expect(await countOf('internal_students')).toBe(0);

    // Only the orphan history row survives (Req 4.13).
    const history = await rows('SELECT student_id, note FROM internal_student_history ORDER BY id');
    expect(history).toEqual([{ student_id: 999999, note: 'orphan' }]);

    // Unmatched progress survives unchanged, including the whitespace-only name
    // that no blank student name may select (Req 4.4, 4.12).
    const progress = await rows(
      'SELECT student_name, program_code FROM internal_live_progress ORDER BY id'
    );
    expect(progress).toEqual([
      { student_name: 'Zoe Unmatched', program_code: 'K1' },
      { student_name: '   ', program_code: 'K3' },
    ]);

    // All five protected tables byte-identical, student-name text included
    // (Req 4.5, 4.10).
    expect(await protectedSnapshot()).toEqual(protectedBefore);
  });

  // -------------------------------------------------------------------------
  // 2. Concurrency — the advisory lock, not row locks (Req 9.6)
  // -------------------------------------------------------------------------

  it('makes a second wipe wait until the first transaction has ended', async () => {
    await seedStudent('Ada Lovelace');
    await seedStudent('Budi Santoso');
    await seedStudent('Citra Dewi');

    // Stand in for an in-progress wipe by holding its advisory lock.
    const holder = await observer.connect();
    let settled = false;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1)', [WIPE_LOCK_KEY]);

      const wipe = bulkWipeStudents().then((counts) => {
        settled = true;
        return counts;
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Blocked on the lock: nothing deleted yet.
      expect(settled).toBe(false);
      const stillThere = await observer.query('SELECT count(*)::int AS n FROM internal_students');
      expect(Number(stillThere.rows[0].n)).toBe(3);

      await holder.query('COMMIT');

      const counts = await wipe;
      expect(counts.deletedStudents).toBe(3);
      expect(await countOf('internal_students')).toBe(0);
    } finally {
      holder.release();
    }
  });

  it('splits two concurrent wipes so the counts sum to the registry size and the later reports zero', async () => {
    const size = 5;
    for (let i = 0; i < size; i += 1) await seedStudent(`Student ${i}`);

    const [first, second] = await Promise.all([bulkWipeStudents(), bulkWipeStudents()]);

    const counts = [first.deletedStudents, second.deletedStudents].sort((a, b) => a - b);
    expect(counts).toEqual([0, size]);          // the later request reports zero
    expect(counts[0] + counts[1]).toBe(size);   // and nothing is double-counted
    expect(await countOf('internal_students')).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 3. The confirmation guard applies to both admitted caller classes (Req 5.8)
  // -------------------------------------------------------------------------

  it('rejects the same unconfirmed request with 400 whether admitted as same-origin or by API key', async () => {
    await seedStudent('Ada Lovelace');
    await query(
      `INSERT INTO internal_student_history (student_id, student_name, branch_name)
       VALUES (1, 'Ada Lovelace', 'Bintaro')`
    );
    await query(
      `INSERT INTO internal_live_progress (student_name, program_code)
       VALUES ('Ada Lovelace', 'K1')`
    );
    const before = {
      students: await rows('SELECT * FROM internal_students ORDER BY id'),
      history: await rows('SELECT * FROM internal_student_history ORDER BY id'),
      progress: await rows('SELECT * FROM internal_live_progress ORDER BY id'),
    };

    const admissions = [
      { label: 'same-origin', headers: { 'sec-fetch-site': 'same-origin' } },
      { label: 'x-api-key', headers: { 'x-api-key': TEST_API_KEY } },
    ];

    for (const { label, headers } of admissions) {
      const request = deleteRequest(headers, {});

      // The guard admits the request...
      const gate = middleware(request);
      expect(gate.status, `${label} should be admitted by the API guard`).not.toBe(401);

      // ...and the handler still refuses it for want of a confirmation phrase.
      const res = await DELETE(request);
      const payload = await res.json();
      expect(res.status, `${label} should be rejected with 400`).toBe(400);
      expect(payload.error).toMatch(/confirmation phrase is required/i);
    }

    expect(await rows('SELECT * FROM internal_students ORDER BY id')).toEqual(before.students);
    expect(await rows('SELECT * FROM internal_student_history ORDER BY id')).toEqual(before.history);
    expect(await rows('SELECT * FROM internal_live_progress ORDER BY id')).toEqual(before.progress);
  });

  // -------------------------------------------------------------------------
  // 4. A forced mid-transaction failure rolls everything back (Req 6.2, 6.3)
  // -------------------------------------------------------------------------

  it('leaves the three tables at their pre-wipe counts and values when a deletion fails mid-transaction', async () => {
    const adaId = await seedStudent('Ada Lovelace');
    await seedStudent('Budi Santoso');
    await query(
      `INSERT INTO internal_student_history (student_id, student_name, branch_name, note)
       VALUES ($1, 'Ada Lovelace', 'Bintaro', 'joined')`,
      [adaId]
    );
    await query(
      `INSERT INTO internal_live_progress (student_name, program_code, category)
       VALUES ('Ada Lovelace', 'K1', 'kinder')`
    );

    const before = {
      students: await rows('SELECT * FROM internal_students ORDER BY id'),
      history: await rows('SELECT * FROM internal_student_history ORDER BY id'),
      progress: await rows('SELECT * FROM internal_live_progress ORDER BY id'),
    };

    // The students delete is the last of the three, so failing it means the
    // other two have already run inside the transaction. Anything left behind
    // afterwards would be a rollback that did not hold.
    await query(`
      CREATE TRIGGER internal_students_force_failure
        BEFORE DELETE ON internal_students
        FOR EACH ROW EXECUTE FUNCTION wipe_integration_force_failure()
    `);

    try {
      await expect(bulkWipeStudents()).rejects.toThrow(/forced mid-transaction failure/i);
    } finally {
      await query('DROP TRIGGER IF EXISTS internal_students_force_failure ON internal_students');
    }

    expect(await rows('SELECT * FROM internal_students ORDER BY id')).toEqual(before.students);
    expect(await rows('SELECT * FROM internal_student_history ORDER BY id')).toEqual(before.history);
    expect(await rows('SELECT * FROM internal_live_progress ORDER BY id')).toEqual(before.progress);
  });
});
