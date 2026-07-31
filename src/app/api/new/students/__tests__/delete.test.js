// @vitest-environment node
//
// Example-based checks for two branches of the students endpoint that the
// dispatch property cannot express:
//
//   Req 5.7 — `?id=` matching no record answers 404 and deletes nothing.
//   Req 9.7 — an update for a record a completed wipe removed answers 404,
//             and the registry stays at zero records.
//
// Both data paths are mocked over one in-memory store, so no database is needed.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { WIPE_CONFIRMATION_PHRASE } from '@/lib/wipeConfirmation';

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
let PUT;

beforeAll(async () => {
  ({ DELETE, PUT } = await import('@/app/api/new/students/route'));
});

let store;

function makeStore() {
  return {
    students: [
      { id: 7, name: 'Ada', level: 'L1', branch_name: 'Bintaro', parent_name: 'Mira', contact: '0812', status: 'Active', remarks: null },
      { id: 8, name: 'Budi', level: 'L2', branch_name: 'Serpong', parent_name: null, contact: '', status: 'Active', remarks: null },
    ],
    history: [{ id: 'h1', student_id: 7 }],
    progress: [{ id: 'p1', student_name: 'ada' }],
  };
}

beforeEach(() => {
  store = makeStore();

  queryMock.mockReset();
  queryMock.mockImplementation(async (text, params) => {
    if (text.startsWith('DELETE FROM internal_students WHERE id')) {
      const [id] = params;
      const removed = store.students.filter((s) => String(s.id) === String(id));
      store.students = store.students.filter((s) => String(s.id) !== String(id));
      return { rowCount: removed.length, rows: removed };
    }
    if (text.trim().startsWith('UPDATE internal_students')) {
      const id = params[params.length - 1];
      const row = store.students.find((s) => String(s.id) === String(id));
      if (!row) return { rowCount: 0, rows: [] };
      const [name, level, branchName, parentName, contact, status, remarks] = params;
      Object.assign(row, {
        name, level, branch_name: branchName, parent_name: parentName,
        contact, status, remarks,
      });
      return { rowCount: 1, rows: [row] };
    }
    throw new Error(`unexpected statement: ${text}`);
  });

  bulkWipeMock.mockReset();
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
});

const deleteRequest = (search, body) => ({
  url: `http://localhost:3000/api/new/students${search}`,
  json: async () => body,
});

const putRequest = (body) => ({
  url: 'http://localhost:3000/api/new/students',
  json: async () => body,
});

describe('DELETE /api/new/students with an unknown id', () => {
  it('answers 404 with a not-found message and deletes nothing', async () => {
    const res = await DELETE(deleteRequest('?id=4242', { confirm: WIPE_CONFIRMATION_PHRASE }));
    const payload = await res.json();

    expect(res.status).toBe(404); // Req 5.7
    expect(payload.error).toMatch(/not found/i);

    expect(bulkWipeMock).not.toHaveBeenCalled(); // an id never reaches the bulk path
    expect(store).toEqual(makeStore());
  });
});

describe('PUT /api/new/students after a completed wipe', () => {
  it('answers 404 for a record the wipe deleted and leaves the registry at zero records', async () => {
    const wipe = await DELETE(deleteRequest('', { confirm: WIPE_CONFIRMATION_PHRASE }));
    expect(wipe.status).toBe(200);
    await expect(wipe.json()).resolves.toMatchObject({ success: true, deletedStudents: 2 });
    expect(store.students).toHaveLength(0);

    const res = await PUT(putRequest({
      id: 7,
      name: 'Ada Renamed',
      level: 'L1',
      branchName: 'Bintaro',
      parentName: 'Mira',
      contact: '0812',
      status: 'Active',
      remarks: 'edited after the wipe',
    }));
    const payload = await res.json();

    expect(res.status).toBe(404); // Req 9.7
    expect(payload.error).toMatch(/not found/i);
    expect(store.students).toHaveLength(0);
  });
});
