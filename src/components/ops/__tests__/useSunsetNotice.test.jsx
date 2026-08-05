// @vitest-environment jsdom
// This file mounts a hook, which needs a document for the `visibilitychange`
// listener and for `localStorage`, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Unit tests for `useSunsetNotice`.
 *
 * Every day count, phase and dismissal decision belongs to `@/lib/opsSunset`,
 * which its own tests already cover. What no test of that module can see is the
 * impure edge this hook owns: the seeded instant, the 60-second re-read, the
 * `visibilitychange` re-read, the one-request-per-mount guard, the 10-second
 * abort, and what is left running after unmount. That is what this file asserts.
 *
 * Req 1.2  — the first render carries a notice, before any config response.
 * Req 1.7  — no loading state and no placeholder while the response is out.
 * Req 4.2  — `opsMode: 'new'` returns `{ visible: false }`.
 * Req 12.1 — the instant is seeded from the host clock on mount.
 * Req 12.2 — the instant is re-read every 60 seconds.
 * Req 12.3 — a `visibilitychange` to `visible` re-reads, and fetches nothing.
 * Req 12.4 — crossing WIB midnight shows the new day's count within 65s.
 * Req 12.5 — at most one config request per mount, whatever happens after.
 * Req 12.6 — outside Old Operations: no request and no interval.
 * Req 12.7 — a dismissal records once for the displayed phase and recomputes.
 * Req 12.8 — the hook returns `{ notice, dismiss, refresh }`.
 * Req 12.10 — unmount stops the interval, removes the listener, updates nothing.
 * Req 13.1 — a failed or rejected response leaves the constant in place, silently.
 * Req 13.2 — the next mount after a failure issues exactly one further request.
 * Req 13.6 — `opsMode: 'new'` performs no arithmetic and issues no request.
 * Req 13.7 — a request outstanding for 10 seconds counts as failed, once.
 *
 * The clock is driven with `vi.setSystemTime` so the WIB midnight crossing is a
 * fixed instant rather than a function of when the suite runs. `fetch` is a stub
 * in every test, including the tests that assert it is never called: a real
 * request from a unit test is a defect either way.
 */

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
// Unmounting between tests is handled globally by vitest.setup.js.
import { act, renderHook } from '@testing-library/react';

import useSunsetNotice, {
  CLOCK_INTERVAL_MS,
  CONFIG_KEY,
  CONFIG_TIMEOUT_MS,
} from '@/components/ops/useSunsetNotice';
import { DISMISS_KEY, OLD_OPS_SUNSET_ISO } from '@/lib/opsSunset';

/* ----------------------------------------------------------------- fixtures */

const CONFIG_URL = `/api/new/config?key=${CONFIG_KEY}`;

/**
 * 4 August 2026, 12:00 WIB. 28 days from the shipped date, so the phase is
 * `notice` and the count is far from any boundary — nothing in this file drifts
 * into a neighbouring day by accident.
 */
const BASE_MS = Date.UTC(2026, 7, 4, 5, 0, 0);
const BASE_DAYS = 28;

/** 31 August 2026, 23:59:30 WIB: 30 seconds short of the deadline's own day. */
const EVE_MS = Date.UTC(2026, 7, 31, 16, 59, 30);

/** The fields a visible model carries, so a missing one is caught by name. */
const MODEL_FIELDS = [
  'visible', 'phase', 'days', 'sunsetISO', 'dismissible',
  'tone', 'icon', 'headline', 'detail', 'badge',
];

/* ------------------------------------------------------------------ helpers */

/** A response the hook will accept, carrying `value` as the configured date. */
const okResponse = (value) => ({ ok: true, json: async () => ({ value }) });

/** A `fetch` that resolves with one config value. */
const fetchValue = (value) => vi.fn(async () => okResponse(value));

/** A `fetch` that never settles: the response is still outstanding. */
const fetchPending = () => vi.fn(() => new Promise(() => {}));

/** A `fetch` that settles only when the hook's own abort fires. */
const fetchUntilAbort = () => vi.fn((_url, init) => new Promise((_resolve, reject) => {
  init.signal.addEventListener('abort', () => {
    reject(new DOMException('The operation was aborted.', 'AbortError'));
  });
}));

function stubFetch(impl) {
  vi.stubGlobal('fetch', impl);
  return impl;
}

/** Mount the hook. `opsMode` is a prop so a mode change is a re-render. */
function mount(opsMode = 'old') {
  return renderHook(({ mode }) => useSunsetNotice(mode), {
    initialProps: { mode: opsMode },
  });
}

/** Let the stubbed fetch and its `.json()` settle inside `act`. */
async function flush() {
  await act(async () => {});
}

/** Advance the fake clock, firing anything scheduled along the way. */
function advance(ms) {
  act(() => { vi.advanceTimersByTime(ms); });
}

/** Fire a `visibilitychange`, as the browser does on a tab return. */
function visibilityChange() {
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

/** Jump the host clock without firing any timer, as a sleeping tab does. */
function jumpClock(ms) {
  vi.setSystemTime(ms);
}

const stored = () => window.localStorage.getItem(DISMISS_KEY);

let errorSpy;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_MS);
  window.localStorage.clear();
  // Nothing in this feature logs, so any console output is a defect worth seeing.
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

