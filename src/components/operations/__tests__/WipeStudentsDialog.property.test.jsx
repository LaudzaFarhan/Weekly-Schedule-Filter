/**
 * Property test for the wipe dialog's enablement gates.
 *
 * The dialog is driven through the DOM exactly as a user would drive it: the
 * confirmation input cannot be filled before the export completes, so the text
 * is set by completing the export first and the pre-export disabled state is
 * asserted separately.
 *
 * `src/lib/studentExport.js` is mocked so no spreadsheet is ever written, and so
 * a success, a throw and an over-budget elapsed time can all be simulated.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';

import { matchesConfirmationPhrase, WIPE_CONFIRMATION_PHRASE } from '@/lib/wipeConfirmation';

const downloadStudentExport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/studentExport', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadStudentExport,
}));

// Imported after the mock declaration; `vi.mock` is hoisted above both.
const { default: WipeStudentsDialog, EXPORT_TIME_BUDGET_MS } = await import(
  '@/components/operations/WipeStudentsDialog'
);

/* ------------------------------------------------------------------ queries */

const exportButton = () => screen.getByRole('button', { name: /export student list/i });
const confirmInput = () => screen.getByRole('textbox');
const wipeButton = () => screen.getByRole('button', { name: /delete all students|deleting/i });
const cancelButton = () => screen.getByRole('button', { name: /^cancel$/i });

/* -------------------------------------------------------------- generators */

/** Whitespace runs used to pad the phrase — the empty run keeps it unpadded. */
const whitespace = fc.constantFrom('', ' ', '  ', '\t', ' \t ');

/** `DELETE ALL STUDENTS` with arbitrary leading and trailing whitespace. */
const paddedPhrase = fc
  .tuple(whitespace, whitespace)
  .map(([before, after]) => `${before}${WIPE_CONFIRMATION_PHRASE}${after}`);

const caseVariant = fc.constantFrom(
  'delete all students',
  'Delete All Students',
  'DELETE ALL STUDENTs',
  'dELETE ALL STUDENTS',
  'DeLeTe AlL sTuDeNtS',
);

const nearMiss = fc.constantFrom(
  'DELETE ALL STUDENT',
  'DELETE ALL STUDENTS.',
  'DELETE ALL STUDENTS!',
  'DELETEALLSTUDENTS',
  'DELETE  ALL STUDENTS',
  'DELETE ALL  STUDENTS',
  'D ELETE ALL STUDENTS',
  'DELETE ALL STUDENTS DELETE ALL STUDENTS',
  'ELETE ALL STUDENTS',
);

/**
 * Text the user may end up with in the confirmation input.
 *
 * The matching branch carries about half the weight. The armed state is only
 * reached when a matching phrase meets a completed export, and with the
 * reduced example count in this file (see the `numRuns` notes below) an
 * unweighted draw would leave the armed coverage counter at zero too often.
 */
const confirmationText = fc.oneof(
  { arbitrary: paddedPhrase, weight: 9 },
  { arbitrary: caseVariant, weight: 2 },
  { arbitrary: nearMiss, weight: 3 },
  { arbitrary: fc.constant(''), weight: 1 },
  { arbitrary: fc.string({ maxLength: 40 }), weight: 2 },
);

/**
 * Whether the export ran, and how it ended. The success branch is weighted up
 * for the same reason as `confirmationText`: it is the only branch that can
 * reach the armed and running states the coverage counters require.
 */
const exportPlan = fc.oneof(
  { arbitrary: fc.constant({ run: false, outcome: 'none', elapsedMs: 0 }), weight: 2 },
  {
    arbitrary: fc
      .integer({ min: 0, max: EXPORT_TIME_BUDGET_MS })
      .map((elapsedMs) => ({ run: true, outcome: 'success', elapsedMs })),
    weight: 8,
  },
  { arbitrary: fc.constant({ run: true, outcome: 'throw', elapsedMs: 0 }), weight: 2 },
  {
    arbitrary: fc
      .integer({ min: 1, max: 5000 })
      .map((over) => ({ run: true, outcome: 'overBudget', elapsedMs: EXPORT_TIME_BUDGET_MS + over })),
    weight: 2,
  },
);

/* ------------------------------------------------------------------ helpers */

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function applyExportBehaviour(plan) {
  downloadStudentExport.mockReset();
  if (plan.outcome === 'throw') {
    downloadStudentExport.mockImplementation(() => {
      throw new Error('the workbook could not be written');
    });
    return;
  }
  downloadStudentExport.mockReturnValue(plan.elapsedMs);
}

