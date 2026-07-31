// @vitest-environment node
//
// Example-based checks for the bounds contract of the terms endpoint.
//
//   Req 2.12 — a request carrying a `termNumber` outside `1..4` or a `year`
//              outside `2000..2100` answers 400 with a message naming the
//              offending field and its permitted bounds, and writes no record.
//   Req 2.11 — the control: a request whose triple is in bounds does reach the
//              store, so "writes nothing" above is a real claim and not a test
//              that would pass against a route which never writes at all.
//
// "Writes nothing" is asserted against the data layer, not against the status
// code: `@/lib/db`'s `query` and `@/lib/ensureSchema`'s `ensureTable` are mocked
// and every call is recorded, so a rejected request has to leave both untouched.
// No real database is contacted.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { queryMock, ensureTableMock, calls } = vi.hoisted(() => {
  const calls = [];
  return {
    calls,
    queryMock: vi.fn(async (sql, params) => {
      calls.push({ kind: 'query', sql, params });
      return { rows: [], rowCount: 0 };
    }),
    ensureTableMock: vi.fn(async (table) => {
      calls.push({ kind: 'ensureTable', table });
    }),
  };
});

vi.mock('@/lib/db', () => ({ query: queryMock }));
vi.mock('@/lib/ensureSchema', () => ({ ensureTable: ensureTableMock }));

let POST;
let PUT;
let GET;

beforeAll(async () => {
  ({ POST, PUT, GET } = await import('@/app/api/new/student-terms/route'));
});

beforeEach(() => {
  calls.length = 0;
  queryMock.mockClear();
  ensureTableMock.mockClear();
});

const postRequest = (body) => ({
  url: 'http://localhost:3000/api/new/student-terms',
  json: async () => body,
});

const getRequest = (search) => ({
  url: `http://localhost:3000/api/new/student-terms${search}`,
});

/** Nothing was written, and the table was not even provisioned. */
function expectNoWrite() {
  expect(queryMock).not.toHaveBeenCalled();
  expect(ensureTableMock).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
}

/**
 * Values a caller plausibly sends that are not an integer in `1..4`: below and
 * above the range, non-integers, and the coercion traps (`''`, `null`, `true`,
 * `[2]`) where `Number(...)` would silently produce an in-range number.
 */
const BAD_TERM_NUMBERS = [0, 5, -1, 2.5, 4.000001, '0', '5', '2.5', 'two', '', '  ', null, true, false, [2], {}, NaN];

/** The same for `year` against `2000..2100`. */
const BAD_YEARS = [1999, 2101, 0, -2024, 2024.5, '1999', '2101', '20 24', 'MMXXIV', '', '   ', null, true, [2024], {}, NaN];

describe('POST /api/new/student-terms with an out-of-bounds termNumber', () => {
  it.each(BAD_TERM_NUMBERS)('answers 400 naming termNumber and its bounds for %o, and writes nothing', async (termNumber) => {
    const res = await POST(postRequest({ studentId: 7, year: 2026, termNumber, paid: true }));
    const payload = await res.json();

    expect(res.status).toBe(400); // Req 2.12
    expect(payload.error).toMatch(/termNumber/); // names the offending field
    expect(payload.error).toMatch(/from 1 to 4/); // and its permitted bounds
    expectNoWrite();
  });

  it('answers 400 naming termNumber when the key is absent altogether', async () => {
    const res = await POST(postRequest({ studentId: 7, year: 2026, paid: true }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/termNumber must be an integer from 1 to 4/),
    });
    expectNoWrite();
  });
});

describe('POST /api/new/student-terms with an out-of-bounds year', () => {
  it.each(BAD_YEARS)('answers 400 naming year and its bounds for %o, and writes nothing', async (year) => {
    const res = await POST(postRequest({ studentId: 7, year, termNumber: 2, paid: true }));
    const payload = await res.json();

    expect(res.status).toBe(400); // Req 2.12
    expect(payload.error).toMatch(/\byear\b/);
    expect(payload.error).toMatch(/from 2000 to 2100/);
    expectNoWrite();
  });

  it('answers 400 naming year when the key is absent altogether', async () => {
    const res = await POST(postRequest({ studentId: 7, termNumber: 2, paid: true }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/year must be an integer from 2000 to 2100/),
    });
    expectNoWrite();
  });

  it('reports the year before the term number when both are out of bounds', async () => {
    const res = await POST(postRequest({ studentId: 7, year: 1999, termNumber: 9 }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/year must be an integer from 2000 to 2100/),
    });
    expectNoWrite();
  });
});

describe('PUT /api/new/student-terms with an out-of-bounds value', () => {
  // The `PUT` path identifies the row by `id`, so the triple is optional there —
  // but a value that is supplied is still bounds-checked before the UPDATE runs.
  it.each([
    ['termNumber', { id: 11, termNumber: 7, paid: true }, /termNumber must be an integer from 1 to 4/],
    ['termNumber', { id: 11, termNumber: '0', note: 'x' }, /termNumber must be an integer from 1 to 4/],
    ['year', { id: 11, year: 2101, paid: true }, /year must be an integer from 2000 to 2100/],
    ['year', { id: 11, year: '1999', note: 'x' }, /year must be an integer from 2000 to 2100/],
  ])('answers 400 naming %s and its bounds, and updates nothing', async (_field, body, message) => {
    const res = await PUT(postRequest(body));

    expect(res.status).toBe(400); // Req 2.12
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(message) });
    expectNoWrite();
  });
});

describe('GET /api/new/student-terms with an out-of-bounds year filter', () => {
  it.each([1999, 2101, 'MMXXIV', '2024.5'])('answers 400 naming year and its bounds for %o without querying', async (year) => {
    const res = await GET(getRequest(`?year=${encodeURIComponent(year)}`));

    expect(res.status).toBe(400); // Req 2.12
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/year must be an integer from 2000 to 2100/),
    });
    expectNoWrite();
  });
});

describe('POST /api/new/student-terms at the edges of the permitted bounds', () => {
  // Req 2.11: the boundary values are accepted and written, which is what makes
  // the "writes nothing" assertions above meaningful.
  it.each([
    [2000, 1],
    [2000, 4],
    [2100, 1],
    [2100, 4],
    [2026, 3],
  ])('writes the record for year %i term %i', async (year, termNumber) => {
    queryMock.mockImplementationOnce(async (sql, params) => {
      calls.push({ kind: 'query', sql, params });
      return {
        rowCount: 1,
        rows: [{
          id: 1, student_id: 7, term_year: year, term_number: termNumber,
          paid: true, paid_at: null, note: null,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
        }],
      };
    });

    const res = await POST(postRequest({ studentId: 7, year, termNumber, paid: true }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ year, termNumber, paid: true });

    // Provisioning first, then exactly one write carrying the triple (Req 2.13).
    expect(calls.map((c) => c.kind)).toEqual(['ensureTable', 'query']);
    expect(ensureTableMock).toHaveBeenCalledWith('internal_student_terms');
    expect(calls[1].sql).toMatch(/INSERT INTO internal_student_terms/);
    expect(calls[1].params.slice(0, 3)).toEqual([7, year, termNumber]);
  });
});
