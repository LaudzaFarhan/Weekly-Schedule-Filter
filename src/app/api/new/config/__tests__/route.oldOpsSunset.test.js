// @vitest-environment node
//
// Example-based checks for the `oldOpsSunset` configuration entry.
//
//   Req 11.1 — the key is in the `SETTINGS` allowlist, its default is `null`,
//              and its description names the expected `"YYYY-MM-DD"` WIB format.
//   Req 11.5 — `null` is an accepted write, so unsetting the date is a reset
//              rather than a way to switch the notice off.
//   Req 11.6 — every real calendar date in `"YYYY-MM-DD"` form is accepted,
//              including the leap day `2028-02-29`.
//   Req 11.7 — anything else is refused with 400 and a message naming the
//              expected `"YYYY-MM-DD"` format, and nothing is written.
//   Req 11.8 — a date in the past is accepted; there is no range check.
//
// `validate` and `SETTINGS` are module-private, so they are exercised through the
// exported `PUT` and `GET` handlers, as the other new-ops route tests do.
// `@/lib/db`, `@/lib/ensureSchema` and `@/lib/apiIdentity` are mocked over one
// in-memory config table, so no database and no session are needed. `isoDayIndex`
// is deliberately *not* mocked: the point of the entry is that the route accepts
// exactly the dates the countdown can count to.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { queryMock, ensureTableMock, auditMock, identifyMock, canAdminMock, isAuthenticatedMock, table } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  ensureTableMock: vi.fn(async () => {}),
  auditMock: vi.fn(async () => {}),
  identifyMock: vi.fn(async () => ({ email: 'admin@example.com', role: 'Admin' })),
  canAdminMock: vi.fn(() => true),
  isAuthenticatedMock: vi.fn(() => true),
  /** key -> { value, updated_at, updated_by }, standing in for `internal_config`. */
  table: new Map(),
}));

vi.mock('@/lib/db', () => ({ query: queryMock }));
vi.mock('@/lib/ensureSchema', () => ({ ensureTable: ensureTableMock }));
vi.mock('@/lib/apiIdentity', () => ({
  identify: identifyMock,
  isAuthenticated: isAuthenticatedMock,
  canAdminAccounts: canAdminMock,
  auditAccountAction: auditMock,
}));

let GET;
let PUT;

beforeAll(async () => {
  ({ GET, PUT } = await import('@/app/api/new/config/route'));
});

beforeEach(() => {
  table.clear();
  auditMock.mockClear();
  ensureTableMock.mockClear();
  canAdminMock.mockClear();
  canAdminMock.mockReturnValue(true);

  queryMock.mockReset();
  queryMock.mockImplementation(async (sql, params = []) => {
    if (sql.startsWith('SELECT key, value, updated_at, updated_by FROM internal_config WHERE key')) {
      const row = table.get(params[0]);
      return { rowCount: row ? 1 : 0, rows: row ? [{ key: params[0], ...row }] : [] };
    }
    if (sql.startsWith('SELECT key, value FROM internal_config')) {
      const rows = [...table.entries()].map(([key, row]) => ({ key, value: row.value }));
      return { rowCount: rows.length, rows };
    }
    if (sql.trim().startsWith('INSERT INTO internal_config')) {
      const [key, json, updatedBy] = params;
      // The column is jsonb, so what comes back out is the parsed value.
      const row = { value: JSON.parse(json), updated_at: '2026-01-01T00:00:00Z', updated_by: updatedBy };
      table.set(key, row);
      return { rowCount: 1, rows: [{ key, ...row }] };
    }
    if (sql.startsWith('DELETE FROM internal_config WHERE key')) {
      const existed = table.delete(params[0]);
      return { rowCount: existed ? 1 : 0, rows: [] };
    }
    throw new Error(`unexpected statement: ${sql}`);
  });
});

const putRequest = (body) => ({
  url: 'http://localhost:3000/api/new/config',
  json: async () => body,
});

const getRequest = (search = '') => ({
  url: `http://localhost:3000/api/new/config${search}`,
});

/** Write `oldOpsSunset` and return `{ status, payload }`. */
async function writeSunset(body) {
  const res = await PUT(putRequest(body));
  return { status: res.status, payload: await res.json() };
}

/** Read the single `oldOpsSunset` entry back through the GET handler. */
async function readSunset() {
  const res = await GET(getRequest('?key=oldOpsSunset'));
  return { status: res.status, payload: await res.json() };
}

