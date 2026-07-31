/**
 * Unit tests for `src/services/studentEvaluationService.js`.
 *
 * Example-based, not property tests. `fetch` is stubbed, so no request leaves
 * the process: what is asserted is the request each verb builds (the contract
 * with `/api/new/student-evaluations`) and how each response is classified.
 *
 * The load-bearing assertion is the error path. Req 1.13 requires the
 * Evaluation_Form to display the message the API returned, and Req 2.14 requires
 * a 500 to carry the error raised — so the thrown message has to equal the API's
 * `error` string character for character, not merely be truthy. Every rejection
 * test below compares the whole message with `toBe`.
 *
 * _Requirements: 1.13, 2.14_
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getEvaluations,
  saveEvaluation,
  updateEvaluation,
  deleteEvaluation,
} from '@/services/studentEvaluationService';

const API_PATH = '/api/new/student-evaluations';

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

/**
 * Every verb, paired with the fallback message it uses when the API supplies
 * none, so the error contract is checked once per verb rather than once.
 */
const VERBS = [
  { name: 'getEvaluations', call: () => getEvaluations({ studentId: 42 }), fallback: 'Failed to fetch evaluations' },
  { name: 'saveEvaluation', call: () => saveEvaluation({ studentId: 42 }), fallback: 'Failed to save evaluation' },
  { name: 'updateEvaluation', call: () => updateEvaluation({ id: 7 }), fallback: 'Failed to update evaluation' },
  { name: 'deleteEvaluation', call: () => deleteEvaluation(7), fallback: 'Failed to delete evaluation' },
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

describe('getEvaluations — query string and result', () => {
  it('requests the bare path when given no filters', async () => {
    fetch.mockResolvedValue(jsonResponse([]));

    await getEvaluations();

    const { url, options } = lastRequest();
    expect(url).toBe(API_PATH);
    expect(url).not.toContain('?');
    // A GET is the default verb: no options object is passed at all.
    expect(options).toBeUndefined();
  });

  it('sends studentId, from and to when all three are supplied', async () => {
    fetch.mockResolvedValue(jsonResponse([]));

    await getEvaluations({ studentId: 42, from: '2026-01-01', to: '2026-03-31' });

    const { url } = lastRequest();
    expect(queryOf(url)).toEqual({ studentId: '42', from: '2026-01-01', to: '2026-03-31' });
  });

  it('omits an absent bound rather than sending it empty', async () => {
    fetch.mockResolvedValue(jsonResponse([]));

    await getEvaluations({ studentId: 42, from: '2026-01-01' });

    const { url } = lastRequest();
    // `to=` would read as a filter the route then rejects as not YYYY-MM-DD,
    // turning "no upper bound" into a 400.
    expect(queryOf(url)).toEqual({ studentId: '42', from: '2026-01-01' });
    expect(url).not.toContain('to=');
  });

  it('returns the mapped records exactly as the API sent them', async () => {
    const records = [
      { id: 1, studentId: 42, date: '2026-01-05', concept: 4, instructorName: 'Helen' },
      { id: 2, studentId: 42, date: '2026-01-12', concept: 5, instructorName: 'Helen' },
    ];
    fetch.mockResolvedValue(jsonResponse(records));

    await expect(getEvaluations({ studentId: 42 })).resolves.toEqual(records);
  });
});

describe('write verbs — method, body and result', () => {
  it('saveEvaluation POSTs the whole payload as JSON and returns the saved record', async () => {
    const payload = {
      studentId: 42,
      date: '2026-01-05',
      lessonTopic: 'Gears',
      concept: 4,
      building: 3,
      problemSolving: 5,
      focus: 4,
      attitude: 5,
      instructorNotes: 'Strong session',
      instructorName: 'Helen',
    };
    const saved = { id: 11, ...payload };
    fetch.mockResolvedValue(jsonResponse(saved));

    await expect(saveEvaluation(payload)).resolves.toEqual(saved);

    const { url, options } = lastRequest();
    expect(url).toBe(API_PATH);
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' });
    // The route upserts on (student_id, eval_date), so a partial body would
    // blank the columns it left out.
    expect(JSON.parse(options.body)).toEqual(payload);
  });

  it('updateEvaluation PUTs the record including its id and returns the updated record', async () => {
    const payload = { id: 11, studentId: 42, date: '2026-01-06', concept: 5 };
    const updated = { ...payload, updatedAt: '2026-01-06T09:00:00.000Z' };
    fetch.mockResolvedValue(jsonResponse(updated));

    await expect(updateEvaluation(payload)).resolves.toEqual(updated);

    const { url, options } = lastRequest();
    expect(url).toBe(API_PATH);
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual(payload);
  });

  it('deleteEvaluation DELETEs one id in the query string', async () => {
    fetch.mockResolvedValue(jsonResponse({ success: true, message: 'Evaluation deleted' }));

    await expect(deleteEvaluation(11)).resolves.toEqual({
      success: true,
      message: 'Evaluation deleted',
    });

    const { url, options } = lastRequest();
    expect(url).toBe(`${API_PATH}?id=11`);
    expect(options.method).toBe('DELETE');
    expect(options.body).toBeUndefined();
  });

  it('encodes the id it is given rather than pasting it into the URL', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: 'Invalid id' }, { ok: false, status: 400 }));

    await expect(deleteEvaluation('11 OR 1=1')).rejects.toThrow('Invalid id');

    const { url } = lastRequest();
    expect(url).toBe(`${API_PATH}?id=11%20OR%201%3D1`);
  });
});

