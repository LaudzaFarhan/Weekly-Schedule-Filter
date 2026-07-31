/**
 * Property tests for the pure report-card derivation module (`src/lib/reportCard.js`).
 *
 * Ten of the design's correctness properties live here, because all ten quantify
 * over the same four pure functions:
 *
 *   Properties 1–6   `competencyAverages` / `overallGrade`   (Req 3.1–3.4, 3.7, 5.12)
 *   Properties 7–8   `lessonSeries`                          (Req 2.7, 3.5, 3.6)
 *   Properties 12–13 `termSummary`                           (Req 4.1–4.8)
 *
 * Generators come from `./helpers/reportCardArbitraries` rather than being
 * redefined here, so a change to the record shape is one edit in one file.
 *
 * No mocks: the module under test imports only `reportCardRubric` and
 * `programRules`, both pure, so every assertion below runs against the real
 * derivation the page and the printed document use.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  GRADE_BANDS,
  NOT_ASSESSED,
  competencyAverages,
  lessonSeries,
  overallGrade,
  termSummary,
} from '@/lib/reportCard';
import { LESSONS_PER_LEVEL } from '@/lib/programRules';

import {
  COMPETENCY_KEYS,
  evaluationsForOneStudentArb,
  termRowArb,
  termYearArb,
  validEvaluationArb,
} from './helpers/reportCardArbitraries';

/** The three states a badge may carry, and nothing else (Req 4.1). */
const BADGE_STATES = ['paid', 'unpaid', 'absent'];

/** Every label the band table can produce, for the "non-empty label" check. */
const BAND_LABELS = GRADE_BANDS.map((band) => band.label);

/** The mean of one evaluation's five scores — one point of the trend series. */
const rowMean = (row) =>
  COMPETENCY_KEYS.reduce((total, key) => total + row[key], 0) / COMPETENCY_KEYS.length;

/** The arithmetic mean of a non-empty list of numbers. */
const meanOf = (numbers) => numbers.reduce((total, value) => total + value, 0) / numbers.length;

/** The band the displayed score falls in, recomputed independently of the module. */
const bandFor = (score) => GRADE_BANDS.find((band) => score >= band.min);

/**
 * `(year, termNumber)` collapsed to one comparable integer. `termNumber` is
 * constrained to 1..4, so `year * 4 + termNumber` orders exactly as year-then-term
 * lexicographic ordering does.
 */
const termOrder = (point) => point.year * 4 + point.termNumber;

/** An averages object whose five values are all `score`, so the mean is `score`. */
const averagesAllEqualTo = (score) =>
  Object.fromEntries(COMPETENCY_KEYS.map((key) => [key, score]));

/** A score anywhere in the displayable range, boundary values included. */
const scoreArb = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: 1, max: 5, noNaN: true }) },
  // The band thresholds and the values that round onto them, where an off-by-one
  // in the rounding order would show.
  {
    weight: 4,
    arbitrary: fc.constantFrom(1, 1.44, 1.45, 1.5, 2.449, 2.45, 2.5, 3.45, 3.5, 4.449, 4.45, 4.5, 5),
  },
);

/** A list of evaluations paired with a permutation of itself. */
const withPermutation = (rowsArb) =>
  rowsArb.chain((rows) =>
    fc.tuple(
      fc.constant(rows),
      rows.length === 0
        ? fc.constant([])
        : fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }),
    ),
  );