describe('the oldOpsSunset entry in the SETTINGS allowlist', () => {
  it('is a known key whose default is null and whose description names the format', async () => {
    const res = await GET(getRequest());
    const payload = await res.json();

    expect(res.status).toBe(200); // Req 11.1: a known key, not an unknown setting
    expect(payload.config).toHaveProperty('oldOpsSunset', null); // the default
    expect(payload.settings.oldOpsSunset).toMatch(/YYYY-MM-DD/);
    expect(payload.settings.oldOpsSunset).toMatch(/WIB/);
  });

  it('reads as null and flagged as the default while nothing is stored', async () => {
    const { status, payload } = await readSunset();

    expect(status).toBe(200); // Req 11.1
    expect(payload).toMatchObject({ key: 'oldOpsSunset', value: null, isDefault: true });
  });
});

describe('PUT /api/new/config with an accepted oldOpsSunset value', () => {
  it('accepts null and stores it, so the shipped constant takes over', async () => {
    const { status, payload } = await writeSunset({ key: 'oldOpsSunset', value: null });

    expect(status).toBe(200); // Req 11.5
    expect(payload).toMatchObject({ key: 'oldOpsSunset', value: null });
    expect(table.get('oldOpsSunset').value).toBe(null);
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the shipped date', '2026-09-01'],
    ['a leap day in a leap year', '2028-02-29'],
    ['another leap day', '2024-02-29'],
    ['a 31-day month end', '2026-12-31'],
    ['a 30-day month end', '2026-04-30'],
    ['the first day of a year', '2027-01-01'],
    ['a four-digit year at the bottom of the range', '0001-01-01'],
    ['a four-digit year at the top of the range', '9999-12-31'],
  ])('accepts %s (%s) and persists it character for character', async (_label, value) => {
    const { status, payload } = await writeSunset({ key: 'oldOpsSunset', value });

    expect(status).toBe(200); // Req 11.6
    expect(payload).toMatchObject({ key: 'oldOpsSunset', value });

    const read = await readSunset();
    expect(read.payload).toMatchObject({ value, isDefault: false });
  });

  it.each([
    ['one day back', '2026-08-31'],
    ['a year back', '2025-09-01'],
    ['ten years back', '2016-09-01'],
  ])('accepts a date in the past (%s, %s) with no range check', async (_label, value) => {
    const { status, payload } = await writeSunset({ key: 'oldOpsSunset', value });

    expect(status).toBe(200); // Req 11.8
    expect(payload).toMatchObject({ key: 'oldOpsSunset', value });
  });
});

describe('PUT /api/new/config with a refused oldOpsSunset value', () => {
  // Every value Req 11.7 names, plus the neighbouring traps: a month or day of
  // zero, a day past the end of the month, and a non-leap 29 February.
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a leading and trailing space', ' 2026-09-01 '],
    ['a trailing space', '2026-09-01 '],
    ['a newline', '2026-09-01\n'],
    ['an unpadded month and day', '2026-9-1'],
    ['a prose date', '1 Sept'],
    ['a long-form date', '1 September 2026'],
    ['a timestamp', '2026-09-01T00:00:00Z'],
    ['a slash-separated date', '2026/09/01'],
    ['a day past the end of February', '2026-02-30'],
    ['a thirteenth month', '2026-13-01'],
    ['29 February in a non-leap year', '2027-02-29'],
    ['a zeroth month', '2026-00-10'],
    ['a zeroth day', '2026-09-00'],
    ['a 31st of a 30-day month', '2026-04-31'],
    ['a number', 20260901],
    ['zero', 0],
    ['true', true],
    ['false', false],
    ['an array', ['2026-09-01']],
    ['an object', { date: '2026-09-01' }],
    ['an empty object', {}],
  ])('refuses %s with 400 and a message naming YYYY-MM-DD, and writes nothing', async (_label, value) => {
    const { status, payload } = await writeSunset({ key: 'oldOpsSunset', value });

    expect(status).toBe(400); // Req 11.7
    expect(payload.error).toBe('Invalid value');
    expect(payload.message).toMatch(/YYYY-MM-DD/);
    expect(payload.message).toMatch(/oldOpsSunset/);

    expect(table.has('oldOpsSunset')).toBe(false);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('refuses an absent value with 400 through the route\'s existing missing-value path', async () => {
    // `value === undefined` is caught before `validate` runs, so the message is
    // the shared one rather than the format message. Still 400, still no write.
    const { status, payload } = await writeSunset({ key: 'oldOpsSunset' });

    expect(status).toBe(400); // Req 11.7
    expect(payload.error).toMatch(/missing value/i);
    expect(table.has('oldOpsSunset')).toBe(false);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('leaves a previously stored date in place when a later write is refused', async () => {
    await writeSunset({ key: 'oldOpsSunset', value: '2026-09-01' });

    const refused = await writeSunset({ key: 'oldOpsSunset', value: '2026-02-30' });
    expect(refused.status).toBe(400); // Req 11.7
    expect(refused.payload.message).toMatch(/YYYY-MM-DD/);

    const read = await readSunset();
    expect(read.payload).toMatchObject({ value: '2026-09-01', isDefault: false });
  });
});
