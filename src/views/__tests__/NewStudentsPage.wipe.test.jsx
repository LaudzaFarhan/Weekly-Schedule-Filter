// @vitest-environment jsdom
// This file renders components, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Example-based unit tests for the bulk-wipe orchestration in
 * `NewStudentsPage` — the branches that live on the page rather than in the
 * dialog: the role re-check at dispatch, the local-storage cleanup, the audit
 * write and its single retry, and the post-success sequence.
 *
 * The property test in `NewStudentsPage.wipe.property.test.jsx` covers header
 * gating and filter preservation across generated inputs. This file pins the
 * fixed branches the requirements name.
 *
 * Everything the page reaches outside itself is mocked: the student and
 * activity services, the schedule and auth contexts, and the spreadsheet
 * export. `subscribeToInternalStudents` is replaced by a one-shot callback so
 * the real 3-second poll never runs. The dialog itself is the real component,
 * so each test drives the same export → type → confirm path a user does.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WIPE_CONFIRMATION_PHRASE } from '@/lib/wipeConfirmation';
import { ToastProvider } from '@/components/ui/Toast';

/* ------------------------------------------------------------------- mocks */

/**
 * One external store behind both mocked context hooks, so a role change is a
 * real re-render of the page rather than a manual `rerender` call. Req 1.4
 */
const stores = vi.hoisted(() => {
  const listeners = new Set();
  const notify = () => { listeners.forEach((l) => l()); };
  let schedule = { enabledBranches: [], branches: [], users: {} };
  let auth = { user: null };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSchedule: () => schedule,
    getAuth: () => auth,
    setSchedule(patch) { schedule = { ...schedule, ...patch }; notify(); },
    reset(nextSchedule, nextAuth) { schedule = nextSchedule; auth = nextAuth; notify(); },
  };
});

/**
 * Lets a test defeat the render-time Admin gate without defeating the
 * re-check inside `handleWipeConfirm`, which is the only way to reach the
 * non-Admin dispatch branch from the UI. Req 1.8
 */
const roleOverride = vi.hoisted(() => ({ isAdmin: null }));

const downloadStudentExport = vi.hoisted(() => vi.fn(() => 5));
const logActivity = vi.hoisted(() => vi.fn());
const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const getAllInternalStudents = vi.hoisted(() => vi.fn());
const bulkDeleteAllStudents = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ScheduleContext', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useSchedule: () => useSyncExternalStore(stores.subscribe, stores.getSchedule, stores.getSchedule),
  };
});

vi.mock('@/contexts/AuthContext', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useAuth: () => useSyncExternalStore(stores.subscribe, stores.getAuth, stores.getAuth),
  };
});

vi.mock('@/utils/roles', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isAdmin: (...args) => (roleOverride.isAdmin ? roleOverride.isAdmin(...args) : actual.isAdmin(...args)),
  };
});

vi.mock('@/lib/studentExport', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadStudentExport,
}));

vi.mock('@/services/newActivityService', async (importOriginal) => ({
  ...(await importOriginal()),
  logActivity,
}));

vi.mock('@/services/internalStudentService', async (importOriginal) => ({
  ...(await importOriginal()),
  subscribeToInternalStudents,
  getAllInternalStudents,
  bulkDeleteAllStudents,
}));

// Imported after the mock declarations; `vi.mock` is hoisted above all of them.
const { default: NewStudentsPage } = await import('@/views/NewStudentsPage');

/* ---------------------------------------------------------------- fixtures */

const BRANCH_HISTORY_KEY = 'newOpsStudentBranchHistory';
const ADMIN_EMAIL = 'admin@lab.id';
const COUNTS = { success: true, deletedStudents: 12, deletedHistory: 4, deletedProgress: 7 };

const makeStudents = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    name: `Student ${String(i + 1).padStart(2, '0')}`,
    level: 'Junior Coding',
    branchName: 'Bintaro',
    parentName: `Parent ${i + 1}`,
    contact: '08000000000',
    status: 'Active',
    remarks: '',
  }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/* ----------------------------------------------------------------- queries */

const wipeControl = () => screen.getByRole('button', { name: /delete all student records/i });
const dialog = () => screen.getByRole('dialog');
const exportButton = () => within(dialog()).getByRole('button', { name: /export student list/i });
const confirmInput = () => within(dialog()).getByRole('textbox');
const dialogWipeButton = () =>
  within(dialog()).getByRole('button', { name: /^delete all students$|^deleting/i });

/* ----------------------------------------------------------------- helpers */

