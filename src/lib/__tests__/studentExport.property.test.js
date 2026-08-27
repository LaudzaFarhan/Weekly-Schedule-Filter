/**
 * Property tests for the pure parts of the mandatory student export.
 *
 * Only `buildStudentExportRows` and `studentExportFileName` are exercised;
 * `downloadStudentExport` writes a real file and is out of scope here.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  STUDENT_EXPORT_HEADERS,
  buildStudentExportRows,
  studentExportFileName,
} from '@/lib/studentExport';

/** The student-record fields, in the order the sheet's columns take them. */
const FIELDS = ['id', 'name', 'level', 'branchName', 'parentName', 'contact', 'status', 'remarks'];

/**
 * Day, Time, Instructor and Program sit between Status and Remarks. They come
 * from the student's class row rather than the student record, so with no
 * classes supplied — as in every case generated here — they are blank.
 */
const SCHEDULE_HEADERS = ['Day', 'Time', 'Instructor', 'Program'];
const EXPECTED_HEADERS = [
  'ID', 'Name', 'Level', 'Branch', 'Parent Name', 'Contact', 'Status',
  ...SCHEDULE_HEADERS,
  'Remarks',
];

/** Which header each student field is written under. */
const FIELD_HEADERS = {
  id: 'ID',
  name: 'Name',
  level: 'Level',
  branchName: 'Branch',
  parentName: 'Parent Name',
  contact: 'Contact',
  status: 'Status',
  remarks: 'Remarks',
};

/**
 * One field value: present-and-ordinary, empty, null, very long, non-ASCII, or
 * numeric. Absence of the key itself is generated separately by `requiredKeys: []`.
 */
const fieldValue = fc.oneof(
  { arbitrary: fc.string(), weight: 4 },
  { arbitrary: fc.constant(''), weight: 2 },
  { arbitrary: fc.constant(null), weight: 2 },
  { arbitrary: fc.constant(undefined), weight: 1 },
  { arbitrary: fc.string({ minLength: 500, maxLength: 2000 }), weight: 1 },
  { arbitrary: fc.constantFrom('日本語のテスト', 'Zoë Müller — remarks', 'Ω≈ç√∫˜µ', 'Иванов'), weight: 2 },
  { arbitrary: fc.integer(), weight: 1 },
);

/** A registry record whose keys may each be absent. */
const studentRecord = fc.record(
  Object.fromEntries(FIELDS.map((f) => [f, fieldValue])),
  { requiredKeys: [] },
);

/** Registries, with the empty registry drawn often enough to matter. */
const studentRegistry = fc.oneof(
  { arbitrary: fc.constant([]), weight: 1 },
  { arbitrary: fc.array(studentRecord, { maxLength: 25 }), weight: 6 },
);

/** Values the page's search box and three filter selects can hold. */
const filterValue = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constantFrom('All', 'all', 'Active', 'Inactive', 'Level 3', 'Bintaro'),
  fc.string(),
);

const expectedCell = (value) => (value === null || value === undefined ? '' : String(value));

describe('studentExport pure functions', () => {
  // Feature: student-data-bulk-wipe, Property 2: The export sheet reproduces the whole registry in the fixed column order
  it('reproduces the whole registry in the fixed column order, unchanged by any filter arguments', () => {
    fc.assert(
      fc.property(
        studentRegistry,
        filterValue,
        filterValue,
        filterValue,
        filterValue,
        (students, search, level, branch, status) => {
          const rows = buildStudentExportRows(students);

          // Header row, exactly, and not an alias of the exported constant.
          expect(rows[0]).toEqual(EXPECTED_HEADERS);
          expect(rows[0]).toEqual([...STUDENT_EXPORT_HEADERS]);
          expect(rows[0]).not.toBe(STUDENT_EXPORT_HEADERS);

          // Exactly one row per record, in registry order.
          expect(rows).toHaveLength(students.length + 1);

          students.forEach((record, index) => {
            const row = rows[index + 1];
            expect(row).toHaveLength(EXPECTED_HEADERS.length);
            // Each student field lands in the column its header occupies, which
            // is no longer the field's own position now that the schedule
            // columns sit between Status and Remarks.
            FIELDS.forEach((field) => {
              const column = EXPECTED_HEADERS.indexOf(FIELD_HEADERS[field]);
              const expected = expectedCell(record[field]);
              // Value present as a string, '' for absent, and not shortened.
              expect(row[column]).toBe(expected);
              expect(typeof row[column]).toBe('string');
              expect(row[column].length).toBe(expected.length);
            });
            // No classes were supplied, so nothing is invented for the schedule.
            SCHEDULE_HEADERS.forEach((header) => {
              expect(row[EXPECTED_HEADERS.indexOf(header)]).toBe('');
            });
          });

          // No filter argument combination can narrow or reorder the output.
          expect(buildStudentExportRows(students, search, level, branch, status)).toEqual(rows);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: student-data-bulk-wipe, Property 3: The export file name carries the fixed prefix and the export date
  it('names the file with the fixed prefix and the export date', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date(Date.UTC(1900, 0, 2)),
          max: new Date(Date.UTC(2200, 0, 1)),
          noInvalidDate: true,
        }),
        (date) => {
          const name = studentExportFileName(date);
          const match = /^students-export-(\d{4})-(\d{2})-(\d{2})\.xlsx$/.exec(name);
          expect(match).not.toBeNull();

          // Local components, matching what the export function reads.
          const pad = (n) => String(n).padStart(2, '0');
          expect(match[1]).toBe(String(date.getFullYear()));
          expect(match[2]).toBe(pad(date.getMonth() + 1));
          expect(match[3]).toBe(pad(date.getDate()));
        },
      ),
      { numRuns: 100 },
    );
  });
});
