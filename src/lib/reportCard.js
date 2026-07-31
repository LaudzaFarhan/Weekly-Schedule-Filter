/**
 * Pure derivation module for the student report cards feature.
 *
 * Every number a parent can read — the Competency Map radar, the Average
 * Progress Trend line, the overall grade badge and the printed Competency
 * Mastery Summary — comes from this one module (Req 3.1–3.4, 3.7). One
 * computation, several renderers, so the screen and the paper cannot disagree.
 *
 * Pure: no React, no `pg`, no `window`. The only import is the rubric module,
 * which supplies the canonical five competency keys. Directly testable with
 * fast-check.
 *
 * Two rules are deliberate and load-bearing rather than stylistic:
 *   1. A score is never invented. Zero evaluations returns NOT_ASSESSED with a
 *      `null` score, never `0` — a zero on a document a parent keeps reads as a
 *      failing grade (Req 3.4).
 *   2. The overall score is rounded to one decimal BEFORE the grade band is
 *      selected, so the printed number and the printed label cannot contradict
 *      each other (Req 3.3).
 */

import { COMPETENCIES } from './reportCardRubric';
import { LESSONS_PER_LEVEL } from './programRules';

/**
 * @typedef {import('./reportCardRubric').CompetencyKey} CompetencyKey
 */

/**
 * @typedef {Record<CompetencyKey, number>} CompetencyAverages
 *   One unrounded arithmetic mean per competency, each in [1,5].
 */

/**
 * @typedef {Object} OverallGrade
 * @property {number|null} score  mean of the five averages to 1dp, or null when n === 0
 * @property {string} label       EXCELLENT | VERY GOOD | GOOD | DEVELOPING | BEGINNING | NOT YET ASSESSED
 * @property {number} rank        0 for NOT YET ASSESSED, then 1..5 ascending
 */

/**
 * The arithmetic mean of each competency over the supplied evaluations.
 *
 * Returns `null` for an empty list (and for anything that is not an array), so
 * "no assessment yet" is a distinct value rather than a row of zeroes. The
 * means are unrounded — rounding happens once, at the point of display, so no
 * intermediate rounding error accumulates into the printed number.
 *
 * Order-independent: the five scores are integers in [1,5], so their sums are
 * exact in floating point whatever order they are added in. The input array and
 * its rows are never mutated.
 *
 * @param {Array<Record<string, number>>} evaluations
 * @returns {CompetencyAverages|null} the five means, or null when there are none
 */
export function competencyAverages(evaluations) {
  const rows = Array.isArray(evaluations) ? evaluations : [];
  if (rows.length === 0) return null; // n === 0 -> no value, never a zero (Req 3.4)

  const sums = { concept: 0, building: 0, problemSolving: 0, focus: 0, attitude: 0 };

  for (const row of rows) {
    // INVARIANT: after i rows, sums[k] is the sum of the first i values of k,
    // and therefore lies in [i, 5i].
    for (const { key } of COMPETENCIES) {
      sums[key] += Number(row?.[key]);
    }
  }

  /** @type {CompetencyAverages} */
  const out = {};
  for (const { key } of COMPETENCIES) out[key] = sums[key] / rows.length;
  return out; // each value in [1,5]
}

/**
 * The grade bands, descending by threshold. First match wins, so this table is
 * the single source of the banding rule (D5, Req 3.3). `rank` rises with the
 * band, so a higher score can never carry a lower rank.
 *
 * @type {ReadonlyArray<{ min: number, label: string, rank: number }>}
 */
export const GRADE_BANDS = [
  { min: 4.5, label: 'EXCELLENT', rank: 5 },
  { min: 3.5, label: 'VERY GOOD', rank: 4 },
  { min: 2.5, label: 'GOOD', rank: 3 },
  { min: 1.5, label: 'DEVELOPING', rank: 2 },
  { min: 1.0, label: 'BEGINNING', rank: 1 },
];

/**
 * The grade for a student with no evaluations in range.
 *
 * `score` is `null`, never `0`: nothing downstream may print a number or a
 * `/5` for an unassessed student, because a zero would read as a failing grade
 * on a report a parent keeps (Req 3.4). `rank` is 0, below every real band.
 *
 * @type {OverallGrade}
 */
export const NOT_ASSESSED = { score: null, label: 'NOT YET ASSESSED', rank: 0 };

/**
 * The overall grade: the displayed score and its band.
 *
 * The score is the arithmetic mean of the five competency averages, which
 * equals the grand mean of every score of every evaluation in range (Req 3.2).
 *
 * The rounding order matters. The score is rounded to one decimal FIRST and the
 * band is then selected from that rounded value, so the band recomputed from the
 * displayed score always equals the displayed band (Req 3.3). Banding the raw
 * mean would let 4.46 print as "4.5" beneath a VERY GOOD label — the number and
 * the label contradicting each other on the same printed line.
 *
 * Total: never throws, never returns an empty label.
 *
 * @param {CompetencyAverages|null} averages as returned by {@link competencyAverages}
 * @returns {OverallGrade}
 */