function renderPage({ students = makeStudents(12), role = 'Admin', email = ADMIN_EMAIL } = {}) {
  stores.reset(
    {
      enabledBranches: [{ name: 'Bintaro' }],
      branches: [{ name: 'Bintaro' }],
      users: email ? { [email.toLowerCase()]: role } : {},
    },
    { user: email ? { email } : null },
  );
  subscribeToInternalStudents.mockImplementation((cb) => {
    cb(students);
    return () => {};
  });
  return render(
    <ToastProvider>
      <NewStudentsPage />
    </ToastProvider>,
  );
}

/** Open the dialog and satisfy both of its gates, leaving the wipe armed. */
async function armDialog(user) {
  await user.click(wipeControl());
  await user.click(exportButton());
  await user.type(confirmInput(), WIPE_CONFIRMATION_PHRASE);
  expect(dialogWipeButton()).toBeEnabled();
}

/* ------------------------------------------------------------------- setup */

beforeEach(() => {
  downloadStudentExport.mockReset().mockReturnValue(5);
  logActivity.mockReset().mockResolvedValue({ id: 1 });
  subscribeToInternalStudents.mockReset();
  getAllInternalStudents.mockReset().mockResolvedValue([]);
  bulkDeleteAllStudents.mockReset().mockResolvedValue(COUNTS);
  roleOverride.isAdmin = null;
  window.localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------- tests */

describe('NewStudentsPage bulk wipe — authorisation branches', () => {
  it('closes the open dialog and discards the typed phrase when the role stops being Admin', async () => {
    const user = userEvent.setup();
    renderPage();
    await armDialog(user);
    expect(confirmInput()).toHaveValue(WIPE_CONFIRMATION_PHRASE);

    // The recorded role changes under the open dialog. Req 1.4
    act(() => { stores.setSchedule({ users: { [ADMIN_EMAIL]: 'Instructor' } }); });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete all student records/i })).not.toBeInTheDocument();
    expect(bulkDeleteAllStudents).not.toHaveBeenCalled();

    // Back to Admin: the dialog reopens with the typed text gone, not restored.
    act(() => { stores.setSchedule({ users: { [ADMIN_EMAIL]: 'Admin' } }); });
    await user.click(wipeControl());
    expect(confirmInput()).toHaveValue('');
    expect(dialogWipeButton()).toBeDisabled();
    expect(bulkDeleteAllStudents).not.toHaveBeenCalled();
  });

  it('sends no request and names the required role when the dispatch-time role is not Admin', async () => {
    const user = userEvent.setup();
    // Rendered as Admin so the control and dialog exist...
    roleOverride.isAdmin = () => true;
    renderPage({ role: 'Instructor' });
    await armDialog(user);

    // ...then the guard is defeated before the wipe is dispatched. Req 1.8
    roleOverride.isAdmin = () => false;
    await user.click(dialogWipeButton());

    expect(await screen.findByText(/requires the Admin role/i)).toBeInTheDocument();
    expect(bulkDeleteAllStudents).not.toHaveBeenCalled();
    expect(getAllInternalStudents).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('NewStudentsPage bulk wipe — local branch history', () => {
  /*
   * The spy goes on `Storage.prototype`, not on the `window.localStorage`
   * instance: jsdom exposes storage as a proxy whose `defineProperty` trap
   * treats a named property as a stored key, so an instance spy is swallowed
   * and the real method still runs. The prototype is the object the page's
   * `localStorage.removeItem` call actually resolves to.
   */
  it('clears the local branch history on success', async () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const user = userEvent.setup();
    renderPage();
    await armDialog(user);
    await user.click(dialogWipeButton());

    expect(await screen.findByText(/Bulk wipe complete/i)).toBeInTheDocument();
    expect(removeItem).toHaveBeenCalledWith(BRANCH_HISTORY_KEY); // Req 4.6
  });

  it('still reports success when clearing the local branch history throws', async () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage is full');
    });
    const user = userEvent.setup();
    renderPage();
    await armDialog(user);
    await user.click(dialogWipeButton());

    // Req 4.7 — success stands, the storage failure only reaches the console.
    expect(await screen.findByText('Bulk wipe complete: deleted 12 student records.')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to delete all student records/i)).not.toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/local student branch history/i),
      expect.any(Error),
    );
  });
});

