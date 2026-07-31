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

/** Fixed column order of the export sheet. Req 2.3 */
export const STUDENT_EXPORT_HEADERS = [
  'ID',
  'Name',
  'Level',
  'Branch',
  'Parent Name',
  'Contact',
  'Status',
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
export function buildStudentExportRows(students) {
  const rows = Array.isArray(students) ? students : [];
  return [
    [...STUDENT_EXPORT_HEADERS],
    ...rows.map((s) => {
      const r = s || {};
      return [
        cell(r.id),
        cell(r.name),
        cell(r.level),
        cell(r.branchName),
        cell(r.parentName),
        cell(r.contact),
        cell(r.status),
        cell(r.remarks),
      ];
    }),
  ];
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
 * @returns {number} elapsed milliseconds
 */
export function downloadStudentExport(students, date = new Date()) {
  const started = Date.now();
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(buildStudentExportRows(students));
  XLSX.utils.book_append_sheet(workbook, sheet, STUDENT_EXPORT_SHEET_NAME);
  XLSX.writeFile(workbook, studentExportFileName(date));
  return Date.now() - started;
}
