/**
 * Unit tests for the transaction helper in `src/lib/db.js`.
 *
 * These are example-based tests, not property tests. `pg` is mocked so no real
 * database is needed: every `client.query` call is recorded, which is what makes
 * the exact statement ordering assertable.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.8_
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// `vi.mock` is hoisted above the imports, so the mock's shared state has to be
// hoisted with it.
const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));

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

// `db.js` reads `process.env.DATABASE_URL` at module scope, so the env var has to
// be in place before the module is evaluated — hence the dynamic import.
let withTransaction;
let WipeTimeoutError;
let DEFAULT_TRANSACTION_TIMEOUT_MS;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://tester:secret@localhost:5432/wipe_test';
  ({ withTransaction, WipeTimeoutError, DEFAULT_TRANSACTION_TIMEOUT_MS } = await import('@/lib/db'));
});

/**
 * A fake pooled client that records the SQL text of every call in order.
 *
 * @param {{ failOn?: string, error?: Error, rollbackFails?: boolean }} [options]
 */
function makeClient({ failOn = null, error = new Error('deletion failed'), rollbackFails = false } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (text) => {
      calls.push(text);
      if (text === 'ROLLBACK' && rollbackFails) {
        throw new Error('Connection terminated unexpectedly');
      }
      if (failOn && text.startsWith(failOn)) {
        throw error;
      }
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  connectMock.mockResolvedValue(client);
  return { client, calls };
}

let consoleErrorSpy;

beforeEach(() => {
  connectMock.mockReset();
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.useRealTimers();
});

describe('withTransaction — success path (Req 6.1)', () => {
  it('runs BEGIN, SET LOCAL statement_timeout, the callback, then COMMIT, in that order', async () => {
    const { client, calls } = makeClient();

    const result = await withTransaction(async (c) => {
      await c.query('DELETE FROM internal_students');
      return { deletedStudents: 3 };
    });

    expect(calls).toEqual([
      'BEGIN',
      `SET LOCAL statement_timeout = ${DEFAULT_TRANSACTION_TIMEOUT_MS}`,
      'DELETE FROM internal_students',
      'COMMIT',
    ]);
    expect(calls).not.toContain('ROLLBACK');
    expect(result).toEqual({ deletedStudents: 3 });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('passes the pooled client to the callback and acquires exactly one client', async () => {
    const { client } = makeClient();
    const seen = [];

    await withTransaction(async (c) => {
      seen.push(c);
    });

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([client]);
  });

  it('interpolates a caller-supplied timeout into the statement_timeout', async () => {
    const { calls } = makeClient();

    await withTransaction(async () => 'ok', { timeoutMs: 5000 });

    expect(calls[1]).toBe('SET LOCAL statement_timeout = 5000');
  });

  it('defaults the deadline to 30 seconds', () => {
    expect(DEFAULT_TRANSACTION_TIMEOUT_MS).toBe(30000);
  });
});

describe('withTransaction — callback failure (Req 6.2, 6.3)', () => {
  it('rolls back, never commits, and rethrows the original error', async () => {
    const { client, calls } = makeClient();
    const boom = new Error('internal_student_history delete failed');

    await expect(
      withTransaction(async (c) => {
        await c.query('DELETE FROM internal_live_progress');
        throw boom;
      })
    ).rejects.toBe(boom);

    expect(calls).toEqual([
      'BEGIN',
      `SET LOCAL statement_timeout = ${DEFAULT_TRANSACTION_TIMEOUT_MS}`,
      'DELETE FROM internal_live_progress',
      'ROLLBACK',
    ]);
    expect(calls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back when a statement inside the callback rejects', async () => {
    const dbError = new Error('relation "internal_students" does not exist');
    const { client, calls } = makeClient({ failOn: 'DELETE FROM internal_students', error: dbError });

    await expect(
      withTransaction((c) => c.query('DELETE FROM internal_students'))
    ).rejects.toBe(dbError);

    expect(calls.at(-1)).toBe('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('withTransaction — COMMIT failure (Req 6.2, 6.3)', () => {
  it('rolls back after a rejecting COMMIT and surfaces the commit error', async () => {
    const commitError = new Error('Connection terminated unexpectedly');
    const { client, calls } = makeClient({ failOn: 'COMMIT', error: commitError });

    await expect(withTransaction(async () => 'unreachable')).rejects.toBe(commitError);

    expect(calls).toEqual([
      'BEGIN',
      `SET LOCAL statement_timeout = ${DEFAULT_TRANSACTION_TIMEOUT_MS}`,
      'COMMIT',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not mask the original error when the ROLLBACK itself fails', async () => {
    const original = new Error('live progress delete failed');
    const { client, calls } = makeClient({
      failOn: 'DELETE FROM internal_live_progress',
      error: original,
      rollbackFails: true,
    });

    await expect(
      withTransaction((c) => c.query('DELETE FROM internal_live_progress'))
    ).rejects.toBe(original);

    expect(calls).toContain('ROLLBACK');
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('withTransaction — deadline (Req 6.8)', () => {
  it('rejects with WipeTimeoutError and rolls back when the deadline fires', async () => {
    vi.useFakeTimers();
    const { client, calls } = makeClient();

    const pending = withTransaction(() => new Promise(() => {}), { timeoutMs: 30000 });
    const assertion = expect(pending).rejects.toBeInstanceOf(WipeTimeoutError);

    await vi.advanceTimersByTimeAsync(30000);
    await assertion;

    expect(calls).toEqual([
      'BEGIN',
      'SET LOCAL statement_timeout = 30000',
      'ROLLBACK',
    ]);
    expect(calls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('carries the 30-second limit in the timeout error', async () => {
    vi.useFakeTimers();
    makeClient();

    const pending = withTransaction(() => new Promise(() => {}), { timeoutMs: 30000 });
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'WipeTimeoutError',
      timeoutMs: 30000,
      message: expect.stringContaining('30-second'),
    });

    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
  });

  it('commits normally when the callback finishes before the deadline', async () => {
    vi.useFakeTimers();
    const { client, calls } = makeClient();

    const result = await withTransaction(async () => 'done', { timeoutMs: 30000 });

    expect(result).toBe('done');
    expect(calls.at(-1)).toBe('COMMIT');
    expect(vi.getTimerCount()).toBe(0); // the race timer is cleared
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('withTransaction — timeout validation (Req 6.8)', () => {
  it('rejects a non-numeric, negative, zero or non-integer timeout without touching the pool', async () => {
    for (const timeoutMs of ['abc', '30000; DROP TABLE internal_students', -1, 0, 1.5, NaN, Infinity, null, {}, [1, 2]]) {
      makeClient();
      connectMock.mockClear();

      await expect(withTransaction(async () => 'never', { timeoutMs })).rejects.toBeInstanceOf(TypeError);
      expect(connectMock).not.toHaveBeenCalled();
    }
  });

  it('accepts a numeric string that is a positive integer and interpolates only the number', async () => {
    const { calls } = makeClient();

    await withTransaction(async () => 'ok', { timeoutMs: '1500' });

    expect(calls[1]).toBe('SET LOCAL statement_timeout = 1500');
    expect(calls[1]).toMatch(/^SET LOCAL statement_timeout = \d+$/);
  });
});
