// @vitest-environment jsdom
// This file renders a page, so it opts in to a DOM. The suite default is `node`
// (vitest.config.mjs) because building jsdom per file is the single largest
// fixed cost in the run.
/**
 * Unit tests for the Students_Page → Report_Cards_Page navigation path.
 *
 * Req 6.3 — each student row's actions cell carries a third control whose
 *           accessible name identifies it as that row's student's report card.
 * Req 6.4 — activating that control requests navigation to `report-cards`
 *           carrying that student's identifier and name.
 *
 * Every control is reached through its role and accessible name, never through
 * DOM internals or a positional query, and the registry always holds more than
 * one student so a test cannot pass by activating the wrong row's control.
 *
 * `NewStudentsPage` sits on top of two contexts, two services and the export
 * module, so all five are replaced — the real `ScheduleContext` pulls in the
 * whole data layer and the polling subscription would otherwise fire real
 * 3-second timers underneath the assertions. No request leaves the process.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
// Unmounting between tests is handled globally by vitest.setup.js.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* ------------------------------------------------------------------- mocks */

const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const getAllInternalStudents = vi.hoisted(() => vi.fn());
const bulkDeleteAllStudents = vi.hoisted(() => vi.fn());
const logActivity = vi.hoisted(() => vi.fn());
const downloadStudentExport = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ScheduleContext', () => ({
  ScheduleProvider: ({ children }) => children,
  useSchedule: () => ({
    enabledBranches: [{ name: 'Bintaro' }, { name: 'Kemang' }],
    branches: [{ name: 'Bintaro' }, { name: 'Kemang' }],
    users: {},
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: { email: 'teacher@lab.id' } }),
}));

vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }) => children,
  useToast: () => ({ showToast, dismissToast: () => {} }),
}));

vi.mock('@/services/internalStudentService', async (importOriginal) => ({
  ...(await importOriginal()),
  subscribeToInternalStudents,
  getAllInternalStudents,
  bulkDeleteAllStudents,
}));

vi.mock('@/services/newActivityService', () => ({
  logActivity,
  getActivity: vi.fn(async () => []),
  subscribeToActivity: vi.fn(() => () => {}),
  deleteActivity: vi.fn(async () => ({})),
  displayUser: (email) => (email ? String(email).split('@')[0] : 'Unknown user'),
}));

vi.mock('@/lib/studentExport', () => ({
  STUDENT_EXPORT_HEADERS: [
    'ID', 'Name', 'Level', 'Branch', 'Parent Name', 'Contact', 'Status',
    'Day', 'Time', 'Instructor', 'Program', 'Remarks',
  ],
  buildStudentExportRows: () => [],
  studentExportFileName: () => 'students-export-2026-01-01.xlsx',
  downloadStudentExport,
}));

// Imported after the mock declarations; `vi.mock` is hoisted above both.
const { default: NewStudentsPage } = await import('@/views/NewStudentsPage');

/* ----------------------------------------------------------------- helpers */

/**
 * Three rows, deliberately fewer than `STUDENTS_PAGE_SIZE` (5) so all three are
 * on the first page. The names differ from each other and one carries an
 * apostrophe, so an accessible name built from the wrong row is visible.
 */
const STUDENTS = [
  {
    id: 7,
    name: 'Alya Rahman',
    level: 'Kinder Core',
    branchName: 'Bintaro',
    parentName: 'Parent A',
    contact: '0811000001',
    status: 'Active',
    remarks: '',
  },
  {
    id: 42,
    name: "Ben O'Hara",
    level: 'Junior Core',
    branchName: 'Kemang',
    parentName: 'Parent B',
    contact: '0811000002',
    status: 'Active',
    remarks: '',
  },
  {
    id: 108,
    name: 'Citra Wulandari',
    level: 'Coder Advance',
    branchName: 'Bintaro',
    parentName: 'Parent C',
    contact: '0811000003',
    status: 'Inactive',
    remarks: '',
  },
];

/** Mount the page with the registry already delivered by the poll. */
function mountPage(onNavigate) {
  subscribeToInternalStudents.mockImplementation((callback) => {
    callback(STUDENTS);
    return () => {};
  });
  return render(<NewStudentsPage onNavigate={onNavigate} />);
}

/** That student's report control, found by role and accessible name only. */
const reportControl = (name) => screen.getByRole('button', { name: `Report card for ${name}` });

beforeEach(() => {
  showToast.mockReset();
  logActivity.mockReset().mockResolvedValue({ id: 1 });
  getAllInternalStudents.mockReset().mockResolvedValue([]);
  bulkDeleteAllStudents.mockReset();
  downloadStudentExport.mockReset().mockReturnValue(0);
  subscribeToInternalStudents.mockReset();
});

/* ------------------------------------------------------------------- tests */

describe('NewStudentsPage report card navigation', () => {
  it('exposes one report control per row, each accessibly named for that row’s student', () => {
    mountPage(vi.fn());

    // One per row, and each is reachable by its own accessible name. Req 6.3
    for (const st of STUDENTS) {
      expect(reportControl(st.name)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /^Report card for / })).toHaveLength(STUDENTS.length);
  });

  it('places the report control in the same actions cell as that row’s edit and delete controls', () => {
    mountPage(vi.fn());

    // The row is located by its student name, then the three controls are found
    // inside it — so the third control sits alongside edit and delete rather
    // than anywhere on the page. Req 6.3
    const row = reportControl(STUDENTS[1].name).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row).getByRole('button', { name: /edit student/i })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /delete student/i })).toBeInTheDocument();
    expect(within(row).getByText(STUDENTS[1].name)).toBeInTheDocument();
  });

  it.each(STUDENTS.map((st) => [st.name, st]))(
    'requests navigation exactly once for %s, carrying that row’s id and name',
    async (_name, st) => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      mountPage(onNavigate);

      await user.click(reportControl(st.name));

      // Exactly one navigation request, for this row's student. Req 6.4
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith('report-cards', {
        studentId: st.id,
        studentName: st.name,
      });
    },
  );

  it('requests navigation from the keyboard, so the control is reachable without a pointer', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    mountPage(onNavigate);

    // Enter on the focused control. Req 6.3, 6.4
    reportControl(STUDENTS[0].name).focus();
    expect(reportControl(STUDENTS[0].name)).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('report-cards', {
      studentId: STUDENTS[0].id,
      studentName: STUDENTS[0].name,
    });

    // Space on a different row's control: the second request carries that row.
    onNavigate.mockClear();
    reportControl(STUDENTS[2].name).focus();
    await user.keyboard(' ');

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('report-cards', {
      studentId: STUDENTS[2].id,
      studentName: STUDENTS[2].name,
    });
  });

  it('stays inert when the page is rendered without a navigation handler', async () => {
    const user = userEvent.setup();
    mountPage(undefined);

    // The control is still exposed and activating it must not throw. Req 6.4
    await expect(user.click(reportControl(STUDENTS[0].name))).resolves.toBeUndefined();
    expect(reportControl(STUDENTS[0].name)).toBeInTheDocument();
  });
});
