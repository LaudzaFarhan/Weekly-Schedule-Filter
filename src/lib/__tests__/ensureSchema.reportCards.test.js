/**
 * Unit tests for the two report-card schema definitions in
 * `src/lib/ensureSchema.js` (`internal_student_evaluations` and
 * `internal_student_terms`).
 *
 * `DEFINITIONS` is module-private, so the DDL is captured the way the
 * application actually emits it: `./db`'s `query` is mocked and `ensureTable()`
 * is driven once per table, recording every statement it issues. That asserts
 * the SQL that really runs rather than a copy of it.
 *
 * Two claims here are load-bearing for the feature:
 *
 *   - the five score columns are `NOT NULL` with a `BETWEEN 1 AND 5` check, so a
 *     write that bypasses the route validator is refused by the database itself
 *     and no evaluation can hold a score no instructor entered (Req 1.6);
 *   - neither table stores which term is current or which is the start term, and
 *     neither stores money, so "one current term per student" is unrepresentable
 *     rather than merely discouraged (Req 4.4) and billing stays out of scope
 *     (Req 4.10).
 *
 * _Requirements: 1.6, 4.4, 4.10_
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// `vi.mock` factories are hoisted above the imports, so the shared log has to be
// hoisted with them.
const { queryMock, executed } = vi.hoisted(() => {
  const executed = [];
  return {
    executed,
    queryMock: vi.fn(async (sql) => {
      executed.push(sql);
      return { rows: [], rowCount: 0 };
    }),
  };
});

vi.mock('../db', () => ({ query: queryMock }));

const EVALUATIONS = 'internal_student_evaluations';
const TERMS = 'internal_student_terms';

/** The five competency score columns, in the order the design lists them. */
const SCORE_COLUMNS = ['concept', 'building', 'problem_solving', 'focus', 'attitude'];

/** The statement that creates `table`, as `provision()` issued it. */
const createTableOf = (table) =>
  executed.find((sql) => sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`));

/**
 * Column names declared by a `CREATE TABLE` body — table-level `CONSTRAINT`,
 * `UNIQUE` and index lines excluded. Names only, so a `CURRENT_TIMESTAMP`
 * default can never be mistaken for a "current term" column.
 */
const columnNamesOf = (sql) =>
  sql
    .split('\n')
    .map((line) => line.trim())
    .map((line) =>
      /^([a-z_]+)\s+(SERIAL|INTEGER|TEXT|DATE|BOOLEAN|VARCHAR|TIMESTAMP)\b/.exec(line)
    )
    .filter(Boolean)
    .map((match) => match[1]);

let evaluationsSql;
let termsSql;

beforeAll(async () => {
  const { ensureTable } = await import('@/lib/ensureSchema');
  await ensureTable(EVALUATIONS);
  await ensureTable(TERMS);
  evaluationsSql = createTableOf(EVALUATIONS);
  termsSql = createTableOf(TERMS);
});

describe('internal_student_evaluations definition', () => {
  it('is provisioned with a CREATE TABLE statement', () => {
    expect(evaluationsSql).toBeTruthy();
  });

  // Req 1.6: the database refuses a partial or out-of-range evaluation even when
  // the caller never went through `validateEvaluationPayload`.
  it.each(SCORE_COLUMNS)('declares %s as NOT NULL with a 1..5 check', (column) => {
    expect(evaluationsSql).toMatch(
      new RegExp(`\\b${column}\\s+INTEGER\\s+NOT NULL\\s+CHECK\\s*\\(\\s*${column}\\s+BETWEEN 1 AND 5\\s*\\)`)
    );
  });

  it('holds all five score columns and no sixth competency', () => {
    const scoreLike = columnNamesOf(evaluationsSql).filter((name) =>
      SCORE_COLUMNS.includes(name)
    );
    expect(scoreLike.sort()).toEqual([...SCORE_COLUMNS].sort());
  });

  // Req 1.6 / D1: one row per student per day, so re-saving a date edits it.
  it('keys one evaluation per student per day', () => {
    expect(evaluationsSql).toMatch(/UNIQUE\s*\(student_id,\s*eval_date\)/);
  });

  // D3: `date` is a type name; the column is `eval_date` and the API translates.
  it('names the date column eval_date, not date', () => {
    const columns = columnNamesOf(evaluationsSql);
    expect(columns).toContain('eval_date');
    expect(columns).not.toContain('date');
  });

  it('declares no current-term, start-term or billing column', () => {
    expect(columnNamesOf(evaluationsSql)).toEqual(
      expect.not.arrayContaining([
        'is_current',
        'is_start',
        'current_term',
        'start_term',
        'price',
        'currency',
        'invoice',
        'invoice_id',
        'invoice_ref',
      ])
    );
  });
});

describe('internal_student_terms definition', () => {
  it('is provisioned with a CREATE TABLE statement', () => {
    expect(termsSql).toBeTruthy();
  });

  // Req 4.4: one row per student per term per year.
  it('keys one term row per student, year and term number', () => {
    expect(termsSql).toMatch(/UNIQUE\s*\(student_id,\s*term_year,\s*term_number\)/);
  });

  it('names the year column term_year, not year', () => {
    const columns = columnNamesOf(termsSql);
    expect(columns).toContain('term_year');
    expect(columns).not.toContain('year');
  });

  // Req 4.4: "current" and "start" are derived on read, never stored, which is
  // what makes two current terms for one student unrepresentable.
  // Req 4.10: paid flag, paid date and note are the only subscription values.
  it('declares no current-term, start-term or billing column', () => {
    expect(columnNamesOf(termsSql)).toEqual(
      expect.not.arrayContaining([
        'is_current',
        'is_start',
        'current',
        'current_term',
        'start_term',
        'price',
        'amount',
        'currency',
        'invoice',
        'invoice_id',
        'invoice_ref',
      ])
    );
  });

  it('holds paid, paid_at and note as its subscription values', () => {
    const columns = columnNamesOf(termsSql);
    expect(columns).toContain('paid');
    expect(columns).toContain('paid_at');
    expect(columns).toContain('note');
  });
});