describe('WipeStudentsDialog enablement', () => {
  // Feature: student-data-bulk-wipe, Property 4: The dialog arms only when an export has completed and the phrase matches
  it('enables the input only after a completed export, and the wipe only when armed and idle', async () => {
    // Coverage counters, checked after the run so the iff cannot pass vacuously.
    const seen = { armed: 0, notArmed: 0, exportDone: 0, exportNotDone: 0, running: 0 };

    await fc.assert(
      fc.asyncProperty(
        exportPlan,
        confirmationText,
        fc.integer({ min: 0, max: 5000 }),
        fc.boolean(),
        async (plan, text, studentCount, filtersActive) => {
          const user = userEvent.setup();
          applyExportBehaviour(plan);
          const pending = deferred();
          let confirmCalls = 0;

          try {
            render(
              <WipeStudentsDialog
                studentCount={studentCount}
                filtersActive={filtersActive}
                students={[]}
                onCancel={() => {}}
                onConfirm={() => { confirmCalls += 1; return pending.promise; }}
              />,
            );

            // ---- Before any export: input disabled, wipe disabled. Req 2.7, 2.8
            expect(confirmInput()).toBeDisabled();
            expect(wipeButton()).toBeDisabled();
            expect(exportButton()).toBeEnabled();

            if (plan.run) {
              await user.click(exportButton());
            }

            const exportDone = plan.run && plan.outcome === 'success';
            exportDone ? (seen.exportDone += 1) : (seen.exportNotDone += 1);

            // ---- Input enabled iff an export completed for this session. Req 2.5, 2.8
            if (exportDone) {
              expect(confirmInput()).toBeEnabled();
            } else {
              expect(confirmInput()).toBeDisabled();
              // With no completed export the wipe stays disabled whatever else
              // is true, and the export remains retryable. Req 2.6, 2.7, 2.10
              expect(wipeButton()).toBeDisabled();
              expect(exportButton()).toBeEnabled();
              return;
            }

            // Empty input right after the export: still disarmed.
            expect(wipeButton()).toBeDisabled();

            if (text !== '') {
              await user.click(confirmInput());
              await user.paste(text);
            }

            // The input's own value is the source of truth for the comparison.
            const value = confirmInput().value;
            const armed = matchesConfirmationPhrase(value);
            armed ? (seen.armed += 1) : (seen.notArmed += 1);

            // ---- Wipe enabled iff export done AND phrase matches AND idle. Req 3.5
            expect(wipeButton().disabled).toBe(!armed);

            if (!armed) return;

            // ---- The third conjunct: no wipe in progress. Req 6.6, 6.7
            await user.click(wipeButton());
            seen.running += 1;

            expect(confirmCalls).toBe(1);
            expect(wipeButton()).toBeDisabled();
            expect(cancelButton()).toBeDisabled();
            expect(confirmInput()).toBeDisabled();
            expect(screen.getByRole('status')).toBeInTheDocument();

            // A repeat activation while running issues no second request.
            await user.click(wipeButton());
            expect(confirmCalls).toBe(1);

            // Failure returns the dialog to the armed state with the typed text
            // and the completed-export state intact. Req 6.4
            pending.reject(new Error('the wipe failed'));
            await waitFor(() => expect(wipeButton()).toBeEnabled());
            expect(confirmInput()).toBeEnabled();
            expect(confirmInput().value).toBe(value);

            // Clearing the text disarms it again — the other direction of the iff.
            await user.clear(confirmInput());
            expect(wipeButton()).toBeDisabled();
          } finally {
            cleanup();
          }
        },
      ),
      // Fewer runs than the pure-function properties in `src/lib/__tests__`:
      // every example here mounts the dialog in jsdom and drives it with real
      // user-event interactions, so a run costs ~100x a pure call. The
      // generators below are weighted so the states the coverage counters
      // require are still reached within this many examples.
      { numRuns: 20 },
    );

    expect(seen.exportDone).toBeGreaterThan(0);
    expect(seen.exportNotDone).toBeGreaterThan(0);
    expect(seen.armed).toBeGreaterThan(0);
    expect(seen.notArmed).toBeGreaterThan(0);
    expect(seen.running).toBeGreaterThan(0);
  }, 60000);
});
/* ------------------------------------------- shared helpers for 13, 14, 15 */

