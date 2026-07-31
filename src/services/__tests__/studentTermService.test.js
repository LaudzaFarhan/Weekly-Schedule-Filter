/**
 * Unit tests for `src/services/studentTermService.js`.
 *
 * Example-based, not property tests. `fetch` is stubbed, so nothing leaves the
 * process: what is asserted is the request each verb builds (the contract with
 * `/api/new/student-terms`) and how each response is classified.
 *
 * Req 2.14 is the load-bearing one: a 500 carries the error raised, and the page
 * shows it. So each rejection test compares the whole thrown message with `toBe`
 * against the API's `error` string rather than just checking that it threw.
 *
 * _Requirements: 1.13, 2.14_
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTerms, saveTerm, deleteTerm } from '@/services/studentTermService';

const API_PATH = '/api/new/student-terms';

/** A response double: the service reads only `ok` and `json`. */
function jsonResponse(body, { ok = true, status = ok ? 200 : 500 } = {}) {
  return { ok, status, json: async () => body };
}

/** A non-ok response whose body is not valid JSON — a crash before the body is written. */
function unparseableResponse(status = 500) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  };
}

/** The single `fetch` call the service is expected to have made. */
function lastRequest() {
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  return { url, options };
}

/** The rejection reason, failing the test if the call resolved instead. */
function rejectionOf(promise) {
  return promise.then(
    () => { throw new Error('expected a rejection'); },
    (caught) => caught
  );
}

/** Query parameters of a built URL, in a form that is order-independent. */
function queryOf(url) {
  const [, search = ''] = url.split('?');
  return Object.fromEntries(new URLSearchParams(search));
}

const VERBS = [
  { name: 'getTerms', call: () => getTerms({ studentId: 42 }), fallback: 'Failed to fetch student terms' },
  { name: 'saveTerm', call: () => saveTerm({ studentId: 42, year: 2026, termNumber: 2 }), fallback: 'Failed to save student term' },
  { name: 'deleteTerm', call: () => deleteTerm(7), fallback: 'Failed to delete student term' },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  // The service logs on every failure path by design; silenced for readability.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getTerms — query string and result', () => {
  it('requests the bare path when given no filters', async () => {
    fetch.mockResolvedValue(jsonResponse([]));

    await getTerms();

    const { url, options } = lastRequest();
    expect(url).toBe(API_PATH);
    expect(url).not.toContain('?');
    // A GET is the default verb: no options object is passed at all.
    expect(options).toBeUndefined();
  });

  it('sends studentId and year when both are supplied', async () => {
    fetch.mockResolvedValue(jsonResponse([]));

    await getTerms({ studentId: 42, year: 2026 });

    const { url } = lastRequest();
    expect(queryOf(url)).toEqual({ studentId: '42', year: '2026' });
  });

  it('sends only the filter it was given', async () => {
    fetch.mockResolvedValue(jsonResponse([]));

    await getTerms({ year: 2026 });

    const { url } = lastRequest();
    expect(queryOf(url)).toEqual({ year: '2026' });
    expect(url).not.toContain('studentId');
  });

  it('omits a filter supplied as an empty string rather than sending it empty', async () => {
    fetch.mockResolvedValue(jsonResponse([]));

    // The page passes through whatever is in its select; an unselected student
    // must read as "no filter", not as a filter on the empty string.
    await getTerms({ studentId: '', year: null });

    const { url } = lastRequest();
    expect(url).toBe(API_PATH);
  });

  it('returns the mapped rows exactly as the API ordered them', async () => {
    const rows = [
      { id: 1, studentId: 42, year: 2026, termNumber: 1, paid: true, paidAt: '2026-01-10', note: null },
      { id: 2, studentId: 42, year: 2026, termNumber: 2, paid: false, paidAt: null, note: 'invoice sent' },
    ];
    fetch.mockResolvedValue(jsonResponse(rows));

    // Handed straight to `termSummary()`, so the array must arrive untouched.
    await expect(getTerms({ studentId: 42, year: 2026 })).resolves.toEqual(rows);
  });
});

