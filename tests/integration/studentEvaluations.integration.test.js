// Integration tests for the evaluations table, against a REAL PostgreSQL
// database. Feature: student-report-cards, task 18.1.
//
// ---------------------------------------------------------------------------
// THIS SUITE DROPS AND RECREATES `internal_student_evaluations`.
// ---------------------------------------------------------------------------
//
// It is deliberately kept out of the unit suite (`npm run test`, whose glob is
// `src/**/*.{test,spec}.{js,jsx}`) and it refuses to run unless a dedicated
// connection string is supplied. `DATABASE_URL` is never used as the target:
// requiring a second, differently-named variable is what stops an accidental
// run from dropping a table full of real evaluations.
//
// How to run
// ----------
// 1. Start a throwaway PostgreSQL (nothing else must depend on it):
//
//      docker run --rm -d --name report-cards-test-pg \
//        -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=report_cards_test \
//        -p 55432:5432 postgres:16
//
// 2. Point the tests at it and run them:
//
//      # bash / zsh
//      REPORT_CARDS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/report_cards_test \
//        npm run test:integration
//
//      # PowerShell
//      $env:REPORT_CARDS_TEST_DATABASE_URL="postgres://postgres:postgres@localhost:55432/report_cards_test"
//      npm run test:integration
//
// 3. Throw the database away:
//
//      docker stop report-cards-test-pg
//
// `WIPE_TEST_DATABASE_URL` is accepted as a fallback, so the one throwaway
// database already described in `bulkWipeStudents.integration.test.js` serves
// both suites. That file drops a different set of tables and never touches
// `internal_student_evaluations`, and `vitest.integration.config.mjs` sets
// `fileParallelism: false`, so the two cannot race each other.
//
// With neither variable set the whole suite SKIPS, which is the default in CI
// and on a developer machine. Three guards run before any statement is sent:
// the variable must be set, the target must not equal `DATABASE_URL`, and its
// database name must contain `test`. The last two abort the run loudly rather
// than writing to real data.
//
// Set `REPORT_CARDS_TEST_DATABASE_SSL=true` (or `WIPE_TEST_DATABASE_SSL=true`)
// if the throwaway server needs SSL.
//
// What is covered
// ---------------
// - Property 10: the `ON CONFLICT (student_id, eval_date) DO UPDATE` upsert is
//   idempotent in row count and the second write wins in full (Req 1.1, 2.2, 2.3).
// - The `23505 → 409` path on `PUT`, with both rows left unchanged (Req 2.8).
// - The `(student_id, eval_date)` unique constraint refusing a plain duplicate
//   `INSERT` — the constraint itself, not the route's conflict clause (Req 1.1).
// - The five `CHECK (… BETWEEN 1 AND 5)` and `NOT NULL` score constraints
//   refusing `0`, `6` and `NULL` (Req 1.6).
// - `ensureTable` provisioning the table twice without error, and not caching a
//   failed provision (Req 2.13).
//
// Every row written here carries a `student_id` in the obviously-synthetic range
// 990000–990999, so a leftover row is identifiable at a glance, and the suite
// deletes that range before it finishes.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { NextRequest } from 'next/server';

const EXPLICIT_URL = process.env.REPORT_CARDS_TEST_DATABASE_URL;
const TARGET_URL = EXPLICIT_URL || process.env.WIPE_TEST_DATABASE_URL;
const TARGET_VAR = EXPLICIT_URL ? 'REPORT_CARDS_TEST_DATABASE_URL' : 'WIPE_TEST_DATABASE_URL';
const APPLICATION_URL = process.env.DATABASE_URL;
const USE_SSL = process.env.REPORT_CARDS_TEST_DATABASE_SSL === 'true'
  || process.env.WIPE_TEST_DATABASE_SSL === 'true';

const TABLE = 'internal_student_evaluations';
const SCORE_COLUMNS = ['concept', 'building', 'problem_solving', 'focus', 'attitude'];
const SYNTHETIC_MIN = 990000;
const SYNTHETIC_MAX = 990999;

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
 * about, and silence here is exactly how a table of real evaluations gets
 * dropped.
 */
