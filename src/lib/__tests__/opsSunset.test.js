import { describe, it, expect } from 'vitest';
import {
  OLD_OPS_SUNSET_ISO,
  PHASE_COPY,
  SUNSET_PHASES,
  daysUntilSunset,
  formatSunsetDate,
  isDismissible,
  resolveSunsetISO,
  sunsetPhase,
} from '../opsSunset';

/**
 * The worked examples from the design, as executable assertions. The property
 * tests prove the invariants; these show a reader what the numbers actually are
 * on the dates that matter.
 *
 * Every instant is built explicitly in UTC and shifted by hand, so the numbers
 * below are the same whatever timezone the machine running the suite is set to.
 */

/** An instant given as a WIB wall-clock time. WIB is UTC+7 with no DST. */
function wib(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
  return Date.UTC(year, month - 1, day, hour - 7, minute, second, ms);
}

describe('daysUntilSunset — the run-up to 1 September 2026', () => {
  it('reads 28 days on 4 August 2026, which is the notice phase', () => {
    const days = daysUntilSunset('2026-09-01', wib(2026, 8, 4, 9, 0));
    expect(days).toBe(28);
    expect(sunsetPhase(days)).toBe('notice');
  });

  it('reads 14 days on 18 August 2026, the first day of warning', () => {
    const days = daysUntilSunset('2026-09-01', wib(2026, 8, 18, 9, 0));
    expect(days).toBe(14);
    expect(sunsetPhase(days)).toBe('warning');
    // The day before is still notice, so 18 August really is the boundary.
    expect(sunsetPhase(daysUntilSunset('2026-09-01', wib(2026, 8, 17, 9, 0)))).toBe('notice');
  });

  it('reads 3 days on 29 August 2026, the first day of urgent', () => {
    const days = daysUntilSunset('2026-09-01', wib(2026, 8, 29, 9, 0));
    expect(days).toBe(3);
    expect(sunsetPhase(days)).toBe('urgent');
    expect(sunsetPhase(daysUntilSunset('2026-09-01', wib(2026, 8, 28, 9, 0)))).toBe('warning');
  });

  it('reads 1 day throughout 31 August 2026, the WIB day before the deadline', () => {
    expect(daysUntilSunset('2026-09-01', wib(2026, 8, 31, 0, 1))).toBe(1);
    expect(daysUntilSunset('2026-09-01', wib(2026, 8, 31, 23, 59))).toBe(1);
  });

  it('reads 0 at both ends of 1 September 2026, and that day is final', () => {
    const justAfterMidnight = daysUntilSunset('2026-09-01', wib(2026, 9, 1, 0, 1));
    const justBeforeMidnight = daysUntilSunset('2026-09-01', wib(2026, 9, 1, 23, 59));

    expect(justAfterMidnight).toBe(0);
    expect(justBeforeMidnight).toBe(0);
    expect(sunsetPhase(justAfterMidnight)).toBe('final');
    expect(sunsetPhase(justBeforeMidnight)).toBe('final');
    // Not dismissible: on the day itself the notice is a status, not a reminder.
    expect(isDismissible('final')).toBe(false);
  });

  it('reads −1 on 2 September 2026, which is past and not dismissible', () => {
    const days = daysUntilSunset('2026-09-01', wib(2026, 9, 2, 9, 0));
    expect(days).toBe(-1);
    expect(sunsetPhase(days)).toBe('past');
    expect(isDismissible('past')).toBe(false);
  });
});

describe('resolveSunsetISO — config precedence', () => {
  it('takes a configured date that names a real day', () => {
    expect(resolveSunsetISO(OLD_OPS_SUNSET_ISO, '2026-09-15')).toBe('2026-09-15');
  });

  it('falls back to the shipped constant when nothing is configured', () => {
    expect(resolveSunsetISO(OLD_OPS_SUNSET_ISO, null)).toBe('2026-09-01');
  });

  it('falls back when the configured value is not a date at all', () => {
    expect(resolveSunsetISO(OLD_OPS_SUNSET_ISO, 'soon')).toBe('2026-09-01');
  });

  it('falls back when the configured value names a day that does not exist', () => {
    expect(resolveSunsetISO(OLD_OPS_SUNSET_ISO, '2026-02-30')).toBe('2026-09-01');
  });

  it('takes 29 February of a leap year, which is a real day', () => {
    expect(resolveSunsetISO(OLD_OPS_SUNSET_ISO, '2028-02-29')).toBe('2028-02-29');
  });
});

describe('formatSunsetDate', () => {
  it('writes the deadline out as day, month name, year', () => {
    expect(formatSunsetDate('2026-09-01')).toBe('1 September 2026');
  });
});
/**
 * The copy table. What matters here is not the exact prose — that will be edited
 * — but that the five phases stay tellable apart with the colour stripped out,
 * and that neither the day count nor the month name can push a rendered string
 * past the length the banner and a tour step body are allowed (Req 3.11, 3.12,
 * 3.15, 10.2, 10.4).
 */