describe('rejected requests carry the API message verbatim (Req 1.13, 2.14)', () => {
  it.each(VERBS)('$name rethrows the API error string character for character', async ({ call }) => {
    // The 409 wording the route writes for a date the student already holds:
    // punctuation and casing included, because the form shows it unchanged.
    const apiMessage =
      'This student already has an evaluation for 2026-01-05. Open that day to edit it.';
    fetch.mockResolvedValue(jsonResponse({ error: apiMessage }, { ok: false, status: 409 }));

    const error = await rejectionOf(call());

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(apiMessage);
  });

  it.each(VERBS)('$name preserves a validator message naming the field', async ({ call }) => {
    const apiMessage = 'concept must be an integer from 1 to 5';
    fetch.mockResolvedValue(jsonResponse({ error: apiMessage }, { ok: false, status: 400 }));

    await expect(rejectionOf(call()).then((e) => e.message)).resolves.toBe(apiMessage);
  });

  it.each(VERBS)('$name preserves a database message from a 500 unchanged', async ({ call }) => {
    const apiMessage = 'relation "student_evaluations" does not exist';
    fetch.mockResolvedValue(jsonResponse({ error: apiMessage }, { ok: false, status: 500 }));

    await expect(rejectionOf(call()).then((e) => e.message)).resolves.toBe(apiMessage);
  });

  it.each(VERBS)('$name falls back to its own message when the body has no error key', async ({ call, fallback }) => {
    fetch.mockResolvedValue(jsonResponse({ detail: 'something went wrong' }, { ok: false, status: 500 }));

    const error = await rejectionOf(call());

    expect(error.message).toBe(fallback);
  });

  it.each(VERBS)('$name falls back rather than surfacing a parse error when the body is not JSON', async ({ call, fallback }) => {
    fetch.mockResolvedValue(unparseableResponse(500));

    const error = await rejectionOf(call());

    expect(error.message).toBe(fallback);
    expect(error.message).not.toMatch(/JSON/i);
  });

  it('does not treat an empty-string error message as a message to show', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: '' }, { ok: false, status: 500 }));

    const error = await rejectionOf(saveEvaluation({ studentId: 42 }));

    // An empty string would leave the form showing a blank failure notice.
    expect(error.message).toBe('Failed to save evaluation');
  });

  it.each(VERBS)('$name propagates a network failure instead of swallowing it', async ({ call }) => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await rejectionOf(call());

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('Failed to fetch');
  });
});
