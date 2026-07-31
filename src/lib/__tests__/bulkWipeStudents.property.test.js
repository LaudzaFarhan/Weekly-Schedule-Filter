// Feature: student-data-bulk-wipe, Property 7: A wipe deletes the registry and exactly its keyed side data
//
// The wipe is a set-valued database transform, so it is checked against an
// in-memory model of PostgreSQL: a fake pooled `pg` client holding the seven
// tables as arrays. The fake interprets each statement by the table it deletes
// from, then applies the matching rule stated in the requirements — not the SQL
// text the service happens to send:
//
//   internal_live_progress   -> Req 4.3 / 4.11 / 4.12: rows whose student name
//                               equals a non-blank student name after removing
//                               leading and trailing whitespace and
//                               disregarding letter case, every such row.
//   internal_student_history -> Req 4.2: rows whose student identifier is an
//                               exact, character-for-character match of a
//                               student record's identifier.
//   internal_students        -> Req 4.1 / 4.8 / 9.2: every row held when the
//                               transaction started, unconditionally.
//   protected tables         -> Req 4.5 / 4.10: a delete against one of these
//                               is a failure, not a modelled outcome.
//
// Generated names use the ASCII space as their only whitespace character and
// ASCII letters as their only cased characters, which is the region where
// PostgreSQL's `btrim`/`lower` and JavaScript's `trim`/`toLowerCase` agree, so
// the model cannot drift from real SQL over folding edge cases. Task 12.1
// checks the model itself against a real database.
//
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 4.9, 4.10, 4.11, 4.13, 9.2**

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fc from 'fast-check';

const { connectMock, ensureTableMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  ensureTableMock: vi.fn(),
}));

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

// The service calls `ensureTable` twice before opening the transaction. Table
// creation is not part of this property, so it is a no-op here.
vi.mock('@/lib/ensureSchema', () => ({
  ensureTable: ensureTableMock,
}));

// `db.js` reads `process.env.DATABASE_URL` at module scope.
let bulkWipeStudents;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://tester:secret@localhost:5432/wipe_test';
  ({ bulkWipeStudents } = await import('@/lib/bulkWipeStudents'));
});

