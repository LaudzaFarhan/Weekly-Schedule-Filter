// @vitest-environment jsdom
// This file renders components, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Example-based unit tests for the wipe dialog's content and its edge branches.
 *
 * The property test in `WipeStudentsDialog.property.test.jsx` covers the
 * enablement algebra across generated inputs; this file pins the fixed copy the
 * requirements name literally, the export failure branches, and the three cancel
 * routes.
 *
 * `src/lib/studentExport.js` is mocked so no spreadsheet is ever written and so a
 * throw and an over-budget elapsed time can both be simulated.
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WIPE_CONFIRMATION_PHRASE } from '@/lib/wipeConfirmation';

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
const dialog = () => screen.getByRole('dialog');

/** The element the dialog points at with `aria-describedby`. Req 3.2 */
function describedByElement() {
  const id = dialog().getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  const el = document.getElementById(id);
  expect(el).not.toBeNull();
  return el;
}

/* ------------------------------------------------------------------ helpers */

function renderDialog(overrides = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <WipeStudentsDialog
      studentCount={26}
      filtersActive={false}
      students={[{ id: 1, name: 'Ada' }]}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { ...utils, onCancel, onConfirm };
}

/**
 * Replaces the input's value the way a password manager or a script does:
 * through the native setter, with an `input` event dispatched afterwards and no
 * keystrokes at all. Req 3.6
 */
function replaceValueProgrammatically(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  fireEvent(input, new Event('input', { bubbles: true }));
}

beforeEach(() => {
  downloadStudentExport.mockReset();
  downloadStudentExport.mockReturnValue(12);
});

/* ------------------------------------------------------------------- content */

describe('WipeStudentsDialog content', () => {
  it('names the deleted and the kept data sets inside the accessible description', () => {
    renderDialog();
    const description = describedByElement();
    const text = description.textContent;

    // Will be deleted. Req 3.2
    expect(text).toMatch(/student records/i);
    expect(text).toMatch(/branch history/i);
    expect(text).toMatch(/live lesson progress/i);

    // Will be kept. Req 3.2
    expect(text).toMatch(/class schedule/i);
    expect(text).toMatch(/instructors/i);
    expect(text).toMatch(/leave/i);
    expect(text).toMatch(/operational rules/i);
    expect(text).toMatch(/crm leads/i);

    // Both groups are labelled, so the description reads as two lists.
    expect(text).toMatch(/will be deleted/i);
    expect(text).toMatch(/will be kept/i);
  });

  it('states the class-schedule consequence before the user commits', () => {
    renderDialog();

    // Class rows keep their student-name text. Req 3.3
    expect(
      screen.getByText(/class records keep their stored student names/i),
    ).toBeInTheDocument();

    // The Schedule page reads zero unallocated students until a new import. Req 3.3
    expect(
      screen.getByText(/zero unallocated students until a new student list is imported/i),
    ).toBeInTheDocument();
  });

  it('renders the confirmation phrase as literal text to type', () => {
    renderDialog();

    // Req 3.4 — the exact phrase, character for character.
    const phrase = screen.getByText(WIPE_CONFIRMATION_PHRASE, { selector: 'code' });
    expect(phrase).toBeInTheDocument();
    expect(phrase.textContent).toBe('DELETE ALL STUDENTS');
  });

  it('places initial keyboard focus on the export action', () => {
    renderDialog();

    // Not the input, not the wipe button. Req 3.11
    expect(exportButton()).toHaveFocus();
    expect(confirmInput()).not.toHaveFocus();
    expect(wipeButton()).not.toHaveFocus();
  });
});

/* ------------------------------------------------------- export edge branches */

