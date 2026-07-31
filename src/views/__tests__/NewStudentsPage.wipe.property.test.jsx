// @vitest-environment jsdom
// This file renders components, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Page-level property tests for the student bulk wipe.
 *
 *   Property 5  — the header exposes the wipe control only to Admin, and only
 *                 usably when the registry holds records.
 *   Property 16 — the four filter values survive a wipe, and the dialog
 *                 discloses the every-record scope exactly when the view is
 *                 narrowed.
 *
 * `NewStudentsPage` sits on top of two contexts, two services and the export
 * module, so all five are replaced here. The replacements are deliberately
 * complete rather than partial: the real `ScheduleContext` pulls in the whole
 * application data layer, and the polling subscription would otherwise fire
 * real 3-second timers underneath the assertions.
 *
 * The expected role is computed in the test from the generated email → role map
 * directly, never through `src/utils/roles.js`, so the property cannot pass by
 * agreeing with the implementation it is checking.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';

/* ------------------------------------------------------------------- mocks */

/** Mutable stand-in for what the two contexts would expose. */
const ctx = vi.hoisted(() => ({
  users: {},
  email: null,
  branchNames: ['Bintaro', 'Kemang'],
}));

const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const getAllInternalStudents = vi.hoisted(() => vi.fn());
const bulkDeleteAllStudents = vi.hoisted(() => vi.fn());
const logActivity = vi.hoisted(() => vi.fn());
const downloadStudentExport = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ScheduleContext', () => ({
  ScheduleProvider: ({ children }) => children,
  useSchedule: () => ({
    enabledBranches: ctx.branchNames.map((name) => ({ name })),
    branches: ctx.branchNames.map((name) => ({ name })),
    users: ctx.users,
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: ctx.email ? { email: ctx.email } : null }),
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
  STUDENT_EXPORT_HEADERS: ['ID', 'Name', 'Level', 'Branch', 'Parent Name', 'Contact', 'Status', 'Remarks'],
  buildStudentExportRows: () => [],
  studentExportFileName: () => 'students-export-2026-01-01.xlsx',
  downloadStudentExport,
}));

// Imported after the mock declarations; `vi.mock` is hoisted above both.
const { default: NewStudentsPage } = await import('@/views/NewStudentsPage');
const { WIPE_CONFIRMATION_PHRASE } = await import('@/lib/wipeConfirmation');

/* ----------------------------------------------------------------- helpers */

const LEVELS = ['Kinder Core', 'Junior Core', 'Coder Advance'];
const STATUSES = ['Active', 'Inactive'];