beforeEach(() => {
  connectMock.mockReset();
  ensureTableMock.mockReset();
  ensureTableMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// The model: requirement rules, expressed once
// ---------------------------------------------------------------------------

const KEYED_TABLES = ['internal_students', 'internal_student_history', 'internal_live_progress'];

const PROTECTED_TABLES = [
  'internal_classes',
  'internal_instructors',
  'internal_leaves',
  'internal_operationals',
  'new_crm_leads',
];

/** Req 4.11: trim, then disregard letter case. */
const foldName = (value) => String(value ?? '').trim().toLowerCase();

/** Req 4.2: an identifier match is character for character. */
const foldId = (value) => String(value ?? '');

/** Req 4.11 / 4.12: names that select nothing are those blank after trimming. */
function matchableStudentNames(students) {
  return new Set(students.map((s) => foldName(s.name)).filter((name) => name !== ''));
}

function studentIdentifiers(students) {
  return new Set(students.map((s) => foldId(s.id)));
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/** The table a statement deletes from, or null for any other statement. */
function deleteTarget(sql) {
  const match = /^\s*delete\s+from\s+([a-z_][a-z0-9_]*)/i.exec(sql);
  return match ? match[1].toLowerCase() : null;
}

const isConditional = (sql) => /\bwhere\b/i.test(sql);

const isBegin = (sql) => /^\s*begin\b/i.test(sql);
const isCommit = (sql) => /^\s*commit\b/i.test(sql);
const isRollback = (sql) => /^\s*rollback\b/i.test(sql);

/**
 * A fake pooled `pg` client standing in for PostgreSQL over the seven tables.
 *
 * Transaction semantics are modelled rather than assumed (Req 6.1, 6.2, 6.3):
 * `BEGIN` snapshots the committed tables into a working copy, the deletions
 * apply to that working copy only, `COMMIT` publishes it, and `ROLLBACK` — or
 * an abandoned transaction — discards it. `state` is therefore the *committed*
 * view at all times, so a rolled-back wipe cannot appear to have changed
 * anything just because the model applied its deletes eagerly.
 *
 * @param {object} initialState table name -> array of rows
 * @param {{ failOn?: string|null, failureReason?: string }} [options]
 *   `failOn` names the table whose delete should fail, standing in for any
 *   deletion failure or lost connection at that point of the transaction.
 */
function createFakeDatabase(initialState, { failOn = null, failureReason = null } = {}) {
  const committed = clone(initialState);
  const statements = [];
  let working = null;

  function runStatement(sql) {
    if (isBegin(sql)) {
      if (working) throw new Error('the wipe opened a transaction inside a transaction');
      working = clone(committed);
      return { rowCount: 0, rows: [] };
    }
    if (isCommit(sql)) {
      if (!working) throw new Error('the wipe committed without an open transaction');
      // Publish in place so references already held onto `state` stay valid.
      Object.assign(committed, clone(working));
      working = null;
      return { rowCount: 0, rows: [] };
    }
    if (isRollback(sql)) {
      // Every deletion of this transaction is discarded (Req 6.2, 6.3).
      working = null;
      return { rowCount: 0, rows: [] };
    }

    const target = deleteTarget(sql);
    if (!target) return { rowCount: 0, rows: [] }; // SET LOCAL, advisory lock

    if (PROTECTED_TABLES.includes(target)) {
      throw new Error(`the wipe deleted from the protected table ${target}`);
    }
    if (!KEYED_TABLES.includes(target)) {
      throw new Error(`the wipe deleted from an unmodelled table: ${target}`);
    }
    if (!working) {
      throw new Error(`the wipe deleted from ${target} outside a transaction`);
    }
    if (failOn === target) {
      // Injected failure: the statement changes nothing, exactly as a failed
      // statement or a lost connection would not.
      throw new Error(failureReason || `injected failure deleting from ${target}`);
    }

    const before = working[target].length;

    if (target === 'internal_live_progress') {
      // Req 4.4: unmatched rows have to survive, so this delete must be
      // conditional at all.
      if (!isConditional(sql)) {
        throw new Error('the live progress delete was unconditional, so unmatched rows could not survive');
      }
      const names = matchableStudentNames(working.internal_students);
      working.internal_live_progress = working.internal_live_progress.filter(
        (row) => !names.has(foldName(row.student_name)),
      );
    } else if (target === 'internal_student_history') {
      // Req 4.13: history rows matching no student have to survive.
      if (!isConditional(sql)) {
        throw new Error('the branch history delete was unconditional, so unmatched rows could not survive');
      }
      const ids = studentIdentifiers(working.internal_students);
      working.internal_student_history = working.internal_student_history.filter(
        (row) => !ids.has(foldId(row.student_id)),
      );
    } else {
      // Req 4.1 / 4.8 / 9.2: every student record, no predicate.
      if (isConditional(sql)) {
        throw new Error('the student delete carried a predicate, so it could not clear the whole registry');
      }
      working.internal_students = [];
    }

    return { rowCount: before - working[target].length, rows: [] };
  }

  const client = {
    query: vi.fn(async (text, params) => {
      const sql = String(text);
      statements.push({ sql, params });
      return runStatement(sql);
    }),
    release: vi.fn(),
  };

  return { state: committed, statements, client };
}

/** Run one wipe against an existing fake database, with arbitrary extra call arguments. */
async function runWipeOn(db, callArgs = []) {
  connectMock.mockResolvedValue(db.client);
  return bulkWipeStudents(...callArgs);
}

/** Run one wipe against a fresh copy of `initialState`, with arbitrary extra call arguments. */
async function runWipe(initialState, callArgs = []) {
  const db = createFakeDatabase(initialState);
  const counts = await runWipeOn(db, callArgs);
  return { ...db, counts };
}

/** The three tables a wipe may change, for before/after comparison. */
const keyedTablesOf = (state) => ({
  internal_students: state.internal_students,
  internal_student_history: state.internal_student_history,
  internal_live_progress: state.internal_live_progress,
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Names a student record may hold. Reused so duplicates and folded matches occur. */
const BASE_NAMES = ['ana lim', 'Ben Tan', 'CARA WU', 'dee'];

/** Names no student record ever holds, so they can never fold onto one. */
const FOREIGN_NAMES = ['zephyr', 'Quinn Roe', 'OMAR K'];

const BLANK_NAMES = ['', ' ', '   ', '  '];

/** Same name, arbitrarily re-cased and padded with spaces — folds onto the original. */
const variantOf = (name) =>
  fc
    .tuple(
      fc.array(fc.constant(' '), { maxLength: 3 }).map((p) => p.join('')),
      fc.array(fc.constant(' '), { maxLength: 3 }).map((p) => p.join('')),
      fc.constantFrom('same', 'upper', 'lower'),
    )
    .map(([before, after, casing]) => {
      const cased =
        casing === 'upper' ? name.toUpperCase() : casing === 'lower' ? name.toLowerCase() : name;
      return `${before}${cased}${after}`;
    });

/** Student names: blank, plain, and padded / re-cased duplicates of the same few values. */
const studentNameArb = fc.oneof(
  { arbitrary: fc.constantFrom(...BLANK_NAMES), weight: 1 },
  { arbitrary: fc.constantFrom(...BASE_NAMES), weight: 3 },
  { arbitrary: fc.constantFrom(...BASE_NAMES).chain(variantOf), weight: 3 },
);

const studentArb = fc.record({
  id: fc.integer({ min: 1, max: 40 }),
  name: studentNameArb,
  level: fc.constantFrom('L1', 'L2', 'Prep', null),
  branchName: fc.constantFrom('Bintaro', 'Kelapa Gading', 'Pluit'),
  status: fc.constantFrom('Active', 'Inactive', 'Trial', 'Graduated'),
});

const studentsArb = fc.uniqueArray(studentArb, { selector: (s) => s.id, maxLength: 8 });

/** Branch history rows: some keyed to a generated student, some to no student at all. */
function historyArb(students) {
  const ids = students.map((s) => s.id);
  const studentIdArb = ids.length
    ? fc.oneof(fc.constantFrom(...ids), fc.integer({ min: 100, max: 140 }))
    : fc.integer({ min: 100, max: 140 });
  return fc.array(
    fc.record({
      id: fc.integer({ min: 1, max: 500 }),
      student_id: studentIdArb,
      from_branch: fc.constantFrom('Bintaro', 'Pluit'),
      to_branch: fc.constantFrom('Kelapa Gading', 'Pluit'),
    }),
    { maxLength: 8 },
  );
}

/** Live progress rows: exact matches, folded matches, blanks and unmatched names. */
function progressArb(students) {
  const names = students.map((s) => s.name);
  const nameArb = names.length
    ? fc.oneof(
        { arbitrary: fc.constantFrom(...names), weight: 3 },
        { arbitrary: fc.constantFrom(...names).chain(variantOf), weight: 3 },
        { arbitrary: fc.constantFrom(...FOREIGN_NAMES), weight: 2 },
        { arbitrary: fc.constantFrom(...BLANK_NAMES), weight: 1 },
      )
    : fc.oneof(fc.constantFrom(...FOREIGN_NAMES), fc.constantFrom(...BLANK_NAMES));
  return fc.array(
    fc.record({
      id: fc.integer({ min: 1, max: 500 }),
      student_name: nameArb,
      program_code: fc.constantFrom('PIANO', 'VIOLIN', 'DRUMS'),
      category: fc.constantFrom('Junior', 'Senior'),
    }),
    { maxLength: 8 },
  );
}

/** Protected-table rows, deliberately including names that fold onto student names (Req 4.10). */
const protectedNameArb = fc.oneof(
  fc.constantFrom(...BASE_NAMES),
  fc.constantFrom(...BASE_NAMES).chain(variantOf),
  fc.constantFrom(...FOREIGN_NAMES),
);

const protectedTablesArb = fc.record({
  internal_classes: fc.array(
    fc.record({
      id: fc.integer({ min: 1, max: 200 }),
      student: protectedNameArb,
      day: fc.constantFrom('Mon', 'Sat'),
      time: fc.constantFrom('09:00', '15:30'),
    }),
    { maxLength: 5 },
  ),
  internal_instructors: fc.array(
    fc.record({ id: fc.integer({ min: 1, max: 200 }), name: protectedNameArb }),
    { maxLength: 4 },
  ),
  internal_leaves: fc.array(
    fc.record({ id: fc.integer({ min: 1, max: 200 }), instructor: protectedNameArb, date: fc.constantFrom('2026-01-02') }),
    { maxLength: 4 },
  ),
  internal_operationals: fc.array(
    fc.record({ id: fc.integer({ min: 1, max: 200 }), key: fc.constantFrom('maxLoad', 'openHour'), value: fc.constantFrom('8', '09:00') }),
    { maxLength: 4 },
  ),
  new_crm_leads: fc.array(
    fc.record({ id: fc.integer({ min: 1, max: 200 }), name: protectedNameArb, phone: fc.constantFrom('0811', '0822') }),
    { maxLength: 4 },
  ),
});

/** Filter-shaped arguments passed alongside the request (Req 4.9). */
const filterArgsArb = fc.array(
  fc.oneof(
    fc.record({
      search: fc.string({ maxLength: 6 }),
      branch: fc.constantFrom('Bintaro', 'Pluit', ''),
      status: fc.constantFrom('Active', 'Inactive', ''),
      level: fc.constantFrom('L1', ''),
    }),
    fc.constantFrom('Active', 'Bintaro'),
    fc.constant(null),
  ),
  { maxLength: 2 },
);

const databaseStateArb = studentsArb.chain((students) =>
  fc
    .tuple(historyArb(students), progressArb(students), protectedTablesArb)
    .map(([history, progress, protectedRows]) => ({
      internal_students: students,
      internal_student_history: history,
      internal_live_progress: progress,
      ...protectedRows,
    })),
);

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('Property 7: A wipe deletes the registry and exactly its keyed side data', () => {
  it('clears the registry, removes exactly the keyed side data, and leaves every other row alone', async () => {
    await fc.assert(
      fc.asyncProperty(databaseStateArb, filterArgsArb, async (initialState, filterArgs) => {
        // Two runs from the same starting state: one plain, one with arbitrary
        // filter-shaped arguments alongside the request (Req 4.9).
        const plain = await runWipe(initialState);
        const filtered = await runWipe(initialState, filterArgs);

        const matchable = matchableStudentNames(initialState.internal_students);
        const ids = studentIdentifiers(initialState.internal_students);

        const survivingHistory = initialState.internal_student_history.filter(
          (row) => !ids.has(foldId(row.student_id)),
        );
        const survivingProgress = initialState.internal_live_progress.filter(
          (row) => !matchable.has(foldName(row.student_name)),
        );

        for (const run of [plain, filtered]) {
          // Req 4.1, 4.8, 9.2: zero student records at the point of commit.
          expect(run.state.internal_students).toEqual([]);

          // Req 4.2, 4.13: history rows keyed to a student go, orphans stay
          // with their field values intact.
          expect(run.state.internal_student_history).toEqual(survivingHistory);

          // Req 4.3, 4.4, 4.11: every folded match goes, including duplicates
          // sharing a name; unmatched and blank names stay untouched.
          expect(run.state.internal_live_progress).toEqual(survivingProgress);

          // Req 4.5, 4.10: protected tables unchanged in count and in values,
          // including class student-name text and matching instructor/lead names.
          for (const table of PROTECTED_TABLES) {
            expect(run.state[table]).toEqual(initialState[table]);
            expect(run.statements.some((s) => s.sql.includes(table))).toBe(false);
          }

          expect(run.counts.deletedStudents).toBe(initialState.internal_students.length);
          expect(run.counts.deletedHistory).toBe(
            initialState.internal_student_history.length - survivingHistory.length,
          );
          expect(run.counts.deletedProgress).toBe(
            initialState.internal_live_progress.length - survivingProgress.length,
          );
        }

        // Req 4.9: the filter arguments changed nothing at all.
        expect(filtered.state).toEqual(plain.state);
        expect(filtered.counts).toEqual(plain.counts);
      }),
      { numRuns: 100 },
    );
  });

  it('selects no live progress record on the basis of a blank or whitespace-only student name', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.record({
            id: fc.integer({ min: 1, max: 40 }),
            name: fc.constantFrom(...BLANK_NAMES),
            branchName: fc.constantFrom('Bintaro', 'Pluit'),
            status: fc.constantFrom('Active', 'Inactive'),
          }),
          { selector: (s) => s.id, minLength: 1, maxLength: 5 },
        ),
        fc.array(
          fc.record({
            id: fc.integer({ min: 1, max: 200 }),
            student_name: fc.oneof(fc.constantFrom(...BLANK_NAMES), fc.constantFrom(...FOREIGN_NAMES)),
            program_code: fc.constantFrom('PIANO', 'VIOLIN'),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (students, progress) => {
          const initialState = {
            internal_students: students,
            internal_student_history: [],
            internal_live_progress: progress,
            internal_classes: [],
            internal_instructors: [],
            internal_leaves: [],
            internal_operationals: [],
            new_crm_leads: [],
          };

          const run = await runWipe(initialState);

          // Req 4.11, 4.12: blank student names match nothing, so every
          // progress row survives even though the registry is emptied.
          expect(run.state.internal_live_progress).toEqual(progress);
          expect(run.counts.deletedProgress).toBe(0);
          expect(run.state.internal_students).toEqual([]);
          expect(run.counts.deletedStudents).toBe(students.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8
// ---------------------------------------------------------------------------

// Feature: student-data-bulk-wipe, Property 8: A failed wipe changes nothing
//
// The failure is injected at each of the three deletions in turn, standing in
// for any deletion failure or a connection lost before commit. At this layer
// `bulkWipeStudents` propagates the failure reason by throwing; mapping that to
// status 500 is the route's job and is covered by task 7.2. What is checked here
// is the half of Req 6.2 this layer owns — the transaction is discarded — plus
// Req 6.3 in full.
//
// **Validates: Requirements 6.2, 6.3**

/** Failure reasons a deletion or a lost connection can produce. */
const failureReasonArb = fc.constantFrom(
  'deadlock detected',
  'connection terminated unexpectedly',
  'permission denied for table internal_students',
  'could not serialize access due to concurrent update',
);

describe('Property 8: A failed wipe changes nothing', () => {
  it('rolls back and leaves the three tables at their pre-wipe counts and values, whichever deletion fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        databaseStateArb,
        fc.constantFrom(...KEYED_TABLES),
        failureReasonArb,
        async (initialState, failOn, failureReason) => {
          const db = createFakeDatabase(initialState, { failOn, failureReason });

          // Req 6.2: the failure reaches the caller, which is what lets the
          // route return it as the reason on its 500.
          let thrown = null;
          try {
            await runWipeOn(db);
          } catch (error) {
            thrown = error;
          }
          expect(thrown).toBeInstanceOf(Error);
          expect(thrown.message).toContain(failureReason);

          // Req 6.2: the transaction was rolled back, never committed.
          const kinds = db.statements.map((s) => s.sql);
          expect(kinds.some(isRollback)).toBe(true);
          expect(kinds.some(isCommit)).toBe(false);

          // Req 6.3: same record counts and same field values as before the
          // wipe started, for all three tables — including the deletions that
          // had already succeeded before the failing one.
          expect(keyedTablesOf(db.state)).toEqual(keyedTablesOf(initialState));
          for (const table of KEYED_TABLES) {
            expect(db.state[table]).toHaveLength(initialState[table].length);
          }

          // The protected tables were never in scope to begin with.
          for (const table of PROTECTED_TABLES) {
            expect(db.state[table]).toEqual(initialState[table]);
          }

          // The pooled client goes back to the pool on the failure path too.
          expect(db.client.release).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

// Feature: student-data-bulk-wipe, Property 9: Wiping is idempotent
//
// Both runs share one fake database instance, so the second wipe sees exactly
// what the first one committed. Requirement 9.1 is about the elapsed time since
// the preceding wipe being irrelevant, which this models by running the second
// wipe immediately.
//
// **Validates: Requirements 6.5, 9.1**

describe('Property 9: Wiping is idempotent', () => {
  it('leaves the same final state as a single wipe and reports three zero counts on the second run', async () => {
    await fc.assert(
      fc.asyncProperty(databaseStateArb, async (initialState) => {
        const db = createFakeDatabase(initialState);

        const firstCounts = await runWipeOn(db);
        const afterFirst = clone(db.state);

        const secondCounts = await runWipeOn(db);

        // Req 6.5, 9.1: a wipe over an empty registry still succeeds, and
        // reports zero for all three data sets.
        expect(secondCounts).toEqual({
          deletedStudents: 0,
          deletedHistory: 0,
          deletedProgress: 0,
        });

        // Running it twice leaves what running it once left.
        expect(db.state).toEqual(afterFirst);

        // And that is the same state a single wipe from the same start reaches.
        const once = await runWipe(initialState);
        expect(db.state).toEqual(once.state);
        expect(firstCounts).toEqual(once.counts);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

// Feature: student-data-bulk-wipe, Property 10: Every success response carries three non-negative integer counts
//
// **Validates: Requirements 7.1**

const COUNT_KEYS = ['deletedStudents', 'deletedHistory', 'deletedProgress'];

const emptyDatabaseStateArb = fc.constant({
  internal_students: [],
  internal_student_history: [],
  internal_live_progress: [],
  internal_classes: [],
  internal_instructors: [],
  internal_leaves: [],
  internal_operationals: [],
  new_crm_leads: [],
});

describe('Property 10: Every success response carries three non-negative integer counts', () => {
  it('reports all three counts as integers of 0 or greater, including when a count is 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof({ arbitrary: databaseStateArb, weight: 4 }, { arbitrary: emptyDatabaseStateArb, weight: 1 }),
        async (initialState) => {
          const { counts, state } = await runWipe(initialState);

          // The wipe committed, so this is a success response.
          expect(state.internal_students).toEqual([]);

          for (const key of COUNT_KEYS) {
            // Req 7.1: present even at 0, so a zero count is reported rather
            // than dropped by a falsy check anywhere downstream.
            expect(Object.prototype.hasOwnProperty.call(counts, key)).toBe(true);
            expect(counts[key]).not.toBeUndefined();
            expect(Number.isInteger(counts[key])).toBe(true);
            expect(counts[key]).toBeGreaterThanOrEqual(0);
          }

          expect(Object.keys(counts).sort()).toEqual([...COUNT_KEYS].sort());
        },
      ),
      { numRuns: 100 },
    );
  });
});