describe('WipeStudentsDialog export failures', () => {
  it('reports the cause when the export throws, and arms nothing', async () => {
    const user = userEvent.setup();
    downloadStudentExport.mockImplementation(() => {
      throw new Error('the workbook could not be written');
    });
    renderDialog();

    await user.click(exportButton());

    // The message identifies the cause. Req 2.6
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/the export failed/i);
    expect(alert).toHaveTextContent(/the workbook could not be written/i);

    // No arming: input and wipe stay disabled. Req 2.6
    expect(confirmInput()).toBeDisabled();
    expect(wipeButton()).toBeDisabled();
    expect(
      screen.getByText(/export must complete before the confirmation phrase can be typed/i),
    ).toBeInTheDocument();
  });

  it('treats an over-budget export as a timeout failure, and arms nothing', async () => {
    const user = userEvent.setup();
    downloadStudentExport.mockReturnValue(EXPORT_TIME_BUDGET_MS + 1500);
    renderDialog();

    await user.click(exportButton());

    // Timeout-flavoured wording naming the budget. Req 2.6
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      new RegExp(`did not finish within ${EXPORT_TIME_BUDGET_MS / 1000} seconds`, 'i'),
    );
    expect(alert).toHaveTextContent(/11\.5 seconds/);

    expect(confirmInput()).toBeDisabled();
    expect(wipeButton()).toBeDisabled();
  });

  it('keeps the export enabled after three consecutive failures', async () => {
    const user = userEvent.setup();
    downloadStudentExport.mockImplementation(() => {
      throw new Error('disk full');
    });
    renderDialog();

    // No attempt cap. Req 2.10
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await user.click(exportButton());
      expect(downloadStudentExport).toHaveBeenCalledTimes(attempt);
      expect(exportButton()).toBeEnabled();
      expect(screen.getByRole('alert')).toHaveTextContent(/disk full/i);
      expect(confirmInput()).toBeDisabled();
    }

    // A fourth attempt that succeeds still arms the dialog. Req 2.5, 2.10
    downloadStudentExport.mockReset();
    downloadStudentExport.mockReturnValue(40);
    await user.click(exportButton());
    expect(confirmInput()).toBeEnabled();
  });
});

/* ------------------------------------------------------ input update branches */

describe('WipeStudentsDialog confirmation input', () => {
  it('re-evaluates enablement on paste', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(exportButton());

    await user.click(confirmInput());
    await user.paste('DELETE ALL STUDENT');
    expect(wipeButton()).toBeDisabled();

    await user.clear(confirmInput());
    await user.paste(`  ${WIPE_CONFIRMATION_PHRASE}  `);

    // Pasted, whitespace-padded, never typed. Req 3.6
    await waitFor(() => expect(wipeButton()).toBeEnabled());
  });

  it('re-evaluates enablement on a programmatic value replacement', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(exportButton());

    replaceValueProgrammatically(confirmInput(), WIPE_CONFIRMATION_PHRASE);
    expect(confirmInput().value).toBe(WIPE_CONFIRMATION_PHRASE);
    await waitFor(() => expect(wipeButton()).toBeEnabled());

    // And the other direction: replacing it with a near miss disarms again. Req 3.6
    replaceValueProgrammatically(confirmInput(), 'delete all students');
    await waitFor(() => expect(wipeButton()).toBeDisabled());
  });
});

/* -------------------------------------------------------------- cancel routes */

describe('WipeStudentsDialog cancel routes', () => {
  it('cancels through the Cancel button without confirming', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();

    await user.click(cancelButton());

    // Req 3.7
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels through the Escape key without confirming', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();

    await user.keyboard('{Escape}');

    // Req 3.7
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels through a mousedown outside the dialog without confirming', () => {
    const { onCancel, onConfirm } = renderDialog();
    const overlay = dialog().parentElement;

    fireEvent.mouseDown(overlay);

    // Req 3.7
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    // A mousedown on the panel itself is not a cancel.
    fireEvent.mouseDown(dialog());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels after the phrase is typed, still without confirming', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();

    await user.click(exportButton());
    await user.click(confirmInput());
    await user.paste(WIPE_CONFIRMATION_PHRASE);
    await waitFor(() => expect(wipeButton()).toBeEnabled());

    await user.keyboard('{Escape}');

    // Req 3.7 — an armed dialog still sends nothing when cancelled.
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
