// @vitest-environment node
//
// Feature: student-report-cards — properties over the two exported helpers of
// `/api/new/student-evaluations`.
//
// Both properties are about PURE functions: `mapRow` maps one row object, and
// `buildEvaluationListQuery` maps one `URLSearchParams`. No request is issued
// and no database is reached — `@/lib/db` and `@/lib/ensureSchema` are mocked
// with functions that throw, so an accidental query fails loudly rather than
// quietly opening a connection to the operational database.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import fc from 'fast-check';

// Pure helper, no database of its own — imported statically so the composed
// statement can be built inside a synchronous property.
import { withLimit } from '@/lib/listQuery';

const { queryMock, ensureTableMock } = vi.hoisted(() => ({
  queryMock: vi.fn(() => {
    throw new Error('the route helpers must not touch the database');
  }),
  ensureTableMock: vi.fn(() => {
    throw new Error('the route helpers must not provision a table');
  }),
}));

vi.mock('@/lib/db', () => ({ query: queryMock }));
vi.mock('@/lib/ensureSchema', () => ({ ensureTable: ensureTableMock }));

let mapRow;
let buildEvaluationListQuery;

beforeAll(async () => {
  ({ mapRow, buildEvaluationListQuery } = await import('@/app/api/new/student-evaluations/route'));
});

// ---------------------------------------------------------------------------
// Property 11 — the documented record shape
// ---------------------------------------------------------------------------

/** The documented `Evaluation` keys, and nothing else (design §Evaluation). */
const DOCUMENTED_KEYS = [
  'id',
  'studentId',
  'date',
  'lessonTopic',
  'lessonNumber',
  'concept',
  'building',
  'problemSolving',
  'focus',
  'attitude',
  'instructorNotes',
  'instructorName',
  'createdAt',
  'updatedAt',
].sort();

/** The stored columns a real row carries. */
const storedRowArb = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  student_id: fc.integer({ min: 1, max: 100_000 }),
  eval_date: fc.oneof(
    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }),
    fc.constantFrom('2025-04-17', '', null, undefined),
  ),
  lesson_topic: fc.oneof(fc.string(), fc.constant(null)),
  concept: fc.integer({ min: 1, max: 5 }),
  building: fc.integer({ min: 1, max: 5 }),
  problem_solving: fc.integer({ min: 1, max: 5 }),
  focus: fc.integer({ min: 1, max: 5 }),
  attitude: fc.integer({ min: 1, max: 5 }),
  instructor_notes: fc.oneof(fc.string(), fc.constant(null)),
  instructor_name: fc.oneof(fc.string(), fc.constant(null)),
  created_at: fc.date({ noInvalidDate: true }),
  updated_at: fc.date({ noInvalidDate: true }),
});

/**
 * Hostile extra column names — the ones a whitelist exists to keep out:
 * snake-case duplicates of documented fields, credential-looking columns, the
 * price/currency/invoice columns Req 4.10 rules out, and prototype keys.
 */
const HOSTILE_KEYS = [
  'eval_date', 'student_id', 'problem_solving', 'lesson_topic', 'instructor_notes',
  'instructor_name', 'created_at', 'updated_at',
  'price', 'price_cents', 'currency', 'currency_code', 'invoice_ref', 'invoice_number',
  'password', 'password_hash', 'api_key', 'secret', 'token', 'DATABASE_URL',
  'internal_notes', 'deleted_at', 'is_current', 'is_start',
  '__proto__', 'constructor', 'prototype', 'toString',
  'Date', 'date ', ' date', 'DATE', 'studentid', 'student-id',
];

const hostileValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constantFrom(null, undefined),
  fc.record({ nested: fc.string(), deeper: fc.record({ leak: fc.string() }) }),
  fc.array(fc.string(), { maxLength: 3 }),
);

const extraColumnsArb = fc.array(
  fc.tuple(
    fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(...HOSTILE_KEYS) },
      { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 12 }) },
    ),
    hostileValueArb,
  ),
  { maxLength: 8 },
);

