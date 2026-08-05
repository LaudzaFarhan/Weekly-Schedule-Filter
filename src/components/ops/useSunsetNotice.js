'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  OLD_OPS_SUNSET_ISO,
  recordDismissal,
  resolveSunsetISO,
  sunsetNotice,
} from '@/lib/opsSunset';

/**
 * The one impure edge of the sunset notice: today's date, the configured date,
 * and the dismissal write. Every decision about what the notice *says* — the day
 * count, the phase, whether it has been dismissed — is delegated to
 * `@/lib/opsSunset`, which is why none of that arithmetic appears here.
 */

/**
 * How often the clock is re-read, in milliseconds.
 *
 * Coarse on purpose. The only thing that can change is the WIB calendar day, so
 * a minute is already 1,440 times more often than it needs to be; anything
 * finer would be a timer running all day to watch a number that moves at
 * midnight. It fires no request — this is a clock re-read, nothing else.
 */
export const CLOCK_INTERVAL_MS = 60000;

/**
 * How long the configuration request is given before it counts as failed.
 *
 * A request left hanging would otherwise sit open for the life of the tab. The
 * displayed notice is already correct from the shipped constant, so giving up is
 * free: there is nothing to fall back to, because nothing was ever waited for.
 */
export const CONFIG_TIMEOUT_MS = 10000;

/** The allowlisted `/api/new/config` key holding the retirement date. */
export const CONFIG_KEY = 'oldOpsSunset';

/**
 * The model returned whenever the user is not in Old Operations. One frozen
 * object rather than a fresh `{ visible: false }` per render, so a consumer that
 * memoises on the notice is not re-rendered by identity churn.
 */
const HIDDEN = Object.freeze({ visible: false });

/**
 * `localStorage` with a mount-scoped memory overlay in front of it.
 *
 * The overlay exists for one requirement: a dismissal whose write to
 * `localStorage` throws — private-mode lockdown, quota — must still hide the
 * notice for the rest of this mount, and must show it again on the next one
 * (Req 13.4). Writing to memory first and reading memory first gets exactly
 * that, and it keeps the decision inside `opsSunset`: the module still reads a
 * record and still decides, it is only the shelf the record sits on that
 * changes. The overlay dies with the mount, so nothing persists that
 * `localStorage` refused.
 *
 * Reads are deliberately left to throw, because `readDismissal` already treats a
 * throwing storage as "not dismissed" — which is the correct direction for a
 * deadline.
 *
 * @returns {{ getItem: Function, setItem: Function, removeItem: Function }}
 */
function createNoticeStorage() {
  let base = null;
  try {
    base = typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // SSR, or a browser that throws on the property access itself.
    base = null;
  }

  const memory = new Map();

  return {
    getItem(key) {
      if (memory.has(key)) return memory.get(key);
      return base ? base.getItem(key) : null;
    },
    setItem(key, value) {
      memory.set(key, value);
      if (base) base.setItem(key, value);
    },
    removeItem(key) {
      memory.delete(key);
      if (base) base.removeItem(key);
    },
  };
}

/**
 * The sunset notice for the current instant, ready to render.
 *
 * Seeded from `Date.now()` and `OLD_OPS_SUNSET_ISO`, so the very first render
 * already carries a real notice: no loading state, no placeholder day count, no
 * empty container waiting for a response (Req 1.2, 1.7). The configured date is
 * fetched once per mount and, if it arrives and parses, the count corrects
 * itself on the next render (Req 1.6). If it never arrives, arrives with a 401,
 * or arrives malformed, the constant simply stands and nothing is said about it —
 * there is no toast and no retry control, because the user cannot act on it and
 * the displayed date is right either way (Req 13.1).
 *
 * Outside Old Operations the hook does nothing at all: no request, no interval,
 * no listener, and a model that is always `{ visible: false }` (Req 4.2, 12.6,
 * 13.6). Someone already working in New Operations has done what the notice
 * asks, and nagging them is how a notice gets tuned out before it matters.
 *
 * @param   {string} opsMode `'old'` or `'new'`
 * @returns {{ notice: object, dismiss: Function, refresh: Function }}
 *          `notice` is the view model from `sunsetNotice`; `dismiss` records a
 *          dismissal for the phase on screen; `refresh` re-reads the clock and
 *          recomputes without issuing a request.
 */
