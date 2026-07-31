import { describe, expect, it } from 'vitest';

import { COMPETENCIES, RUBRIC_LEVELS, descriptorFor } from '../reportCardRubric';

const RATINGS = [1, 2, 3, 4, 5];

/**
 * The rating 5 and rating 1 wording as supplied by the source brief, character
 * for character (Req 1.15). These literals are the brief, not a copy of the
 * module: if `reportCardRubric.js` is reworded, this test is what catches it, so
 * a failure here means either the module drifted or the brief changed — and the
 * brief change has to be made here deliberately.
 *
 * Ratings 4, 3 and 2 are provisional pending the rubric owner's sign-off and so
 * are deliberately NOT pinned to literals here; they are only checked for being
 * present, non-empty and distinct.
 */
const BRIEF_WORDING = {
  concept:        { 5: 'Excellent independent understanding', 1: 'Beginning with support' },
  building:       { 5: 'Builds independently',               1: 'Early stage' },
  problemSolving: { 5: 'Solves independently',               1: 'Needs significant support' },
  focus:          { 5: 'Follows perfectly',                  1: 'Needs extra guidance' },
  attitude:       { 5: 'Very positive & enthusiastic',        1: 'Needs guidance' },
};

describe('RUBRIC_LEVELS completeness', () => {
  it('covers exactly the five declared competencies', () => {
    expect(COMPETENCIES).toHaveLength(5);
    expect(Object.keys(RUBRIC_LEVELS)).toEqual(COMPETENCIES.map((competency) => competency.key));
  });

  it('holds all 25 cells, each present and non-empty', () => {
    const cells = [];

    for (const { key } of COMPETENCIES) {
      const levels = RUBRIC_LEVELS[key];
      expect(Object.keys(levels).map(Number).sort()).toEqual(RATINGS);

      for (const rating of RATINGS) {
        const descriptor = levels[rating];
        expect(typeof descriptor, `${key}/${rating} is missing`).toBe('string');
        expect(descriptor.trim(), `${key}/${rating} is empty`).not.toBe('');
        cells.push(descriptor);
      }
    }

    expect(cells).toHaveLength(25);
  });

  it('keeps the five descriptors within a competency distinct from each other', () => {
    for (const { key, label } of COMPETENCIES) {
      const levels = RATINGS.map((rating) => RUBRIC_LEVELS[key][rating]);
      expect(new Set(levels).size, `${label} repeats a descriptor`).toBe(5);
    }
  });
});

describe('rubric wording from the brief', () => {
  it('holds the rating 5 and rating 1 wording character for character', () => {
    for (const { key } of COMPETENCIES) {
      expect(RUBRIC_LEVELS[key][5]).toBe(BRIEF_WORDING[key][5]);
      expect(RUBRIC_LEVELS[key][1]).toBe(BRIEF_WORDING[key][1]);
    }
  });

  it('serves that same wording through descriptorFor, the one lookup the views call', () => {
    expect(descriptorFor('concept', 5)).toBe('Excellent independent understanding');
    expect(descriptorFor('concept', 1)).toBe('Beginning with support');
    expect(descriptorFor('problemSolving', 5)).toBe('Solves independently');
    expect(descriptorFor('attitude', 1)).toBe('Needs guidance');

    for (const { key } of COMPETENCIES) {
      expect(descriptorFor(key, 5)).toBe(BRIEF_WORDING[key][5]);
      expect(descriptorFor(key, 1)).toBe(BRIEF_WORDING[key][1]);
    }
  });

  it('holds provisional wording for ratings 2, 3 and 4 as non-empty text', () => {
    for (const { key } of COMPETENCIES) {
      for (const rating of [2, 3, 4]) {
        expect(RUBRIC_LEVELS[key][rating].trim()).not.toBe('');
      }
    }
  });
});