const dialogEl = () => screen.getByRole('dialog');

/** The number the dialog is showing, read back out of the rendered copy. */
function displayedCount() {
  const match = /currently holds\s*(\d+)\s+student\s+records?/.exec(dialogEl().textContent);
  if (!match) throw new Error('the dialog displayed no record count');
  return Number(match[1]);
}

/** One student row — the dialog never derives its count from this array. */
const studentRow = fc.record({
  id: fc.integer({ min: 1, max: 9999 }),
  name: fc.string({ maxLength: 12 }),
  branchName: fc.constantFrom('Bintaro', 'Kemang', 'Pluit'),
});

/**
 * One poll of the registry or one filter change on the page behind the dialog:
 * a new count, a new filter state and a new list, all pushed as fresh props.
 */
const listRefresh = fc.record({
  studentCount: fc.nat({ max: 20000 }),
  filtersActive: fc.boolean(),
  students: fc.array(studentRow, { maxLength: 4 }),
});

describe('WipeStudentsDialog frozen count', () => {
  // Feature: student-data-bulk-wipe, Property 13: The dialog's record count is frozen at open time
  it('shows the count read at open time through every later refresh and filter change', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 20000 }),
        fc.boolean(),
        fc.array(listRefresh, { minLength: 1, maxLength: 6 }),
        async (openCount, openFiltersActive, refreshes) => {
          applyExportBehaviour({ run: false, outcome: 'success', elapsedMs: 0 });

          try {
            const { rerender } = render(
              <WipeStudentsDialog
                studentCount={openCount}
                filtersActive={openFiltersActive}
                students={[]}
                onCancel={() => {}}
                onConfirm={() => Promise.resolve()}
              />,
            );

            // ---- The value read at open time. Req 3.1
            const atOpen = displayedCount();
            expect(atOpen).toBe(openCount);
            expect(Number.isInteger(atOpen)).toBe(true);
            expect(atOpen).toBeGreaterThanOrEqual(0);

            for (const refresh of refreshes) {
              // The page polls every three seconds and its filters can change
              // under an open dialog; both arrive as new props.
              rerender(
                <WipeStudentsDialog
                  studentCount={refresh.studentCount}
                  filtersActive={refresh.filtersActive}
                  students={refresh.students}
                  onCancel={() => {}}
                  onConfirm={() => Promise.resolve()}
                />,
              );

              // ---- Unmoved, whatever the registry or the filters now say.
              // Req 3.1, 3.10, 9.5
              expect(displayedCount()).toBe(atOpen);

              // The disclosure that the wipe is not scoped to this number. Req 9.5
              expect(dialogEl().textContent).toMatch(
                /deletes every student record held at the moment it runs/i,
              );
            }
          } finally {
            cleanup();
          }
        },
      ),
      // Fewer runs than the pure-function properties in `src/lib/__tests__`:
      // each example mounts the dialog in jsdom and rerenders it up to six
      // times, so examples here are orders of magnitude more expensive.
      { numRuns: 20 },
    );
  }, 60000);
});

describe('WipeStudentsDialog cancel and reopen', () => {
  // Feature: student-data-bulk-wipe, Property 14: A cancelled dialog reopens clean
  it('reopens with an empty confirmation input and a disabled wipe after every cancel route', async () => {
    const seen = { control: 0, escape: 0, backdrop: 0, armedBeforeCancel: 0 };

    await fc.assert(
      fc.asyncProperty(
        confirmationText,
        fc.constantFrom('control', 'escape', 'backdrop'),
        fc.nat({ max: 5000 }),
        async (text, route, studentCount) => {
          const user = userEvent.setup();
          applyExportBehaviour({ run: true, outcome: 'success', elapsedMs: 0 });
          let cancels = 0;

          const dialog = (
            <WipeStudentsDialog
              studentCount={studentCount}
              filtersActive={false}
              students={[]}
              onCancel={() => { cancels += 1; }}
              onConfirm={() => Promise.resolve()}
            />
          );

          try {
            const { unmount } = render(dialog);

            // The input only opens after an export, so the export runs first.
            await user.click(exportButton());
            if (text !== '') {
              await user.click(confirmInput());
              await user.paste(text);
            }

            const typed = confirmInput().value;
            const armed = matchesConfirmationPhrase(typed);
            if (armed) seen.armedBeforeCancel += 1;
            expect(wipeButton().disabled).toBe(!armed);

            // ---- One of the three cancel routes. Req 3.7
            if (route === 'control') {
              await user.click(cancelButton());
            } else if (route === 'escape') {
              await user.keyboard('{Escape}');
            } else {
              // A mousedown on the overlay itself, outside the dialog panel.
              await user.click(dialogEl().parentElement);
            }
            seen[route] += 1;
            expect(cancels).toBe(1);

            // The page remounts the dialog per open, so a reopen is a fresh mount.
            unmount();
            render(dialog);

            // ---- Reopened clean. Req 3.8
            expect(confirmInput().value).toBe('');
            expect(confirmInput()).toBeDisabled();
            expect(wipeButton()).toBeDisabled();
            expect(exportButton()).toBeEnabled();
          } finally {
            cleanup();
          }
        },
      ),
      // Fewer runs than the pure-function properties in `src/lib/__tests__`:
      // each example mounts the dialog twice and runs an export plus real
      // typing, so examples here are orders of magnitude more expensive. The
      // cancel route is drawn from `fc.constantFrom` over all three routes so
      // each one is still exercised within this many examples.
      { numRuns: 20 },
    );

    expect(seen.control).toBeGreaterThan(0);
    expect(seen.escape).toBeGreaterThan(0);
    expect(seen.backdrop).toBeGreaterThan(0);
    expect(seen.armedBeforeCancel).toBeGreaterThan(0);
  }, 60000);
});

