/**
 * Export performance check for the mandatory student export.
 *
 * Requirement 2.2 bounds the export at 10 seconds for a registry holding up to
 * 10,000 records. This is one example-based test, not a property: the cost is a
 * function of registry size, so a single worst-case size is the whole check.
 *
 * `XLSX.writeFile` is replaced with a no-op so nothing is written to disk, while
 * `XLSX.utils` stays real — `aoa_to_sheet` and `book_append_sheet` are where the
 * per-cell work happens, and stubbing them would measure nothing. The remaining
 * unmeasured cost is the file serialisation inside `writeFile`, which is noted
 * below rather than silently ignored.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the real `utils` so sheet construction cost is genuinely measured;
// replace only the disk write.
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...(actual.default || actual), writeFile: (...args) => writeFileSpy(...args) },
    writeFile: (...args) => writeFileSpy(...args),
  };
});

let writeFileSpy;

const {
  STUDENT_EXPORT_HEADERS,
  buildStudentExportRows,
  downloadStudentExport,
  studentExportFileName,
} = await import('@/lib/studentExport');

/** Requirement 2.2's upper bound, in milliseconds. */
const EXPORT_BUDGET_MS = 10_000;
const RECORD_COUNT = 10_000;

const BRANCHES = ['Bintaro', 'Kelapa Gading', 'Pantai Indah Kapuk', 'Alam Sutera', 'Cibubur'];
const LEVELS = ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Pre-School', 'Advanced 2'];
const STATUSES = ['Active', 'Inactive', 'On Hold', 'Graduated'];

/**
 * Records sized like the real thing: full names, parent names, phone numbers and
 * a sentence of remarks. An unrealistically small record would understate the
 * per-cell cost and make the budget look safer than it is.
 */
function buildStudentRegistry(count) {
  const students = new Array(count);
  for (let i = 0; i < count; i += 1) {
    students[i] = {
      id: 100000 + i,
      name: `Student Firstname ${i} Middlename Lastname-${i % 97}`,
      level: LEVELS[i % LEVELS.length],
      branchName: BRANCHES[i % BRANCHES.length],
      parentName: `Parent Firstname ${i} Lastname-${i % 89}`,
      contact: `+62 81${String(200000000 + i).slice(0, 9)}`,
      status: STATUSES[i % STATUSES.length],
      remarks:
        i % 4 === 0
          ? ''
          : `Moved from ${BRANCHES[(i + 1) % BRANCHES.length]} in term ${(i % 3) + 1}; `
            + 'parent prefers afternoon slots and asked for a make-up class after the holiday break.',
    };
  }
  return students;
}

describe('student export performance', () => {
  beforeEach(() => {
    writeFileSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'builds rows and constructs the sheet for 10,000 records within 10 seconds',
    () => {
      const students = buildStudentRegistry(RECORD_COUNT);
      expect(students).toHaveLength(RECORD_COUNT);

      const started = performance.now();
      const reportedMs = downloadStudentExport(students, new Date(2026, 4, 4));
      const elapsedMs = performance.now() - started;

      // Diagnosable on a future regression: the number, not just pass/fail.
      // eslint-disable-next-line no-console
      console.log(
        `[perf] student export of ${RECORD_COUNT} records: `
        + `${elapsedMs.toFixed(0)} ms measured, ${reportedMs} ms reported `
        + `(budget ${EXPORT_BUDGET_MS} ms)`,
      );

      expect(elapsedMs).toBeLessThan(EXPORT_BUDGET_MS);
      expect(reportedMs).toBeLessThan(EXPORT_BUDGET_MS);

      // The measured run has to be a real export, not a short-circuited one.
      expect(writeFileSpy).toHaveBeenCalledTimes(1);
      const [workbook, fileName] = writeFileSpy.mock.calls[0];
      expect(fileName).toBe(studentExportFileName(new Date(2026, 4, 4)));
      expect(workbook.SheetNames).toEqual(['Students']);
      // Header row plus one row per record, so the whole registry was built.
      const rows = buildStudentExportRows(students);
      expect(rows).toHaveLength(RECORD_COUNT + 1);
      expect(rows[0]).toEqual([...STUDENT_EXPORT_HEADERS]);
      // Last data cell survived into the constructed sheet.
      const sheet = workbook.Sheets.Students;
      expect(sheet[`B${RECORD_COUNT + 1}`].v).toBe(students[RECORD_COUNT - 1].name);
    },
    // Well above the 10-second budget so a slow-but-over-budget run reports its
    // real elapsed time instead of dying on the default vitest timeout.
    60_000,
  );
});
