// @vitest-environment node
//
// Feature: student-data-bulk-wipe, Property 6: The delete endpoint dispatches by identifier first and by confirmation second
//
// The property is about *dispatch*, so the two data paths the handler can take
// are replaced by mocks and the assertions are about which one ran:
//
//   @/lib/db `query`            -> the single-record delete (Req 5.4, 5.6)
//   @/lib/bulkWipeStudents      -> the bulk wipe (Req 5.1)
//
// Both mocks operate on one in-memory store holding the student registry, the
// branch history and the live progress records, so "deletes no record and
// leaves the three data sets unchanged" is checked as a value comparison
// against the pre-request snapshot rather than as a call-count assertion alone
// (Req 5.2, 5.5).
//
// Generated request bodies cover an unparseable body, `undefined`, `null`, the
// empty string, whitespace-only strings, non-objects and objects whose
// confirmation value is the exact phrase, a whitespace-padded phrase, a case
// variant, a near miss, blank, absent or not a string. Each body is crossed
// with an identifier present and absent, and present identifiers include both
// one that matches a seeded record and one that matches nothing.
//
// **Validates: Requirements 5.2, 5.4, 5.5, 5.6**

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import { WIPE_CONFIRMATION_PHRASE, matchesConfirmationPhrase } from '@/lib/wipeConfirmation';

const { queryMock, bulkWipeMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  bulkWipeMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  query: queryMock,
}));

vi.mock('@/lib/bulkWipeStudents', () => ({
  bulkWipeStudents: bulkWipeMock,
}));

let DELETE;

beforeAll(async () => {
  ({ DELETE } = await import('@/app/api/new/students/route'));
});

// ---------------------------------------------------------------------------
// The store the two mocked paths act on
// ---------------------------------------------------------------------------

const SEEDED_ID = '7';

function makeStore() {
  return {
    students: [
      { id: SEEDED_ID, name: 'Ada', branch_name: 'Bintaro', status: 'Active' },
      { id: '8', name: 'Budi', branch_name: 'Serpong', status: 'Inactive' },
    ],
    history: [
      { id: 'h1', student_id: SEEDED_ID, from_branch: 'Serpong', to_branch: 'Bintaro' },
      { id: 'h2', student_id: '99', from_branch: 'Bintaro', to_branch: 'Serpong' },
    ],
    progress: [
      { id: 'p1', student_name: 'ada', program_code: 'A1' },
      { id: 'p2', student_name: 'Citra', program_code: 'B2' },
    ],
  };
}

const snapshot = (store) => JSON.parse(JSON.stringify(store));

const SINGLE_DELETE_SQL = 'DELETE FROM internal_students WHERE id = $1 RETURNING *';

/** Installs mocks that mutate `store` exactly as the two real paths would. */
function installPaths(store) {
  queryMock.mockImplementation(async (text, params) => {
    if (text !== SINGLE_DELETE_SQL) {
      throw new Error(`unexpected statement on the single-record path: ${text}`);
    }
    const [id] = params;
    const removed = store.students.filter((s) => String(s.id) === String(id));
    store.students = store.students.filter((s) => String(s.id) !== String(id));
    return { rowCount: removed.length, rows: removed };
  });

  bulkWipeMock.mockImplementation(async () => {
    const counts = {
      deletedStudents: store.students.length,
      deletedHistory: store.history.length,
      deletedProgress: store.progress.length,
    };
    store.students = [];
    store.history = [];
    store.progress = [];
    return counts;
  });
}

/** A request the handler can read: `new URL(req.url)` works and `json()` may reject. */
function makeRequest(id, body) {
  const url = new URL('http://localhost:3000/api/new/students');
  if (id !== null) url.searchParams.set('id', id);
  return {
    url: url.toString(),
    json: async () => {
      if (body.kind === 'unparseable') throw new SyntaxError('Unexpected token < in JSON at position 0');
      return body.value;
    },
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const WHITESPACE = [' ', '  ', '\t', '\n', ' \t \n '];

const whitespaceArb = fc.constantFrom(...WHITESPACE);

/** Identifier absent (null) or present: a seeded id, an unknown id, arbitrary text. */
const idArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant(null) },
  { weight: 2, arbitrary: fc.constant(SEEDED_ID) },
  { weight: 1, arbitrary: fc.constantFrom('8', 'nope', '0', 'abc-123', '  9  ') },
  { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.length > 0) }
);

/** Confirmation values: matching, padded, case-varied, near misses, blank, absent, non-string. */
const confirmValueArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant(WIPE_CONFIRMATION_PHRASE) },
  {
    weight: 3,
    arbitrary: fc
      .tuple(whitespaceArb, whitespaceArb)
      .map(([before, after]) => `${before}${WIPE_CONFIRMATION_PHRASE}${after}`),
  },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'delete all students',
      'Delete All Students',
      'DELETE ALL STUDENT',
      'DELETEALLSTUDENTS',
      'DELETE  ALL  STUDENTS',
      'DELETE ALL STUDENTS!',
      'DELETE ALL STUDENTS DELETE ALL STUDENTS'
    ),
  },
  { weight: 2, arbitrary: fc.constant('') },
  { weight: 2, arbitrary: whitespaceArb },
  { weight: 2, arbitrary: fc.constantFrom(null, undefined) },
  { weight: 2, arbitrary: fc.oneof(fc.integer(), fc.boolean(), fc.constant(0), fc.constant(false)) },
  { weight: 2, arbitrary: fc.string({ maxLength: 30 }) }
);

