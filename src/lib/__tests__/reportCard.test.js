/**
 * Worked-example unit tests for `src/lib/reportCard.js`.
 *
 * The property tests in `reportCard.property.test.js` pin the universal rules.
 * This file pins the specific numbers the feature was specified with, so a
 * refactor that keeps the properties true but moves the arithmetic still fails:
 *
 *   - the screenshot's `EXCELLENT (4.8/5)` — five scores of 5/5/4/5/5 (Req 3.2);
 *   - every grade-band boundary at 4.5 / 3.5 / 2.5 / 1.5, asserted at the
 *     boundary and one tenth below it, plus the pair 4.46 / 4.44 that only bands
 *     correctly because the score is rounded to one decimal BEFORE the band is
 *     selected (Req 3.3);
 *   - `n = 0` reading `NOT YET ASSESSED` with a `null` score and no number
 *     anywhere (Req 3.4);
 *   - `n = 1`, `n = 10` (exactly the `LESSONS_PER_LEVEL` window) and `n = 11`
 *     (the window slides and the labels stay true ordinals, `L2`…`L11`)
 *     (Req 3.5).
 *
 * _Requirements: 3.2, 3.3, 3.4, 3.5_
 */
import { describe, it, expect } from 'vitest';

import {
  competencyAverages,
  overallGrade,
  lessonSeries,
  GRADE_BANDS,
  NOT_ASSESSED,
} from '../reportCard';
import { LESSONS_PER_LEVEL } from '../programRules';

/** The five competency keys, in the order the module declares them. */
const KEYS = ['concept', 'building', 'problemSolving', 'focus', 'attitude'];

/** An evaluation row with the five scores supplied positionally. */
const evaluation = (id, date, [concept, building, problemSolving, focus, attitude]) => ({
  id,
  date,
  concept,
  building,
  problemSolving,
  focus,
  attitude,
});

/** Five identical competency averages — the shape `overallGrade` consumes. */
const flatAverages = (value) => Object.fromEntries(KEYS.map((k) => [k, value]));

/** `n` evaluations, one per consecutive day, all scores equal to `score`. */
const series = (n, score = 3) =>
  Array.from({ length: n }, (_, i) =>
    evaluation(i + 1, `2026-03-${String(i + 1).padStart(2, '0')}`, [
      score,
      score,
      score,
      score,
      score,
    ])
  );

describe('the screenshot worked example: EXCELLENT (4.8/5)', () => {
  // concept 5, building 5, problemSolving 4, focus 5, attitude 5 -> 24/5 = 4.8
  const screenshot = [
    evaluation(1, '2026-03-04', [5, 5, 4, 5, 5]),
  ];

  it('averages each competency to that single day\'s score', () => {
    // Req 3.1 — with one evaluation the average IS that evaluation (D6).
    expect(competencyAverages(screenshot)).toEqual({
      concept: 5,
      building: 5,
      problemSolving: 4,
      focus: 5,
      attitude: 5,
    });
  });

  it('scores 4.8 and bands it EXCELLENT at rank 5', () => {
    // Req 3.2, Req 3.3
    expect(overallGrade(competencyAverages(screenshot))).toEqual({
      score: 4.8,
      label: 'EXCELLENT',
      rank: 5,
    });
  });

  it('prints the same 4.8 when the same scores arrive as several evaluations', () => {
    // Req 3.2 — the overall score is the grand mean over every score in range,
    // so splitting the same numbers across days cannot move it.
    const spread = [
      evaluation(1, '2026-03-04', [5, 5, 5, 5, 5]),
      evaluation(2, '2026-03-11', [5, 5, 3, 4, 5]),
    ];
    // Day one sums to 25, day two to 22: 47 over ten scores is 4.7.
    expect(overallGrade(competencyAverages(spread)).score).toBe(4.7);

    const identical = [
      evaluation(1, '2026-03-04', [5, 5, 4, 5, 5]),
      evaluation(2, '2026-03-11', [5, 5, 4, 5, 5]),
    ];
    expect(overallGrade(competencyAverages(identical))).toEqual({
      score: 4.8,
      label: 'EXCELLENT',
      rank: 5,
    });
  });
});

