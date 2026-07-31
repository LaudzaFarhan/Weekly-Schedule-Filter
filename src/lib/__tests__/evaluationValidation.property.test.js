import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { todayIso, validateEvaluationPayload } from '@/lib/evaluationValidation';
import { COMPETENCIES } from '@/lib/reportCardRubric';
import {
  COMPETENCY_KEYS,
  competencyScoreArb,
  invalidScoreArb,
  isoDateArb,
  studentIdArb,
  validEvaluationArb,
} from './helpers/reportCardArbitraries';

/** Competency key → on-screen label, the wording an error message must use. */
const LABEL_BY_KEY = Object.fromEntries(COMPETENCIES.map(({ key, label }) => [key, label]));

/** `instructor_name` is `VARCHAR(255)` (Req 1.9). */
const INSTRUCTOR_NAME_MAX = 255;

/**
 * True when `raw` is a value the contract calls a positive integer / a score in
 * range: a whole number, or a clean run of digits as a caller may send JSON
 * strings. Used ONLY to guarantee that the "invalid" generators below really do
 * generate invalid values — `fc.double()` can draw `3` and `fc.string()` can
 * draw `'4'`, both of which are perfectly valid scores.
 */
function asWholeNumber(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

const isValidScoreValue = (raw) => {
  const whole = asWholeNumber(raw);
  return whole !== null && whole >= 1 && whole <= 5;
};

const isValidStudentIdValue = (raw) => {
  const whole = asWholeNumber(raw);
  return whole !== null && whole > 0;
};

// --- studentId ---------------------------------------------------------------

/**
 * Values that are not a positive integer: zero and negatives, fractions, the
 * numeric specials, numeric-looking text that is not a clean integer, and the
 * coercion traps (`''`, `null`, `true`, `[7]`) that `Number()` would happily
 * turn into a number.
 */
const invalidStudentIdArb = fc
  .oneof(
    { weight: 3, arbitrary: fc.integer({ min: -10_000, max: 0 }) },
    { weight: 3, arbitrary: fc.double({ min: -1_000, max: 1_000, noNaN: true }) },
    { weight: 2, arbitrary: fc.constantFrom(NaN, Infinity, -Infinity, 1.5, -0.5) },
    { weight: 3, arbitrary: fc.constantFrom('', '   ', 'abc', '4.5', '1e3', '12px', '-7') },
    { weight: 3, arbitrary: fc.constantFrom(null, undefined, true, false, [], [7], {}, { id: 7 }) },
  )
  .filter((raw) => !isValidStudentIdValue(raw));

// --- date --------------------------------------------------------------------

const pad2 = (value) => String(value).padStart(2, '0');
const isLeapYear = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

/** Right shape `YYYY-MM-DD`, not a real calendar date (Req 1.8). */
const unrealIsoDateArb = fc.oneof(
  // 31st of a 30-day month, and the 30th/31st of February.
  fc
    .tuple(fc.integer({ min: 2000, max: 2099 }), fc.constantFrom(2, 4, 6, 9, 11))
    .map(([year, month]) => `${year}-${pad2(month)}-31`),
  fc.integer({ min: 2000, max: 2099 }).map((year) => `${year}-02-30`),
  // 29 February of a common year.
  fc
    .integer({ min: 2001, max: 2099 })
    .filter((year) => !isLeapYear(year))
    .map((year) => `${year}-02-29`),
  // Month or day outside its bounds.
  fc.integer({ min: 2000, max: 2099 }).map((year) => `${year}-13-01`),
  fc.integer({ min: 2000, max: 2099 }).map((year) => `${year}-00-10`),
  fc.integer({ min: 2000, max: 2099 }).map((year) => `${year}-01-00`),
  fc.integer({ min: 2000, max: 2099 }).map((year) => `${year}-01-32`),
);

/** Wrong shape entirely, or not text at all — still a named `date` rejection. */
const malformedDateArb = fc.oneof(
  fc.constantFrom(
    '2026-1-1',
    '01-01-2026',
    '2026/01/01',
    '20260101',
    '2026-01-01T00:00:00Z',
    'today',
    '-2026-01-01',
  ),
  fc.constantFrom(20260101, 0, -1, true, false, [], ['2026-01-01'], {}, 1.5, NaN),
);

/**
 * Not text at all, but coerces to something ISO-shaped — the array and
 * `toString` traps that the score path closes deliberately (`[4]` is not a 4).
 * The value that ARRIVES is not a `YYYY-MM-DD` date, so Req 1.8 asks for a
 * rejection naming the date field.
 */
const coercibleDateArb = fc.oneof(
  isoDateArb.map((date) => [date]),
  isoDateArb.map((date) => [[date]]),
);

/** The three ways a date can fail Req 1.8, in equal measure. */
const invalidDateArb = fc.oneof(
  { weight: 4, arbitrary: unrealIsoDateArb },
  { weight: 4, arbitrary: malformedDateArb },
  { weight: 6, arbitrary: coercibleDateArb },
);

/** Absent or blank: the validator substitutes the server's date (Req 1.7). */
const blankDateArb = fc.constantFrom(undefined, null, '', '   ', '\t\n ');

// --- scores ------------------------------------------------------------------

/**
 * The design's invalid-score union, narrowed to draws that really are invalid
 * (`fc.double()` can produce `3`, `fc.string()` can produce `'4'`).
 */
const rejectedScoreArb = fc.oneof(
  { weight: 6, arbitrary: invalidScoreArb.filter((raw) => !isValidScoreValue(raw)) },
  // Absent / blank, which must be reported as "required" rather than defaulted.
  { weight: 3, arbitrary: fc.constantFrom(undefined, null, '', '   ') },
  { weight: 2, arbitrary: fc.constantFrom(true, false, [], [3], {}, NaN, Infinity, 0, 6, 5.5) },
);

// --- optional text -----------------------------------------------------------

const validOptionalTextArb = fc.oneof(
  fc.string({ maxLength: 60 }),
  fc.constantFrom(null, undefined, '   '),
);

/** Over the `VARCHAR(255)` limit even after trimming (Req 1.9). */
const oversizeInstructorNameArb = fc
  .integer({ min: INSTRUCTOR_NAME_MAX + 1, max: 400 })
  .map((length) => 'x'.repeat(length));

// --- one generated case ------------------------------------------------------

/**
 * Wrap a field arbitrary as `{ raw, valid }` so the expectation is known by
 * construction rather than recomputed from the module under test.
 */
const fieldCase = (arbitrary, valid) => arbitrary.map((raw) => ({ raw, valid }));

const studentIdCaseArb = fc.oneof(
  { weight: 5, arbitrary: fieldCase(studentIdArb, true) },
  { weight: 2, arbitrary: fieldCase(invalidStudentIdArb, false) },
);

const dateCaseArb = fc.oneof(
  { weight: 4, arbitrary: fieldCase(isoDateArb, true) },
  { weight: 2, arbitrary: fieldCase(blankDateArb, true) },
  { weight: 3, arbitrary: fieldCase(invalidDateArb, false) },
);

const scoreCaseArb = fc.oneof(
  { weight: 8, arbitrary: fieldCase(competencyScoreArb, true) },
  { weight: 2, arbitrary: fieldCase(rejectedScoreArb, false) },
);

const instructorNameCaseArb = fc.oneof(
  { weight: 6, arbitrary: fieldCase(validOptionalTextArb, true) },
  { weight: 1, arbitrary: fieldCase(oversizeInstructorNameArb, false) },
);

/**
 * A payload assembled field by field, together with the fields that are
 * expected to be rejected. Weighted so a large share of draws is either fully
 * valid or has exactly one fault, which is where the message can be asserted
 * precisely.
 */
const assembledCaseArb = fc
  .record({
    studentId: studentIdCaseArb,
    date: dateCaseArb,
    scores: fc.record(Object.fromEntries(COMPETENCY_KEYS.map((key) => [key, scoreCaseArb]))),
    lessonTopic: validOptionalTextArb,
    instructorNotes: validOptionalTextArb,
    instructorName: instructorNameCaseArb,
  })
  .map(({ studentId, date, scores, lessonTopic, instructorNotes, instructorName }) => {
    const offenders = [];
    if (!studentId.valid) offenders.push('studentId');
    if (!date.valid) offenders.push('date');
    for (const key of COMPETENCY_KEYS) {
      if (!scores[key].valid) offenders.push(LABEL_BY_KEY[key]);
    }
    if (!instructorName.valid) offenders.push('instructorName');

    return {
      body: {
        studentId: studentId.raw,
        date: date.raw,
        ...Object.fromEntries(COMPETENCY_KEYS.map((key) => [key, scores[key].raw])),
        lessonTopic,
        instructorNotes,
        instructorName: instructorName.raw,
      },
      offenders,
      dateOmitted: date.valid && isBlankValue(date.raw),
    };
  });

/** A fully valid record exactly as the API returns it — extra `id` key and all. */
const acceptedRecordCaseArb = validEvaluationArb.map((record) => ({
  body: record,
  offenders: [],
  dateOmitted: false,
}));

const payloadCaseArb = fc.oneof(
  { weight: 8, arbitrary: assembledCaseArb },
  { weight: 2, arbitrary: acceptedRecordCaseArb },
);

/**
 * How the received value is expected to appear in a message, or `null` where
 * the value has no useful printed form to assert on.
 */
function receivedFragment(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw === 'string') return JSON.stringify(raw);
  return null;
}