/** Case ignored and runs of whitespace collapsed, per Req 3.12. */
function normalise(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Day counts that reach each phase, including both ends of its range and the
 * widest count Req 10.2 admits, so the longest number the templates can ever
 * interpolate is measured rather than assumed.
 */
const REPRESENTATIVE_DAYS = {
  notice: [15, 16, 28, 3650],
  warning: [4, 9, 14],
  urgent: [1, 2, 3],
  final: [0],
  past: [-1, -365, -3650],
};

/**
 * The shipped date and the longest date `formatSunsetDate` can produce: a
 * two-digit day with the longest English month name.
 */
const REPRESENTATIVE_DATES = ['2026-09-01', '2026-09-30'];

/** Every rendering of every phase, as `{ phase, days, date, headline, detail }`. */
const RENDERINGS = SUNSET_PHASES.flatMap((phase) =>
  REPRESENTATIVE_DAYS[phase].flatMap((days) =>
    REPRESENTATIVE_DATES.map((iso) => {
      const date = formatSunsetDate(iso);
      return {
        phase,
        days,
        date,
        headline: PHASE_COPY[phase].headline(days, date),
        detail: PHASE_COPY[phase].detail(days, date),
      };
    }),
  ),
);

describe('PHASE_COPY — one entry per phase', () => {
  it('covers exactly the five phases and nothing else', () => {
    expect(Object.keys(PHASE_COPY).sort()).toEqual([...SUNSET_PHASES].sort());
  });

  it('gives every phase its own tone, equal to the phase name', () => {
    // Req 3.15: the tone maps to a CSS class, so a tone shared between two
    // phases would render two different messages identically.
    const tones = SUNSET_PHASES.map((phase) => PHASE_COPY[phase].tone);
    expect(tones).toEqual(SUNSET_PHASES);
    expect(new Set(tones).size).toBe(5);
  });

  it('assigns the five icon names the design lists', () => {
    // Req 3.11.
    expect(SUNSET_PHASES.map((phase) => PHASE_COPY[phase].icon)).toEqual([
      'Info',
      'AlertTriangle',
      'AlertCircle',
      'AlertCircle',
      'Archive',
    ]);
  });

  it('gives notice, warning and past an icon no other phase carries', () => {
    // Req 3.11: the three non-shared icons are unique, so those phases are
    // identifiable from the glyph alone.
    const icons = SUNSET_PHASES.map((phase) => PHASE_COPY[phase].icon);
    for (const phase of ['notice', 'warning', 'past']) {
      expect(icons.filter((icon) => icon === PHASE_COPY[phase].icon)).toHaveLength(1);
    }
  });

  it('tells urgent and final apart by headline and by dismissible, not by icon', () => {
    // Req 3.11: one glyph for "this is serious" is clearer than inventing a
    // second, so the pair has to be separated some other way.
    expect(PHASE_COPY.urgent.icon).toBe(PHASE_COPY.final.icon);

    const urgentHeadline = normalise(PHASE_COPY.urgent.headline(2, '1 September 2026'));
    const finalHeadline = normalise(PHASE_COPY.final.headline(0, '1 September 2026'));
    expect(urgentHeadline).not.toBe(finalHeadline);

    expect(isDismissible('urgent')).toBe(true);
    expect(isDismissible('final')).toBe(false);
  });

  it('gives the five phases pairwise distinct headlines, case and whitespace ignored', () => {
    // Req 3.12: five different sentences, not one sentence with a different
    // number in it, so the phase survives being read aloud without the colour.
    const headlines = SUNSET_PHASES.map((phase) =>
      normalise(PHASE_COPY[phase].headline(REPRESENTATIVE_DAYS[phase][0], '1 September 2026')),
    );
    expect(new Set(headlines).size).toBe(5);
  });
});

describe('PHASE_COPY — rendered length limits', () => {
  it('keeps every rendered headline non-empty and within 120 characters', () => {
    // Req 10.2.
    for (const { phase, days, headline } of RENDERINGS) {
      expect(headline.length, `${phase} at ${days} days: ${headline}`).toBeGreaterThan(0);
      expect(headline.length, `${phase} at ${days} days: ${headline}`).toBeLessThanOrEqual(120);
    }
  });

  it('keeps every rendered detail non-empty and within 240 characters', () => {
    // Req 10.4: the same cap tourSteps.test.js puts on a step body, so any of
    // this copy can be lifted into the sunset tour unchanged.
    for (const { phase, days, detail } of RENDERINGS) {
      expect(detail.length, `${phase} at ${days} days: ${detail}`).toBeGreaterThan(0);
      expect(detail.length, `${phase} at ${days} days: ${detail}`).toBeLessThanOrEqual(240);
    }
  });

  it('never renders a placeholder value into the copy', () => {
    // Req 10.2, 10.6: a template that reached for a missing field would show it.
    for (const { headline, detail } of RENDERINGS) {
      for (const text of [headline, detail]) {
        expect(text).not.toContain('NaN');
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('Invalid');
      }
    }
  });

  it('names no colour in any rendered string', () => {
    // Req 3.15: colour is decoration on top of wording that already carries the
    // meaning, so the copy must not tell the user to look for red.
    for (const { headline, detail } of RENDERINGS) {
      expect(normalise(`${headline} ${detail}`)).not.toMatch(/\b(red|amber|orange|blue|grey|gray|green|yellow)\b/);
    }
  });

  it('has every rendering land in the phase it was generated for', () => {
    // Guards the fixtures themselves: a representative day count that no longer
    // reaches its phase would make the length assertions above vacuous.
    for (const { phase, days } of RENDERINGS) {
      expect(sunsetPhase(days)).toBe(phase);
    }
  });
});