export function overallGrade(averages) {
  if (!averages) return NOT_ASSESSED; // zero evaluations -> no number anywhere

  let total = 0;
  for (const { key } of COMPETENCIES) total += Number(averages[key]);
  const mean = total / COMPETENCIES.length;

  // Rounded FIRST, then banded — see the note above.
  const score = Math.round(mean * 10) / 10;

  const band =
    GRADE_BANDS.find((b) => score >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1];

  return { score, label: band.label, rank: band.rank };
}

/**
 * @typedef {Object} LessonSeries
 * @property {string[]} labels  e.g. ['L1',..,'L10'] or ['L2',..,'L11'] — true ordinals
 * @property {number[]} values  per-evaluation mean of the five scores, same length
 * @property {string[]} dates   the ISO date behind each point, non-decreasing
 */

/**
 * The Average Progress Trend series: one point per evaluation, labelled with the
 * lesson's ordinal in that student's whole history.
 *
 * The ordinals are the point of this function (Req 3.5). The records are sorted
 * by `(date, id)`, the ordinal is taken from the position in the FULL sorted
 * list, and only then is the window sliced off the end. So the eleventh
 * evaluation is `L11` and the chart reads `L2…L11`, not `L1…L10`. Relabelling
 * the window `L1…L10` on every render would make `L1` mean a different lesson
 * tomorrow than it did today, and a parent comparing two printed reports would
 * be misled.
 *
 * `date` is compared as a string. ISO `YYYY-MM-DD` sorts lexicographically, so
 * this is both correct and free of the timezone behaviour that constructing
 * `Date` objects would bring in. `id` breaks a same-day tie so the order is
 * total for imported data — the one-record-per-student-per-day rule (Req 1.1)
 * makes ties impossible for a single student's own records.
 *
 * The window defaults to `LESSONS_PER_LEVEL` from `programRules.js` rather than
 * a literal declared here, so the chart span and the attendance-tick span stay
 * one value (Req 3.6).
 *
 * The input array and its rows are never mutated: `.slice()` runs before
 * `.sort()`, because `Array.prototype.sort` sorts in place.
 *
 * @param {Array<{ id?: number, date?: string } & Record<string, number>>} evaluations
 *   rows for ONE student
 * @param {{ window?: number }} [options] window defaults to `LESSONS_PER_LEVEL`
 * @returns {LessonSeries} equal-length `labels`, `values` and `dates`
 */
export function lessonSeries(evaluations, { window = LESSONS_PER_LEVEL } = {}) {
  // .slice() first — sort() is in place, and the caller's list must survive.
  const rows = (Array.isArray(evaluations) ? evaluations : []).slice();

  // Date first, id second. localeCompare on the ISO string, never a Date object.
  rows.sort(
    (a, b) =>
      String(a?.date).localeCompare(String(b?.date)) ||
      // Number() keeps a missing id from turning the comparator into NaN, which
      // would silently degrade to "equal" and lose the tiebreak.
      (Number(a?.id) || 0) - (Number(b?.id) || 0)
  );

  const n = rows.length;
  const start = Math.max(0, n - window); // the last min(n, window) records (D4)

  /** @type {string[]} */ const labels = [];
  /** @type {number[]} */ const values = [];
  /** @type {string[]} */ const dates = [];

  for (let i = start; i < n; i += 1) {
    // INVARIANT: labels are strictly increasing by 1 and dates are
    // non-decreasing, because i increases by 1 over a list sorted by date.
    labels.push(`L${i + 1}`); // the TRUE ordinal in the full history, not 1..window

    let total = 0;
    for (const { key } of COMPETENCIES) total += Number(rows[i]?.[key]);
    values.push(total / COMPETENCIES.length); // in [1,5]

    dates.push(rows[i]?.date);
  }

  return { labels, values, dates };
}
/**
 * @typedef {Object} TermPoint
 * @property {number} year
 * @property {number} termNumber  1..4
 */

/**
 * @typedef {Object} TermBadge
 * @property {number} termNumber                 1..4
 * @property {string} label                      'T1'..'T4'
 * @property {'paid'|'unpaid'|'absent'} state
 * @property {boolean} current                   true on at most one badge
 */

/**
 * @typedef {Object} TermSummary
 * @property {TermPoint|null} startTerm    (year, termNumber) minimum over all rows
 * @property {TermPoint|null} currentTerm  (year, termNumber) maximum over paid rows
 * @property {TermBadge[]} badges          always length 4, ordered T1..T4
 * @property {number} year                 the selected year the badges describe
 */

/** The four term numbers, ascending. The badge row is this list, always. */
const TERM_NUMBERS = [1, 2, 3, 4];

