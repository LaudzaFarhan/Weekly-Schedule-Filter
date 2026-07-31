// @vitest-environment jsdom
// This file renders a page, so it opts in to a DOM. The suite default is `node`
// (vitest.config.mjs) because building jsdom per file is the single largest
// fixed cost in the run.
/**
 * Unit tests for the Report_Cards_Page — task 13.3.
 *
 * Four behaviours are pinned here, one per requirement the task names:
 *
 *   - Req 6.5 — a `studentId` navigation parameter selects that student on first
 *     render AND on each subsequent change, whichever program tab the student
 *     belongs to. Without a parameter the first student of the current tab is
 *     selected (Req 6.6).
 *   - Req 6.7 — the three program tabs partition the registry: every student is
 *     listed under exactly one tab, so nobody is unreachable from this screen.
 *   - Req 6.10 — a save calls the evaluation service EXACTLY once (the call
 *     count is asserted, not merely that it was called), and neither the save
 *     nor a subsequent poll of the student registry re-requests the evaluations:
 *     they are loaded once per student selection, not on a poll (Req 6.9).
 *   - Req 3.4 — a student with zero evaluations renders `NOT YET ASSESSED` with
 *     NO numeric score anywhere, on screen and in the preview document. The
 *     assertions look for the ABSENCE of a figure and of any `/5` text, because
 *     a `0.0 / 5` on a document a parent keeps reads as a failing grade rather
 *     than as an unassessed one. That is the load-bearing assertion in this file,
 *     so the save test below also checks that a number DOES appear once the
 *     student is assessed — otherwise the absence could pass vacuously.
 *
 * Everything the page reaches outside itself is replaced: the two contexts and
 * the toast host, the students polling helper, the instructor lookup, the two
 * new services and the activity log. No request leaves the process and no timer
 * runs underneath the assertions.
 *
 * Both chart components are stubbed. jsdom implements no canvas, so the real
 * Chart.js cannot construct anything here; the page loads them through
 * `next/dynamic` with `{ ssr: false }`, and mocking the two modules the loaders
 * import leaves that wiring in place while keeping the canvas out.
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* ------------------------------------------------------------------- mocks */

const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const getAllInternalInstructors = vi.hoisted(() => vi.fn());
const getEvaluations = vi.hoisted(() => vi.fn());
const saveEvaluation = vi.hoisted(() => vi.fn());
const getTerms = vi.hoisted(() => vi.fn());
const saveTerm = vi.hoisted(() => vi.fn());
const logActivity = vi.hoisted(() => vi.fn());
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
  useAuth: () => ({ user: { email: 'ops@schedule.local' } }),
}));

vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }) => children,
  useToast: () => ({ showToast, dismissToast: () => {} }),
}));

vi.mock('@/services/internalStudentService', () => ({
  subscribeToInternalStudents,
  getAllInternalStudents: vi.fn(async () => []),
}));

vi.mock('@/services/internalInstructorService', () => ({ getAllInternalInstructors }));

vi.mock('@/services/studentEvaluationService', () => ({
  getEvaluations,
  saveEvaluation,
  updateEvaluation: vi.fn(),
  deleteEvaluation: vi.fn(),
}));

vi.mock('@/services/studentTermService', () => ({
  getTerms,
  saveTerm,
  deleteTerm: vi.fn(),
}));

vi.mock('@/services/newActivityService', () => ({
  logActivity,
  getActivity: vi.fn(async () => []),
  subscribeToActivity: vi.fn(() => () => {}),
  deleteActivity: vi.fn(async () => ({})),
  displayUser: (email) => (email ? String(email).split('@')[0] : 'Unknown user'),
}));

// The two modules the `next/dynamic` loaders import. Stubbed, so no canvas is
// ever constructed and no charting code runs in jsdom.
vi.mock('@/components/reportcards/CompetencyRadarChart', () => ({
  default: () => <div data-testid="radar-stub" />,
}));