/* -------------------------------------------------------------------- tests */

describe('useSunsetNotice: the first render', () => {
  it('is guarded by the shipped date this file is written around', () => {
    // Every expected number below is derived from this constant by hand. If it
    // moves, the numbers are wrong rather than the hook.
    expect(OLD_OPS_SUNSET_ISO).toBe('2026-09-01');
  });

  it('carries a complete notice before any config response has arrived', async () => {
    stubFetch(fetchPending());

    const { result } = mount('old');

    // Seeded from the host clock in the initialiser, so the count is real on the
    // very first render rather than after an effect. Req 1.2, 12.1
    expect(result.current.notice.visible).toBe(true);
    expect(result.current.notice.days).toBe(BASE_DAYS);
    expect(result.current.notice.phase).toBe('notice');
    expect(result.current.notice.sunsetISO).toBe(OLD_OPS_SUNSET_ISO);

    // No loading state, no placeholder, no empty container: every field a
    // consumer renders is populated while the response is outstanding. Req 1.7
    expect(Object.keys(result.current.notice).sort()).toEqual([...MODEL_FIELDS].sort());
    expect(result.current.notice.headline).toMatch(/\S/);
    expect(result.current.notice.detail).toMatch(/\S/);
    expect(result.current.notice.badge).toBe('28d');

    // The hook's whole surface. Req 12.8
    expect(Object.keys(result.current).sort()).toEqual(['dismiss', 'notice', 'refresh']);
    expect(typeof result.current.dismiss).toBe('function');
    expect(typeof result.current.refresh).toBe('function');

    await flush();
    expect(result.current.notice.days).toBe(BASE_DAYS);
  });

  it('adopts a configured date that resolves, on the next render', async () => {
    // Not a resilience case but the control for the two that follow: without it,
    // "the count did not change" would pass on a hook that ignores config. Req 1.6
    stubFetch(fetchValue('2026-08-10'));

    const { result } = mount('old');
    expect(result.current.notice.days).toBe(BASE_DAYS);

    await flush();

    expect(fetch).toHaveBeenCalledWith(CONFIG_URL, expect.objectContaining({
      signal: expect.any(Object),
    }));
    expect(result.current.notice.sunsetISO).toBe('2026-08-10');
    expect(result.current.notice.days).toBe(6);
    expect(result.current.notice.phase).toBe('warning');
  });
});

