/**
 * The one student filter predicate, shared by the Students_Page and the
 * Student_Selector_Panel, plus the Program_Category resolver that partitions a student
 * list into the `Kinder` / `Junior` / `Coder` tabs.
 *
 * Req 6.8: both screens filter through this module, so they cannot filter differently.
 * Req 6.7: every student resolves to exactly one Program_Category, so nobody vanishes
 * from all three tabs.
 *
 * The predicate is a transcription of the expression that lived inline in
 * `src/views/NewStudentsPage.jsx`, kept semantics-for-semantics so task 7.4 can swap the
 * page over without changing what that page shows:
 *
 *   - `level` is compared against `normaliseCoderLevel(student.level)`, so filtering by
 *     "Coder Advance" still finds records written as "Coder Advance 1". The filter value
 *     itself is NOT folded — that matches the page, whose dropdown only ever offers
 *     `STUDENT_LEVELS` values, which are already folded.
 *   - `branch` is compared to `student.branchName` and `status` to `student.status` by
 *     strict equality, with no trimming and no case folding.
 *   - `search` is lower-cased and matched with `includes` against the student's name,
 *     parent name, contact AND remarks. The page has always searched remarks as well as
 *     the three fields named in Req 6.8, so remarks stay in: dropping the field here
 *     would silently narrow the existing screen's results. Whitespace is not trimmed,
 *     because the page does not trim it either — a search of " " matches any field
 *     containing a space.
 *   - Each of the four criteria is inactive at its unfiltered default (`'all'` for the
 *     three selects, `''` for the search box), and an omitted criterion is inactive too.
 *
 * The one deliberate difference: fields are read through `String(value ?? '')` instead of
 * calling `.toLowerCase()` on the raw value. The inline version threw a TypeError on a
 * non-string field (a numeric `contact`, say); it never returned a different result, so
 * no passing case changes.
 *
 * Pure module: `programRules.js` is the only import, and there is no React here, so both
 * the page and a plain Node test can use it.
 */

import {
  CATEGORIES,
  CATEGORY_LEVELS,
  STUDENT_LEVELS,
  normaliseCoderLevel,
  parseProgram,
} from './programRules';

/** The value every select carries while it is not narrowing anything. */
export const UNFILTERED = 'all';

/** `['Kinder', 'Junior', 'Coder']` — re-exported so callers need one import, not two. */
export const PROGRAM_CATEGORIES = CATEGORIES;

/**
 * Where a student lands when their level resolves to no known category.
 *
 * Req 6.7 wants every student under exactly one tab. A student who resolved to nothing
 * would be listed under no tab at all and would be unreachable from this screen — a
 * silent data loss, and worse than being filed under the wrong heading, which is at
 * least visible and fixable by editing the student's level. So an unresolved level falls
 * back to the first category rather than dropping the student.
 */
export const FALLBACK_PROGRAM_CATEGORY = CATEGORIES[0];

/** Lookup key: the level as written, trimmed and case-folded. */
function levelKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Level (or program code) → Program_Category, built from the constants in
 * `programRules.js` rather than from string patterns written here.
 *
 * Two shapes reach this module. `student.level` holds a `STUDENT_LEVELS` name
 * ("Kinder Foundation"), which `parseProgram` does not recognise — its families match
 * program codes. A stored program value holds a code ("KF1", "J2.3", "Coder Advance"),
 * which `parseProgram` does recognise. Indexing both keeps the resolver total over the
 * data the app actually holds.
 */
const LEVEL_CATEGORY_INDEX = (() => {
  const index = new Map();

  // Program codes, straight from the category → codes table.
  for (const category of CATEGORIES) {
    for (const code of CATEGORY_LEVELS[category] || []) {
      index.set(levelKey(code), category);
    }
  }

  // Level names. Each name opens with its category ("Junior Core" → "Junior"), so the
  // mapping is derived from CATEGORIES and STUDENT_LEVELS instead of being hand-written.
  for (const level of STUDENT_LEVELS) {
    const category = CATEGORIES.find((c) => levelKey(level).startsWith(levelKey(c)));
    if (category) index.set(levelKey(level), category);
  }

  return index;
})();

