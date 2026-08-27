/**
 * The mandatory `.xlsx` export that must complete before a student bulk wipe
 * can be armed.
 *
 * Mirrors `downloadImportTemplate()` in `NewSchedulePage.jsx` for how this
 * project drives the bundled `xlsx` package: `book_new` → sheet →
 * `book_append_sheet` → `writeFile`. Rows are built with `aoa_to_sheet`
 * rather than `json_to_sheet` so the header row and the column order are
 * fixed by this file rather than inferred from object keys.
 *
 * `buildStudentExportRows` and `studentExportFileName` are pure and touch no
 * XLSX API, so they are testable without a browser or a workbook.
 */

import * as XLSX from 'xlsx';
import { ATTENDANCE } from './instructorAvailability';
import { buildPlacesByStudent, normalizeStudentName } from './studentAllocation';

/**
 * Fixed column order of the export sheet. Req 2.3
 *
 * `Day`, `Time`, `Instructor` and `Program` come from the student's class row,
 * not from the student record. They used to be missing entirely, which left the
 * instructor readable only inside the `Remarks` prose ("… | Instructor: Angel")
 * — not a column anyone could sort, filter or re-import.
 *
 * That mattered more than a missing column usually does: this export is the
 * mandatory backup taken before a bulk wipe, and the importer needs a day, a
 * time AND an instructor before it will recreate a class row. Without those
 * three the sheet could restore the students but not their schedule.
 *
 * The header spellings are the ones `rosterImport.js` already recognises, so an
 * exported sheet can go straight back in.
 */
export const STUDENT_EXPORT_HEADERS = [
  'ID',
  'Name',
  'Level',
  'Branch',
  'Parent Name',
  'Contact',
  'Status',
  'Day',
  'Time',
  'Instructor',
  'Program',
  'Remarks',
];

/** The single sheet in the exported workbook. */
export const STUDENT_EXPORT_SHEET_NAME = 'Students';

/**
 * Absent, null and undefined values become the empty string; every other
 * value is stringified as-is with no truncation and no trimming.
 *
 * @param {unknown} value
 * @returns {string}
 */
function cell(value) {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Pure: registry rows → array-of-arrays, header row first.
 *
 * Field names are the camelCase shape the students API returns
 * (`mapRow` in `src/app/api/new/students/route.js`). Callers pass the
 * page's unfiltered `students` array, so every branch and every status is
 * included and a zero-record registry yields the header row alone.
 *
 * Req 2.3, 2.4, 2.9
 *
 * @param {Array<Record<string, unknown>>} [students]
 * @returns {string[][]}
 */
export function buildStudentExportRows(students, options) {
  const rows = Array.isArray(students) ? students : [];

  /*
   * An options object rather than a positional argument: this function has
   * historically been called with the page's filter values tacked on, and
   * ignoring them is a property the tests pin. A named `classes` key cannot be
   * confused with a search string.
   */
  const classes = Array.isArray(options?.classes) ? options.classes : [];
  const places = buildPlacesByStudent(classes, options?.todayISO || isoToday());

  return [
    [...STUDENT_EXPORT_HEADERS],
    ...rows.map((s) => {
      const r = s || {};
      const schedule = scheduleFor(r.name, places);
      return [
        cell(r.id),
        cell(r.name),
        cell(r.level),
        cell(r.branchName),
        cell(r.parentName),
        cell(r.contact),
        cell(r.status),
        cell(schedule?.day),
        cell(schedule?.time),
        cell(schedule?.teacher),
        cell(schedule?.program),
        cell(r.remarks),
      ];
    }),
  ];
}

/** Today as `YYYY-MM-DD`, local time, for deciding which dated places are spent. */
function isoToday(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The class row whose day, time and instructor describe where this student sits.
 *
 * The regular weekly place is what a restore needs, so it is preferred over a
 * replacement or an extra session. Falls back to whatever live row exists, and
 * to nothing at all for an unallocated student — whose schedule columns are then
 * blank rather than guessed.
 *
 * Matching reuses `studentAllocation`, so the sheet agrees with the Unallocated
 * panel about who has a class instead of applying a third set of name rules.
 */
function scheduleFor(studentName, places) {
  const key = normalizeStudentName(studentName);
  if (!key) return null;
  const held = places.get(key);
  if (!held || held.length === 0) return null;
  return held.find((c) => (c.classType || ATTENDANCE.REGULAR) === ATTENDANCE.REGULAR) || held[0];
}

/**
 * Pure: `students-export-2026-05-04.xlsx`, month and day zero-padded.
 *
 * Uses the local-time components of `date`, which is what the user sees as
 * "today" on the machine running the export.
 *
 * Req 2.2
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function studentExportFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `students-export-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.xlsx`;
}

/**
 * Side-effecting shell: builds the workbook and hands the file to the
 * browser for download.
 *
 * `XLSX.writeFile` is synchronous, so a hard abort is not possible; the
 * elapsed time is returned instead and the caller treats an over-budget run
 * as a failure. Any error from workbook construction or the download is
 * allowed to propagate so the dialog can report the cause and keep the
 * export retryable.
 *
 * Req 2.2, 2.3, 2.6
 *
 * @param {Array<Record<string, unknown>>} students
 * @param {Date} [date]
 * @param {Array<Record<string, unknown>>} [classes] class rows, so the sheet can
 *   carry each student's day, time, instructor and program
 * @returns {number} elapsed milliseconds
 */
export function downloadStudentExport(students, date = new Date(), classes = []) {
  const started = Date.now();
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(buildStudentExportRows(students, { classes }));
  XLSX.utils.book_append_sheet(workbook, sheet, STUDENT_EXPORT_SHEET_NAME);
  XLSX.writeFile(workbook, studentExportFileName(date));
  return Date.now() - started;
}
