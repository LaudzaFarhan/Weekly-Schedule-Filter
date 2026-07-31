import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  FALLBACK_PROGRAM_CATEGORY,
  PROGRAM_CATEGORIES,
  UNFILTERED,
  filterStudents,
  partitionByProgramCategory,
  resolveProgramCategory,
  studentProgramCategory,
} from '@/lib/studentFilter';
import { CATEGORY_LEVELS, STUDENT_LEVELS, normaliseCoderLevel } from '@/lib/programRules';

/**
 * Property tests for the shared student filter (`src/lib/studentFilter.js`).
 *
 *   - Property 19 covers the Program_Category tabs of the Student_Selector_Panel:
 *     the three tab lists must partition the student list (Req 6.7).
 *   - Property 20 covers the predicate both screens filter through: it must behave
 *     as a filter — a subset of the input, in the input's order, retaining exactly
 *     the students that match every active criterion (Req 6.8).
 *
 * Both are pure functions, so nothing here mocks or renders anything.
 *
 * Generated field text is ASCII only. Case-insensitivity is asserted by comparing a
 * run against the same search upper-cased and lower-cased, and outside ASCII that
 * round trip is not length-preserving ('İ'.toLowerCase() is two code units), which
 * would fail the assertion for a reason that has nothing to do with the filter.
 */

/** Names as the registry holds them: mixed case, spaces, the odd apostrophe. */
const NAME_POOL = [
  'Alice Tan',
  'alice tan',
  'ALICE TAN',
  'Bob Wijaya',
  'Chandra',
  'dewi lestari',
  "O'Brien",
  'Eka Putra Jr.',
];

/** Search fragments: prefixes and infixes of the pool in assorted casings. */
const SEARCH_POOL = ['ali', 'ALI', 'Ali', 'tan', 'TAN', 'wij', 'chan', 'DEWI', "o'b", '08', ' ', '.'];

const BRANCH_POOL = ['Bintaro', 'bintaro', 'Kemang', 'Puri Indah', ''];

const STATUS_POOL = ['Active', 'Inactive', 'active', ''];

/** Short ASCII text, so `toUpperCase`/`toLowerCase` stay length-preserving. */
const asciiTextArb = fc.stringMatching(/^[A-Za-z0-9 .'@+-]{0,12}$/);

/** Every Kinder/Junior program code, and a dotted lesson form of each. */
const PROGRAM_CODES = PROGRAM_CATEGORIES.flatMap((category) => CATEGORY_LEVELS[category] || []);

/**
 * Levels as the data actually holds them, and as it does not:
 * `STUDENT_LEVELS` names, legacy numbered Coder levels, program codes with and
 * without a lesson number, odd casing and padding, unrecognised values, and the
 * missing-field cases. Req 6.7 asks that every one of these lands under a tab.
 */
const levelArb = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...STUDENT_LEVELS) },
  { weight: 2, arbitrary: fc.constantFrom('Coder Basic 1', 'Coder Advance 2', 'coder advance 10', 'Coder Foundation 3') },
  { weight: 2, arbitrary: fc.constantFrom(...PROGRAM_CODES) },
  { weight: 2, arbitrary: fc.constantFrom('K2.3', 'JF1.10', 'kf1.2', 'j4.7') },
  { weight: 1, arbitrary: fc.constantFrom('  Junior Core  ', 'JUNIOR FOUNDATION', 'kinder core') },
  { weight: 2, arbitrary: fc.constantFrom('Robotics', 'Trial', 'Level 3', '-', '') },
  { weight: 2, arbitrary: fc.constantFrom(null, undefined) },
  { weight: 1, arbitrary: asciiTextArb },
);

/** An optional text field: a pool value, free text, or missing entirely. */
function fieldArb(pool) {
  return fc.oneof(
    { weight: 5, arbitrary: fc.constantFrom(...pool) },
    { weight: 2, arbitrary: asciiTextArb },
    { weight: 2, arbitrary: fc.constantFrom(null, undefined) },
  );
}

/**
 * A student record in the shape `/api/new/students` returns, with every field the
 * filter reads. `contact` is sometimes a number because the registry has held
 * numeric contacts, and the module reads fields through `String(value ?? '')`.
 */
const studentArb = fc.record({
  id: fc.integer({ min: 1, max: 10_000 }),
  name: fieldArb(NAME_POOL),
  parentName: fieldArb(NAME_POOL),
  contact: fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom('08123456789', '+62 812 3456', '0899-000') },
    { weight: 2, arbitrary: fc.integer({ min: 0, max: 99_999_999 }) },
    { weight: 2, arbitrary: fc.constantFrom(null, undefined, '') },
  ),
  remarks: fieldArb(['makeup class', 'Trial student', '']),
  level: levelArb,
  branchName: fieldArb(BRANCH_POOL),
  status: fieldArb(STATUS_POOL),
});

/** A student list; the empty list is included on purpose. */
const studentsArb = fc.array(studentArb, { maxLength: 15 });

/** One filter criteria object, each field at its unfiltered default or narrowing. */
const criteriaArb = fc.record({
  search: fc.oneof(
    { weight: 3, arbitrary: fc.constant('') },
    { weight: 4, arbitrary: fc.constantFrom(...SEARCH_POOL) },
    { weight: 2, arbitrary: asciiTextArb },
  ),
  // The page's dropdown only ever offers already-folded STUDENT_LEVELS values.
  level: fc.oneof(
    { weight: 4, arbitrary: fc.constant(UNFILTERED) },
    { weight: 4, arbitrary: fc.constantFrom(...STUDENT_LEVELS) },
  ),
  branch: fc.oneof(
    { weight: 4, arbitrary: fc.constant(UNFILTERED) },
    { weight: 4, arbitrary: fc.constantFrom(...BRANCH_POOL) },
  ),
  status: fc.oneof(
    { weight: 4, arbitrary: fc.constant(UNFILTERED) },
    { weight: 4, arbitrary: fc.constantFrom(...STATUS_POOL) },
  ),
});