vi.mock('@/components/reportcards/ProgressTrendChart', () => ({
  default: () => <div data-testid="trend-stub" />,
}));

// Imported after the mock declarations; `vi.mock` is hoisted above all of them.
const { default: NewStudentReportCardsPage } = await import('@/views/NewStudentReportCardsPage');
const { COMPETENCIES } = await import('@/lib/reportCardRubric');

/* ----------------------------------------------------------------- fixtures */

/**
 * Six students, two per program category, deliberately interleaved so "the first
 * student of this tab" is never simply the first row of the registry.
 */
const STUDENTS = [
  { id: 1, name: 'Kayla Kinder', level: 'Kinder Foundation', branchName: 'Bintaro', status: 'Active' },
  { id: 2, name: 'Jae Junior', level: 'Junior Core', branchName: 'Kemang', status: 'Active' },
  { id: 3, name: 'Cody Coder', level: 'Coder Advance', branchName: 'Bintaro', status: 'Active' },
  { id: 4, name: 'Kian Kinder', level: 'Kinder Core', branchName: 'Kemang', status: 'Active' },
  { id: 5, name: 'Jun Junior', level: 'Junior Foundation', branchName: 'Bintaro', status: 'Active' },
  { id: 6, name: 'Cami Coder', level: 'Coder Basic', branchName: 'Kemang', status: 'Active' },
];

const INSTRUCTORS = [{ id: 7, name: 'Ms. Tina' }, { id: 8, name: 'Mr. Dwi' }];

/** The last callback the page handed to the students poll, so a poll can be replayed. */
let pollCallback = null;

/** Mount the page with the registry already delivered by the (mocked) poll. */
function mountPage(props = {}, students = STUDENTS) {
  subscribeToInternalStudents.mockImplementation((callback) => {
    pollCallback = callback;
    callback(students);
    return () => {};
  });
  return render(<NewStudentReportCardsPage {...props} />);
}

const studentList = () => screen.getByRole('tabpanel');
const selectedRow = () => studentList().querySelector('[aria-current="true"]');
const tab = (name) => screen.getByRole('tab', { name: new RegExp(name, 'i') });
/** The Overall grade block of the student header: label, optional score, band. */
const gradeBlock = () => screen.getByText(/^overall grade$/i).parentElement;

/** Every student name the current tab lists, in listed order. */
function listedNames() {
  return within(studentList())
    .queryAllByRole('button')
    .map((button) => button.textContent);
}

beforeEach(() => {
  pollCallback = null;
  showToast.mockReset();
  logActivity.mockReset().mockResolvedValue({ id: 1 });
  subscribeToInternalStudents.mockReset();
  getAllInternalInstructors.mockReset().mockResolvedValue(INSTRUCTORS);
  getEvaluations.mockReset().mockResolvedValue([]);
  getTerms.mockReset().mockResolvedValue([]);
  saveEvaluation.mockReset().mockImplementation(async (payload) => ({ id: 42, ...payload }));
  saveTerm.mockReset();
});

/* ------------------------------------------------- Req 6.5 / 6.6 selection */

