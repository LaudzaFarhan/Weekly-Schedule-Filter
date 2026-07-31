/**
 * Shared fast-check arbitraries for the student-report-cards property tests.
 *
 * THIS FILE IS A HELPER, NOT A TEST. It holds no `describe` and no `it`, and its
 * name deliberately avoids `.test.` / `.spec.` so it does not match the Vitest
 * include glob `src/**\/*.{test,spec}.{js,jsx}` in `vitest.config.mjs` — a file
 * that matched the glob but declared zero tests would fail the run.
 *
 * Consumers (per the design's Testing Strategy table):
 *   - `src/lib/__tests__/reportCard.property.test.js` — Properties 1–8, 12, 13
 *   - `src/lib/__tests__/evaluationValidation.property.test.js` — Property 9
 *   - `src/app/api/new/student-evaluations/__tests__/route.property.test.js` — 11, 15
 *   - `src/views/__tests__/NewStudentReportCardsPage.property.test.jsx` — 16, 17, 18
 *
 * The five competency keys come from `COMPETENCIES` in `src/lib/reportCardRubric.js`
 * rather than from literals repeated here, so a rename of a competency key is
 * still one edit in one file (Req 1.16) and these generators cannot drift out of
 * step with the real record shape.
 *
 * Every generated date is a real calendar date formatted `YYYY-MM-DD` (Req 1.2,
 * Req 1.8): the underlying `fc.date()` value is formatted from its **UTC**
 * components throughout, so no `2026-02-30` is ever produced and the same seed
 * yields the same date whatever timezone the test machine runs in.
 */

import fc from 'fast-check';

import { COMPETENCIES } from '@/lib/reportCardRubric';

/** The five competency keys, in the rubric's display order. */
export const COMPETENCY_KEYS = COMPETENCIES.map((competency) => competency.key);

/**
 * One valid Competency_Score: an integer from 1 to 5 inclusive (Req 1.2).
 *
 * Used by: every property that needs a score the validator and the database
 * `CHECK` constraints both accept — Properties 1–9.
 */
export const competencyScoreArb = fc.integer({ min: 1, max: 5 });

/**
 * A record identifier: a positive integer, as `SERIAL PRIMARY KEY` produces.
 *
 * Used by: Properties 7 and 8, where `id` is the tie-breaker in the
 * `(date, id)` ordering of `lessonSeries`.
 */
export const idArb = fc.integer({ min: 1, max: 100_000 });

/**
 * A student identifier: a positive integer, which is exactly what the
 * evaluation validator accepts (Req 1.2).
 *
 * Used by: Properties 9, 12, 13, 15.
 */
export const studentIdArb = fc.integer({ min: 1, max: 10_000 });

/**
 * Format a `Date` as `YYYY-MM-DD` from its UTC components.
 *
 * UTC rather than local getters, applied consistently, so the formatted string
 * is a real calendar date and is stable across machine timezones.
 *
 * @param {Date} date
 * @returns {string} ISO calendar date, e.g. `'2026-02-28'`
 */