describe('reportCard derivation properties', () => {
  // Feature: student-report-cards, Property 1: Averages are in range and total
  it('returns five in-range means for any non-empty list and no value for an empty one', () => {
    fc.assert(
      fc.property(fc.array(validEvaluationArb, { minLength: 1, maxLength: 12 }), (rows) => {
        const averages = competencyAverages(rows);

        // Exactly the five competencies, no more and no fewer (Req 3.1).
        expect(averages).not.toBeNull();
        expect(Object.keys(averages).sort()).toEqual([...COMPETENCY_KEYS].sort());

        for (const key of COMPETENCY_KEYS) {
          // Each value is the arithmetic mean of that competency and therefore
          // lies in [1,5], the range of a single score (Req 3.1).
          expect(averages[key]).toBeGreaterThanOrEqual(1);
          expect(averages[key]).toBeLessThanOrEqual(5);
          expect(averages[key]).toBeCloseTo(meanOf(rows.map((row) => row[key])), 9);
        }

        // No evaluations is a distinct value, never a row of zeroes (Req 3.4).
        expect(competencyAverages([])).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 2: Averages are order-independent
  it('returns the same averages for any ordering of the same set and leaves it unchanged', () => {
    fc.assert(
      fc.property(
        withPermutation(fc.array(validEvaluationArb, { minLength: 1, maxLength: 12 })),
        ([rows, shuffled]) => {
          const before = structuredClone(rows);

          const fromOriginal = competencyAverages(rows);
          const fromShuffled = competencyAverages(shuffled);

          // Two orderings of one set, one answer (Req 3.1).
          for (const key of COMPETENCY_KEYS) {
            expect(fromShuffled[key]).toBeCloseTo(fromOriginal[key], 9);
          }

          // The supplied set is left unchanged (Req 3.1).
          expect(rows).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 3: The overall score is the grand mean
  it('scores a non-empty list at the grand mean of every score of every evaluation', () => {
    fc.assert(
      fc.property(fc.array(validEvaluationArb, { minLength: 1, maxLength: 12 }), (rows) => {
        const averages = competencyAverages(rows);
        const meanOfAverages = meanOf(COMPETENCY_KEYS.map((key) => averages[key]));
        const grandMean = meanOf(rows.flatMap((row) => COMPETENCY_KEYS.map((key) => row[key])));

        // The mean of the five averages IS the mean of all 5n scores, within the
        // tolerance the requirement states (Req 3.2).
        expect(Math.abs(meanOfAverages - grandMean)).toBeLessThanOrEqual(0.000001);

        // And the displayed score is that same mean, rounded to one decimal for
        // display and nothing else (Req 3.2, Req 3.3).
        const grade = overallGrade(averages);
        expect(Math.abs(grade.score - grandMean)).toBeLessThanOrEqual(0.05 + 0.000001);

        // A per-evaluation trend point is the mean of that evaluation's five
        // scores, so the trend line and the badge measure the same thing (Req 3.2).
        expect(meanOf(rows.map(rowMean))).toBeCloseTo(grandMean, 9);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 4: Banding is total and monotone
  it('bands every score in [1,5] and never lowers the rank as the score rises', () => {
    fc.assert(
      fc.property(scoreArb, scoreArb, (first, second) => {
        const lower = Math.min(first, second);
        const higher = Math.max(first, second);

        for (const score of [lower, higher]) {
          const grade = overallGrade(averagesAllEqualTo(score));

          // Total: a real label and a real rank for every score in range (Req 3.3).
          expect(BAND_LABELS).toContain(grade.label);
          expect(grade.label.length).toBeGreaterThan(0);
          expect(grade.rank).toBeGreaterThanOrEqual(1);
          expect(grade.rank).toBeLessThanOrEqual(5);
          expect(Number.isInteger(grade.rank)).toBe(true);
        }

        // Monotone: a ≤ b implies rank(a) ≤ rank(b), so a higher score can never
        // carry a lower band (Req 3.3).
        expect(overallGrade(averagesAllEqualTo(lower)).rank).toBeLessThanOrEqual(
          overallGrade(averagesAllEqualTo(higher)).rank,
        );
      }),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 5: The printed number and the printed label agree
  it('prints a score whose recomputed band is the label printed beside it', () => {
    fc.assert(
      fc.property(fc.array(validEvaluationArb, { minLength: 1, maxLength: 12 }), (rows) => {
        const grade = overallGrade(competencyAverages(rows));

        // The score is a one-decimal display value (Req 3.7).
        expect(Math.round(grade.score * 10) / 10).toBe(grade.score);

        // Banding the DISPLAYED score reproduces the displayed label and rank, so
        // the number and the label on the printed line cannot contradict each
        // other (Req 3.3, Req 3.7).
        const recomputed = bandFor(grade.score);
        expect(recomputed).toBeDefined();
        expect(recomputed.label).toBe(grade.label);
        expect(grade.rank).toBe(recomputed.rank);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 6: No evaluations means no number
  it('reads NOT YET ASSESSED with no number and no /5 text when there are no evaluations', () => {
    fc.assert(
      fc.property(
        // The empty list, and the non-lists the module must survive without
        // inventing a score.
        fc.constantFrom([], null, undefined, 0, '', {}),
        (nothing) => {
          const averages = competencyAverages(nothing);
          const grade = overallGrade(averages);
          const series = lessonSeries(nothing);

          // No averages, no score, the stated label (Req 3.4).
          expect(averages).toBeNull();
          expect(grade).toEqual(NOT_ASSESSED);
          expect(grade.score).toBeNull();
          expect(grade.label).toBe('NOT YET ASSESSED');
          expect(series).toEqual({ labels: [], values: [], dates: [] });

          // Everything the document can print from this derivation, assembled the
          // way the report assembles it: the grade line and the five mastery
          // values. It carries no digit followed by `/5` — and in fact no digit at
          // all, so `0.0/5` cannot reach paper (Req 3.4, Req 5.12).
          const printable = [
            grade.label,
            grade.score === null ? '' : `${grade.score.toFixed(1)} / 5.0`,
            ...(averages ? Object.values(averages).map((value) => `${value.toFixed(1)} / 5.0`) : []),
            ...series.values.map((value) => `${value.toFixed(1)} / 5.0`),
          ].join(' ');

          expect(printable).not.toMatch(/\d\s*\/\s*5/);
          expect(printable).not.toMatch(/\d/);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 7: Lesson labels are contiguous true ordinals
  it('labels the window with consecutive true ordinals ending at the nth lesson', () => {
    fc.assert(
      fc.property(
        evaluationsForOneStudentArb({ minLength: 0, maxLength: 12 }),
        fc.integer({ min: 1, max: 15 }),
        (rows, window) => {
          const n = rows.length;

          for (const [series, w] of [
            // The explicit window, and the default one — which must be
            // LESSONS_PER_LEVEL from programRules, not a value of this feature's
            // own (Req 3.6).
            [lessonSeries(rows, { window }), window],
            [lessonSeries(rows), LESSONS_PER_LEVEL],
          ]) {
            // The last min(n, w) records, and one value and one date per label
            // (Req 3.5).
            expect(series.labels).toHaveLength(Math.min(n, w));
            expect(series.values).toHaveLength(series.labels.length);
            expect(series.dates).toHaveLength(series.labels.length);

            const ordinals = series.labels.map((label) => {
              expect(label).toMatch(/^L\d+$/);
              return Number(label.slice(1));
            });

            // Consecutive integers increasing by 1 (Req 3.5).
            for (let i = 1; i < ordinals.length; i += 1) {
              expect(ordinals[i]).toBe(ordinals[i - 1] + 1);
            }

            if (n > 0) {
              // TRUE ordinals: the last point is the nth lesson of the whole
              // history, so an 11-record student reads L2…L11 (Req 3.5).
              expect(ordinals[ordinals.length - 1]).toBe(n);
              expect(ordinals[0]).toBe(n - Math.min(n, w) + 1);
              if (n <= w) expect(ordinals[0]).toBe(1);
            }

            // Each point is a mean of five scores in [1,5] (Req 3.5).
            for (const value of series.values) {
              expect(value).toBeGreaterThanOrEqual(1);
              expect(value).toBeLessThanOrEqual(5);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 8: Series order is date order
  it('returns one date-ordered series for any ordering of the same evaluations', () => {
    fc.assert(
      fc.property(
        withPermutation(evaluationsForOneStudentArb({ minLength: 0, maxLength: 12 })),
        ([rows, shuffled]) => {
          const before = structuredClone(rows);

          const fromOriginal = lessonSeries(rows);
          const fromShuffled = lessonSeries(shuffled);

          // The module sorts for itself, so the order it was handed the records in
          // cannot change the chart (Req 3.5).
          expect(fromShuffled).toEqual(fromOriginal);

          // Ordered ascending by date, matching the order the API returns records
          // in (Req 2.7, Req 3.5).
          for (let i = 1; i < fromOriginal.dates.length; i += 1) {
            expect(fromOriginal.dates[i] >= fromOriginal.dates[i - 1]).toBe(true);
          }

          // The caller's list survives the sort (Req 3.5).
          expect(rows).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 12: Four badges, at most one current
  it('always returns four ordered badges with at most one marked current', () => {
    fc.assert(
      fc.property(
        fc.array(termRowArb, { maxLength: 8 }),
        fc.option(termYearArb, { nil: undefined }),
        (rows, year) => {
          const summary = termSummary(rows, { year });

          // Exactly four badges, T1..T4, in ascending term-number order (Req 4.2).
          expect(summary.badges).toHaveLength(4);
          expect(summary.badges.map((badge) => badge.label)).toEqual(['T1', 'T2', 'T3', 'T4']);
          expect(summary.badges.map((badge) => badge.termNumber)).toEqual([1, 2, 3, 4]);

          for (const badge of summary.badges) {
            expect(BADGE_STATES).toContain(badge.state);

            // The state is decided by the rows of the SELECTED year only, paid
            // winning a disagreement (Req 4.1).
            const inYear = rows.filter(
              (row) => row.year === summary.year && row.termNumber === badge.termNumber,
            );
            const expected =
              inYear.length === 0
                ? 'absent'
                : inYear.some((row) => row.paid === true)
                  ? 'paid'
                  : 'unpaid';
            expect(badge.state).toBe(expected);
          }

          // At most one current badge, by construction rather than convention
          // (Req 4.2).
          const current = summary.badges.filter((badge) => badge.current === true);
          expect(current.length).toBeLessThanOrEqual(1);

          // A current badge exists only where the current term sits in the
          // selected year, so a latest paid term in an earlier year shows no
          // current badge here (Req 4.8).
          if (current.length === 1) {
            expect(summary.currentTerm).not.toBeNull();
            expect(summary.currentTerm.year).toBe(summary.year);
            expect(current[0].termNumber).toBe(summary.currentTerm.termNumber);
            expect(current[0].state).toBe('paid');
          } else if (summary.currentTerm) {
            expect(summary.currentTerm.year).not.toBe(summary.year);
          }

          // No term rows at all: four absent badges and no header values (Req 4.6).
          if (rows.length === 0) {
            expect(summary.badges.every((badge) => badge.state === 'absent')).toBe(true);
            expect(summary.badges.every((badge) => badge.current === false)).toBe(true);
            expect(summary.startTerm).toBeNull();
            expect(summary.currentTerm).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 13: The current term never precedes the start term
  it('reports a current term only when a term is paid, and never before the start term', () => {
    fc.assert(
      fc.property(fc.array(termRowArb, { maxLength: 8 }), (rows) => {
        const before = structuredClone(rows);
        const summary = termSummary(rows);

        const paidRows = rows.filter((row) => row.paid === true);

        // A current term exists if and only if a row is paid (Req 4.3).
        expect(summary.currentTerm !== null).toBe(paidRows.length > 0);
        expect(summary.startTerm !== null).toBe(rows.length > 0);

        if (summary.startTerm) {
          // The (year, termNumber) minimum over every row, and the maximum over
          // the paid rows (Req 4.3).
          expect(termOrder(summary.startTerm)).toBe(Math.min(...rows.map(termOrder)));
        }
        if (summary.currentTerm) {
          expect(termOrder(summary.currentTerm)).toBe(Math.max(...paidRows.map(termOrder)));
        }
        if (summary.startTerm && summary.currentTerm) {
          // The current term is drawn from a subset of the rows the start term
          // minimises over, so it can never precede it (Req 4.3).
          expect(termOrder(summary.startTerm)).toBeLessThanOrEqual(termOrder(summary.currentTerm));
        }

        // Both points are fresh { year, termNumber } values, carrying no stored
        // current-term or start-term flag out of the input rows (Req 4.4).
        for (const point of [summary.startTerm, summary.currentTerm].filter(Boolean)) {
          expect(Object.keys(point).sort()).toEqual(['termNumber', 'year']);
          expect(rows).not.toContain(point);
        }

        // With no year supplied: the greatest year held, or the current calendar
        // year when the student holds no term row (Req 4.7).
        expect(summary.year).toBe(
          rows.length > 0 ? Math.max(...rows.map((row) => row.year)) : new Date().getFullYear(),
        );

        // The supplied rows are left unchanged.
        expect(rows).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });
});