/** Read a field as the filter reads it: missing is empty, never a throw. */
function text(value) {
  return String(value ?? '').toLowerCase();
}

/**
 * Is `sub` a subsequence of `sup` under object identity? True only when every
 * element of `sub` is an element of `sup`, appears once, and appears in `sup`'s
 * order. Identity comparison is sound here because each generated record is a
 * fresh object, so no two list entries are the same object.
 */
function isSubsequence(sub, sup) {
  let cursor = 0;
  for (const item of sup) {
    if (cursor < sub.length && sub[cursor] === item) cursor += 1;
  }
  return cursor === sub.length;
}

describe('studentFilter properties', () => {
  // Feature: student-report-cards, Property 19: The program tabs partition the student list
  it('files every student under exactly one program tab, in the input order', () => {
    fc.assert(
      fc.property(studentsArb, (students) => {
        const buckets = partitionByProgramCategory(students);

        // One tab per Program_Category, and no other tab (Req 6.7).
        expect(Object.keys(buckets)).toEqual([...PROGRAM_CATEGORIES]);

        // The union covers the input exactly: sizes add up, and every student is
        // in exactly one bucket — nothing dropped, nothing double-counted (Req 6.7).
        const total = PROGRAM_CATEGORIES.reduce((sum, category) => sum + buckets[category].length, 0);
        expect(total).toBe(students.length);

        for (const student of students) {
          const holding = PROGRAM_CATEGORIES.filter((category) => buckets[category].includes(student));
          expect(holding).toHaveLength(1);

          // The tab a student lands under is the one the resolver names, and it is
          // always one of the three — an unrecognised or missing level falls back
          // rather than leaving the student off every tab (Req 6.7).
          const category = studentProgramCategory(student);
          expect(PROGRAM_CATEGORIES).toContain(category);
          expect(holding[0]).toBe(category);
          if (resolveProgramCategory(student.level) === null) {
            expect(category).toBe(FALLBACK_PROGRAM_CATEGORY);
          }
        }

        // Pairwise disjoint, stated directly rather than only via the count above.
        for (const category of PROGRAM_CATEGORIES) {
          for (const other of PROGRAM_CATEGORIES) {
            if (category === other) continue;
            for (const student of buckets[category]) {
              expect(buckets[other]).not.toContain(student);
            }
          }
        }

        // Each tab list is a subsequence of the input: same objects, input's order,
        // no duplicates invented by the split (Req 6.7).
        for (const category of PROGRAM_CATEGORIES) {
          expect(isSubsequence(buckets[category], students)).toBe(true);
          expect(new Set(buckets[category]).size).toBe(buckets[category].length);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: student-report-cards, Property 20: The shared filter predicate is a filter
  it('retains exactly the matching students, as a subset of the input in the input order', () => {
    fc.assert(
      fc.property(studentsArb, criteriaArb, (students, criteria) => {
        const result = filterStudents(students, criteria);
        const { search, level, branch, status } = criteria;
        const needle = search.toLowerCase();

        // A subset of the input, in the input's order, with nothing invented and
        // nothing duplicated (Req 6.8).
        expect(isSubsequence(result, students)).toBe(true);
        expect(new Set(result).size).toBe(result.length);
        for (const student of result) expect(students).toContain(student);

        for (const student of students) {
          const retained = result.includes(student);

          // The three equality criteria, as Req 6.8 states them: level compared on
          // the folded value so "Coder Advance" finds "Coder Advance 1"; branch and
          // status by equality.
          const levelOk = level === UNFILTERED || normaliseCoderLevel(student.level) === level;
          const branchOk = branch === UNFILTERED || student.branchName === branch;
          const statusOk = status === UNFILTERED || student.status === status;

          // A retained student satisfies every active criterion.
          if (retained) {
            expect(levelOk).toBe(true);
            expect(branchOk).toBe(true);
            expect(statusOk).toBe(true);
            if (needle) {
              const anyField =
                text(student.name).includes(needle) ||
                text(student.parentName).includes(needle) ||
                text(student.contact).includes(needle) ||
                text(student.remarks).includes(needle);
              expect(anyField).toBe(true);
            }
          } else {
            // A student matching all three equalities and the search over name,
            // parent name or contact must be retained — those are the three fields
            // Req 6.8 names, so a match on any of them cannot be dropped.
            const namedFieldHit =
              !needle ||
              text(student.name).includes(needle) ||
              text(student.parentName).includes(needle) ||
              text(student.contact).includes(needle);
            expect(levelOk && branchOk && statusOk && namedFieldHit).toBe(false);
          }
        }

        // The search is case-insensitive: the same text in any casing retains the
        // same students, in the same order (Req 6.8).
        expect(filterStudents(students, { ...criteria, search: search.toUpperCase() })).toEqual(result);
        expect(filterStudents(students, { ...criteria, search: search.toLowerCase() })).toEqual(result);

        // At its unfiltered defaults the filter narrows nothing: the input back,
        // same objects, same order.
        expect(filterStudents(students, {})).toEqual(students);

        // Relaxing any one criterion never returns fewer students, and the stricter
        // result stays a subsequence of the relaxed one.
        for (const key of ['search', 'level', 'branch', 'status']) {
          const relaxed = { ...criteria, [key]: key === 'search' ? '' : UNFILTERED };
          const relaxedResult = filterStudents(students, relaxed);
          expect(relaxedResult.length).toBeGreaterThanOrEqual(result.length);
          expect(isSubsequence(result, relaxedResult)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
