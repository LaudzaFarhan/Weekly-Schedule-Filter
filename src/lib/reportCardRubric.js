/**
 * The report-card rubric: the five competencies and all 25 rating descriptors.
 *
 * This module is the ONLY place rubric descriptor text lives (Req 1.16). The
 * evaluation form's italic descriptor line, the compact rubric reference panel
 * and the full Standardized Scoring Table Guidelines view all read from here,
 * so changing a descriptor is one edit in one file and the three views cannot
 * drift apart. No descriptor string belongs in a component.
 *
 * Pure module — no imports, no side effects, safe to call from render.
 *
 * WORDING STATUS (Req 1.15):
 *   - Rating 5 and rating 1 are VERBATIM from the source brief, character for
 *     character. Do not reword them without going back to the brief.
 *   - Ratings 4, 3 and 2 are PROVISIONAL. They are the graduated wording
 *     inferred from the prototype screenshots' full five-level table and are
 *     NOT yet approved. They require the rubric owner's sign-off before
 *     release. Once signed off, delete this note for the affected rows.
 */

/**
 * @typedef {'concept'|'building'|'problemSolving'|'focus'|'attitude'} CompetencyKey
 */

/**
 * The five assessed competencies, in display order.
 *
 * `key` is the camelCase API key, `column` is the snake_case database column
 * (they differ only for `problemSolving` → `problem_solving`), `label` is the
 * on-screen and printed heading, and `color` is the star / chart colour.
 *
 * @type {ReadonlyArray<{ key: CompetencyKey, column: string, label: string, color: string }>}
 */
export const COMPETENCIES = [
  { key: 'concept',        column: 'concept',         label: 'Concept',         color: '#3b82f6' },
  { key: 'building',       column: 'building',        label: 'Building',        color: '#f97316' },
  { key: 'problemSolving', column: 'problem_solving', label: 'Problem Solving', color: '#10b981' },
  { key: 'focus',          column: 'focus',           label: 'Focus',           color: '#8b5cf6' },
  { key: 'attitude',       column: 'attitude',        label: 'Attitude',        color: '#ec4899' },
];

/**
 * Competency key → rating 1..5 → descriptor. 5 × 5 = 25 cells, none empty, and
 * the five descriptors within any one competency are distinct from each other
 * (Req 1.14).
 *
 * Ratings 5 and 1: verbatim from the brief.
 * Ratings 4, 3, 2: provisional, pending the rubric owner's sign-off (Req 1.15).
 *
 * @type {Readonly<Record<CompetencyKey, Readonly<Record<number, string>>>>}
 */
export const RUBRIC_LEVELS = {
  concept: {
    5: 'Excellent independent understanding',
    4: 'Good understanding with minimal prompting',
    3: 'Understands with some guidance',
    2: 'Developing understanding, needs frequent guidance',
    1: 'Beginning with support',
  },
  building: {
    5: 'Builds independently',
    4: 'Builds with minimal help',
    3: 'Builds with regular help',
    2: 'Builds only with step-by-step guidance',
    1: 'Early stage',
  },
  problemSolving: {
    5: 'Solves independently',
    4: 'Solves with minor hints',
    3: 'Solves with guided questions',
    2: 'Solves with substantial help',
    1: 'Needs significant support',
  },
  focus: {
    5: 'Follows perfectly',
    4: 'Follows well with occasional reminders',
    3: 'Follows with regular reminders',
    2: 'Often distracted, needs redirection',
    1: 'Needs extra guidance',
  },
  attitude: {
    5: 'Very positive & enthusiastic',
    4: 'Positive and willing',
    3: 'Generally cooperative',
    2: 'Inconsistent engagement',
    1: 'Needs guidance',
  },
};

/**
 * Look up one rubric descriptor.
 *
 * Total over its whole argument domain and defensive by design, because it is
 * called from render: for a known competency key and an integer rating in
 * `[1,5]` it returns that non-empty descriptor, and for anything else — an
 * unknown key, a non-integer, an out-of-range number, `null`, `undefined`, an
 * object — it returns `''`. It never returns `undefined` and never throws, so a
 * bad value renders as an empty descriptor line instead of crashing the page.
 *
 * @param {CompetencyKey|string|unknown} competencyKey
 * @param {number|unknown} rating
 * @returns {string} the descriptor, or `''`
 */
export function descriptorFor(competencyKey, rating) {
  if (typeof competencyKey !== 'string') return '';

  const levels = Object.prototype.hasOwnProperty.call(RUBRIC_LEVELS, competencyKey)
    ? RUBRIC_LEVELS[competencyKey]
    : null;
  if (!levels) return '';

  if (typeof rating !== 'number' || !Number.isInteger(rating)) return '';
  if (rating < 1 || rating > 5) return '';

  const descriptor = levels[rating];
  return typeof descriptor === 'string' ? descriptor : '';
}
