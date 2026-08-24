/**
 * Unit tests for `src/lib/bulkWipeStudents.js`.
 *
 * These are example-based tests, not property tests (the property tests for the
 * deletion scope live in `bulkWipeStudents.property.test.js`). `pg` is mocked so
 * no database is needed, and `ensureTable` is a no-op that records its calls in
 * the same log as the SQL statements — which is what makes both the statement
 * ordering and the "DDL happens before BEGIN" claim assertable.
 *
 * Ordering is asserted explicitly rather than incidentally because two of the
 * orderings carry the correctness of the whole operation:
 *
 *   - the advisory lock must be the FIRST statement inside the transaction,
 *     otherwise a concurrent wipe can interleave part-way through the
 *     deletions (Req 9.6);
 *   - live progress must be deleted BEFORE students, because it is matched by
 *     name and those names only exist while the student rows do. Inverted, the
 *     live progress delete would silently match nothing, forever.
 *
 * _Requirements: 4.12, 6.1, 9.6_
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// `vi.mock` factories are hoisted above the imports, so their shared state has
// to be hoisted with them.
const { connectMock, log, ensureTableMock } = vi.hoisted(() => {
  const log = [];
  return {
    log,
    connectMock: vi.fn(),
    ensureTableMock: vi.fn(async (table) => {
      log.push(`ensureTable:${table}`);
    }),
  };
});

vi.mock('pg', () => ({
  Pool: class FakePool {
    constructor(config) {
      this.config = config;
    }
    connect(...args) {
      return connectMock(...args);
    }
  },
}));

vi.mock('../ensureSchema', () => ({
  ensureTable: ensureTableMock,
}));

// `db.js` reads `process.env.DATABASE_URL` at module scope, so the env var has to
// be in place before the module graph is evaluated — hence the dynamic import.
let bulkWipeStudents;
let WIPE_LOCK_KEY;
let DEFAULT_TRANSACTION_TIMEOUT_MS;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://tester:secret@localhost:5432/wipe_test';
  ({ bulkWipeStudents, WIPE_LOCK_KEY } = await import('@/lib/bulkWipeStudents'));
  ({ DEFAULT_TRANSACTION_TIMEOUT_MS } = await import('@/lib/db'));
});

const SET_TIMEOUT_LABEL = () => `SET LOCAL statement_timeout = ${DEFAULT_TRANSACTION_TIMEOUT_MS}`;

/** Collapse whitespace so multi-line SQL can be matched as one string. */
const flatten = (text) => String(text).replace(/\s+/g, ' ').trim();

/** Short, stable label for each statement the service is expected to emit. */
function label(text) {
  const sql = flatten(text);
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return sql;
  if (sql.startsWith('SET LOCAL')) return sql;
  if (sql.includes('pg_advisory_xact_lock')) return 'pg_advisory_xact_lock';
  if (sql.startsWith('DELETE FROM internal_live_progress')) return 'DELETE internal_live_progress';
  if (sql.startsWith('DELETE FROM internal_student_history')) return 'DELETE internal_student_history';
  if (sql.startsWith('DELETE FROM internal_students')) return 'DELETE internal_students';
  return sql;
}

/**
 * A fake pooled client backed by in-memory tables, applying the same predicates
 * the SQL expresses. State-driven rather than stubbed row counts, so a test can
 * assert which rows survive rather than only which statements ran.
 *
 * @param {{ students?: Array<{id: number, name: any}>,
 *           history?: Array<{id: number, student_id: number}>,
 *           progress?: Array<{id: number, student_name: any}> }} [state]
 */