/**
 * Strict `(year, termNumber)` ordering: is `a` earlier than `b`?
 *
 * @param {TermPoint} a
 * @param {TermPoint} b
 * @returns {boolean}
 */
const before = (a, b) => (a.year !== b.year ? a.year < b.year : a.termNumber < b.termNumber);

/**
 * The four term badges plus the start term and the current term.
 *
 * Nothing here is stored. `internal_student_terms` holds no `is_current` and no
 * `is_start` column (Req 4.4), so "this student has two current terms" is not a
 * state the database can be in — and it is not a state this function can return
 * either: `currentTerm` is one `(year, termNumber)` point, and a badge is current
 * only when it equals that single point, so `current === true` lands on at most
 * one of the four badges by construction rather than by convention (Req 4.2).
 * Duplicate rows for the same triple, rows spread over several years and rows
 * with a junk term number cannot change that count.
 *
 * Total over any input. `null`, `undefined`, a non-array and rows of rubbish all
 * return a well-formed four-badge result. Two filters carry that:
 *
 *   - a row needs an integer `termNumber` in `[1,4]` to be considered at all,
 *     because a badge is keyed by term number and there is no badge to put a
 *     `termNumber` of `7` or `2.5` on;
 *   - a row needs an integer `year`, because `(year, termNumber)` ordering is
 *     meaningless for `undefined` or `'2026'` and one such row would otherwise
 *     poison the year maximum into `NaN` and take every badge with it.
 *
 * `paid` is compared with `=== true` rather than for truthiness, so only a real
 * boolean flag can put a badge in the `paid` state or produce a current term.
 *
 * The selected year defaults to the greatest year present across the rows, and
 * to the current calendar year when there are no rows (Req 4.7). Badge states
 * come only from rows in that year (Req 4.1); `startTerm` and `currentTerm` are
 * computed over every year, so a student whose latest paid term sits in an
 * earlier year still reports that term in the header while showing no current
 * badge in the selected year (Req 4.8).
 *
 * Where the same `(year, termNumber)` carries duplicate rows that disagree, a
 * paid row wins. That keeps the badge row consistent with `currentTerm`: if the
 * current term is in the selected year, its badge always reads `paid`, never
 * `unpaid`.
 *
 * The input array and its rows are never mutated; the returned points are fresh
 * objects, not references into the input.
 *
 * @param {Array<{ year?: number, termNumber?: number, paid?: boolean }>} terms
 *   rows for ONE student, any year
 * @param {{ year?: number }} [options] the selected year; defaults per Req 4.7
 * @returns {TermSummary}
 */
export function termSummary(terms, { year } = {}) {
  // Only rows that can be ordered and can be placed on a badge take part.
  const rows = (Array.isArray(terms) ? terms : []).filter(
    (t) =>
      Number.isInteger(t?.termNumber) &&
      t.termNumber >= 1 &&
      t.termNumber <= 4 &&
      Number.isInteger(t?.year)
  );

  const selectedYear = Number.isInteger(year)
    ? year
    : rows.length > 0
      ? rows.reduce((max, t) => Math.max(max, t.year), rows[0].year)
      : new Date().getFullYear(); // no rows at all -> the current calendar year

  /** @type {TermPoint|null} */ let startTerm = null;
  /** @type {TermPoint|null} */ let currentTerm = null;

  for (const t of rows) {
    // INVARIANT: startTerm is the (year, termNumber) minimum over the prefix
    // scanned so far, and currentTerm the maximum over the paid rows of that
    // same prefix. currentTerm therefore always comes from a subset of the rows
    // startTerm minimises over, which is why startTerm <= currentTerm holds
    // whenever both exist (Req 4.3) — it is not a separate check.
    const point = { year: t.year, termNumber: t.termNumber };
    if (startTerm === null || before(point, startTerm)) startTerm = point;
    if (t.paid === true && (currentTerm === null || before(currentTerm, point))) {
      currentTerm = point;
    }
  }

  // Term number -> does the selected year hold a row for it, and is any paid?
  /** @type {Map<number, boolean>} */
  const inYear = new Map();
  for (const t of rows) {
    if (t.year !== selectedYear) continue;
    inYear.set(t.termNumber, (inYear.get(t.termNumber) || false) || t.paid === true);
  }

  const badges = TERM_NUMBERS.map((termNumber) => ({
    termNumber,
    label: `T${termNumber}`,
    state: !inYear.has(termNumber) ? 'absent' : inYear.get(termNumber) ? 'paid' : 'unpaid',
    // Derived from the one current point, so two current badges are
    // unrepresentable (D8, Req 4.2, Req 4.8).
    current: Boolean(
      currentTerm && currentTerm.year === selectedYear && currentTerm.termNumber === termNumber
    ),
  }));

  return { startTerm, currentTerm, badges, year: selectedYear };
}