describe('student selection (Req 6.5, 6.6)', () => {
  it('selects the student named by the navigation parameter on first render', async () => {
    mountPage({ params: { studentId: 3 } });

    // The parameter wins over "the first student of the default tab": the page
    // opens on Cody Coder, and the tab follows the selection rather than the
    // other way round.
    await waitFor(() => expect(selectedRow()).not.toBeNull());
    expect(selectedRow().textContent).toContain('Cody Coder');
    expect(tab('Coder')).toHaveAttribute('aria-selected', 'true');

    // And that student's data — nobody else's — was requested. Req 6.10
    await waitFor(() => expect(getEvaluations).toHaveBeenCalledWith({ studentId: 3 }));
    expect(getTerms).toHaveBeenCalledWith({ studentId: 3 });
    expect(getEvaluations).toHaveBeenCalledTimes(1);
  });

  it('follows a later change of the navigation parameter', async () => {
    const view = mountPage({ params: { studentId: 3 } });
    await waitFor(() => expect(selectedRow()?.textContent).toContain('Cody Coder'));

    // A string id, as navigation actually delivers it, and a student in another
    // program category. Req 6.5
    view.rerender(<NewStudentReportCardsPage params={{ studentId: '5' }} />);

    await waitFor(() => expect(selectedRow()?.textContent).toContain('Jun Junior'));
    expect(tab('Junior')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(getEvaluations).toHaveBeenCalledWith({ studentId: 5 }));
  });

  it('selects the first student of the current tab when no parameter is supplied', async () => {
    mountPage();

    // Kinder is the first tab, and Kayla is its first student even though the
    // registry order would put other rows first. Req 6.6
    await waitFor(() => expect(selectedRow()).not.toBeNull());
    expect(selectedRow().textContent).toContain('Kayla Kinder');
    expect(tab('Kinder')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(getEvaluations).toHaveBeenCalledWith({ studentId: 1 }));
  });

  it('displays a stated prompt and selects nobody when the registry is empty', async () => {
    mountPage({}, []);

    expect(
      await screen.findByText(/select a student from the list to record an evaluation/i)
    ).toBeInTheDocument();
    expect(selectedRow()).toBeNull();
    expect(getEvaluations).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------- Req 6.7 the tabs */

describe('program tabs (Req 6.7)', () => {
  it('partitions the registry: every student is listed under exactly one tab', async () => {
    const user = userEvent.setup({ delay: null });
    mountPage();
    await waitFor(() => expect(selectedRow()).not.toBeNull());

    /** category → the names that tab lists. */
    const byTab = {};
    for (const name of ['Kinder', 'Junior', 'Coder']) {
      await user.click(tab(name));
      await waitFor(() => expect(tab(name)).toHaveAttribute('aria-selected', 'true'));
      byTab[name] = listedNames();
    }

    // Each tab lists its own two students…
    for (const [category, names] of Object.entries(byTab)) {
      expect(names).toHaveLength(2);
      for (const text of names) {
        const student = STUDENTS.find((s) => text.includes(s.name));
        expect(student, `a listed row under ${category} matches a known student`).toBeDefined();
        expect(student.level.startsWith(category)).toBe(true);
      }
    }

    // …and together the three tabs cover the registry exactly once: no student
    // is listed twice, and none is unreachable from this panel.
    const placements = STUDENTS.map(
      (student) =>
        Object.values(byTab)
          .flat()
          .filter((text) => text.includes(student.name)).length
    );
    expect(placements).toEqual(STUDENTS.map(() => 1));
  });
});

/* ------------------------------------------- Req 6.9 / 6.10 loading, saving */

describe('saving an evaluation (Req 6.10)', () => {
  /** Rate all five competencies and pick an instructor, so Save becomes usable. */
  async function fillForm(user, rating = 4) {
    for (const competency of COMPETENCIES) {
      await user.click(
        screen.getByRole('radio', {
          name: new RegExp(`^${competency.label}, ${rating} of 5`),
        })
      );
    }
    await user.selectOptions(screen.getByLabelText('Instructor *'), 'Ms. Tina');
  }

  it('calls the evaluation service exactly once for one save', async () => {
    const user = userEvent.setup({ delay: null });
    mountPage({ params: { studentId: 2 } });
    await waitFor(() => expect(getEvaluations).toHaveBeenCalledWith({ studentId: 2 }));

    await fillForm(user);
    const save = screen.getByRole('button', { name: /save evaluation/i });
    expect(save).toBeEnabled();
    await user.click(save);

    // Exactly one write. A second call would mean a duplicated day, which is
    // the whole reason the API upserts on `(student_id, eval_date)`.
    await waitFor(() => expect(saveEvaluation).toHaveBeenCalledTimes(1));
    expect(saveEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 2,
        instructorName: 'Ms. Tina',
        ...Object.fromEntries(COMPETENCIES.map((competency) => [competency.key, 4])),
      })
    );

    // The returned record is merged locally, so the save does not re-read the
    // student's history. Req 3.11, 6.10
    expect(getEvaluations).toHaveBeenCalledTimes(1);
    expect(getTerms).toHaveBeenCalledTimes(1);

    // The control assertion for Req 3.4 below: once the student IS assessed, a
    // number and its `/ 5.0` do appear, so an absence test cannot pass vacuously.
    await waitFor(() => expect(gradeBlock().textContent).toContain('4.0 / 5.0'));
    expect(gradeBlock().textContent).toContain('VERY GOOD');
  });

  it('requests the evaluations once per selection, not on a poll (Req 6.9)', async () => {
    mountPage({ params: { studentId: 2 } });
    await waitFor(() => expect(getEvaluations).toHaveBeenCalledTimes(1));

    // A poll tick delivering the registry again must not re-read the student's
    // evaluations or terms: they change only through this page's own writes.
    await act(async () => {
      pollCallback([...STUDENTS]);
    });

    expect(getEvaluations).toHaveBeenCalledTimes(1);
    expect(getTerms).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------- Req 3.4 the empty state */

describe('a student with no evaluations (Req 3.4)', () => {
  /** No figure, and no `/5` score text, anywhere in this subtree. */
  function expectNoScore(text, where) {
    expect(text, `${where} states no /5 score`).not.toMatch(/\/\s*5/);
    expect(text, `${where} prints no numeric score`).not.toMatch(/\d+\.\d/);
  }

  it('states NOT YET ASSESSED on screen and prints no number', async () => {
    const { container } = mountPage({ params: { studentId: 1 } });
    await waitFor(() => expect(getEvaluations).toHaveBeenCalledWith({ studentId: 1 }));

    // The band is STATED, so an unassessed student reads as unassessed rather
    // than as an empty box.
    expect(await screen.findByText('NOT YET ASSESSED')).toBeInTheDocument();

    // The grade block holds the label and nothing numeric at all — not a zero,
    // not a dash followed by `/5`.
    await waitFor(() => expect(gradeBlock().textContent).toContain('NOT YET ASSESSED'));
    expect(gradeBlock().textContent).not.toMatch(/\d/);

    // And no score text anywhere on the page, so no `0.0 / 5` can be read as a
    // failing grade.
    expectNoScore(container.textContent, 'the page');
  });

  it('prints NOT YET ASSESSED with no number in the preview document', async () => {
    const user = userEvent.setup({ delay: null });
    mountPage({ params: { studentId: 1 } });
    await waitFor(() => expect(getEvaluations).toHaveBeenCalledWith({ studentId: 1 }));

    await user.click(screen.getByRole('button', { name: /preview report/i }));

    const document_ = await waitFor(() => {
      const node = window.document.getElementById('report-card-print');
      expect(node).not.toBeNull();
      return node;
    });

    expect(within(document_).getByText('NOT YET ASSESSED')).toBeInTheDocument();
    // The empty state stands in for the radar, and the document stays printable.
    expect(within(document_).getByText(/no evaluations yet/i)).toBeInTheDocument();
    expectNoScore(document_.textContent, 'the report document');
  });

  it('shows a number again as soon as the student has an evaluation', async () => {
    // The same page, the same student, one evaluation on record: the absence
    // asserted above is a consequence of having no evaluations, not of the
    // queries used to look for it.
    getEvaluations.mockResolvedValue([
      { id: 1, date: '2026-01-05', concept: 5, building: 5, problemSolving: 5, focus: 5, attitude: 5 },
    ]);
    const { container } = mountPage({ params: { studentId: 1 } });

    await waitFor(() => expect(gradeBlock().textContent).toContain('5.0 / 5.0'));
    expect(screen.queryByText('NOT YET ASSESSED')).toBeNull();
    expect(container.textContent).toContain('EXCELLENT');

    cleanup();
  });
});