describe('useSunsetNotice: one config request per mount', () => {
  it('issues no second request across a re-read, a visibility change, a dismissal and a page change', async () => {
    stubFetch(fetchValue(null));

    const { result, rerender } = mount('old');
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);

    advance(CLOCK_INTERVAL_MS);
    visibilityChange();
    act(() => { result.current.dismiss(); });
    // A page change re-renders the component holding the hook; the hook itself
    // takes only `opsMode`, so the same props re-render is that event.
    rerender({ mode: 'old' });
    await flush();

    // Req 12.5, and the dismissal and the re-read fetch nothing. Req 12.3, 12.7
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('issues exactly one further request on the next mount after a failure', async () => {
    stubFetch(vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    const first = mount('old');
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);

    // No retry loop inside the failed mount. Req 13.2
    advance(CLOCK_INTERVAL_MS * 5);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);

    first.unmount();
    mount('old');
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('useSunsetNotice: re-reading the clock', () => {
  it('crosses WIB midnight on the 60-second re-read, with no request', async () => {
    stubFetch(fetchValue(null));
    jumpClock(EVE_MS);

    const { result } = mount('old');
    await flush();

    // 31 August WIB: one day left. Req 12.1
    expect(result.current.notice.days).toBe(1);
    expect(result.current.notice.phase).toBe('urgent');

    // Real time has crossed midnight, but the hook has not re-read yet, so the
    // displayed count is unchanged until the interval fires. Req 12.2
    advance(CLOCK_INTERVAL_MS - 1);
    expect(result.current.notice.days).toBe(1);
    expect(result.current.notice.phase).toBe('urgent');

    advance(1);

    // 1 September WIB, within 65 seconds of the boundary, with no reload and no
    // second request. Req 12.2, 12.4
    expect(result.current.notice.days).toBe(0);
    expect(result.current.notice.phase).toBe('final');
    expect(result.current.notice.dismissible).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-reads on a visibilitychange while visible, and not while hidden', async () => {
    stubFetch(fetchValue(null));

    const { result } = mount('old');
    await flush();
    expect(result.current.notice.days).toBe(BASE_DAYS);

    // A tab asleep for four weeks, woken by the user. jsdom reports `visible`.
    jumpClock(BASE_MS + BASE_DAYS * 86400000);
    visibilityChange();

    // Req 12.3, within the same tick, and no request went out.
    expect(result.current.notice.days).toBe(0);
    expect(result.current.notice.phase).toBe('final');
    expect(fetch).toHaveBeenCalledTimes(1);

    // The other branch of the same event: nothing is re-read while hidden.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    jumpClock(BASE_MS + (BASE_DAYS + 1) * 86400000);
    visibilityChange();

    expect(result.current.notice.days).toBe(0);
    expect(result.current.notice.phase).toBe('final');
  });
});

describe('useSunsetNotice: dismissal', () => {
  it('records the displayed phase once at the last read instant, and hides the notice', async () => {
    stubFetch(fetchValue(null));

    const { result } = mount('old');
    await flush();
    expect(result.current.notice.phase).toBe('notice');
    expect(stored()).toBeNull();

    act(() => { result.current.dismiss(); });

    // Exactly one record, naming the phase that was on screen and the instant
    // the hook last read. Req 12.7
    expect(JSON.parse(stored())).toEqual({ phase: 'notice', at: BASE_MS });
    expect(result.current.notice).toEqual({ visible: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('useSunsetNotice: resilience', () => {
  it.each([
    ['the request rejects', vi.fn(async () => { throw new TypeError('Failed to fetch'); })],
    ['the response is unauthorised', vi.fn(async () => ({ ok: false, status: 401 }))],
    ['the body is not JSON', vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }))],
    ['the value is a date that does not exist', fetchValue('2026-02-30')],
    ['the value is not a string', fetchValue(17)],
  ])('leaves the shipped date in place when %s, and surfaces nothing', async (_name, impl) => {
    stubFetch(impl);

    const { result } = mount('old');
    const before = result.current.notice;
    await flush();

    // The same count and phase as before the response, from the constant, with
    // no error field anywhere in the returned shape. Req 13.1
    expect(result.current.notice.sunsetISO).toBe(OLD_OPS_SUNSET_ISO);
    expect(result.current.notice.days).toBe(before.days);
    expect(result.current.notice.phase).toBe(before.phase);
    expect(result.current.notice.visible).toBe(true);
    expect(Object.keys(result.current.notice).sort()).toEqual([...MODEL_FIELDS].sort());
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('treats a request outstanding for 10 seconds as failed, and issues no other', async () => {
    stubFetch(fetchUntilAbort());

    const { result } = mount('old');
    await flush();
    expect(result.current.notice.days).toBe(BASE_DAYS);

    advance(CONFIG_TIMEOUT_MS - 1);
    await flush();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);

    advance(1);
    await flush();

    // Aborted at the 10-second mark, the constant still in force, and no retry
    // for the rest of the mount. Req 13.7
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(result.current.notice.sunsetISO).toBe(OLD_OPS_SUNSET_ISO);
    expect(result.current.notice.days).toBe(BASE_DAYS);
    expect(result.current.notice.visible).toBe(true);

    advance(CLOCK_INTERVAL_MS * 5);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('useSunsetNotice: outside Old Operations', () => {
  it('returns a hidden model, starts no interval and issues no request', async () => {
    stubFetch(fetchValue('2026-08-10'));
    const startInterval = vi.spyOn(globalThis, 'setInterval');
    const listen = vi.spyOn(document, 'addEventListener');

    const { result } = mount('new');
    await flush();
    advance(CLOCK_INTERVAL_MS * 10);
    await flush();

    // Req 4.2, 12.6, 13.6
    expect(result.current.notice).toEqual({ visible: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(startInterval).not.toHaveBeenCalled();
    expect(listen.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(0);
  });

  it('re-reads the clock and issues its one request when the mode becomes old', async () => {
    stubFetch(fetchValue(null));

    const { result, rerender } = mount('new');
    await flush();
    expect(fetch).not.toHaveBeenCalled();

    // Time passed while the user was in New Operations, so the seeded instant is
    // stale by the time the mode flips. Req 12.9
    jumpClock(BASE_MS + BASE_DAYS * 86400000);
    rerender({ mode: 'old' });
    await flush();

    expect(result.current.notice.visible).toBe(true);
    expect(result.current.notice.days).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('useSunsetNotice: unmount', () => {
  it('clears the interval, removes the listener and updates nothing after', async () => {
    stubFetch(fetchValue(null));
    const listen = vi.spyOn(document, 'addEventListener');
    const unlisten = vi.spyOn(document, 'removeEventListener');

    const { result, unmount } = mount('old');
    await flush();

    const added = listen.mock.calls.filter(([type]) => type === 'visibilitychange');
    expect(added).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1); // the clock interval, the config timeout cleared

    const last = result.current.notice;
    unmount();

    // The same handler removed, and no timer left to fire. Req 12.10
    const removed = unlisten.mock.calls.filter(([type]) => type === 'visibilitychange');
    expect(removed).toHaveLength(1);
    expect(removed[0][1]).toBe(added[0][1]);
    expect(vi.getTimerCount()).toBe(0);

    // Nothing the browser can still do reaches the unmounted hook.
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    advance(CLOCK_INTERVAL_MS * 10);
    await flush();

    expect(result.current.notice).toBe(last);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('performs no state update when a response resolves during teardown', async () => {
    let release;
    stubFetch(vi.fn(() => new Promise((resolve) => { release = resolve; })));

    const { unmount } = mount('old');
    unmount();

    // The response lands after the effect has torn down. Req 12.10
    release(okResponse('2026-08-10'));
    await flush();

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