export function toIsoDate(date) {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * A real calendar date in the format `YYYY-MM-DD`, drawn from 2024-01-01 to
 * 2030-12-31 — the same span as `termYearArb`, so evaluations and term rows in
 * one generated case describe a plausible student.
 *
 * `noInvalidDate: true` keeps `fc.date()` from producing an `Invalid Date`,
 * and formatting from UTC components guarantees the day-of-month is real for
 * the generated month (no `2026-02-30`), which matters because a downstream
 * test would otherwise fail for the wrong reason.
 *
 * Used by: Properties 1–9 (as the evaluation date) and Property 15 (as the
 * `from` / `to` list parameters).
 */
export const isoDateArb = fc
  .date({
    min: new Date(Date.UTC(2024, 0, 1)),
    max: new Date(Date.UTC(2030, 11, 31)),
    noInvalidDate: true,
  })
  .map(toIsoDate);

/** Free text short enough to stay inside `VARCHAR(255)` (Req 1.9). */
const shortTextArb = fc.string({ minLength: 1, maxLength: 60 });

/** An optional text field: either a text value or `null` (Req 1.9). */
const optionalTextArb = fc.option(shortTextArb, { nil: null });

/**
 * The five valid Competency_Scores as a `{ concept, building, problemSolving,
 * focus, attitude }` object, keyed from `COMPETENCIES`.
 *
 * Used by: every property that builds an evaluation — Properties 1–9.
 */
export const competencyScoresArb = fc.record(
  Object.fromEntries(COMPETENCY_KEYS.map((key) => [key, competencyScoreArb])),
);

/**
 * A fully valid Evaluation_Record as the API returns it: an `id`, a `studentId`,
 * a real ISO `YYYY-MM-DD` date, the five competency scores each an integer in
 * `[1,5]`, and the optional `lessonTopic`, `instructorNotes` and
 * `instructorName` each either text or `null` (Req 1.1, Req 1.2, Req 1.9).
 *
 * Dates are NOT distinct across a plain `fc.array(validEvaluationArb)`. Where a
 * property depends on the one-record-per-student-per-day rule of Req 1.1 — which
 * `lessonSeries` assumes — use `evaluationsForOneStudentArb` instead.
 *
 * Used by: Property 1 (averages in range and total), Property 2 (order
 * independence), Property 3 (the grand mean), Properties 5 and 6, and
 * Property 9 (the accepted side of validation).
 */
export const validEvaluationArb = fc.record({
  id: idArb,
  studentId: studentIdArb,
  date: isoDateArb,
  ...Object.fromEntries(COMPETENCY_KEYS.map((key) => [key, competencyScoreArb])),
  lessonTopic: optionalTextArb,
  instructorNotes: optionalTextArb,
  instructorName: optionalTextArb,
});

/**
 * A deliberately INVALID Competency_Score: a non-integer number, an integer at
 * or below 0, an integer above 5, a text value, or `null`.
 *
 * The exact union named in the design. Note `fc.double()` also produces `NaN`
 * and the infinities, and `fc.string()` produces `''` — all of which the
 * validator must reject by naming the competency and carrying the received
 * value, never by clamping or defaulting it (Req 1.3, Req 1.4, Req 1.5).
 *
 * A caller that needs a strictly-invalid value should keep in mind that
 * `fc.double()` can generate a whole number such as `3`, which IS valid; filter
 * with the module under test rather than assuming every draw is a rejection.
 *
 * Used by: Property 9 (the rejected side of validation).
 */
export const invalidScoreArb = fc.oneof(
  fc.double(),
  fc.integer({ min: -50, max: 0 }),
  fc.integer({ min: 6, max: 99 }),
  fc.string(),
  fc.constant(null),
);

/** A term year inside the database's `2000..2100` check (Req 2.12). */
export const termYearArb = fc.integer({ min: 2024, max: 2030 });

/** A term number: an integer from 1 to 4 inclusive (Req 2.12, Req 4.2). */
export const termNumberArb = fc.integer({ min: 1, max: 4 });

/**
 * One Term_Record as the API returns it: an `id`, a `studentId`, a `year` in
 * 2024–2030, a `termNumber` in 1–4, and a `paid` boolean. It carries a
 * `paidAt` and a `note` and — by design — no price, currency or invoice value
 * (Req 4.10).
 *
 * Rows are NOT unique on `(studentId, year, termNumber)` across a plain
 * `fc.array(termRowArb)`, which is intentional: `termSummary` must stay total
 * over whatever it is handed.
 *
 * Used by: Property 12 (four badges, at most one current) and Property 13 (the
 * current term never precedes the start term).
 */
export const termRowArb = fc.record({
  id: idArb,
  studentId: studentIdArb,
  year: termYearArb,
  termNumber: termNumberArb,
  paid: fc.boolean(),
  paidAt: fc.option(isoDateArb, { nil: null }),
  note: optionalTextArb,
});

/**
 * A list of Evaluation_Records for ONE student with DISTINCT dates and distinct
 * ids — the shape the Evaluation_Store can actually hold, because Req 1.1 allows
 * at most one record per student per calendar date and `lessonSeries` assumes it.
 *
 * The returned array is in generated order, not date order, so a property can
 * still assert that the module under test does its own sorting.
 *
 * @param {Object} [options]
 * @param {number} [options.minLength=0] fewest records; 0 exercises the
 *   no-evaluations path (`NOT YET ASSESSED`, Req 3.4)
 * @param {number} [options.maxLength=12] most records; above `LESSONS_PER_LEVEL`
 *   (10) so the windowing branch of `lessonSeries` is reached
 * @param {number} [options.studentId] fix the student id instead of generating one
 * @returns {fc.Arbitrary<Array<Object>>}
 *
 * Used by: Property 7 (lesson labels are contiguous true ordinals) and
 * Property 8 (series order is date order).
 */
export function evaluationsForOneStudentArb(options = {}) {
  const { minLength = 0, maxLength = 12, studentId } = options;

  const ownerArb = studentId === undefined ? studentIdArb : fc.constant(studentId);

  return ownerArb.chain((owner) =>
    fc
      .uniqueArray(isoDateArb, { minLength, maxLength })
      .chain((dates) =>
        fc
          .uniqueArray(idArb, { minLength: dates.length, maxLength: dates.length })
          .chain((ids) =>
            dates.length === 0
              ? fc.constant([])
              : fc.tuple(
                  ...dates.map((date, index) =>
                    fc.record({
                      id: fc.constant(ids[index]),
                      studentId: fc.constant(owner),
                      date: fc.constant(date),
                      ...Object.fromEntries(
                        COMPETENCY_KEYS.map((key) => [key, competencyScoreArb]),
                      ),
                      lessonTopic: optionalTextArb,
                      instructorNotes: optionalTextArb,
                      instructorName: optionalTextArb,
                    }),
                  ),
                ),
          ),
      ),
  );
}