describe('WipeStudentsDialog focus trap', () => {
  /** The same focusable set the dialog's Tab handler works from. */
  const FOCUSABLE = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  const focusables = (el) => Array.from(el.querySelectorAll(FOCUSABLE));

  // Feature: student-data-bulk-wipe, Property 15: Keyboard focus cannot leave an open dialog
  it('keeps focus on a control inside the dialog and wraps at both ends', async () => {
    const seen = { wrapForward: 0, wrapBackward: 0 };

    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        // At least four Tab presses per example. The dialog exposes three or
        // four focusable controls, so a short sequence can finish without ever
        // standing on either end of the set; with the reduced example count in
        // this file that would leave the two wrap counters at zero.
        fc.array(fc.boolean(), { minLength: 4, maxLength: 8 }),
        fc.nat({ max: 5000 }),
        async (exportFirst, shiftFlags, studentCount) => {
          const user = userEvent.setup();
          applyExportBehaviour({ run: true, outcome: 'success', elapsedMs: 0 });

          try {
            render(
              <>
                {/* Focusable controls outside the dialog: without a trap, Tab
                    would reach these. */}
                <button type="button">page control before</button>
                <WipeStudentsDialog
                  studentCount={studentCount}
                  filtersActive={false}
                  students={[]}
                  onCancel={() => {}}
                  onConfirm={() => Promise.resolve()}
                />
                <button type="button">page control after</button>
              </>,
            );

            // Optionally complete the export, which adds the confirmation input
            // to the dialog's focusable set.
            if (exportFirst) await user.click(exportButton());

            const el = dialogEl();
            expect(el.contains(document.activeElement)).toBe(true);

            for (const shift of shiftFlags) {
              const nodes = focusables(el);
              const from = document.activeElement;
              const index = nodes.indexOf(from);
              expect(index).toBeGreaterThanOrEqual(0);

              await user.tab({ shift });

              const to = document.activeElement;

              // ---- Focus never leaves the dialog. Req 3.12
              expect(el.contains(to)).toBe(true);

              // ---- Last -> first forwards, first -> last backwards, plain
              // DOM order in between. Req 3.12
              const expected = shift
                ? nodes[(index - 1 + nodes.length) % nodes.length]
                : nodes[(index + 1) % nodes.length];
              expect(to).toBe(expected);

              if (!shift && index === nodes.length - 1) seen.wrapForward += 1;
              if (shift && index === 0) seen.wrapBackward += 1;
            }
          } finally {
            cleanup();
          }
        },
      ),
      // Fewer runs than the pure-function properties in `src/lib/__tests__`:
      // each example mounts the dialog and issues up to eight real Tab
      // presses through user-event, so examples here are orders of magnitude
      // more expensive. The Tab sequences are generated long enough to reach
      // both ends of the focusable set within this many examples.
      { numRuns: 20 },
    );

    // Both wrap directions must actually have been exercised.
    expect(seen.wrapForward).toBeGreaterThan(0);
    expect(seen.wrapBackward).toBeGreaterThan(0);
  }, 60000);
});