describe('write verbs — method, body and result', () => {
  it('saveTerm POSTs the payload as JSON and returns the stored row', async () => {
    const payload = { studentId: 42, year: 2026, termNumber: 2, paid: true, paidAt: '2026-03-01' };
    const stored = { id: 9, ...payload, note: null, createdAt: 'x', updatedAt: 'y' };
    fetch.mockResolvedValue(jsonResponse(stored));

    await expect(saveTerm(payload)).resolves.toEqual(stored);

    const { url, options } = lastRequest();
    expect(url).toBe(API_PATH);
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual(payload);
  });

  it('sends the payload through untouched, filling in no default for paid', async () => {
    fetch.mockResolvedValue(jsonResponse({ id: 9 }));

    await saveTerm({ studentId: 42, year: 2026, termNumber: 2, note: 'invoice sent' });

    const { options } = lastRequest();
    const body = JSON.parse(options.body);
    // Defaulting `paid` to false here would let a note-only edit silently un-pay
    // a settled term, and staff would chase a subscription already paid.
    expect(body).toEqual({ studentId: 42, year: 2026, termNumber: 2, note: 'invoice sent' });
    expect('paid' in body).toBe(false);
  });

  it('deleteTerm DELETEs one id in the query string', async () => {
    fetch.mockResolvedValue(jsonResponse({ success: true, message: 'Term deleted' }));

    await expect(deleteTerm(9)).resolves.toEqual({ success: true, message: 'Term deleted' });

    const { url, options } = lastRequest();
    expect(url).toBe(`${API_PATH}?id=9`);
    expect(options.method).toBe('DELETE');
    expect(options.body).toBeUndefined();
  });

  it('encodes the id it is given rather than pasting it into the URL', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: 'Invalid id' }, { ok: false, status: 400 }));

    await expect(deleteTerm('9 OR 1=1')).rejects.toThrow('Invalid id');

    const { url } = lastRequest();
    expect(queryOf(url)).toEqual({ id: '9 OR 1=1' });
    expect(url).toBe(`${API_PATH}?id=9+OR+1%3D1`);
  });
});

describe('rejected requests carry the API message verbatim (Req 1.13, 2.14)', () => {
  it.each(VERBS)('$name rethrows the API error string character for character', async ({ call }) => {
    // The 400 wording the route writes for an out-of-bounds field, punctuation
    // and bounds included, because the page shows it unchanged.
    const apiMessage = 'termNumber must be an integer from 1 to 4 inclusive';
    fetch.mockResolvedValue(jsonResponse({ error: apiMessage }, { ok: false, status: 400 }));

    const error = await rejectionOf(call());

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(apiMessage);
  });

  it.each(VERBS)('$name preserves a year-bounds message naming the field', async ({ call }) => {
    const apiMessage = 'year must be an integer from 2000 to 2100 inclusive';
    fetch.mockResolvedValue(jsonResponse({ error: apiMessage }, { ok: false, status: 400 }));

    await expect(rejectionOf(call()).then((e) => e.message)).resolves.toBe(apiMessage);
  });

  it.each(VERBS)('$name preserves a database message from a 500 unchanged', async ({ call }) => {
    const apiMessage = 'DATABASE_URL is not configured';
    fetch.mockResolvedValue(jsonResponse({ error: apiMessage }, { ok: false, status: 500 }));

    await expect(rejectionOf(call()).then((e) => e.message)).resolves.toBe(apiMessage);
  });

  it.each(VERBS)('$name falls back to its own message when the body has no error key', async ({ call, fallback }) => {
    fetch.mockResolvedValue(jsonResponse({ detail: 'something went wrong' }, { ok: false, status: 500 }));

    const error = await rejectionOf(call());

    expect(error.message).toBe(fallback);
  });

  it('does not treat an empty-string error message as a message to show', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: '' }, { ok: false, status: 500 }));

    const error = await rejectionOf(saveTerm({ studentId: 42, year: 2026, termNumber: 2 }));

    expect(error.message).toBe('Failed to save student term');
  });

  it.each(VERBS)('$name rejects rather than resolving when a non-ok body is not JSON', async ({ call }) => {
    fetch.mockResolvedValue(unparseableResponse(500));

    const error = await rejectionOf(call());

    // A non-ok response must never look like a success. Note that this service
    // parses the error body without a `.catch(() => ({}))` guard, unlike
    // `studentEvaluationService`, so the message reaching the page here is the
    // parse failure rather than the service's own fallback. Reported, not fixed:
    // no source file is touched by this task.
    expect(error).toBeInstanceOf(Error);
  });

  it.each(VERBS)('$name propagates a network failure instead of swallowing it', async ({ call }) => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await rejectionOf(call());

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('Failed to fetch');
  });
});