function assertDisposableTarget(target, applicationUrl, variableName) {
  if (!target) {
    throw new Error(`${variableName} is not set.`);
  }
  if (applicationUrl && target === applicationUrl) {
    throw new Error(
      `Refusing to run: ${variableName} is the same connection string as `
      + 'DATABASE_URL. These tests drop and recreate the evaluations table, so '
      + 'they must target a disposable database, never the one the application '
      + 'uses.'
    );
  }
  const name = databaseNameFrom(target);
  if (!name) {
    throw new Error(
      `Refusing to run: could not read a database name from ${variableName}. `
      + 'Expected a URL of the form postgres://user:pass@host:port/dbname.'
    );
  }
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run: the target database is named "${name}", which does not `
      + `contain "test". Point ${variableName} at a throwaway database.`
    );
  }
}

describe.skipIf(!TARGET_URL)('student evaluations against real PostgreSQL', () => {
  let query;
  let closeAppPool;
  let ensureTable;
  let mapRow;
  let POST;
  let PUT;

  beforeAll(async () => {
    assertDisposableTarget(TARGET_URL, APPLICATION_URL, TARGET_VAR);

    // src/lib/db.js reads DATABASE_URL once at import time, so the redirection
    // has to happen before the first dynamic import below. The guard above has
    // already proved this is not the application's database.
    process.env.DATABASE_URL = TARGET_URL;
    process.env.DATABASE_SSL = USE_SSL ? 'true' : 'false';

    const db = await import('@/lib/db');
    query = db.query;
    closeAppPool = async () => {
      const pool = db.default();
      await pool.end();
    };
    ({ ensureTable } = await import('@/lib/ensureSchema'));
    ({ mapRow, POST, PUT } = await import('@/app/api/new/student-evaluations/route'));

    // Start from a table this suite provisioned itself, through the same
    // `ensureTable` path a cold request takes.
    await query(`DROP TABLE IF EXISTS ${TABLE} CASCADE`);
    await ensureTable(TABLE);
  });

  afterAll(async () => {
    if (query) {
      await query(
        `DELETE FROM ${TABLE} WHERE student_id BETWEEN $1 AND $2`,
        [SYNTHETIC_MIN, SYNTHETIC_MAX]
      ).catch(() => {});
      await query(`DROP TABLE IF EXISTS ${TABLE} CASCADE`).catch(() => {});
    }
    if (closeAppPool) await closeAppPool();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Rows written by this suite, and only those. */
  const syntheticCount = async () => Number((await query(
    `SELECT count(*)::int AS n FROM ${TABLE} WHERE student_id BETWEEN $1 AND $2`,
    [SYNTHETIC_MIN, SYNTHETIC_MAX]
  )).rows[0].n);

  const rowsFor = async (studentId) => (await query(
    `SELECT * FROM ${TABLE} WHERE student_id = $1 ORDER BY eval_date, id`,
    [studentId]
  )).rows;

  const clearStudent = (studentId) =>
    query(`DELETE FROM ${TABLE} WHERE student_id = $1`, [studentId]);

  /** A request the route handlers can read. */
  const evaluationRequest = (method, payload) =>
    new NextRequest('http://localhost:3000/api/new/student-evaluations', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  const post = async (payload) => {
    const res = await POST(evaluationRequest('POST', payload));
    return { status: res.status, body: await res.json() };
  };

  const put = async (payload) => {
    const res = await PUT(evaluationRequest('PUT', payload));
    return { status: res.status, body: await res.json() };
  };

  /**
   * What the stored row must hold after a payload is saved, with the two
   * normalisations the validator applies: `instructorName` is trimmed, and a
   * blank one becomes no value.
   */
  const storedShapeOf = (studentId, date, fields) => ({
    studentId,
    date,
    concept: fields.concept,
    building: fields.building,
    problemSolving: fields.problemSolving,
    focus: fields.focus,
    attitude: fields.attitude,
    lessonTopic: fields.lessonTopic,
    instructorNotes: fields.instructorNotes,
    instructorName: fields.instructorName === null
      ? null
      : fields.instructorName.trim() || null,
  });

  // -------------------------------------------------------------------------
  // Arbitraries
  // -------------------------------------------------------------------------

  const studentIdArb = fc.integer({ min: SYNTHETIC_MIN, max: SYNTHETIC_MAX });

  /** Short ASCII text, so nothing here depends on PostgreSQL's encoding. */
  const textArb = fc.stringMatching(/^[A-Za-z0-9 .'-]{0,16}$/);

  const isoDateArb = fc
    .date({ min: new Date('2024-01-01'), max: new Date('2026-12-31'), noInvalidDate: true })
    .map((d) => d.toISOString().slice(0, 10));

  const scoreArb = fc.integer({ min: 1, max: 5 });

  /** Everything a valid payload carries apart from its `(studentId, date)` key. */
  const fieldsArb = fc.record({
    concept: scoreArb,
    building: scoreArb,
    problemSolving: scoreArb,
    focus: scoreArb,
    attitude: scoreArb,
    lessonTopic: fc.oneof({ weight: 4, arbitrary: textArb }, { weight: 1, arbitrary: fc.constant(null) }),
    instructorNotes: fc.oneof({ weight: 4, arbitrary: textArb }, { weight: 1, arbitrary: fc.constant(null) }),
    instructorName: fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom('Budi', 'Citra', '  Dewi  ', 'Sam ONeill') },
      { weight: 1, arbitrary: fc.constantFrom(null, '', '   ') },
    ),
  });

  // -------------------------------------------------------------------------
  // Property 10
  // -------------------------------------------------------------------------

  // Feature: student-report-cards, Property 10: Upsert is idempotent in row count
  it('leaves exactly one row per (student, date) holding the second payload after two saves', async () => {
    await fc.assert(
      fc.asyncProperty(
        studentIdArb,
        isoDateArb,
        fieldsArb,
        fieldsArb,
        async (studentId, date, first, second) => {
          await clearStudent(studentId);
          const before = await syntheticCount();

          const firstSave = await post({ studentId, date, ...first });
          expect(firstSave.status, JSON.stringify(firstSave.body)).toBe(200);
          const afterFirst = await syntheticCount();

          const secondSave = await post({ studentId, date, ...second });
          expect(secondSave.status, JSON.stringify(secondSave.body)).toBe(200);
          const afterSecond = await syntheticCount();

          // Row count: the first save adds a row, the second changes it.
          // At most one record per (student, date) (Req 1.1, 2.2).
          expect(afterFirst).toBe(before + 1);
          expect(afterSecond).toBe(afterFirst);

          const rows = await rowsFor(studentId);
          expect(rows).toHaveLength(1);

          // The same row was updated, not replaced (Req 2.2).
          expect(secondSave.body.id).toBe(firstSave.body.id);

          // Values are the second payload's, in full — not a merge of the two
          // (Req 2.3).
          const expected = storedShapeOf(studentId, date, second);
          expect(mapRow(rows[0])).toMatchObject(expected);
          expect(secondSave.body).toMatchObject(expected);

          await clearStudent(studentId);
        }
      ),
      { numRuns: 12 }
    );
  });

  // -------------------------------------------------------------------------
  // PUT onto an occupied date: 23505 → 409 (Req 2.8)
  // -------------------------------------------------------------------------

  it('answers 409 and changes neither row when a PUT moves an evaluation onto an occupied date', async () => {
    const studentId = SYNTHETIC_MIN + 1;
    await clearStudent(studentId);

    const occupied = '2026-03-02';
    const moving = '2026-03-09';
    const base = {
      concept: 3, building: 3, problemSolving: 3, focus: 3, attitude: 3,
      lessonTopic: 'Gears', instructorNotes: 'steady', instructorName: 'Budi',
    };

    const kept = await post({ studentId, date: occupied, ...base });
    const target = await post({ studentId, date: moving, ...base, lessonTopic: 'Loops' });
    expect(kept.status).toBe(200);
    expect(target.status).toBe(200);

    const before = await rowsFor(studentId);
    expect(before).toHaveLength(2);

    const clash = await put({
      id: target.body.id, studentId, date: occupied, ...base, lessonTopic: 'Moved',
    });

    // 409, naming the clashing date and pointing at the existing day (Req 2.8).
    expect(clash.status).toBe(409);
    expect(clash.body.error).toContain(occupied);
    expect(clash.body.error).toMatch(/open that day to edit it/i);

    // Both rows unchanged in field values (Req 2.8).
    expect(await rowsFor(studentId)).toEqual(before);

    await clearStudent(studentId);
  });

  // -------------------------------------------------------------------------
  // The constraints themselves, bypassing the route (Req 1.1, 1.6)
  // -------------------------------------------------------------------------

  it('refuses a direct duplicate insert for the same (student_id, eval_date)', async () => {
    const studentId = SYNTHETIC_MIN + 2;
    await clearStudent(studentId);

    const insert = () => query(
      `INSERT INTO ${TABLE}
         (student_id, eval_date, concept, building, problem_solving, focus, attitude)
       VALUES ($1, '2026-04-01'::date, 3, 3, 3, 3, 3)`,
      [studentId]
    );

    await insert();
    // No ON CONFLICT clause here: this is the UNIQUE constraint refusing the
    // duplicate day, not the route's upsert absorbing it (Req 1.1).
    const failure = await insert().then(() => null, (err) => err);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.code).toBe('23505');
    expect(failure.constraint).toBe('internal_student_evaluations_student_date_key');

    expect(await syntheticCount()).toBe(1);
    await clearStudent(studentId);
  });

  it('refuses 0, 6 and NULL on every one of the five score columns', async () => {
    const studentId = SYNTHETIC_MIN + 3;
    await clearStudent(studentId);

    for (const column of SCORE_COLUMNS) {
      const others = SCORE_COLUMNS.filter((c) => c !== column);
      for (const [value, expectedCode] of [[0, '23514'], [6, '23514'], [null, '23502']]) {
        const failure = await query(
          `INSERT INTO ${TABLE}
             (student_id, eval_date, ${column}, ${others.join(', ')})
           VALUES ($1, '2026-05-01'::date, $2, 3, 3, 3, 3)`,
          [studentId, value]
        ).then(() => null, (err) => err);

        // A write that bypasses the validator is refused by the store itself
        // (Req 1.6).
        expect(failure, `${column} = ${value} should have been refused`).toBeInstanceOf(Error);
        expect(failure.code, `${column} = ${value}`).toBe(expectedCode);
      }
    }

    expect(await syntheticCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Provisioning (Req 2.13)
  // -------------------------------------------------------------------------

  /**
   * A fresh copy of the schema module, so its per-process provisioning cache
   * starts empty. Each copy imports its own `@/lib/db`, hence its own pool,
   * which the returned `close` ends.
   */
  async function freshSchemaModule() {
    vi.resetModules();
    const db = await import('@/lib/db');
    const schema = await import('@/lib/ensureSchema');
    return {
      ensureTable: schema.ensureTable,
      close: async () => { await db.default().end(); },
    };
  }

  const tableExists = async () => Number((await query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_name = $1`,
    [TABLE]
  )).rows[0].n);

  const hasEvalDate = async () => Number((await query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = $1 AND column_name = 'eval_date'`,
    [TABLE]
  )).rows[0].n);

  it('provisions the table twice without error and leaves exactly one of it', async () => {
    await query(`DROP TABLE IF EXISTS ${TABLE} CASCADE`);

    const first = await freshSchemaModule();
    try {
      await expect(first.ensureTable(TABLE)).resolves.toBeUndefined();
    } finally {
      await first.close();
    }

    // A second, uncached provision runs the same DDL against a table that now
    // exists. Everything is IF NOT EXISTS, so it is a no-op (Req 2.13).
    const second = await freshSchemaModule();
    try {
      await expect(second.ensureTable(TABLE)).resolves.toBeUndefined();
    } finally {
      await second.close();
    }

    expect(await tableExists()).toBe(1);
    expect(await hasEvalDate()).toBe(1);

    // Still usable, with its constraints intact.
    const studentId = SYNTHETIC_MIN + 4;
    await clearStudent(studentId);
    const saved = await post({
      studentId, date: '2026-06-01', concept: 4, building: 4, problemSolving: 4,
      focus: 4, attitude: 4, lessonTopic: null, instructorNotes: null, instructorName: null,
    });
    expect(saved.status).toBe(200);
    await clearStudent(studentId);
  });

  it('retries provisioning after a failure rather than caching it', async () => {
    // A decoy relation under the same name: `CREATE TABLE IF NOT EXISTS` skips
    // it, and the index step then fails on the missing `eval_date` column. That
    // is a provisioning failure caused by the database, not by a bad argument.
    // `student_id` is present so the failure lands on `eval_date` specifically.
    await query(`DROP TABLE IF EXISTS ${TABLE} CASCADE`);
    await query(`CREATE TABLE ${TABLE} (id SERIAL PRIMARY KEY, student_id INTEGER)`);

    const schema = await freshSchemaModule();
    try {
      await expect(schema.ensureTable(TABLE)).rejects.toThrow(/eval_date/i);
      expect(await hasEvalDate()).toBe(0);

      // Clear the fault. A cached failure would keep rejecting; the next call
      // must attempt provisioning again (Req 2.13).
      await query(`DROP TABLE IF EXISTS ${TABLE} CASCADE`);
      await expect(schema.ensureTable(TABLE)).resolves.toBeUndefined();
    } finally {
      await schema.close();
    }

    expect(await tableExists()).toBe(1);
    expect(await hasEvalDate()).toBe(1);
  });
});