export function useSunsetNotice(opsMode) {
  const isOld = opsMode === 'old';

  // The current instant, read from the host clock and handed to the pure module.
  // Seeded in the initialiser rather than in an effect, so it is present on the
  // first render (Req 12.1).
  const [nowMs, setNowMs] = useState(() => Date.now());

  // The retirement date in force. Starts as the shipped constant and is replaced
  // only by a configured value that `resolveSunsetISO` accepts, so a rejected
  // response resolves back to the same string and React re-renders nothing
  // (Req 1.10, 13.1).
  const [sunsetISO, setSunsetISO] = useState(() => resolveSunsetISO(OLD_OPS_SUNSET_ISO, null));

  // Bumped whenever the dismissal record changes, purely so the notice below
  // recomputes — storage is not reactive.
  const [revision, setRevision] = useState(0);

  const storage = useMemo(() => createNoticeStorage(), []);

  // Guards the configuration request, so at most one is issued per mount however
  // many times this component re-renders, dismisses, changes page or flips mode
  // (Req 12.5, 13.2, 13.7).
  const requested = useRef(false);

  // Distinguishes "mounted in Old Operations", where the seed above is already
  // fresh, from "switched into Old Operations later", which needs a re-read.
  const firstRun = useRef(true);

  const notice = useMemo(() => {
    // `revision` is a recompute trigger rather than an input: the dismissal
    // record it stands for is read from storage inside `sunsetNotice`, and
    // storage is not reactive.
    void revision;
    return isOld ? sunsetNotice({ sunsetISO, nowMs, storage }) : HIDDEN;
  }, [isOld, sunsetISO, nowMs, storage, revision]);

  // The clock. One interval and one `visibilitychange` listener, both scoped to
  // Old Operations, so a tab left open across midnight WIB shows the new day's
  // count within a minute and a tab brought back to the front corrects itself at
  // once (Req 12.2, 12.3, 12.4, 6.9).
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;

    if (!isOld) return undefined;

    // Arriving from New Operations, the seeded instant may be minutes or hours
    // old, so re-read before anything is displayed (Req 12.9).
    if (!first) setNowMs(Date.now());

    const interval = setInterval(() => setNowMs(Date.now()), CLOCK_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') setNowMs(Date.now());
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isOld]);

  // The configured date. One request per mount, and only once the user is
  // actually in Old Operations (Req 12.5, 12.9, 13.6).
  useEffect(() => {
    if (!isOld || requested.current) return undefined;
    requested.current = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/new/config?key=${CONFIG_KEY}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;

        const body = await res.json();
        if (cancelled) return;

        // Every failure mode lands in the same place: `resolveSunsetISO` returns
        // the constant for anything that is not a real calendar date, so a
        // missing field, a number, `"1 Sept"` or `"2026-02-30"` all leave the
        // displayed date exactly as it was (Req 1.3, 1.4, 13.1).
        setSunsetISO(resolveSunsetISO(OLD_OPS_SUNSET_ISO, body?.value));
      } catch {
        // Aborted, offline, unauthorised, or a body that is not JSON. Swallowed
        // deliberately: the notice is already correct and there is nothing the
        // user could do with the news. Retried on the next mount, not in a loop.
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      // `cancelled` first, so an in-flight response that resolves during
      // teardown updates no state (Req 12.10).
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [isOld]);

  const phase = notice.visible ? notice.phase : null;

  /**
   * Record that the user closed the notice, for the phase currently on screen
   * and at the most recently read instant (Req 12.7). Fires no request.
   */
  const dismiss = useCallback(() => {
    if (!phase) return;
    recordDismissal(phase, nowMs, storage);
    setRevision((n) => n + 1);
  }, [phase, nowMs, storage]);

  /** Re-read the clock and recompute. Issues no request, by design (Req 12.5). */
  const refresh = useCallback(() => {
    setNowMs(Date.now());
    setRevision((n) => n + 1);
  }, []);

  return useMemo(() => ({ notice, dismiss, refresh }), [notice, dismiss, refresh]);
}

export default useSunsetNotice;
