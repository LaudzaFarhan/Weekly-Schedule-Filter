import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DISMISS_KEY,
  OLD_OPS_SUNSET_ISO,
  SUNSET_PHASES,
  WIB_OFFSET_MINUTES,
  clearDismissal,
  daysUntilSunset,
  isDismissed,
  isDismissible,
  isoDayIndex,
  phaseRank,
  readDismissal,
  recordDismissal,
  resolveSunsetISO,
  sunsetPhase,
  wibDayIndex,
} from '@/lib/opsSunset';

/** One day, in milliseconds. Every day index in these properties is in these. */
const MS_PER_DAY = 86400000;

/** The WIB offset in milliseconds, so a day index can be turned back into an instant. */
const WIB_OFFSET_MS = WIB_OFFSET_MINUTES * 60000;

/** Instants across a decade, so no property can pass by sitting on one date. */
const instant = () => fc.integer({
  min: Date.UTC(2020, 0, 1),
  max: Date.UTC(2030, 0, 1),
});

/** Any offset within one WIB day, for "same day, same answer" properties. */
const withinDay = () => fc.integer({ min: 0, max: MS_PER_DAY - 1 });

/**
 * Well-formed ISO dates that name real days. `noInvalidDate` because the
 * generator's whole job is to produce a string, and `toISOString` throws on the
 * invalid date fast-check would otherwise be free to hand us.
 */
const isoDate = () => fc.date({
  min: new Date(Date.UTC(2020, 0, 1)),
  max: new Date(Date.UTC(2030, 0, 1)),
  noInvalidDate: true,
}).map((d) => d.toISOString().slice(0, 10));

/** Junk that a config value or a stored record might actually contain. */
const junk = () => fc.oneof(
  fc.constant(null), fc.constant(undefined), fc.string(),
  fc.integer(), fc.boolean(), fc.object(), fc.array(fc.string()),
  fc.constantFrom('2026-02-30', '2026-13-01', '2026-00-10', '26-09-01', '2026/09/01'),
);

const phase = () => fc.constantFrom(...SUNSET_PHASES);

/** The instant of 00:00:00.000 WIB on the WIB day that `instantMs` falls on. */
function wibMidnightOf(instantMs) {
  return wibDayIndex(instantMs) * MS_PER_DAY - WIB_OFFSET_MS;
}

/** The instant of 00:00:00.000 WIB on the WIB day named by a `YYYY-MM-DD` date. */
function wibMidnightOfDate(iso) {
  return isoDayIndex(iso) * MS_PER_DAY - WIB_OFFSET_MS;
}