const isBlankValue = (raw) =>
  raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');

describe('evaluationValidation properties', () => {
  // Feature: student-report-cards, Property 9: Validation accepts exactly the valid payloads
  it('returns a value exactly for valid payloads, and otherwise one message naming the offending field', () => {
    fc.assert(
      fc.property(payloadCaseArb, ({ body, offenders, dateOmitted }) => {
        const before = JSON.stringify(body);
        const dayAtStart = todayIso();
        const result = validateEvaluationPayload(body);
        const dayAtEnd = todayIso();

        // Exactly one of `value` / `error`, never both and never neither (Req 1.2).
        const hasValue = Object.prototype.hasOwnProperty.call(result, 'value');
        const hasError = Object.prototype.hasOwnProperty.call(result, 'error');
        expect(hasValue).toBe(!hasError);

        // The payload is untouched — validation reads, it never rewrites (Req 1.5).
        expect(JSON.stringify(body)).toBe(before);

        // A value is returned if and only if nothing is offending (Req 1.2).
        expect(hasValue).toBe(offenders.length === 0);

        if (hasValue) {
          const { value } = result;

          // studentId is the positive integer that arrived (Req 1.2).
          expect(Number.isInteger(value.studentId)).toBe(true);
          expect(value.studentId).toBeGreaterThan(0);
          expect(value.studentId).toBe(Number(String(body.studentId).trim()));

          // Every score is returned exactly as received: no clamping into range
          // and no default substituted anywhere (Req 1.4, 1.5).
          for (const key of COMPETENCY_KEYS) {
            expect(value[key]).toBe(Number(String(body[key]).trim()));
            expect(Number.isInteger(value[key])).toBe(true);
            expect(value[key]).toBeGreaterThanOrEqual(1);
            expect(value[key]).toBeLessThanOrEqual(5);
          }

          // The date is a real ISO date: the one supplied, or the server's own
          // day when the payload omitted it (Req 1.7, 1.8).
          expect(value.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          if (dateOmitted) {
            // A run that straddles midnight may legitimately see either day.
            expect([dayAtStart, dayAtEnd]).toContain(value.date);
          } else {
            expect(value.date).toBe(String(body.date).trim());
          }

          // Optional text: a string or `null`, with instructorName trimmed and
          // inside the 255-character column (Req 1.9).
          for (const key of ['lessonTopic', 'instructorNotes', 'instructorName']) {
            expect(value[key] === null || typeof value[key] === 'string').toBe(true);
          }
          const expectedName =
            body.instructorName === null || body.instructorName === undefined
              ? null
              : String(body.instructorName).trim() || null;
          expect(value.instructorName).toBe(expectedName);
          expect((value.instructorName ?? '').length).toBeLessThanOrEqual(INSTRUCTOR_NAME_MAX);
        } else {
          // One non-empty sentence, naming a field that is actually offending
          // (Req 1.2, 1.3, 1.4, 1.8, 1.9).
          expect(typeof result.error).toBe('string');
          expect(result.error.trim().length).toBeGreaterThan(0);
          expect(offenders.some((field) => result.error.includes(field))).toBe(true);

          // With a single fault the message must be about that one field, and a
          // rejected score must carry the value that arrived unless it is simply
          // missing (Req 1.3, 1.4, 1.8).
          if (offenders.length === 1) {
            const [field] = offenders;
            expect(result.error).toContain(field);

            const key = COMPETENCY_KEYS.find((candidate) => LABEL_BY_KEY[candidate] === field);
            if (key !== undefined) {
              const raw = body[key];
              if (isBlankValue(raw)) {
                expect(result.error).toContain('required');
              } else {
                const fragment = receivedFragment(raw);
                if (fragment !== null) expect(result.error).toContain(fragment);
              }
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
