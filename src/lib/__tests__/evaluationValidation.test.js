import { describe, expect, it } from 'vitest';

import { isRealDate, todayIso, validateEvaluationPayload } from '@/lib/evaluationValidation';
import { COMPETENCIES } from '@/lib/reportCardRubric';

/**
 * One case per `400` row of the design's Error Handling table, each asserting
 * that the returned message names the offending field.
 *
 * The table's remaining `400` row — "Invalid term number" — belongs to the Term
 * API validator, not to `validateEvaluationPayload`, so it is covered where that
 * validator lives rather than here.
 *
 * A rejection always returns `{ error }` and NO `value`: nothing is clamped into
 * range and nothing is defaulted (Req 1.4, Req 1.5).
 */

/** A payload that the validator accepts, as the baseline for each fault. */
function validPayload(overrides = {}) {
  return {
    studentId: 42,
    date: '2026-03-04',
    // Required: `(student_id, lesson_number)` identifies the report.
    lessonNumber: 3,
    concept: 5,
    building: 4,
    problemSolving: 3,
    focus: 2,
    attitude: 1,
    lessonTopic: 'Gear ratios',
    instructorNotes: 'Built the buggy unaided.',
    instructorName: 'Helen',
    ...overrides,
  };
}

/** Assert a rejection: a non-empty message naming `field`, and no value. */
function expectRejection(result, field) {
  expect(result.value).toBeUndefined();
  expect(typeof result.error).toBe('string');
  expect(result.error.trim().length).toBeGreaterThan(0);
  expect(result.error).toContain(field);
  return result.error;
}