/** Bodies: unparseable, absent, blank, non-object, or an object with a confirmation value. */
const bodyArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant({ kind: 'unparseable' }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'value', value: undefined }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'value', value: null }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'value', value: '' }) },
  { weight: 2, arbitrary: whitespaceArb.map((value) => ({ kind: 'value', value })) },
  {
    weight: 2,
    arbitrary: fc
      .oneof(fc.integer(), fc.boolean(), fc.string({ maxLength: 20 }), fc.array(fc.string(), { maxLength: 3 }))
      .map((value) => ({ kind: 'value', value })),
  },
  { weight: 2, arbitrary: fc.constant({ kind: 'value', value: {} }) },
  {
    weight: 8,
    arbitrary: confirmValueArb.map((confirm) => ({ kind: 'value', value: { confirm } })),
  },
  {
    weight: 2,
    arbitrary: confirmValueArb.map((confirm) => ({
      kind: 'value',
      value: { confirm, id: SEEDED_ID, unrelated: 'ignored' },
    })),
  }
);

// ---------------------------------------------------------------------------
// The model, stated from the requirements rather than from the handler
// ---------------------------------------------------------------------------

/**
 * 'single' when the query string carries an identifier, whatever the body holds
 * (Req 5.4, 5.6); 'bulk' when there is no identifier and the body carries a
 * confirmation value matching the phrase (Req 5.1); 'reject' otherwise
 * (Req 5.2, 5.5).
 */
function expectedPath(id, body) {
  if (typeof id === 'string' && id.length > 0) return 'single';
  const value = body.kind === 'unparseable' ? undefined : body.value;
  const confirm = value !== null && typeof value === 'object' ? value.confirm : undefined;
  if (confirm === undefined || confirm === null) return 'reject';
  return matchesConfirmationPhrase(String(confirm)) ? 'bulk' : 'reject';
}

beforeEach(() => {
  queryMock.mockReset();
  bulkWipeMock.mockReset();
});

describe('DELETE /api/new/students dispatch', () => {
  it('takes the single-record path on an identifier, the bulk path only on a matching confirmation, and rejects everything else', async () => {
    await fc.assert(
      fc.asyncProperty(idArb, bodyArb, async (id, body) => {
        queryMock.mockReset();
        bulkWipeMock.mockReset();

        const store = makeStore();
        const before = snapshot(store);
        installPaths(store);

        const res = await DELETE(makeRequest(id, body));
        const payload = await res.json();
        const path = expectedPath(id, body);

        if (path === 'single') {
          // Req 5.4, 5.6 — one record deleted by identifier, never a wipe.
          expect(bulkWipeMock).not.toHaveBeenCalled();
          expect(queryMock).toHaveBeenCalledTimes(1);
          expect(queryMock).toHaveBeenCalledWith(SINGLE_DELETE_SQL, [id]);

          const matched = before.students.some((s) => String(s.id) === String(id));
          if (matched) {
            expect(res.status).toBe(200);
            expect(payload.success).toBe(true);
            expect(store.students).toHaveLength(before.students.length - 1);
            expect(store.students.some((s) => String(s.id) === String(id))).toBe(false);
          } else {
            expect(res.status).toBe(404);
            expect(store.students).toEqual(before.students);
          }
          // The keyed side data is never touched by the single-record path.
          expect(store.history).toEqual(before.history);
          expect(store.progress).toEqual(before.progress);
          return;
        }

        if (path === 'bulk') {
          // Req 5.1 — no identifier plus a matching phrase is the only bulk route.
          expect(queryMock).not.toHaveBeenCalled();
          expect(bulkWipeMock).toHaveBeenCalledTimes(1);
          expect(res.status).toBe(200);
          expect(payload).toMatchObject({
            success: true,
            deletedStudents: before.students.length,
            deletedHistory: before.history.length,
            deletedProgress: before.progress.length,
          });
          return;
        }

        // Req 5.2, 5.5 — 400, no database path taken, all three data sets intact.
        expect(res.status).toBe(400);
        expect(typeof payload.error).toBe('string');
        expect(payload.error.length).toBeGreaterThan(0);
        expect(queryMock).not.toHaveBeenCalled();
        expect(bulkWipeMock).not.toHaveBeenCalled();
        expect(store.students).toEqual(before.students);
        expect(store.history).toEqual(before.history);
        expect(store.progress).toEqual(before.progress);
      }),
      { numRuns: 100 }
    );
  });
});
