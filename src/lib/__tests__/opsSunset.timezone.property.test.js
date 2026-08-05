/**
 * Timezone independence for the Old Operations sunset day count.
 *
 * This property lives in its own file because it is the one property that has to
 * control `process.env.TZ`. The module under test is imported three times, once
 * under each host timezone, through `vi.resetModules()` — so an offset captured
 * at import time (a module-level `new Date().getTimezoneOffset()`, say) would
 * differ between the three instances and the property would fail. `TZ` is also
 * re-applied immediately before each call, so an offset read at call time is
 * caught as well.
 *
 * If a host ignored `TZ` altogether the assertions would still hold, they would
 * simply stop proving anything; Node honours it on the platforms this suite runs
 * on, which is why the three instances are genuinely different environments.
 *
 * **Validates: Requirements 2.1, 2.11**
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

const MS_PER_DAY = 86400000;
const WIB_OFFSET_MS = 420 * 60000;

/**
 * The host timezones the count has to survive: UTC+14 and UTC−11 are the two
 * extremes of the inhabited range from Req 2.11, and Asia/Jakarta is the one host
 * whose own calendar day happens to agree with the school's — a bug that reads the
 * host clock would pass there and nowhere else, which is exactly why it is
 * included rather than assumed.
 */
const TIMEZONES = ['Pacific/Kiritimati', 'Pacific/Niue', 'Asia/Jakarta'];

/** Instants across a decade, so no property can pass by sitting on one date. */
const instant = () => fc.integer({
  min: Date.UTC(2020, 0, 1),
  max: Date.UTC(2030, 0, 1),
});

/**
 * Instants within a couple of milliseconds of a WIB midnight.
 *
 * A timezone bug is invisible in the middle of the day and obvious at midnight:
 * shifting the boundary by seven hours only changes the answer for instants that
 * sit within seven hours of one. Uniform sampling across a decade would hit that
 * band rarely, so it is generated directly.
 */
const nearWibMidnight = () => fc
  .tuple(instant(), fc.integer({ min: -2, max: 2 }))
  .map(([ms, delta]) => (
    Math.floor((ms + WIB_OFFSET_MS) / MS_PER_DAY) * MS_PER_DAY - WIB_OFFSET_MS + delta
  ));

const anyInstant = () => fc.oneof(instant(), nearWibMidnight());

/** Well-formed ISO dates that name real days. */
const isoDate = () => fc.date({
  min: new Date(Date.UTC(2020, 0, 1)),
  max: new Date(Date.UTC(2030, 0, 1)),
}).map((d) => d.toISOString().slice(0, 10));

/**
 * A fresh copy of the module, evaluated while `tz` is the host timezone.
 *
 * @param   {string} tz an IANA timezone name
 * @returns {Promise<object>} the module namespace for that timezone
 */
async function loadUnder(tz) {
  process.env.TZ = tz;
  vi.resetModules();
  return import('@/lib/opsSunset');
}

describe('opsSunset timezone independence', () => {
  const ORIGINAL_TZ = process.env.TZ;

  /** One module instance per timezone, in the order of `TIMEZONES`. */
  const loaded = [];

  beforeAll(async () => {
    for (const tz of TIMEZONES) {
      // Sequential on purpose: each import has to happen while its own `TZ` is
      // the one in force, so these cannot be started in parallel.
      // eslint-disable-next-line no-await-in-loop
      loaded.push({ tz, mod: await loadUnder(tz) });
    }
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    vi.resetModules();
  });

  // Feature: old-operations-sunset-notice, Property 5: The count is independent of the host timezone
  it('gives the same day count under UTC+14, UTC-11 and Asia/Jakarta', () => {
    fc.assert(
      fc.property(isoDate(), anyInstant(), (iso, nowMs) => {
        const readings = loaded.map(({ tz, mod }) => {
          // Re-applied per call, so a host offset read at call time rather than
          // at import time is caught too (Req 2.11).
          process.env.TZ = tz;

          return {
            tz,
            // Exactly 420 minutes, in every host timezone and with no DST
            // adjustment anywhere (Req 2.1).
            offsetMinutes: mod.WIB_OFFSET_MINUTES,
            days: mod.daysUntilSunset(iso, nowMs),
            wibDay: mod.wibDayIndex(nowMs),
            isoDay: mod.isoDayIndex(iso),
          };
        });

        const [first, ...rest] = readings;

        expect(first.offsetMinutes).toBe(420);

        for (const reading of rest) {
          // Compared as a whole rather than field by field, so a failure names
          // the timezone that disagreed and every value that moved with it.
          expect({ ...reading, tz: first.tz }).toEqual(first);
        }
      }),
      { numRuns: 100 },
    );
  });
});