/**
 * Resolve a level or program value to its Program_Category, or `null` when it resolves
 * to none. Use this when an unknown level should be visible as unknown; use
 * {@link programCategoryOf} when a category is required for every student.
 *
 * @param {string|null|undefined} level a `STUDENT_LEVELS` name or a program code
 * @returns {'Kinder'|'Junior'|'Coder'|null}
 */
export function resolveProgramCategory(level) {
  const folded = normaliseCoderLevel(level);
  if (!folded) return null;

  const parsed = parseProgram(folded);
  if (parsed.category && CATEGORIES.includes(parsed.category)) return parsed.category;

  return (
    LEVEL_CATEGORY_INDEX.get(levelKey(folded)) ||
    LEVEL_CATEGORY_INDEX.get(levelKey(parsed.code)) ||
    null
  );
}

/**
 * The total resolver the tabs use: always one of the three categories, falling back to
 * {@link FALLBACK_PROGRAM_CATEGORY} for a blank or unrecognised level (Req 6.7).
 *
 * @param {string|null|undefined} level
 * @returns {'Kinder'|'Junior'|'Coder'}
 */
export function programCategoryOf(level) {
  return resolveProgramCategory(level) || FALLBACK_PROGRAM_CATEGORY;
}

/**
 * The Program_Category a student belongs to, read off `student.level`.
 *
 * @param {{ level?: string }|null|undefined} student
 * @returns {'Kinder'|'Junior'|'Coder'}
 */
export function studentProgramCategory(student) {
  return programCategoryOf(student?.level);
}

/**
 * Split a student list into the three tab lists, each in the input's order.
 *
 * The three lists are pairwise disjoint and their union is the input, because every
 * student is placed by exactly one call of the total resolver (Req 6.7).
 *
 * @param {Array<object>} students
 * @returns {Record<'Kinder'|'Junior'|'Coder', Array<object>>}
 */
export function partitionByProgramCategory(students) {
  const buckets = {};
  for (const category of CATEGORIES) buckets[category] = [];
  if (!Array.isArray(students)) return buckets;

  for (const student of students) {
    buckets[studentProgramCategory(student)].push(student);
  }
  return buckets;
}

/** Read a student field as searchable text; a missing field is empty, never a throw. */
function searchable(value) {
  return String(value ?? '').toLowerCase();
}

/**
 * @typedef {Object} StudentFilterCriteria
 * @property {string} [search] free text, matched case-insensitively; `''` is inactive
 * @property {string} [level]  a folded `STUDENT_LEVELS` value; `'all'` is inactive
 * @property {string} [branch] a branch name; `'all'` is inactive
 * @property {string} [status] `'Active'` / `'Inactive'`; `'all'` is inactive
 */

/**
 * Does this student match every active criterion?
 *
 * @param {object} student a student record from `/api/new/students`
 * @param {StudentFilterCriteria} [criteria]
 * @returns {boolean}
 */
export function matchesStudentFilter(student, criteria = {}) {
  const {
    search = '',
    level = UNFILTERED,
    branch = UNFILTERED,
    status = UNFILTERED,
  } = criteria || {};

  if (!student) return false;

  // Compared on the folded level so filtering by "Coder Advance" still finds records
  // written as "Coder Advance 1".
  if (level !== UNFILTERED && normaliseCoderLevel(student.level) !== level) return false;
  if (branch !== UNFILTERED && student.branchName !== branch) return false;
  if (status !== UNFILTERED && student.status !== status) return false;

  const needle = String(search ?? '').toLowerCase();
  if (needle) {
    const match =
      searchable(student.name).includes(needle) ||
      searchable(student.parentName).includes(needle) ||
      searchable(student.contact).includes(needle) ||
      searchable(student.remarks).includes(needle);
    if (!match) return false;
  }

  return true;
}

/**
 * Apply {@link matchesStudentFilter} across a list.
 *
 * The result is a subset of the input in the input's order — no sorting, no
 * de-duplication, no new objects — so a caller that wants a different order sorts a copy
 * itself, exactly as the Students_Page does today (Req 6.8).
 *
 * @param {Array<object>} students
 * @param {StudentFilterCriteria} [criteria]
 * @returns {Array<object>} the retained students, same objects, same relative order
 */
export function filterStudents(students, criteria = {}) {
  if (!Array.isArray(students)) return [];
  return students.filter((student) => matchesStudentFilter(student, criteria));
}