describe('grade band boundaries', () => {
  // Each row: the boundary score, the band it opens, and the band one tenth
  // below it. Banding is applied to the score AFTER it is rounded to one
  // decimal (Req 3.3), so these are the values a parent actually reads.
  const boundaries = [
    { at: 4.5, band: 'EXCELLENT', rank: 5, below: 4.4, belowBand: 'VERY GOOD', belowRank: 4 },
    { at: 3.5, band: 'VERY GOOD', rank: 4, below: 3.4, belowBand: 'GOOD', belowRank: 3 },
    { at: 2.5, band: 'GOOD', rank: 3, below: 2.4, belowBand: 'DEVELOPING', belowRank: 2 },
    { at: 1.5, band: 'DEVELOPING', rank: 2, below: 1.4, belowBand: 'BEGINNING', belowRank: 1 },
  ];

  for (const { at, band, rank, below, belowBand, belowRank } of boundaries) {
    it(`bands ${at} as ${band} and ${below} as ${belowBand}`, () => {
      expect(overallGrade(flatAverages(at))).toEqual({ score: at, label: band, rank });
      expect(overallGrade(flatAverages(below))).toEqual({
        score: below,
        label: belowBand,
        rank: belowRank,
      });
    });
  }

  it('reaches the 4.5 boundary from real integer scores', () => {
    // Ten scores summing to 45: one all-5s day and one all-4s day.
    const evaluations = [
      evaluation(1, '2026-03-04', [5, 5, 5, 5, 5]),
      evaluation(2, '2026-03-11', [4, 4, 4, 4, 4]),
    ];
    expect(overallGrade(competencyAverages(evaluations))).toEqual({
      score: 4.5,
      label: 'EXCELLENT',
      rank: 5,
    });
  });

  it('bands the rounded score, not the raw mean', () => {
    // 4.46 displays as 4.5, so it must read EXCELLENT — banding the raw mean
    // would print "4.5" beneath a VERY GOOD label (Req 3.3).
    expect(overallGrade(flatAverages(4.46))).toEqual({
      score: 4.5,
      label: 'EXCELLENT',
      rank: 5,
    });
    // 4.44 displays as 4.4, so it stays VERY GOOD.
    expect(overallGrade(flatAverages(4.44))).toEqual({
      score: 4.4,
      label: 'VERY GOOD',
      rank: 4,
    });
  });

  it('bands the floor of the scale as BEGINNING', () => {
    expect(overallGrade(flatAverages(1))).toEqual({ score: 1, label: 'BEGINNING', rank: 1 });
    expect(overallGrade(flatAverages(5))).toEqual({ score: 5, label: 'EXCELLENT', rank: 5 });
  });

  it('recomputes the same band from the displayed score', () => {
    // Req 3.3 — the band read off the printed number equals the printed band.
    for (const score of [1, 1.4, 1.5, 2.4, 2.5, 3.4, 3.5, 4.4, 4.5, 4.8, 5]) {
      const grade = overallGrade(flatAverages(score));
      const reBanded = GRADE_BANDS.find((b) => grade.score >= b.min);
      expect(grade.label).toBe(reBanded.label);
      expect(grade.rank).toBe(reBanded.rank);
    }
  });
});

describe('n = 0 evaluations', () => {
  it('has no competency averages', () => {
    // Req 3.4 — null, never a row of zeroes.
    expect(competencyAverages([])).toBeNull();
  });

  it('reads NOT YET ASSESSED with a null score and rank 0', () => {
    const grade = overallGrade(competencyAverages([]));
    expect(grade).toEqual(NOT_ASSESSED);
    expect(grade.score).toBeNull();
    expect(grade.label).toBe('NOT YET ASSESSED');
    expect(grade.rank).toBe(0);
  });

  it('exposes no number a renderer could print as a score', () => {
    // Req 3.4 — nothing downstream may print a figure or a `/5` for an
    // unassessed student, so the derivation must not hand one over. `rank` is
    // the only number present and it is the band ordinal, not a score.
    const grade = overallGrade(competencyAverages([]));
    const numbers = Object.entries(grade).filter(([, v]) => typeof v === 'number');
    expect(numbers).toEqual([['rank', 0]]);
    expect(String(grade.score)).not.toMatch(/\d/);
  });

  it('produces an empty lesson series', () => {
    expect(lessonSeries([])).toEqual({ labels: [], values: [], dates: [] });
  });
});

describe('lessonSeries window', () => {
  it('takes its window from LESSONS_PER_LEVEL', () => {
    // Req 3.6 — the chart span is the attendance-tick span, not a new literal.
    expect(LESSONS_PER_LEVEL).toBe(10);
  });

  it('labels a single evaluation L1', () => {
    const evaluations = [evaluation(7, '2026-03-04', [5, 5, 4, 5, 5])];
    expect(lessonSeries(evaluations)).toEqual({
      labels: ['L1'],
      values: [4.8],
      dates: ['2026-03-04'],
    });
  });

  it('emits all ten points as L1..L10 at exactly the window size', () => {
    const evaluations = series(LESSONS_PER_LEVEL, 4);
    const { labels, values, dates } = lessonSeries(evaluations);

    expect(labels).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10']);
    expect(values).toEqual(Array(LESSONS_PER_LEVEL).fill(4));
    expect(dates[0]).toBe('2026-03-01');
    expect(dates[dates.length - 1]).toBe('2026-03-10');
  });

  it('slides the window at eleven evaluations and keeps true ordinals L2..L11', () => {
    // Req 3.5 — the eleventh lesson is L11 for the life of the record, so two
    // printed reports of the same student describe the same lessons.
    const evaluations = series(11, 3);
    const { labels, values, dates } = lessonSeries(evaluations);

    expect(labels).toHaveLength(LESSONS_PER_LEVEL);
    expect(labels).toEqual(['L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10', 'L11']);
    expect(labels[labels.length - 1]).toBe(`L${evaluations.length}`);
    expect(values).toHaveLength(LESSONS_PER_LEVEL);
    // The first evaluation is dropped from the window, not relabelled.
    expect(dates).not.toContain('2026-03-01');
    expect(dates[0]).toBe('2026-03-02');
    expect(dates[dates.length - 1]).toBe('2026-03-11');
  });

  it('orders by date and leaves the caller\'s list untouched', () => {
    // Req 2.7, 3.5 — the series is date order whatever order it arrives in.
    const shuffled = [
      evaluation(3, '2026-03-03', [5, 5, 5, 5, 5]),
      evaluation(1, '2026-03-01', [1, 1, 1, 1, 1]),
      evaluation(2, '2026-03-02', [3, 3, 3, 3, 3]),
    ];
    const snapshot = shuffled.map((row) => ({ ...row }));

    expect(lessonSeries(shuffled)).toEqual({
      labels: ['L1', 'L2', 'L3'],
      values: [1, 3, 5],
      dates: ['2026-03-01', '2026-03-02', '2026-03-03'],
    });
    expect(shuffled).toEqual(snapshot);
  });
});