describe('validateEvaluationPayload', () => {
  it('accepts the baseline payload, returning a value and no error', () => {
    const result = validateEvaluationPayload(validPayload());

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      studentId: 42,
      date: '2026-03-04',
      lessonNumber: 3,
      concept: 5,
      building: 4,
      problemSolving: 3,
      focus: 2,
      attitude: 1,
      lessonTopic: 'Gear ratios',
      instructorNotes: 'Built the buggy unaided.',
      instructorName: 'Helen',
    });
  });

  // Error table row: "Missing student" (Req 1.2)
  describe('missing or non-positive studentId', () => {
    it.each([
      ['absent', undefined],
      ['null', null],
      ['zero', 0],
      ['negative', -7],
      ['not an integer', 4.5],
      ['blank text', '   '],
      ['non-numeric text', 'abc'],
      ['a boolean', true],
      ['an array', [7]],
    ])('rejects a studentId that is %s, naming studentId', (_label, studentId) => {
      const error = expectRejection(
        validateEvaluationPayload(validPayload({ studentId })),
        'studentId',
      );
      expect(error).toContain('positive integer');
    });

    it('carries the received value in the message', () => {
      const error = expectRejection(validateEvaluationPayload(validPayload({ studentId: -7 })), 'studentId');
      expect(error).toContain('-7');
    });
  });

  // Error table row: "Missing competency" (Req 1.3)
  describe('missing competency score', () => {
    it.each(COMPETENCIES.map(({ key, label }) => [key, label]))(
      'rejects an absent %s, naming "%s" and the 1 to 5 rule',
      (key, label) => {
        const payload = validPayload();
        delete payload[key];

        const error = expectRejection(validateEvaluationPayload(payload), label);
        expect(error).toContain('required');
        expect(error).toContain('1 to 5');
      },
    );

    it.each([
      ['null', null],
      ['an empty string', ''],
      ['whitespace only', '   '],
    ])('rejects a %s score, naming the competency', (_label, raw) => {
      const error = expectRejection(validateEvaluationPayload(validPayload({ focus: raw })), 'Focus');
      expect(error).toContain('required');
    });
  });

  // Error table row: "Out-of-range score" (Req 1.4, Req 1.5)
  describe('out-of-range or non-integer competency score', () => {
    it.each([
      ['above the range', 7],
      ['below the range', 0],
      ['negative', -3],
      ['a fraction', 3.5],
      ['non-numeric text', 'five'],
      ['a decimal string', '4.5'],
      ['a boolean', true],
      ['an array holding a valid score', [4]],
    ])('rejects a %s score, naming the competency and the received value', (_label, raw) => {
      const error = expectRejection(
        validateEvaluationPayload(validPayload({ problemSolving: raw })),
        'Problem Solving',
      );
      expect(error).toContain('1 to 5');
    });

    it('names the received value rather than clamping it', () => {
      const error = expectRejection(validateEvaluationPayload(validPayload({ concept: 7 })), 'Concept');
      expect(error).toContain('7');
    });

    it.each([[7], [0], [-3], [3.5], ['4.5'], [[4]], [true], [null], ['']])(
      'never clamps or defaults the score %p',
      (raw) => {
        const result = validateEvaluationPayload(validPayload({ attitude: raw }));

        expect(result.value).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(result, 'value')).toBe(false);
        // No 5, no 1 and no 3 substituted anywhere: the save is refused outright.
        expect(Object.keys(result)).toEqual(['error']);
      },
    );

    it('accepts an integer sent as a JSON string, unchanged', () => {
      const result = validateEvaluationPayload(validPayload({ focus: '4' }));

      expect(result.error).toBeUndefined();
      expect(result.value.focus).toBe(4);
    });

    it('rejects each competency independently, naming the one at fault', () => {
      for (const { key, label } of COMPETENCIES) {
        const error = expectRejection(validateEvaluationPayload(validPayload({ [key]: 9 })), label);
        expect(error).toContain('9');
      }
    });
  });

  // The lesson identifies the report, so it is required and bounded.
  describe('lesson number', () => {
    it.each([
      ['absent', undefined],
      ['null', null],
      ['blank', '   '],
    ])('rejects a lessonNumber that is %s, naming the field', (_label, lessonNumber) => {
      const error = expectRejection(
        validateEvaluationPayload(validPayload({ lessonNumber })),
        'lessonNumber',
      );
      // Defaulting to lesson 1 here would upsert onto a real report.
      expect(error).toContain('required');
    });

    it.each([[0], [11], [-2], [2.5], ['two'], [[3]], [true], [{}]])(
      'rejects an out-of-range or non-integer lessonNumber %p without clamping it',
      (lessonNumber) => {
        const result = validateEvaluationPayload(validPayload({ lessonNumber }));

        expect(Object.keys(result)).toEqual(['error']);
        expect(result.error).toContain('lessonNumber');
        expect(result.error).toContain('1 to 10');
      },
    );

    it('accepts each lesson of the level, and an integer sent as a string', () => {
      for (const lessonNumber of [1, 5, 10]) {
        expect(validateEvaluationPayload(validPayload({ lessonNumber })).value.lessonNumber)
          .toBe(lessonNumber);
      }
      expect(validateEvaluationPayload(validPayload({ lessonNumber: '7' })).value.lessonNumber)
        .toBe(7);
    });
  });

  // Error table row: "Bad date" (Req 1.8)
  describe('bad date', () => {
    it.each([
      ['a real-looking but impossible date', '2026-02-30'],
      ['29 February of a common year', '2025-02-29'],
      ['31st of a 30-day month', '2026-04-31'],
      ['month 13', '2026-13-01'],
      ['day 00', '2026-01-00'],
      ['unpadded parts', '2026-1-1'],
      ['day-first order', '04-03-2026'],
      ['slashes', '2026/03/04'],
      ['a timestamp', '2026-03-04T00:00:00Z'],
      ['free text', 'today'],
      ['a number', 20260304],
      ['a boolean', true],
    ])('rejects %s, naming the date field', (_label, date) => {
      const error = expectRejection(validateEvaluationPayload(validPayload({ date })), 'date');
      expect(error).toContain('YYYY-MM-DD');
    });

    it('carries the received value in the message', () => {
      const error = expectRejection(validateEvaluationPayload(validPayload({ date: '2026-02-30' })), 'date');
      expect(error).toContain('2026-02-30');
    });

    it('substitutes the server date when the date is absent or blank (Req 1.7)', () => {
      for (const date of [undefined, null, '', '   ']) {
        const result = validateEvaluationPayload(validPayload({ date }));

        expect(result.error).toBeUndefined();
        expect(result.value.date).toBe(todayIso());
      }
    });

    it('treats a shaped-but-unreal date as unreal', () => {
      expect(isRealDate('2026-02-30')).toBe(false);
      expect(isRealDate('2026-02-28')).toBe(true);
    });
  });

  // Error table: the optional-text bound (Req 1.9)
  describe('instructor name length', () => {
    it('rejects an instructorName longer than 255 characters, naming the field', () => {
      const error = expectRejection(
        validateEvaluationPayload(validPayload({ instructorName: 'x'.repeat(256) })),
        'instructorName',
      );
      expect(error).toContain('255');
    });

    it('accepts 255 characters, and measures the length after trimming', () => {
      const exact = validateEvaluationPayload(validPayload({ instructorName: 'x'.repeat(255) }));
      expect(exact.error).toBeUndefined();
      expect(exact.value.instructorName).toBe('x'.repeat(255));

      const padded = validateEvaluationPayload(validPayload({ instructorName: `  ${'x'.repeat(255)}  ` }));
      expect(padded.error).toBeUndefined();
      expect(padded.value.instructorName).toBe('x'.repeat(255));
    });

    it('treats absent, blank and whitespace-only optional text as no value', () => {
      const result = validateEvaluationPayload(
        validPayload({ instructorName: '   ', lessonTopic: undefined, instructorNotes: null }),
      );

      expect(result.error).toBeUndefined();
      expect(result.value.instructorName).toBeNull();
      expect(result.value.lessonTopic).toBeNull();
      expect(result.value.instructorNotes).toBeNull();
    });
  });

  describe('non-object body', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an array', [validPayload()]],
      ['a string', '{"studentId":1}'],
      ['a number', 7],
    ])('rejects %s with a message, rather than throwing', (_label, body) => {
      const error = expectRejection(validateEvaluationPayload(body), 'JSON object');
      expect(error).toBe('Request body must be a JSON object');
    });
  });

  it('does not mutate the payload it is given', () => {
    const payload = validPayload({ instructorName: '  Helen  ', date: '   ' });
    const snapshot = structuredClone(payload);

    validateEvaluationPayload(payload);

    expect(payload).toEqual(snapshot);
  });
});