function makeClient(state = {}) {
  const tables = {
    students: [...(state.students ?? [])],
    history: [...(state.history ?? [])],
    progress: [...(state.progress ?? [])],
  };
  const statements = [];
  const params = [];

  // lower(btrim(x)) — the folded compare the SQL uses (Req 4.11).
  const fold = (value) => String(value ?? '').trim().toLowerCase();

  const client = {
    query: vi.fn(async (text, values) => {
      const tag = label(text);
      statements.push(tag);
      params.push(values);
      log.push(tag);

      if (tag === 'DELETE internal_live_progress') {
        const branchList = values && values[0] ? values[0] : null;
        const matchingStudents = tables.students.filter((s) => {
          const nameOk = String(s.name ?? '').trim() !== '';
          const branchOk = !branchList || branchList.includes(s.branch_name);
          return nameOk && branchOk;
        });
        const names = new Set(matchingStudents.map((s) => fold(s.name)));
        const before = tables.progress.length;
        tables.progress = tables.progress.filter((row) => !names.has(fold(row.student_name)));
        return { rowCount: before - tables.progress.length, rows: [] };
      }

      if (tag === 'DELETE internal_student_history') {
        const branchList = values && values[0] ? values[0] : null;
        const matchingStudents = tables.students.filter((s) => {
          return !branchList || branchList.includes(s.branch_name);
        });
        const ids = new Set(matchingStudents.map((s) => s.id));
        const before = tables.history.length;
        tables.history = tables.history.filter((row) => !ids.has(row.student_id));
        return { rowCount: before - tables.history.length, rows: [] };
      }

      if (tag === 'DELETE internal_students') {
        const branchList = values && values[0] ? values[0] : null;
        const before = tables.students.length;
        if (branchList) {
          tables.students = tables.students.filter((s) => !branchList.includes(s.branch_name));
        } else {
          tables.students = [];
        }
        return { rowCount: before - tables.students.length, rows: [] };
      }

      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };

  connectMock.mockResolvedValue(client);
  return { client, statements, params, tables };
}

beforeEach(() => {
  log.length = 0;
  connectMock.mockReset();
  ensureTableMock.mockClear();
});

describe('bulkWipeStudents — statement ordering (Req 6.1, 9.6)', () => {
  it('emits BEGIN → pg_advisory_xact_lock → live progress → history → students → COMMIT', async () => {
    const { statements, client } = makeClient({
      students: [{ id: 1, name: 'Ada' }],
      history: [{ id: 10, student_id: 1 }],
      progress: [{ id: 20, student_name: 'Ada' }],
    });

    await bulkWipeStudents();

    // The transaction helper's own statement_timeout is the only extra
    // statement; everything else is exactly the required sequence.
    expect(statements).toEqual([
      'BEGIN',
      SET_TIMEOUT_LABEL(),
      'pg_advisory_xact_lock',
      'DELETE internal_live_progress',
      'DELETE internal_student_history',
      'DELETE internal_students',
      'COMMIT',
    ]);
    expect(statements).not.toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('takes the advisory lock before any deletion, on the fixed key', async () => {
    const { statements, params } = makeClient({ students: [{ id: 1, name: 'Ada' }] });

    await bulkWipeStudents();

    const lockIndex = statements.indexOf('pg_advisory_xact_lock');
    const firstDeleteIndex = statements.findIndex((s) => s.startsWith('DELETE'));

    expect(lockIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(firstDeleteIndex);
    // First statement of the transaction proper: nothing but BEGIN and the
    // helper's SET LOCAL may precede it.
    expect(statements.slice(0, lockIndex)).toEqual(['BEGIN', SET_TIMEOUT_LABEL()]);
    expect(params[lockIndex]).toEqual([WIPE_LOCK_KEY]);
    expect(Number.isInteger(WIPE_LOCK_KEY)).toBe(true);
  });

  it('deletes live progress before students, and history before students', async () => {
    const { statements } = makeClient({ students: [{ id: 1, name: 'Ada' }] });

    await bulkWipeStudents();

    const progressIndex = statements.indexOf('DELETE internal_live_progress');
    const historyIndex = statements.indexOf('DELETE internal_student_history');
    const studentsIndex = statements.indexOf('DELETE internal_students');

    expect(progressIndex).toBeLessThan(studentsIndex);
    expect(historyIndex).toBeLessThan(studentsIndex);
    expect(progressIndex).toBeLessThan(historyIndex);
  });

  it('commits only after all three deletions have run (Req 6.1)', async () => {
    const { statements } = makeClient({ students: [{ id: 1, name: 'Ada' }] });

    await bulkWipeStudents();

    const commitIndex = statements.indexOf('COMMIT');
    expect(statements.filter((s) => s.startsWith('DELETE')).length).toBe(3);
    statements.forEach((statement, index) => {
      if (statement.startsWith('DELETE')) expect(index).toBeLessThan(commitIndex);
    });
  });

  it('ensures both keyed tables exist before BEGIN, not inside the transaction', async () => {
    makeClient();

    await bulkWipeStudents();

    expect(ensureTableMock.mock.calls.map(([table]) => table)).toEqual([
      'internal_student_history',
      'internal_live_progress',
    ]);
    // One shared log, so "before BEGIN" is a positional fact rather than an
    // inference: DDL on the pool cannot widen the transaction's rollback surface.
    const beginIndex = log.indexOf('BEGIN');
    expect(log.slice(0, beginIndex)).toEqual([
      'ensureTable:internal_student_history',
      'ensureTable:internal_live_progress',
    ]);
    expect(log.slice(beginIndex).some((entry) => entry.startsWith('ensureTable:'))).toBe(false);
  });

  it('opens no transaction when the schema check fails', async () => {
    makeClient();
    const schemaError = new Error('permission denied for schema public');
    ensureTableMock.mockRejectedValueOnce(schemaError);

    await expect(bulkWipeStudents()).rejects.toBe(schemaError);
    expect(connectMock).not.toHaveBeenCalled();
    expect(log).not.toContain('BEGIN');
  });
});

describe('bulkWipeStudents — blank student names select no live progress (Req 4.12)', () => {
  it('excludes blank and whitespace-only names from the live-progress subquery', async () => {
    const { client } = makeClient({ students: [{ id: 1, name: '   ' }] });

    await bulkWipeStudents();

    const progressSql = flatten(
      client.query.mock.calls.map(([text]) => text).find((text) => label(text) === 'DELETE internal_live_progress')
    );

    expect(progressSql).toContain("WHERE btrim(name) <> ''");
    expect(progressSql).toContain('lower(btrim(student_name)) IN');
    expect(progressSql).toContain('SELECT lower(btrim(name)) FROM internal_students');
  });

  it('leaves a blank-named progress row untouched when a student name is whitespace only', async () => {
    const { tables } = makeClient({
      students: [
        { id: 1, name: '   ' },
        { id: 2, name: '' },
        { id: 3, name: 'Ada Lovelace' },
      ],
      progress: [
        { id: 20, student_name: '' },
        { id: 21, student_name: '  ' },
        { id: 22, student_name: '  ADA lovelace ' },
        { id: 23, student_name: 'Grace Hopper' },
      ],
    });

    const result = await bulkWipeStudents();

    // Only the folded match on a non-blank student name goes.
    expect(tables.progress.map((row) => row.id)).toEqual([20, 21, 23]);
    expect(result.deletedProgress).toBe(1);
    expect(result.deletedStudents).toBe(3);
  });

  it('deletes no live progress at all when every student name is blank', async () => {
    const { tables } = makeClient({
      students: [
        { id: 1, name: '' },
        { id: 2, name: '\t \n' },
      ],
      history: [{ id: 10, student_id: 1 }],
      progress: [{ id: 20, student_name: '' }, { id: 21, student_name: 'Ada' }],
    });

    const result = await bulkWipeStudents();

    expect(result.deletedProgress).toBe(0);
    expect(tables.progress.map((row) => row.id)).toEqual([20, 21]);
    // The blank names still count as students and still take their history.
    expect(result.deletedStudents).toBe(2);
    expect(result.deletedHistory).toBe(1);
  });
});

describe('bulkWipeStudents — response counts (Req 7.1)', () => {
  it('returns all three integer counts on a populated registry', async () => {
    makeClient({
      students: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }],
      history: [{ id: 10, student_id: 1 }, { id: 11, student_id: 99 }],
      progress: [{ id: 20, student_name: 'ada' }, { id: 21, student_name: 'Unmatched' }],
    });

    const result = await bulkWipeStudents();

    expect(Object.keys(result).sort()).toEqual(['deletedHistory', 'deletedProgress', 'deletedStudents']);
    expect(result).toEqual({ deletedStudents: 2, deletedHistory: 1, deletedProgress: 1 });
    Object.values(result).forEach((count) => {
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  it('returns three zero counts on an empty registry (Req 6.5, 9.1)', async () => {
    const { statements } = makeClient();

    const result = await bulkWipeStudents();

    expect(result).toEqual({ deletedStudents: 0, deletedHistory: 0, deletedProgress: 0 });
    expect(statements).toContain('COMMIT');
  });

  it('accepts no arguments that could narrow the wipe (Req 4.9)', async () => {
    expect(bulkWipeStudents.length).toBe(0);

    const { params } = makeClient({ students: [{ id: 1, name: 'Ada' }] });
    await bulkWipeStudents({ branch: 'Bintaro' }, 'Active');

    // Only the advisory lock carries a bind parameter; the deletes are unfiltered.
    expect(params.filter((values) => Array.isArray(values))).toEqual([[WIPE_LOCK_KEY]]);
  });
});

describe('bulkWipeStudents — selective branch deletion', () => {
  it('deletes only students and keyed data for the specified branches', async () => {
    const { tables, client } = makeClient({
      students: [
        { id: 1, name: 'Ada', branch_name: 'Bekasi' },
        { id: 2, name: 'Budi', branch_name: 'Bintaro' },
        { id: 3, name: 'Citra', branch_name: 'Kemang' },
      ],
      history: [
        { id: 10, student_id: 1, branch_name: 'Bekasi' },
        { id: 11, student_id: 2, branch_name: 'Bintaro' },
      ],
      progress: [
        { id: 20, student_name: 'Ada' },
        { id: 21, student_name: 'Budi' },
      ],
    });

    const result = await bulkWipeStudents(['Bekasi']);

    expect(result.deletedStudents).toBe(1);
    expect(tables.students.map((s) => s.id)).toEqual([2, 3]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE branch_name = ANY($1)'),
      [['Bekasi']]
    );
  });
});
