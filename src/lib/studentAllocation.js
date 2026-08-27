/**
 * Who counts as allocated to a class, and who does not.
 *
 * `internal_classes` has no foreign key to `internal_students` — the roster is
 * the free-text `student` column — so "is this student allocated?" is answered
 * by matching names. Three screens ask that question (the schedule page's
 * Unallocated panel, the home KPI and the notification bell), and they used to
 * each answer it with their own slightly different rules, so the same student
 * could be red on one screen and fine on another. They all call this now.
 *
 * What makes a student allocated: they are named on a class row that still
 * holds a place. Deliberately *not* part of that test:
 *
 *  - Whether the row's teacher appears in the instructor registry. A teacher
 *    missing from `internal_instructors` is a gap in the instructor list, not
 *    evidence that the student has no class. Treating it as the latter hid real
 *    fixed schedules behind the Unallocated badge and invited a second, duplicate
 *    class row to be created for a student who already had one.
 *  - Which branch the class belongs to, or which program. A student sitting in
 *    a class recorded against another branch is a data problem to correct on
 *    the row, not an unallocated student to place again.
 */

/**
 * Fold a name to a comparison key: lowercase, drop any parenthetical nickname,
 * then keep only letters and digits. Absorbs the spacing, casing and
 * punctuation differences between the master sheet and the students list.
 *
 * Note this also drops accented characters rather than folding them, which is
 * why `José` and `Jose` both key as `jos`/`jose` respectively — matching stays
 * consistent because both sides of the comparison are folded the same way.
 */
export function normalizeStudentName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Split a `student` cell into individual names.
 *
 * One row can carry several students: group classes are written as a
 * comma-separated roster in a single cell.
 */
export function splitStudentCell(cell) {
  return String(cell || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * A teacher value that names nobody. These rows are placeholders rather than
 * real placements, so they do not allocate anyone.
 */
export function isPlaceholderTeacher(teacher) {
  const t = String(teacher || '').trim().toLowerCase();
  return t === '' || t === '-' || t === 'tbd';
}

/** Attendance kinds that only ever apply on specific recorded dates. */
const DATED_KINDS = ['Replacement', 'Additional', 'Trial'];

/**
 * Has a dated place been used up?
 *
 * A replacement or extra session whose dates have all passed is over: it no
 * longer holds a seat, so it no longer allocates the student either. A Regular
 * never expires, and a dated row with no dates recorded is treated as still
 * pending so an incomplete record is never silently dropped.
 */
export function isPlaceExpired(row, todayISO) {
  const kind = String(row?.classType ?? row?.class_type ?? '');
  if (!DATED_KINDS.includes(kind)) return false;
  const dates = row?.sessionDates ?? row?.session_dates ?? [];
  if (!Array.isArray(dates) || dates.length === 0) return false;
  return dates.every((d) => String(d) < todayISO);
}

/**
 * Does this row still hold a place for whoever is named on it?
 * Accepts camelCase (API shape) or snake_case (raw SQL row).
 */
export function isLivePlacement(row, todayISO) {
  if (!row) return false;
  if (isPlaceholderTeacher(row.teacher)) return false;
  return !isPlaceExpired(row, todayISO);
}

/**
 * Every live class row each student holds, keyed by normalised name.
 *
 * @param {Array<object>} classes class rows, camelCase or snake_case
 * @param {string} todayISO today as "YYYY-MM-DD"
 * @returns {Map<string, object[]>}
 */
export function buildPlacesByStudent(classes, todayISO) {
  const map = new Map();
  for (const row of classes || []) {
    if (!isLivePlacement(row, todayISO)) continue;
    for (const name of splitStudentCell(row.student)) {
      const key = normalizeStudentName(name);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
  }
  return map;
}

/**
 * Students from the students list who hold no live class row.
 *
 * @param {Array<object>} students student records
 * @param {Map<string, object[]>} places output of `buildPlacesByStudent`
 * @param {{ activeOnly?: boolean }} [options] when `activeOnly`, students whose
 *   status is anything other than "Active" are left out — used by the server,
 *   which has the status column to hand and should not nag about leavers.
 */
export function findUnallocatedStudents(students, places, { activeOnly = false } = {}) {
  return (students || []).filter((student) => {
    if (activeOnly && String(student?.status || 'Active') !== 'Active') return false;
    const key = normalizeStudentName(student?.name);
    return Boolean(key) && !places.has(key);
  });
}
