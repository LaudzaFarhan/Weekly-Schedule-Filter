/**
 * Unit tests for `bulkDeleteAllStudents` in `src/services/internalStudentService.js`.
 *
 * These are example-based tests, not property tests. `fetch` is mocked, so no
 * request ever leaves the process: what is asserted is the shape of the request
 * the service builds, and how it classifies each kind of response.
 *
 * The abort case matters most. Req 6.9 requires the caller to be able to tell an
 * unconfirmed outcome apart from a failure, because the server transaction may
 * have committed after the client stopped listening.
 *
 * _Requirements: 6.9_
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  bulkDeleteAllStudents,
  isWipeUnconfirmedError,
  WipeUnconfirmedError,
  BULK_DELETE_TIMEOUT_MS,
} from '@/services/internalStudentService';

const STUDENTS_PATH = '/api/new/students';
const PHRASE = 'DELETE ALL STUDENTS';

/** A response double: only `ok` and `json` are read by the service. */
function jsonResponse(body, { ok = true, status = ok ? 200 : 500 } = {}) {
  return { ok, status, json: async () => body };
}

/** A non-ok response whose body cannot be parsed — a rolled-back wipe can 500 with no body. */
function unparseableResponse(status = 500) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  };
}

/**
 * A `fetch` that never settles on its own and rejects with an `AbortError` the
 * moment the service's own 30-second timer aborts the controller — which is how
 * the browser behaves.
 */
function hangingFetch() {
  return vi.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      reject(abortError);
    });
  }));
}

/** The single `fetch` call the service is expected to have made. */
function lastRequest() {
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, options] = global.fetch.mock.calls[0];
  return { url, options };
}

let consoleErrorSpy;
let consoleWarnSpy;

beforeEach(() => {
  global.fetch = vi.fn();
  // The service logs on every non-success path by design; silenced so the test
  // output stays readable.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete global.fetch;
});

describe('bulkDeleteAllStudents — request shape', () => {
  it('sends a DELETE to the students path with no id query parameter', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({ success: true, deletedStudents: 0, deletedHistory: 0, deletedProgress: 0 })
    );

    await bulkDeleteAllStudents(PHRASE);

    const { url, options } = lastRequest();
    // No `?id=` is what makes the server treat this as a bulk request rather
    // than a malformed single-record delete.
    expect(url).toBe(STUDENTS_PATH);
    expect(url).not.toContain('?');
    expect(url).not.toMatch(/[?&]id=/);
    expect(options.method).toBe('DELETE');
  });

  it('carries the confirmation phrase in a JSON body as { confirm }', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({ success: true, deletedStudents: 2, deletedHistory: 1, deletedProgress: 0 })
    );

    await bulkDeleteAllStudents(PHRASE);

    const { options } = lastRequest();
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({ confirm: PHRASE });
  });

  it('sends the phrase verbatim, leaving any validation to the server', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({ error: 'Confirmation phrase does not match' }, { ok: false, status: 400 })
    );

    await expect(bulkDeleteAllStudents('  delete all students  ')).rejects.toThrow(
      'Confirmation phrase does not match'
    );

    const { options } = lastRequest();
    expect(JSON.parse(options.body)).toEqual({ confirm: '  delete all students  ' });
  });
});

describe('bulkDeleteAllStudents — responses', () => {
  it('returns the parsed counts on success', async () => {
    const counts = { success: true, deletedStudents: 26, deletedHistory: 14, deletedProgress: 9 };
    global.fetch.mockResolvedValue(jsonResponse(counts));

    await expect(bulkDeleteAllStudents(PHRASE)).resolves.toEqual(counts);
  });

  it('propagates the server error string on a non-ok response', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse(
        { error: 'Bulk delete exceeded its 30-second time limit and was rolled back' },
        { ok: false, status: 500 }
      )
    );

    await expect(bulkDeleteAllStudents(PHRASE)).rejects.toThrow(
      'Bulk delete exceeded its 30-second time limit and was rolled back'
    );
  });

  it('throws a meaningful error, not a JSON parse error, when a non-ok response has no body', async () => {
    global.fetch.mockResolvedValue(unparseableResponse(500));

    const error = await bulkDeleteAllStudents(PHRASE).then(
      () => { throw new Error('expected a rejection'); },
      (caught) => caught
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('Error');
    expect(error.message).toBe('Failed to delete all students');
    expect(error.message).not.toMatch(/JSON/i);
  });

  it('reports a server failure as a failure, not as an unconfirmed outcome', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({ error: 'deletion failed' }, { ok: false, status: 500 })
    );

    const error = await bulkDeleteAllStudents(PHRASE).catch((caught) => caught);

    expect(isWipeUnconfirmedError(error)).toBe(false);
  });
});

describe('bulkDeleteAllStudents — 30-second abort (Req 6.9)', () => {
  it('raises the unconfirmed signal when no response arrives before the deadline', async () => {
    vi.useFakeTimers();
    global.fetch = hangingFetch();

    const pending = bulkDeleteAllStudents(PHRASE);
    const settled = pending.then(
      () => { throw new Error('expected a rejection'); },
      (caught) => caught
    );

    await vi.advanceTimersByTimeAsync(BULK_DELETE_TIMEOUT_MS);
    const error = await settled;

    expect(error).toBeInstanceOf(WipeUnconfirmedError);
    expect(isWipeUnconfirmedError(error)).toBe(true);
    expect(error.unconfirmed).toBe(true);
    expect(error.timeoutMs).toBe(BULK_DELETE_TIMEOUT_MS);
    // The message has to steer the user to a reload rather than claim a failure.
    expect(error.message).toMatch(/unconfirmed/i);
    expect(error.message).toMatch(/reload/i);
    expect(BULK_DELETE_TIMEOUT_MS).toBe(30000);
  });

  it('does not abort before the deadline elapses', async () => {
    vi.useFakeTimers();
    global.fetch = hangingFetch();

    let settled = false;
    const pending = bulkDeleteAllStudents(PHRASE).catch(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(BULK_DELETE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('honours a caller-supplied deadline', async () => {
    vi.useFakeTimers();
    global.fetch = hangingFetch();

    const settled = bulkDeleteAllStudents(PHRASE, { timeoutMs: 5000 }).catch((caught) => caught);

    await vi.advanceTimersByTimeAsync(5000);
    const error = await settled;

    expect(isWipeUnconfirmedError(error)).toBe(true);
    expect(error.timeoutMs).toBe(5000);
    expect(error.message).toMatch(/5 seconds/);
  });

  it('clears the abort timer on the success path so no pending timer is left behind', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, deletedStudents: 1, deletedHistory: 0, deletedProgress: 0 })
    );

    await bulkDeleteAllStudents(PHRASE);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the abort timer on the failure path too', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'deletion failed' }, { ok: false, status: 500 })
    );

    await expect(bulkDeleteAllStudents(PHRASE)).rejects.toThrow('deletion failed');

    expect(vi.getTimerCount()).toBe(0);
  });
});