/**
 * Attach the extras as OWN ENUMERABLE properties without going through
 * assignment, so a generated `__proto__` key becomes a real own key on the row
 * instead of re-pointing its prototype. That is the harder case for a mapper.
 *
 * An extra never replaces a column the row already holds: the stored columns
 * keep the types `pg` actually returns for them (`storedRowArb` covers those),
 * and this property is about columns the row carries IN ADDITION to those.
 */
function withExtras(row, extras) {
  const target = { ...row };
  for (const [key, value] of extras) {
    if (Object.prototype.hasOwnProperty.call(row, key)) continue;
    Object.defineProperty(target, key, {
      value, enumerable: true, writable: true, configurable: true,
    });
  }
  return target;
}

describe('student-evaluations route: mapRow', () => {
  // Feature: student-report-cards, Property 11: `mapRow` is a whitelist
  it('returns exactly the documented keys for a row carrying arbitrary extra columns', () => {
    fc.assert(
      fc.property(storedRowArb, extraColumnsArb, (row, extras) => {
        const mapped = mapRow(withExtras(row, extras));
        const keys = Object.keys(mapped);

        // Exactly the documented keys — every stored column that is not one of
        // them is omitted, however the row was built (Req 2.1).
        expect([...keys].sort()).toEqual(DOCUMENTED_KEYS);

        // Stated as a leak check too, so a failure names the offending key
        // rather than only reporting two unequal arrays (Req 2.1).
        for (const [key] of extras) {
          if (DOCUMENTED_KEYS.includes(key)) continue;
          expect(keys).not.toContain(key);
        }

        // No snake-case key leaves the endpoint, so a column added to the table
        // later cannot appear in the API surface (Req 2.1).
        expect(keys.filter((k) => k.includes('_'))).toEqual([]);

        // No price, currency or invoice key: subscription money is out of scope
        // and the mapper is where that stays true (Req 4.10).
        expect(keys.filter((k) => /price|currenc|invoice/i.test(k))).toEqual([]);

        // `date` is the documented name and is derived from `eval_date`, which
        // is itself never emitted (Req 2.1).
        expect(keys).toContain('date');
        expect(keys).not.toContain('eval_date');
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15 — the list query stays parameterised
// ---------------------------------------------------------------------------

/** SQL-shaped fragments a caller could try to push into the clause. */
const INJECTION_FRAGMENTS = [
  "'; DROP TABLE internal_student_evaluations; --",
  "1 OR 1=1",
  "' OR '1'='1",
  '" OR ""="',
  "\\'; DELETE FROM internal_student_evaluations WHERE true; --",
  "/* block comment */ UNION SELECT password FROM users",
  "eval_date >= '1900-01-01'",
  "2024-01-01'::date OR true--",
  "%_% ESCAPE '\\'",
  "студент’s ünïcode ½ 😀';",
  "$1; SELECT pg_sleep(10)",
  ");--",
];

const NOISE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '.split('');

const noiseArb = fc
  .array(fc.constantFrom(...NOISE_CHARS), { maxLength: 8 })
  .map((chars) => chars.join(''));

/**
 * A caller-supplied value: always carries one injection fragment verbatim, so
 * "this value is not in the clause" is a meaningful check — a fragment cannot
 * coincidentally be a substring of the module's own column names.
 */
const hostileParamArb = fc
  .tuple(noiseArb, fc.constantFrom(...INJECTION_FRAGMENTS), noiseArb)
  .map(([before, fragment, after]) => `${before}${fragment}${after}`);

/** True when a value carries an injection fragment we can search the SQL for. */
const carriesFragment = (value) =>
  typeof value === 'string' && INJECTION_FRAGMENTS.some((f) => value.includes(f));

/** Present, absent or blank — blank must behave as absent, not as a value. */
const optionalParamArb = fc.oneof(
  { weight: 6, arbitrary: hostileParamArb },
  { weight: 1, arbitrary: fc.constantFrom('', '   ') },
  { weight: 1, arbitrary: fc.constant(null) },
);

const limitParamArb = fc.oneof(
  fc.constant(null),
  fc.integer({ min: -20, max: 2000 }).map(String),
  hostileParamArb,
  fc.constantFrom('', '10; DROP TABLE users', '500', '501', '0', 'abc'),
);

const searchParamsArb = fc
  .record({
    search: optionalParamArb,
    studentId: optionalParamArb,
    instructorName: optionalParamArb,
    from: optionalParamArb,
    to: optionalParamArb,
    limit: limitParamArb,
  })
  .map((raw) => {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (value !== null) searchParams.set(key, value);
    }
    return { raw, searchParams };
  });

/** Every `$n` placeholder in a SQL fragment, as numbers, in order. */
const placeholders = (sql) => [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));

describe('student-evaluations route: buildEvaluationListQuery', () => {
  // Feature: student-report-cards, Property 15: The list query stays parameterised
  it('binds every caller value and never writes one into the clause text', () => {
    fc.assert(
      fc.property(searchParamsArb, ({ raw, searchParams }) => {
        const { clause, params, limit } = buildEvaluationListQuery(searchParams);

        // --- placeholder count equals the bind-parameter count (Req 2.4) ----
        const used = placeholders(clause);
        if (params.length === 0) {
          expect(clause).toBe('');
          expect(used).toEqual([]);
        } else {
          expect(Math.max(...used)).toBe(params.length);
          // Every placeholder addresses a supplied parameter: none dangles past
          // the end of the array and none is `$0`.
          for (const n of used) {
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(params.length);
          }
          // And every parameter is addressed, so nothing is pushed unreferenced.
          for (let n = 1; n <= params.length; n += 1) {
            expect(used).toContain(n);
          }
        }

        // --- no caller-supplied value appears as literal text (Req 2.4) -----
        // The clause is built only from the module's own literal column names
        // and `$n` markers, so none of SQL's dangerous punctuation can be in it.
        for (const forbidden of ["'", '"', ';', '\\', '--', '/*', '%']) {
          expect(clause).not.toContain(forbidden);
        }
        // Stated per value as well, so a failure names the value that leaked.
        for (const value of Object.values(raw)) {
          if (!carriesFragment(value)) continue;
          expect(clause).not.toContain(value);
        }

        // --- each supplied filter reached the params array (Req 2.4, 2.5) ---
        // `search` is bound as an ILIKE pattern around the trimmed term; the
        // equality filters and the date bounds are bound verbatim.
        const supplied = (key) => {
          const value = raw[key];
          return typeof value === 'string' && value !== '' ? value : null;
        };
        const search = (supplied('search') ?? '').trim();
        if (search) expect(params).toContain(`%${search}%`);
        for (const key of ['studentId', 'instructorName', 'from', 'to']) {
          const value = supplied(key);
          // A blank string is skipped by the builder, so only non-blank values
          // are expected to be bound.
          if (value) expect(params).toContain(value);
        }

        // --- the limit is never clause text either (Req 2.5) ----------------
        expect(limit === null || (Number.isInteger(limit) && limit > 0 && limit <= 500)).toBe(true);
        expect(clause).not.toContain('LIMIT');
      }),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 15: The list query stays parameterised
  it('keeps the composed list statement parameterised once the limit is appended', () => {
    fc.assert(
      fc.property(searchParamsArb, ({ raw, searchParams }) => {
        const { clause, params, limit } = buildEvaluationListQuery(searchParams);

        // The statement `GET` actually issues, composed here without a request.
        const { sql, params: finalParams } = withLimit(
          `SELECT * FROM internal_student_evaluations ${clause} ORDER BY eval_date ASC, id ASC`,
          params,
          limit,
        );

        // The highest placeholder in the full statement is the last bind
        // parameter, so the limit is bound too rather than interpolated (Req 2.4).
        const used = placeholders(sql);
        if (finalParams.length === 0) expect(used).toEqual([]);
        else expect(Math.max(...used)).toBe(finalParams.length);

        // No caller-supplied text anywhere in the statement (Req 2.4, 2.5).
        for (const value of Object.values(raw)) {
          if (!carriesFragment(value)) continue;
          expect(sql).not.toContain(value);
        }
        for (const forbidden of ["'", '"', ';', '\\', '--', '/*', '%']) {
          expect(sql).not.toContain(forbidden);
        }
      }),
      { numRuns: 100 },
    );
  });
});
