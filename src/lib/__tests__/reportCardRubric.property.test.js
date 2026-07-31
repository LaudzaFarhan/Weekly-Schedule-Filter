import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { COMPETENCIES, RUBRIC_LEVELS, descriptorFor } from '@/lib/reportCardRubric';
import { COMPETENCY_KEYS, competencyScoreArb } from './helpers/reportCardArbitraries';

const RATINGS = [1, 2, 3, 4, 5];

/**
 * Keys `descriptorFor` must treat as unknown: near-misses of the real keys
 * (wrong case, the snake_case column name, the label), blank strings, arbitrary
 * text, prototype-chain names that a naive `in`/bracket lookup would resolve,
 * and non-string values entirely.
 *
 * `fc.string()` could in principle draw one of the five real keys; the oracle
 * below is computed from the drawn value rather than from which arbitrary
 * produced it, so such a draw still asserts the correct expectation.
 */
const unknownKeyArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('Concept', 'CONCEPT', 'problem_solving', 'Problem Solving', 'problemsolving', 'concepts', ' concept') },
  { weight: 2, arbitrary: fc.constantFrom('', ' ', '   \t\n ') },
  { weight: 3, arbitrary: fc.string() },
  { weight: 2, arbitrary: fc.constantFrom('toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf') },
  { weight: 3, arbitrary: fc.constantFrom(null, undefined, 0, 1, NaN, true, false, Symbol.iterator) },
  { weight: 2, arbitrary: fc.constantFrom({ key: 'concept' }, ['concept'], new String('concept'), () => 'concept') },
);

/** Any key at all: the five real ones, plus the garbage above. */
const anyKeyArb = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...COMPETENCY_KEYS) },
  { weight: 5, arbitrary: unknownKeyArb },
);

/**
 * Ratings outside the accepted domain: non-integer numbers, the numeric
 * specials, out-of-range integers on both sides of `[1,5]`, numeric strings
 * (`'3'` looks up fine with a bracket access, so it must be rejected by type),
 * and non-number values.
 */
const invalidRatingArb = fc.oneof(
  { weight: 3, arbitrary: fc.double({ min: -10, max: 10, noInteger: true, noNaN: true }) },
  { weight: 2, arbitrary: fc.constantFrom(NaN, Infinity, -Infinity, 0.5, 4.999, 5.000001, -0.0000001) },
  { weight: 3, arbitrary: fc.oneof(fc.integer({ min: -1000, max: 0 }), fc.integer({ min: 6, max: 1000 })) },
  { weight: 2, arbitrary: fc.constantFrom('1', '3', '5', '', ' 3 ', 'five') },
  { weight: 3, arbitrary: fc.constantFrom(null, undefined, true, false, {}, [3], [], new Number(3), 3n) },
);

/** Any rating at all: an integer in `[1,5]`, plus the garbage above. */
const anyRatingArb = fc.oneof(
  { weight: 5, arbitrary: competencyScoreArb },
  { weight: 5, arbitrary: invalidRatingArb },
);

/**
 * The oracle for "this pair has a descriptor": the key is one of the five
 * defined keys and the rating is an integer from 1 to 5 inclusive (Req 1.14).
 * Deliberately written from the requirement, not from the module's own guards.
 */
function shouldHaveDescriptor(key, rating) {
  return (
    typeof key === 'string' &&
    COMPETENCY_KEYS.includes(key) &&
    typeof rating === 'number' &&
    Number.isInteger(rating) &&
    rating >= 1 &&
    rating <= 5
  );
}

describe('reportCardRubric properties', () => {
  // Feature: student-report-cards, Property 14: The rubric is complete and lookup is total
  it('answers every call with a string, non-empty exactly for a known key and an integer rating in [1,5]', () => {
    fc.assert(
      fc.property(anyKeyArb, anyRatingArb, (key, rating) => {
        // Total: a string for any input at all, never `undefined`, never a throw
        // — the lookup is called from render, so a bad value must degrade to an
        // empty descriptor line (Req 1.14).
        const descriptor = descriptorFor(key, rating);
        expect(typeof descriptor).toBe('string');

        if (!shouldHaveDescriptor(key, rating)) {
          expect(descriptor).toBe('');
          return;
        }

        // Non-empty exactly on the accepted domain, and it is the descriptor
        // for that competency at that score — the wording the form shows
        // beneath the rating control (Req 1.14, Req 1.17).
        expect(descriptor).not.toBe('');
        expect(descriptor.trim()).not.toBe('');

        // Read from `RUBRIC_LEVELS` and nowhere else, so the form's descriptor
        // line, the rubric panel and the guidelines view cannot drift apart
        // (Req 1.16).
        expect(descriptor).toBe(RUBRIC_LEVELS[key][rating]);

        // Complete for this competency: all five ratings present, non-empty,
        // and distinct from one another (Req 1.14).
        const levels = RATINGS.map((level) => RUBRIC_LEVELS[key][level]);
        expect(levels.every((text) => typeof text === 'string' && text.trim() !== '')).toBe(true);
        expect(new Set(levels).size).toBe(RATINGS.length);
        expect(Object.keys(RUBRIC_LEVELS[key]).map(Number).sort()).toEqual(RATINGS);

        // And the rubric covers exactly the five declared competencies, so
        // every competency the form renders has a descriptor to show
        // (Req 1.14, Req 1.17).
        expect(Object.keys(RUBRIC_LEVELS).sort()).toEqual([...COMPETENCY_KEYS].sort());
        expect(COMPETENCY_KEYS).toHaveLength(COMPETENCIES.length);
      }),
      { numRuns: 100 },
    );
  });
});