describe('opsSunset day counting properties', () => {
  // Feature: old-operations-sunset-notice, Property 1: The day count is always a whole number of days
  it('returns a whole number of days for every real date and every instant', () => {
    fc.assert(
      fc.property(isoDate(), instant(), (iso, now) => {
        const days = daysUntilSunset(iso, now);

        // An integer, never fractional, never NaN, never a string (Req 2.7).
        expect(typeof days).toBe('number');
        expect(Number.isInteger(days)).toBe(true);

        // And it is exactly the deadline's day index minus the instant's, so the
        // count is a subtraction of calendar days rather than a division of
        // milliseconds (Req 2.6).
        expect(days).toBe(isoDayIndex(iso) - wibDayIndex(now));
      }),
      { numRuns: 100 },
    );
  });

  // Feature: old-operations-sunset-notice, Property 2: Every instant on the same WIB day gives the same count
  it('gives one answer for a whole WIB day, and exactly one less at the next WIB midnight', () => {
    fc.assert(
      fc.property(isoDate(), instant(), withinDay(), (iso, now, offset) => {
        const wibMidnight = wibMidnightOf(now);
        const atMidnight = daysUntilSunset(iso, wibMidnight);

        // 00:00:00.000 WIB through 23:59:59.999 WIB all read the same (Req 2.3).
        expect(daysUntilSunset(iso, wibMidnight + offset)).toBe(atMidnight);
        expect(daysUntilSunset(iso, wibMidnight + MS_PER_DAY - 1)).toBe(atMidnight);

        // The next WIB midnight is exactly one day closer (Req 2.3).
        expect(daysUntilSunset(iso, wibMidnight + MS_PER_DAY)).toBe(atMidnight - 1);

        // The deadline's own day reads 0 at every instant within it (Req 2.8).
        const deadlineMidnight = wibMidnightOfDate(iso);
        expect(daysUntilSunset(iso, deadlineMidnight + offset)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: old-operations-sunset-notice, Property 3: The count is non-increasing as time passes
  it('never counts upwards as the instant advances', () => {
    fc.assert(
      fc.property(isoDate(), instant(), fc.nat({ max: 4e9 }), (iso, now, dt) => {
        const before = daysUntilSunset(iso, now);
        const after = daysUntilSunset(iso, now + dt);

        // Time moves one way, so neither can the countdown (Req 2.12).
        expect(after).toBeLessThanOrEqual(before);

        // And it drops by exactly one per WIB day boundary crossed — no drift
        // with the time of day, no double tick (Req 2.12).
        const boundariesCrossed = wibDayIndex(now + dt) - wibDayIndex(now);
        expect(before - after).toBe(boundariesCrossed);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: old-operations-sunset-notice, Property 4: The deadline's own WIB day is exactly zero, and its neighbours are exactly plus or minus one
  it('reads zero throughout the deadline day, one the day before and minus one the day after', () => {
    fc.assert(
      fc.property(isoDate(), withinDay(), (iso, offset) => {
        const deadlineMidnight = wibMidnightOfDate(iso);

        // Every instant during the deadline's own WIB day, first and last
        // millisecond included (Req 2.8).
        expect(daysUntilSunset(iso, deadlineMidnight)).toBe(0);
        expect(daysUntilSunset(iso, deadlineMidnight + offset)).toBe(0);
        expect(daysUntilSunset(iso, deadlineMidnight + MS_PER_DAY - 1)).toBe(0);

        // The whole WIB day before reads 1 (Req 2.9).
        const dayBefore = deadlineMidnight - MS_PER_DAY;
        expect(daysUntilSunset(iso, dayBefore)).toBe(1);
        expect(daysUntilSunset(iso, dayBefore + offset)).toBe(1);
        expect(daysUntilSunset(iso, dayBefore + MS_PER_DAY - 1)).toBe(1);

        // The whole WIB day after reads -1 (Req 2.10).
        const dayAfter = deadlineMidnight + MS_PER_DAY;
        expect(daysUntilSunset(iso, dayAfter)).toBe(-1);
        expect(daysUntilSunset(iso, dayAfter + offset)).toBe(-1);
        expect(daysUntilSunset(iso, dayAfter + MS_PER_DAY - 1)).toBe(-1);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: old-operations-sunset-notice, Property 6: Malformed dates yield null, not a wrong number
  it('returns null rather than a wrong number for junk dates and junk instants', () => {
    const nonNumber = fc.oneof(junk(), fc.constantFrom(Number.NaN, Infinity, -Infinity));

    fc.assert(
      fc.property(nonNumber, isoDate(), instant(), (bad, iso, now) => {
        // A malformed date, a non-string, or a date that does not exist —
        // including the ones a date constructor would silently roll forward
        // (Req 2.5).
        expect(() => isoDayIndex(bad)).not.toThrow();
        expect(isoDayIndex(bad)).toBeNull();

        // A broken deadline counts to nothing rather than to a wrong day (Req 2.13).
        expect(() => daysUntilSunset(bad, now)).not.toThrow();
        expect(daysUntilSunset(bad, now)).toBeNull();

        // Anything that is not a finite number of milliseconds is not an instant
        // (Req 2.14), and a real date with an unreadable instant still yields
        // null rather than NaN (Req 2.13).
        if (typeof bad !== 'number' || !Number.isFinite(bad)) {
          expect(() => wibDayIndex(bad)).not.toThrow();
          expect(wibDayIndex(bad)).toBeNull();
          expect(daysUntilSunset(iso, bad)).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('opsSunset date resolution properties', () => {
  // Feature: old-operations-sunset-notice, Property 19: resolveSunsetISO cannot be sabotaged by config
  it('takes a real configured date and falls through to the fallback for every other value', () => {
    const candidate = () => fc.oneof(junk(), isoDate());

    fc.assert(
      fc.property(candidate(), isoDate(), (configured, fallback) => {
        let resolved;
        // Total over every argument type, including numbers, booleans, arrays
        // and objects (Req 1.9).
        expect(() => { resolved = resolveSunsetISO(fallback, configured); }).not.toThrow();

        // The biconditional: a configured value that names a real calendar day
        // wins outright (Req 1.3), and every other configured value — absent,
        // null, the wrong type, malformed, or naming a day that does not exist —
        // falls through to the fallback rather than switching the notice off
        // (Req 1.4).
        if (isoDayIndex(configured) === null) {
          expect(resolved).toBe(fallback);
        } else {
          expect(resolved).toBe(configured);
        }

        // Either way the answer is a real calendar date, so a mistyped config
        // value cannot leave the banner with nothing to count to (Req 1.9).
        expect(typeof resolved).toBe('string');
        expect(isoDayIndex(resolved)).not.toBeNull();

        // Derived from the two arguments alone: repeated calls agree, and no
        // Storage entry, host timezone or clock reading can make one browser
        // resolve a different date from another (Req 1.8).
        expect(resolveSunsetISO(fallback, configured)).toBe(resolved);

        // And the shipped constant is itself a real date, so the normal call
        // shape can never reach the null branch (Req 1.1, 1.9).
        expect(isoDayIndex(resolveSunsetISO(OLD_OPS_SUNSET_ISO, configured))).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: old-operations-sunset-notice, Property 19: resolveSunsetISO cannot be sabotaged by config
  it('returns null only when neither argument names a real calendar date', () => {
    fc.assert(
      fc.property(junk(), junk(), (configured, fallback) => {
        // Both sides unreadable is the one case with no date to count to
        // (Req 1.5) — and it still completes without throwing (Req 1.9).
        let resolved;
        expect(() => { resolved = resolveSunsetISO(fallback, configured); }).not.toThrow();

        if (isoDayIndex(configured) === null && isoDayIndex(fallback) === null) {
          expect(resolved).toBeNull();
        } else {
          expect(isoDayIndex(resolved)).not.toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
describe('opsSunset phase selection properties', () => {
  // Feature: old-operations-sunset-notice, Property 7: sunsetPhase is total over the integers
  it('maps every integer to exactly one phase, and every non-integer to null', () => {
    const nonInteger = fc.oneof(
      junk().filter((v) => !Number.isInteger(v)),
      fc.constantFrom(Number.NaN, Infinity, -Infinity, 2.5, -0.5, '3', '0'),
    );

    fc.assert(
      fc.property(fc.integer({ min: -100000, max: 100000 }), nonInteger, (days, bad) => {
        let phaseName;
        // Total over the integers: a clock set to 1970 or to 2400 still lands on
        // a phase, and the call completes without throwing (Req 3.7).
        expect(() => { phaseName = sunsetPhase(days); }).not.toThrow();
        expect(SUNSET_PHASES).toContain(phaseName);

        // Exactly one member, and derived from the day count alone — the same
        // count answers the same way on every call, reading no clock, no Storage
        // entry and no configuration value (Req 3.7).
        expect(SUNSET_PHASES.filter((p) => p === phaseName)).toHaveLength(1);
        expect(sunsetPhase(days)).toBe(phaseName);

        // Anything that is not an integer is not a day count: null rather than a
        // guess, and never a throw (Req 3.8).
        expect(() => sunsetPhase(bad)).not.toThrow();
        expect(sunsetPhase(bad)).toBeNull();
      }),
      { numRuns: 100 },
    );

    // The two ends of the safe integer range are still integers, so they still
    // land on a phase rather than falling out of the chain (Req 3.7).
    expect(sunsetPhase(Number.MAX_SAFE_INTEGER)).toBe('notice');
    expect(sunsetPhase(-Number.MAX_SAFE_INTEGER)).toBe('past');
  });

  // Feature: old-operations-sunset-notice, Property 8: Severity never decreases as the deadline approaches
  it('never softens the phase as the day count falls', () => {
    const pair = () => fc.tuple(
      fc.integer({ min: -3650, max: 3650 }),
      fc.integer({ min: -3650, max: 3650 }),
    ).map(([x, y]) => (x <= y ? [x, y] : [y, x]));

    fc.assert(
      fc.property(pair(), ([a, b]) => {
        const rankA = phaseRank(sunsetPhase(a));
        const rankB = phaseRank(sunsetPhase(b));

        // Both counts name a known phase, so both ranks are real positions
        // rather than the unknown-value sentinel (Req 3.9).
        expect(rankA).toBeGreaterThanOrEqual(0);
        expect(rankB).toBeGreaterThanOrEqual(0);

        // The fewer days remain, the further along the severity list we are: a
        // notice that got calmer as the date got closer would be worse than none
        // (Req 3.10).
        expect(rankA).toBeGreaterThanOrEqual(rankB);
      }),
      { numRuns: 100 },
    );

    // The ranks are the zero-based positions the ordering is read from (Req 3.9).
    expect(SUNSET_PHASES.map(phaseRank)).toEqual([0, 1, 2, 3, 4]);
  });

  // Feature: old-operations-sunset-notice, Property 8: Severity never decreases as the deadline approaches
  it('ranks every value that is not exactly a phase name as unknown', () => {
    const notAPhase = fc.oneof(
      junk(),
      fc.constantFrom('Warning', 'PAST', ' warning', 'warning ', '', 'nearly-past'),
      phase().map((p) => `${p} `),
      phase().map((p) => p.toUpperCase()),
    );

    fc.assert(
      fc.property(notAPhase, (bad) => {
        fc.pre(!SUNSET_PHASES.includes(bad));

        // A mistyped phase is an unknown value, not a near-miss: -1 rather than a
        // position that would compare as less urgent than it is (Req 3.14).
        expect(() => phaseRank(bad)).not.toThrow();
        expect(phaseRank(bad)).toBe(-1);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: old-operations-sunset-notice, Property 9: The thresholds sit exactly where the table says
  it('puts each threshold exactly where the table says', () => {
    // Checked directly rather than generated, because an off-by-one here is the
    // difference between "urgent on the last three days" and "urgent on the last
    // two" (Req 3.2, 3.3, 3.4, 3.5, 3.6).
    const boundaries = [
      [15, 'notice'],
      [14, 'warning'],
      [4, 'warning'],
      [3, 'urgent'],
      [1, 'urgent'],
      [0, 'final'],
      [-1, 'past'],
    ];

    boundaries.forEach(([days, expected]) => {
      expect(sunsetPhase(days)).toBe(expected);
    });

    fc.assert(
      fc.property(fc.integer({ min: -3650, max: 3650 }), (days) => {
        // 15 and up is the distant deadline (Req 3.2); 4 through 14 the warning
        // band (Req 3.3); 1 through 3 the urgent one (Req 3.4); 0 the deadline's
        // own day (Req 3.5); anything negative is after it (Req 3.6).
        if (days >= 15) expect(sunsetPhase(days)).toBe('notice');
        else if (days >= 4) expect(sunsetPhase(days)).toBe('warning');
        else if (days >= 1) expect(sunsetPhase(days)).toBe('urgent');
        else if (days === 0) expect(sunsetPhase(days)).toBe('final');
        else expect(sunsetPhase(days)).toBe('past');
      }),
      { numRuns: 100 },
    );

    // The far end of the notice band, ten years out and beyond (Req 3.2), and the
    // far end of the past band (Req 3.6).
    expect(sunsetPhase(16)).toBe('notice');
    expect(sunsetPhase(3650)).toBe('notice');
    expect(sunsetPhase(-3650)).toBe('past');
  });

  // Feature: old-operations-sunset-notice, Property 10: final and past are never dismissible, the other three always are
  it('allows dismissal in exactly the three live phases', () => {
    fc.assert(
      fc.property(phase(), (phaseName) => {
        // `notice`, `warning` and `urgent` are reminders about a future date and
        // may be closed; `final` and `past` are the current status of the screen
        // the user is looking at, and a status is not something you close
        // (Req 5.10).
        expect(isDismissible(phaseName)).toBe(phaseName !== 'final' && phaseName !== 'past');
      }),
      { numRuns: 100 },
    );

    // Stated as a table too, so a change to the rule has to change this line
    // rather than agreeing with itself (Req 5.10).
    expect(SUNSET_PHASES.map(isDismissible)).toEqual([true, true, true, false, false]);
  });
});

/** A localStorage stand-in, following the pattern in `tour.property.test.js`. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get size() { return map.size; },
    keys: () => [...map.keys()],
  };
}

/**
 * A storage that refuses every operation, as a locked-down private-mode one and
 * a quota-exhausted one both do. Reading, writing and removing all throw.
 */
function throwingStorage() {
  return {
    getItem() { throw new Error('storage read denied'); },
    setItem() { throw new Error('storage write denied'); },
    removeItem() { throw new Error('storage remove denied'); },
  };
}

/** The three phases a dismissal can be recorded for. */
const dismissiblePhase = () => fc.constantFrom(...SUNSET_PHASES.filter(isDismissible));

describe('opsSunset dismissal properties', () => {
  // Feature: old-operations-sunset-notice, Property 11: Recording then reading round-trips
  it('reads back exactly the phase and instant it wrote, then and later', () => {
    fc.assert(
      fc.property(dismissiblePhase(), instant(), fc.nat({ max: 4e9 }), (phaseName, now, later) => {
        const storage = fakeStorage();

        // The write reports success, under the one key and no other (Req 5.13).
        expect(recordDismissal(phaseName, now, storage)).toBe(true);
        expect(storage.keys()).toEqual([DISMISS_KEY]);

        // Read back at the same instant: the same phase and the same epoch
        // millisecond value, not a re-derived or rounded one (Req 5.4).
        const record = readDismissal(storage);
        expect(record).toEqual({ phase: phaseName, at: now });
        expect(isDismissed(phaseName, record, now)).toBe(true);

        // And at every later instant, so the notice stays closed rather than
        // reappearing on the next render (Req 5.4).
        expect(isDismissed(phaseName, readDismissal(storage), now + later)).toBe(true);

        // A second dismissal replaces the first, so exactly one record remains:
        // the record is the last thing closed, not a history (Req 5.13).
        expect(recordDismissal(phaseName, now + later, storage)).toBe(true);
        expect(storage.size).toBe(1);
        expect(readDismissal(storage)).toEqual({ phase: phaseName, at: now + later });
      }),
      { numRuns: 100 },
    );
  });

  // Feature: old-operations-sunset-notice, Property 12: A dismissal suppresses exactly one phase
  it('suppresses the phase that was dismissed and no other', () => {
    fc.assert(
      fc.property(phase(), phase(), instant(), (a, b, now) => {
        const storage = fakeStorage();
        recordDismissal(a, now, storage);

        // The biconditional: dismissing one phase says nothing about any other,
        // whether the other is less urgent or more urgent, so escalation always
        // re-surfaces the notice (Req 5.6).
        expect(isDismissed(b, readDismissal(storage), now)).toBe(a === b);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: old-operations-sunset-notice, Property 13: A dismissal from the future is ignored
  it('ignores a record stamped after the current instant, by any margin', () => {
    fc.assert(
      fc.property(dismissiblePhase(), instant(), fc.integer({ min: 1, max: 4e9 }), (phaseName, now, skew) => {
        const storage = fakeStorage();
        expect(recordDismissal(phaseName, now + skew, storage)).toBe(true);

        // A record from the future can only have come from a clock that was
        // wrong when it was written; honouring it would hide the deadline on that
        // machine for good, so it is discarded — 1 millisecond ahead included
        // (Req 5.8).
        const record = readDismissal(storage);
        expect(isDismissed(phaseName, record, now)).toBe(false);
        expect(isDismissed(phaseName, record, now + skew - 1)).toBe(false);

        // It starts counting once the instant it names has actually arrived, so
        // the record is ignored rather than deleted (Req 5.4, 5.8).
        expect(isDismissed(phaseName, record, now + skew)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: old-operations-sunset-notice, Property 14: Junk in storage means not dismissed
  it('treats junk, an unreadable storage and an absent storage as not dismissed', () => {
    const brokenRecord = () => fc.oneof(
      // A phase that is not one of the five, however close it looks.
      fc.record({
        phase: fc.oneof(
          fc.constantFrom('Warning', 'PAST', ' warning', 'warning ', '', 'nearly-past'),
          fc.constant(null), fc.integer(), fc.boolean(),
        ),
        at: fc.integer(),
      }),
      // A real phase with an `at` that is not a finite number.
      fc.record({
        phase: phase(),
        at: fc.oneof(
          fc.constant(null), fc.constant(undefined), fc.string(), fc.boolean(),
          fc.constantFrom(Number.NaN, Infinity, -Infinity),
        ),
      }),
    ).map((r) => JSON.stringify(r));

    const stored = () => fc.oneof(
      junk(),
      brokenRecord(),
      fc.array(fc.string()).map((a) => JSON.stringify(a)),
    );

    fc.assert(
      fc.property(stored(), phase(), instant(), (raw, phaseName, now) => {
        const storage = fakeStorage();
        storage.setItem(DISMISS_KEY, raw);

        // Unparseable JSON, a value that is not an object, a phase outside the
        // five, or a non-finite `at` all mean there is no usable record — null
        // rather than a partly-trusted one, and never a throw (Req 5.7).
        let record;
        expect(() => { record = readDismissal(storage); }).not.toThrow();
        expect(record).toBeNull();

        // So the phase is not dismissed, and the banner stays up (Req 5.7, 13.3).
        expect(() => isDismissed(phaseName, record, now)).not.toThrow();
        expect(isDismissed(phaseName, record, now)).toBe(false);

        // A storage that refuses to be read is the same case: no record, no
        // dismissal, no error reaching the user (Req 5.9, 13.3).
        const denied = throwingStorage();
        expect(() => { record = readDismissal(denied); }).not.toThrow();
        expect(record).toBeNull();
        expect(isDismissed(phaseName, record, now)).toBe(false);

        // A storage that refuses to be written or cleared reports failure rather
        // than throwing, and still leaves the phase not dismissed (Req 5.14).
        expect(() => recordDismissal(phaseName, now, denied)).not.toThrow();
        expect(recordDismissal(phaseName, now, denied)).toBe(false);
        expect(() => clearDismissal(denied)).not.toThrow();
        expect(clearDismissal(denied)).toBe(false);
        expect(isDismissed(phaseName, readDismissal(denied), now)).toBe(false);

        // And an absent storage — server render, private-mode lockdown — is a
        // normal case, not an error (Req 5.9, 5.14, 13.3).
        expect(readDismissal(null)).toBeNull();
        expect(recordDismissal(phaseName, now, null)).toBe(false);
        expect(clearDismissal(null)).toBe(false);
        expect(isDismissed(phaseName, readDismissal(null), now)).toBe(false);

        // Junk that fails to parse is also junk that fails to hide the notice
        // when it is the missing key rather than a bad value (Req 5.7).
        const empty = fakeStorage();
        expect(readDismissal(empty)).toBeNull();
        expect(isDismissed(phaseName, readDismissal(empty), now)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