describe('NewStudentsPage bulk wipe — activity log', () => {
  it('retries a failed activity write exactly once, then abandons it without changing the reported counts', async () => {
    logActivity.mockResolvedValue(null); // the service returns null instead of throwing
    const user = userEvent.setup();
    renderPage();
    await armDialog(user);
    await user.click(dialogWipeButton());

    const successToast = await screen.findByText('Bulk wipe complete: deleted 12 student records.');

    // One retry, about a second later. Req 8.5
    await waitFor(() => expect(logActivity).toHaveBeenCalledTimes(2), { timeout: 4000 });
    await new Promise((resolve) => { setTimeout(resolve, 1200); });
    expect(logActivity).toHaveBeenCalledTimes(2);

    const [first, second] = logActivity.mock.calls.map(([entry]) => entry);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ action: 'bulk', source: 'students', count: 12 });
    // The counts already shown to the user are untouched by the logging failure.
    expect(successToast).toBeInTheDocument();
  });

  it('writes exactly one activity entry with a count of zero when the wipe fails', async () => {
    bulkDeleteAllStudents.mockRejectedValue(new Error('deadlock detected'));
    const user = userEvent.setup();
    renderPage();
    await armDialog(user);
    await user.click(dialogWipeButton());

    // The reason surfaces in two places by design, so each is queried where it
    // lives: the toast that reports the failure...
    const failureToast = await screen.findByText(/Failed to delete all student records/i);
    expect(within(failureToast.closest('.toast-item')).getByText(/deadlock detected/i)).toBeInTheDocument();
    // ...and the dialog's own inline alert, which stays for the retry. Req 6.4
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(/deadlock detected/i);

    // Req 8.7 — one entry, count 0, failure summary. The dialog stays open.
    await waitFor(() => expect(logActivity).toHaveBeenCalledTimes(1));
    expect(logActivity.mock.calls[0][0]).toMatchObject({
      action: 'bulk',
      source: 'students',
      count: 0,
      summary: expect.stringMatching(/failed/i),
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(getAllInternalStudents).not.toHaveBeenCalled();
  });
});

describe('NewStudentsPage bulk wipe — post-success sequence', () => {
  it('closes the dialog, returns focus to the wipe control, reloads the list and renders the empty state', async () => {
    const reload = deferred();
    getAllInternalStudents.mockReturnValue(reload.promise);
    const user = userEvent.setup();
    renderPage();
    const control = wipeControl();
    await armDialog(user);
    await user.click(dialogWipeButton());

    // Req 7.4 — the dialog closes and focus goes back to the control it came from.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(control).toHaveFocus());
    expect(getAllInternalStudents).toHaveBeenCalledTimes(1); // Req 7.5

    await act(async () => { reload.resolve([]); });

    // Req 7.6
    expect(await screen.findByText('No Students Registered')).toBeInTheDocument();
    expect(screen.queryByText('Student 01')).not.toBeInTheDocument();
  });

  it('resets the displayed page number to 1', async () => {
    getAllInternalStudents.mockResolvedValue(makeStudents(12));
    const user = userEvent.setup();
    renderPage({ students: makeStudents(12) });

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();

    await armDialog(user);
    await user.click(dialogWipeButton());

    // Req 9.3
    await waitFor(() => expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument());
  });

  it('keeps the success toast and adds a retryable toast when the reload fails', async () => {
    getAllInternalStudents.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    renderPage();
    await armDialog(user);
    await user.click(dialogWipeButton());

    // Req 7.7 — two notifications: the success stands, the refresh offers a retry.
    expect(await screen.findByText('Bulk wipe complete: deleted 12 student records.')).toBeInTheDocument();
    const retryToast = await screen.findByText(/Student list could not be refreshed/i);
    expect(retryToast).toBeInTheDocument();
    expect(screen.getByText(/Click here to retry loading the list/i)).toBeInTheDocument();

    getAllInternalStudents.mockResolvedValue([]);
    await user.click(retryToast);
    await waitFor(() => expect(getAllInternalStudents).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No Students Registered')).toBeInTheDocument();
  });
});

describe('NewStudentsPage bulk wipe — repeat activation', () => {
  it('issues one request when the wipe is activated again while it is running', async () => {
    const inFlight = deferred();
    bulkDeleteAllStudents.mockReturnValue(inFlight.promise);
    const user = userEvent.setup();
    renderPage();
    await armDialog(user);

    await user.click(dialogWipeButton());
    // The dialog disables the control while the wipe runs, and the page holds an
    // in-flight flag behind it; either way a second activation sends nothing. Req 6.7
    fireEvent.click(dialogWipeButton());
    fireEvent.click(dialogWipeButton());
    expect(bulkDeleteAllStudents).toHaveBeenCalledTimes(1);

    await act(async () => { inFlight.resolve(COUNTS); });
    expect(await screen.findByText(/Bulk wipe complete/i)).toBeInTheDocument();
    expect(bulkDeleteAllStudents).toHaveBeenCalledTimes(1);
  });
});