/** A registry of `n` rows, spread across the branches, levels and statuses. */
function makeStudents(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Student ${String.fromCharCode(65 + (i % 26))}${i}`,
    level: LEVELS[i % LEVELS.length],
    branchName: ctx.branchNames[i % ctx.branchNames.length],
    parentName: `Parent ${i}`,
    contact: `08${1000000 + i}`,
    status: STATUSES[i % STATUSES.length],
    remarks: '',
  }));
}

/** Mount the page with the given registry already delivered by the poll. */
function mountPage(students) {
  subscribeToInternalStudents.mockImplementation((callback) => {
    callback(students);
    return () => {};
  });
  return render(<NewStudentsPage />);
}

const addStudentButton = () => screen.getByRole('button', { name: /add student/i });
const wipeControls = () => screen.queryAllByRole('button', { name: /delete all student records/i });
const searchInput = () => screen.getByPlaceholderText(/search name, contact/i);
/** Level, Branch, Status — in the toolbar's DOM order. */
const filterSelects = () => screen.getAllByRole('combobox');

beforeEach(() => {
  ctx.users = {};
  ctx.email = null;
  showToast.mockReset();
  logActivity.mockReset().mockResolvedValue({ id: 1 });
  getAllInternalStudents.mockReset().mockResolvedValue([]);
  bulkDeleteAllStudents.mockReset();
  downloadStudentExport.mockReset().mockReturnValue(5);
});

/* ------------------------------------------------------- Property 5 inputs */

const EMAIL_POOL = ['admin@lab.id', 'teacher@lab.id', 'ops@lab.id'];
// `admin` in lower case is a recorded role that is *not* the Admin role, which
// keeps the comparison honest about letter case.
const ROLE_POOL = ['Admin', 'Instructor', 'Supervisor', 'Ops', 'admin', ''];

/** email → role maps over the pool, with any subset of the emails recorded. */
const roleMap = fc
  .tuple(...EMAIL_POOL.map(() => fc.option(fc.constantFrom(...ROLE_POOL), { nil: undefined })))
  .map((roles) => {
    const map = {};
    EMAIL_POOL.forEach((email, i) => {
      if (roles[i] !== undefined) map[email] = roles[i];
    });
    return map;
  });

/** No user, a user absent from the map, and users whose case differs. */
const signedInEmail = fc.oneof(
  { arbitrary: fc.constantFrom(null, undefined, ''), weight: 2 },
  { arbitrary: fc.constant('ghost@lab.id'), weight: 2 },
  { arbitrary: fc.constantFrom(...EMAIL_POOL), weight: 6 },
  { arbitrary: fc.constantFrom(...EMAIL_POOL.map((e) => e.toUpperCase())), weight: 3 },
  { arbitrary: fc.constantFrom('Admin@Lab.id', 'Teacher@LAB.ID'), weight: 3 },
);

/** The same maps, but with `admin@lab.id` certain to be recorded as Admin. */
const adminRoleMap = roleMap.map((map) => ({ ...map, 'admin@lab.id': 'Admin' }));

/** `admin@lab.id` in the letter cases a sign-in could present it in. */
const adminSignIn = fc.constantFrom('admin@lab.id', 'ADMIN@LAB.ID', 'Admin@Lab.id');

/**
 * A (users map, signed-in email) pair.
 *
 * The cases the coverage counters require are drawn as explicit weighted
 * branches rather than left to the chance that a freely generated map happens
 * to record `Admin` for a freely generated email — that coincidence lands on
 * roughly 4% of examples, which at the reduced example count used in this file
 * (see the `numRuns` note below) leaves the Admin branch unvisited about half
 * the time. The property still resolves the expected role from the generated
 * map alone, so weighting the draw cannot make it agree with the
 * implementation it checks.
 */
const session = fc.oneof(
  // An email the map records as Admin, in any letter case.
  { arbitrary: fc.tuple(adminRoleMap, adminSignIn), weight: 5 },
  // No signed-in user at all.
  { arbitrary: fc.tuple(roleMap, fc.constantFrom(null, undefined, '')), weight: 4 },
  // A signed-in email the map does not record at all.
  { arbitrary: fc.tuple(roleMap, fc.constant('ghost@lab.id')), weight: 4 },
  // Any pool email in any case, recorded with any role or with none.
  { arbitrary: fc.tuple(roleMap, signedInEmail), weight: 3 },
);

/**
 * How many rows the registry holds. Zero is its own branch so the
 * already-empty case (Req 7.8) is reached within the reduced example count.
 */
const registrySize = fc.oneof(
  { arbitrary: fc.constant(0), weight: 1 },
  { arbitrary: fc.integer({ min: 1, max: 4 }), weight: 1 },
);

describe('NewStudentsPage wipe control gating', () => {
  // Feature: student-data-bulk-wipe, Property 5: The header exposes the wipe control only to Admin, and only usably when records exist
  it('renders the wipe control only for Admin, always renders Add Student, and disables the control on an empty registry', async () => {
    // Coverage counters, checked after the run so no branch passes vacuously.
    const seen = { admin: 0, nonAdmin: 0, noEmail: 0, unknownEmail: 0, caseDiffers: 0, empty: 0, nonEmpty: 0 };

    await fc.assert(
      fc.asyncProperty(session, registrySize, async ([users, email], size) => {
        ctx.users = users;
        ctx.email = email || null;

        // Expected role, resolved here from the generated map alone: no email or
        // an unrecorded email resolves to something other than Admin. Req 1.3
        const recordedRole = email ? users[String(email).toLowerCase()] : undefined;
        const expectAdmin = recordedRole === 'Admin';

        if (!email) seen.noEmail += 1;
        else if (recordedRole === undefined) seen.unknownEmail += 1;
        if (email && email !== String(email).toLowerCase()) seen.caseDiffers += 1;
        expectAdmin ? (seen.admin += 1) : (seen.nonAdmin += 1);
        size === 0 ? (seen.empty += 1) : (seen.nonEmpty += 1);

        try {
          mountPage(makeStudents(size));

          // Add Student is present for every role. Req 1.1, 1.2, 1.3
          expect(addStudentButton()).toBeInTheDocument();

          const controls = wipeControls();

          // Present in the DOM if and only if the resolved role is Admin —
          // absent, not hidden and not merely disabled. Req 1.1, 1.2, 1.3
          expect(controls).toHaveLength(expectAdmin ? 1 : 0);

          if (expectAdmin) {
            // Disabled exactly when the registry holds zero records. Req 7.8
            expect(controls[0].disabled).toBe(size === 0);
            expect(controls[0]).toHaveAttribute(
              'title',
              size === 0
                ? 'The student list is already empty'
                : 'Delete all student records — cannot be undone',
            );
          }
        } finally {
          cleanup();
        }
      }),
      {
        // Fewer runs than the pure-function properties in `src/lib/__tests__`:
        // every example mounts the whole page in jsdom, so an example here costs
        // orders of magnitude more than a pure call. Lowered from 20 to 10
        // deliberately — this file is the slowest in the suite and the run is
        // dominated by it, not by the pure properties.
        numRuns: 10,
        // Coverage, not convenience. `examples` are run first and count toward
        // `numRuns`, so these three pin every case the counters below require
        // (Admin / non-Admin, missing email, unrecorded email, differing letter
        // case, empty / non-empty registry) into the smaller budget instead of
        // leaving them to a weighted draw that misses one roughly one run in
        // six. The remaining seven examples are still generated.
        examples: [
          // Admin, presented in a differing letter case, over a non-empty registry.
          [[{ 'admin@lab.id': 'Admin', 'teacher@lab.id': 'Instructor' }, 'Admin@Lab.id'], 3],
          // No signed-in user at all, over an already-empty registry.
          [[{ 'admin@lab.id': 'Admin' }, null], 0],
          // A signed-in email the map does not record.
          [[{ 'teacher@lab.id': 'Instructor' }, 'ghost@lab.id'], 2],
        ],
      },
    );

    expect(seen.admin).toBeGreaterThan(0);
    expect(seen.nonAdmin).toBeGreaterThan(0);
    expect(seen.noEmail).toBeGreaterThan(0);
    expect(seen.unknownEmail).toBeGreaterThan(0);
    expect(seen.caseDiffers).toBeGreaterThan(0);
    expect(seen.empty).toBeGreaterThan(0);
    expect(seen.nonEmpty).toBeGreaterThan(0);
  }, 180000);
});

/* ------------------------------------------------------ Property 16 inputs */

const searchText = fc.constantFrom('', 'stu', 'zzz', 'Parent 1');
const levelFilter = fc.constantFrom('all', ...LEVELS);
const branchFilter = fc.constantFrom('all', 'Bintaro', 'Kemang');
const statusFilter = fc.constantFrom('all', 'Active', 'Inactive');

/**
 * The four controls together. The all-defaults combination is drawn explicitly
 * because it is one of 144 crossings and the property has to exercise both
 * sides of the disclosure — a narrowed view and an unnarrowed one.
 */
const filterCombination = fc.oneof(
  {
    arbitrary: fc.constant({ search: '', level: 'all', branch: 'all', status: 'all' }),
    // Carries more weight than the 1-in-5 it had at 100 examples: at the
    // reduced example count used in this file it is the only reliable source
    // of the unnarrowed side of the disclosure.
    weight: 2,
  },
  {
    arbitrary: fc.record({
      search: searchText,
      level: levelFilter,
      branch: branchFilter,
      status: statusFilter,
    }),
    weight: 3,
  },
);

const dialog = () => screen.getByRole('dialog');
const disclosure = () =>
  within(dialog()).queryByText(/wipe covers every student record in the database/i);

describe('NewStudentsPage wipe and filters', () => {
  // Feature: student-data-bulk-wipe, Property 16: Filters survive a wipe, and a narrowed view is disclosed
  it('leaves the four filter values untouched across a successful wipe and discloses the every-record scope exactly when narrowed', async () => {
    const seen = { filtered: 0, unfiltered: 0 };

    await fc.assert(
      fc.asyncProperty(
        filterCombination,
        async ({ search, level, branch, status }) => {
          const user = userEvent.setup({ delay: null });
          ctx.users = { 'admin@lab.id': 'Admin' };
          ctx.email = 'admin@lab.id';
          bulkDeleteAllStudents.mockResolvedValue({
            deletedStudents: 3,
            deletedHistory: 2,
            deletedProgress: 1,
          });
          getAllInternalStudents.mockResolvedValue([]);

          // At least one of the four off its unfiltered default narrows the view.
          const filtersActive =
            search !== '' || level !== 'all' || branch !== 'all' || status !== 'all';
          filtersActive ? (seen.filtered += 1) : (seen.unfiltered += 1);

          try {
            mountPage(makeStudents(3));

            if (search !== '') {
              await user.click(searchInput());
              await user.paste(search);
            }
            const [levelSelect, branchSelect, statusSelect] = filterSelects();
            if (level !== 'all') await user.selectOptions(levelSelect, level);
            if (branch !== 'all') await user.selectOptions(branchSelect, branch);
            if (status !== 'all') await user.selectOptions(statusSelect, status);

            // The values the four controls hold when the wipe control is used.
            expect(searchInput().value).toBe(search);
            expect(levelSelect.value).toBe(level);
            expect(branchSelect.value).toBe(branch);
            expect(statusSelect.value).toBe(status);

            await user.click(wipeControls()[0]);

            // The every-record disclosure appears exactly when narrowed. Req 3.9
            if (filtersActive) {
              expect(disclosure()).toBeInTheDocument();
            } else {
              expect(disclosure()).toBeNull();
            }

            // Drive the dialog to a successful wipe: export, phrase, confirm.
            await user.click(within(dialog()).getByRole('button', { name: /export student list/i }));
            const confirmField = within(dialog()).getByPlaceholderText(WIPE_CONFIRMATION_PHRASE);
            await user.click(confirmField);
            await user.paste(WIPE_CONFIRMATION_PHRASE);
            await user.click(within(dialog()).getByRole('button', { name: /delete all students/i }));

            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
            expect(bulkDeleteAllStudents).toHaveBeenCalledWith(WIPE_CONFIRMATION_PHRASE);

            // The four values are unchanged by the wipe. Req 9.4
            const [levelAfter, branchAfter, statusAfter] = filterSelects();
            expect(searchInput().value).toBe(search);
            expect(levelAfter.value).toBe(level);
            expect(branchAfter.value).toBe(branch);
            expect(statusAfter.value).toBe(status);
          } finally {
            cleanup();
          }
        },
      ),
      {
        // Fewer runs than the pure-function properties in `src/lib/__tests__`:
        // every example mounts the whole page, sets up to four filters and
        // drives a full wipe through real user interactions, so examples here
        // cost orders of magnitude more than a pure call. Lowered from 20 to 10
        // because this file dominates the suite's wall time.
        numRuns: 10,
        // Run first and counted toward `numRuns`: these two pin both sides of
        // the disclosure (a narrowed view and an unnarrowed one) so the
        // counters below cannot go unvisited at the smaller run count. The
        // other eight examples are still generated.
        examples: [
          [{ search: '', level: 'all', branch: 'all', status: 'all' }],
          [{ search: 'stu', level: 'all', branch: 'all', status: 'all' }],
        ],
      },
    );

    expect(seen.filtered).toBeGreaterThan(0);
    expect(seen.unfiltered).toBeGreaterThan(0);
  }, 300000);
});
