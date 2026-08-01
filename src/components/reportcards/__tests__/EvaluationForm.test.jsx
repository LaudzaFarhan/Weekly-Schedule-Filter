// @vitest-environment jsdom
// This file renders a component, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Unit tests for the Daily Meeting Evaluator form.
 *
 * Four behaviours are pinned here, each one a requirement rather than a styling
 * choice:
 *
 *   - Req 1.12 — Save stays disabled while any of the five competencies is
 *     unrated OR no instructor is chosen. Both halves are checked, in both
 *     orders, because a check that only ever leaves scores missing would pass
 *     against a form that ignored the instructor entirely.
 *   - Req 1.18 — every option of every row carries an accessible name stating
 *     the score together with its rubric descriptor, and the row is reachable
 *     and settable from the keyboard. The names are read through role queries,
 *     so what is asserted is what a screen reader would compute; the expected
 *     text comes from `descriptorFor`, so rewording the rubric moves the test
 *     with the source instead of breaking it.
 *   - Req 1.13 — a rejected save shows the API's own message AND keeps every
 *     entered value. The retention half is the point: five scores, a topic, the
 *     remarks and the instructor all have to survive the failure so the save
 *     can be retried without re-entering them.
 *   - Req 1.10 — the instructor named on the record stays selectable even when
 *     `/api/new/instructors` no longer lists that person, so a record naming a
 *     departed instructor stays editable.
 *
 * `AuthContext` is mocked: the real provider constructs Firebase auth, which has
 * no business in a form test, and the signed-in user only matters here as the
 * lowest-priority instructor default. Nothing else is mocked — the rating rows,
 * the descriptor line and the disabled logic under test are the real component.
 * `fetch` is replaced by a stub that would answer the instructors endpoint, and
 * one test asserts the form never calls it: the names arrive as a prop, so no
 * request leaves this process.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { COMPETENCIES, descriptorFor } from '@/lib/reportCardRubric';
import { LESSONS_PER_LEVEL } from '@/lib/programRules';

/* ------------------------------------------------------------------- mocks */

/** The signed-in user handed to the component, per test. */
const authState = vi.hoisted(() => ({ user: null }));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: authState.user, loading: false, login: () => {}, logout: () => {} }),
}));

// Imported after the mock declaration; `vi.mock` is hoisted above it.
const { default: EvaluationForm } = await import('@/components/reportcards/EvaluationForm');

/* ---------------------------------------------------------------- fixtures */

const DATE = '2026-02-11';
const INSTRUCTORS = ['Alice Tan', 'Budi Santoso'];
const DEPARTED = 'Dewi Lestari';
const STUDENT = { id: 42, name: 'Nadia' };

/** A payload-shaped record with all five competencies scored. */
function recordFixture(overrides = {}) {
  const record = { id: 7, date: DATE, lessonTopic: 'Gears', instructorNotes: 'Good day' };
  COMPETENCIES.forEach((competency, index) => {
    record[competency.key] = ((index + 2) % 5) + 1; // a spread of 1..5
  });
  return { ...record, ...overrides };
}

function renderForm(props = {}) {
  const onSave = props.onSave ?? vi.fn().mockResolvedValue({});
  const onDateChange = props.onDateChange ?? vi.fn();
  const utils = render(
    <EvaluationForm
      date={DATE}
      student={STUDENT}
      instructorNames={INSTRUCTORS}
      // A lesson is required to save, so the default fixture has one open.
      // Tests about the lesson itself pass their own value, including `null`.
      lessonNumber={3}
      {...props}
      onSave={onSave}
      onDateChange={onDateChange}
    />
  );
  return { ...utils, onSave, onDateChange };
}

/* ----------------------------------------------------------------- queries */

const saveButton = () => screen.getByRole('button', { name: /save evaluation|saving/i });
const instructorSelect = () => screen.getByLabelText(/instructor \*/i);
const lessonTopicInput = () => screen.getByLabelText(/lesson topic/i);
const remarksInput = () => screen.getByLabelText(/instructor remarks/i);
const dateInput = () => screen.getByLabelText(/date \*/i);

/** The accessible name the component owes each option: score plus descriptor. */
const optionName = (competency, rating) =>
  `${competency.label}, ${rating} of 5, ${descriptorFor(competency.key, rating)}`;

const row = (competency) => screen.getByRole('radiogroup', { name: competency.label });

const option = (competency, rating) =>
  within(row(competency)).getByRole('radio', { name: optionName(competency, rating) });

/** Click one option through its accessible name, as an assistive-tech user would find it. */
async function rate(user, competency, rating) {
  await user.click(option(competency, rating));
}

/** Score every competency, using each competency's index to vary the value. */
async function rateAll(user, scoreFor = (index) => ((index + 2) % 5) + 1) {
  for (const [index, competency] of COMPETENCIES.entries()) {
    await rate(user, competency, scoreFor(index));
  }
}

beforeEach(() => {
  authState.user = null;
  // Would answer /api/new/instructors — the form should never need it.
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(INSTRUCTORS) })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

/* --------------------------------------------------------- Req 1.12: gating */

describe('save gating (Req 1.12)', () => {
  it('keeps save disabled on an empty form and says which competencies are unrated', () => {
    renderForm();

    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/rate all five competencies to save/i)).toBeInTheDocument();
  });

  it('keeps save disabled while no lesson is open, and says so first', async () => {
    const user = userEvent.setup();
    renderForm({ lessonNumber: null });

    await rateAll(user);
    await user.selectOptions(instructorSelect(), INSTRUCTORS[0]);

    // Everything else is complete, so the lesson is the only thing left — and it
    // is what the report is keyed by, so a save has nothing to land on.
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/pick the lesson this report is for to save/i)).toBeInTheDocument();
  }, 20000);

  it('keeps save disabled until the fifth competency is rated, with an instructor chosen', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(instructorSelect(), INSTRUCTORS[0]);
    expect(saveButton()).toBeDisabled();

    // Four of five: still disabled at every step.
    for (const competency of COMPETENCIES.slice(0, 4)) {
      await rate(user, competency, 3);
      expect(saveButton()).toBeDisabled();
    }

    await rate(user, COMPETENCIES[4], 3);
    expect(saveButton()).toBeEnabled();
  });

  it('keeps save disabled while all five are rated but no instructor is chosen', async () => {
    const user = userEvent.setup();
    renderForm();

    await rateAll(user);

    expect(instructorSelect()).toHaveValue('');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/choose an instructor to save/i)).toBeInTheDocument();

    await user.selectOptions(instructorSelect(), INSTRUCTORS[1]);
    expect(saveButton()).toBeEnabled();
  });

  it('disables save again when the chosen instructor is cleared', async () => {
    const user = userEvent.setup();
    renderForm();

    await rateAll(user);
    await user.selectOptions(instructorSelect(), INSTRUCTORS[0]);
    expect(saveButton()).toBeEnabled();

    await user.selectOptions(instructorSelect(), '');
    expect(saveButton()).toBeDisabled();
  });

  it('does not call the save handler while the form is incomplete', async () => {
    const user = userEvent.setup();
    const { onSave } = renderForm();

    await rateAll(user);
    await user.click(saveButton());

    expect(onSave).not.toHaveBeenCalled();
  });

  it('takes its instructor names from the prop rather than fetching them', () => {
    renderForm();

    expect(global.fetch).not.toHaveBeenCalled();
    for (const name of INSTRUCTORS) {
      expect(within(instructorSelect()).getByRole('option', { name })).toBeInTheDocument();
    }
  });
});

/* ---------------------------------------- Req 1.18: accessible names, keyboard */

describe('rating options (Req 1.18)', () => {
  it('gives every option an accessible name stating the score and its descriptor', () => {
    renderForm();

    for (const competency of COMPETENCIES) {
      const options = within(row(competency)).getAllByRole('radio');
      expect(options).toHaveLength(5);

      for (const rating of [1, 2, 3, 4, 5]) {
        const target = option(competency, rating);
        expect(target).toBeInTheDocument();

        // The name says what the score means, not how it is drawn.
        const descriptor = descriptorFor(competency.key, rating);
        expect(descriptor).not.toBe('');
        expect(target).toHaveAccessibleName(`${competency.label}, ${rating} of 5, ${descriptor}`);
        expect(target).not.toHaveAccessibleName(/star/i);
      }
    }
  });

  it('marks only the chosen option as checked in its row', async () => {
    const user = userEvent.setup();
    renderForm();

    const competency = COMPETENCIES[0];
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(option(competency, rating)).toHaveAttribute('aria-checked', 'false');
    }

    await rate(user, competency, 4);

    for (const rating of [1, 2, 3, 4, 5]) {
      expect(option(competency, rating)).toHaveAttribute(
        'aria-checked',
        rating === 4 ? 'true' : 'false'
      );
    }
  });

  it('shows the same descriptor on the live line as the option name carries', async () => {
    for (const competency of COMPETENCIES) {
      const user = userEvent.setup();
      const view = renderForm();

      expect(within(row(competency)).getByText(/not yet rated/i)).toBeInTheDocument();

      await rate(user, competency, 2);

      // The line the row points at with aria-describedby, so what is checked is
      // the text the row itself announces as its description.
      const descriptorLine = document.getElementById(row(competency).getAttribute('aria-describedby'));
      expect(descriptorLine).toHaveTextContent(descriptorFor(competency.key, 2));

      view.unmount();
    }
  });

  it('reaches a row by keyboard and sets a score with the arrow and End keys', async () => {
    const user = userEvent.setup();
    renderForm();

    const competency = COMPETENCIES[0];

    // Tab order: date, lesson topic, instructor, the lesson picker's single tab
    // stop, then the row's single tab stop. The lesson picker is a radiogroup
    // with a roving tab stop like the rating rows, so it costs ONE stop here and
    // not ten — that is asserted directly below.
    instructorSelect().focus();
    await user.tab();
    // The picker's single stop, which lands on the open lesson (3 by fixture).
    expect(screen.getByRole('radio', { name: /^Lesson 3\b/ })).toHaveFocus();
    await user.tab();
    expect(option(competency, 1)).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(option(competency, 1)).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(option(competency, 3)).toHaveAttribute('aria-checked', 'true');
    expect(option(competency, 3)).toHaveFocus();

    await user.keyboard('{End}');
    expect(option(competency, 5)).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{Home}');
    expect(option(competency, 1)).toHaveAttribute('aria-checked', 'true');
  });
});

/* ------------------------------------------------------- the lesson picker */

describe('lesson picker', () => {
  const lesson = (n) => screen.getByRole('radio', { name: new RegExp(`^Lesson ${n}\\b`) });
  const group = () => screen.getByRole('radiogroup', { name: /^lesson$/i });

  it('offers one button per lesson of the level, none selected when none is open', () => {
    renderForm({ lessonNumber: null });

    const options = within(group()).getAllByRole('radio');
    expect(options).toHaveLength(LESSONS_PER_LEVEL);
    for (const option of options) {
      expect(option).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.getByText(/pick a lesson to open its report/i)).toBeInTheDocument();
  });

  it('costs a single tab stop rather than one per number', () => {
    renderForm({ lessonNumber: null });

    const reachable = within(group())
      .getAllByRole('radio')
      .filter((option) => option.tabIndex === 0);

    // Ten tab stops here would bury the rating rows behind them.
    expect(reachable).toHaveLength(1);
    expect(reachable[0]).toHaveAccessibleName(/^Lesson 1\b/);
  });

  it('asks the page to open that lesson, rather than deciding for itself', async () => {
    const user = userEvent.setup();
    const onLessonChange = vi.fn();
    renderForm({ lessonNumber: null, onLessonChange });

    await user.click(lesson(4));

    // The page owns which report is open, so the click is a request, not a
    // local state change — that is what keeps the highlight and the loaded
    // record from disagreeing.
    expect(onLessonChange).toHaveBeenCalledTimes(1);
    expect(onLessonChange).toHaveBeenCalledWith(4);
  });

  it('marks the lesson the page says is open', () => {
    renderForm({ lessonNumber: 4 });

    expect(lesson(4)).toHaveAttribute('aria-checked', 'true');
    expect(lesson(3)).toHaveAttribute('aria-checked', 'false');
    expect(within(group()).getAllByRole('radio').filter((o) => o.tabIndex === 0)).toHaveLength(1);
  });

  it('distinguishes a lesson that has a report from one that does not', () => {
    renderForm({ recordedLessons: new Set([2, 5]) });

    // Stated in the accessible name, not only in colour, so the difference
    // between editing and starting a report survives without sight.
    expect(lesson(2)).toHaveAccessibleName(/edit the recorded report/i);
    expect(lesson(3)).toHaveAccessibleName(/no report yet/i);
  });

  it('says whether the open lesson is being edited or started', () => {
    const view = renderForm({ lessonNumber: 5, recordedLessons: new Set([5]) });
    expect(screen.getByText(/editing the lesson 5 report/i)).toBeInTheDocument();
    view.unmount();

    renderForm({ lessonNumber: 6, recordedLessons: new Set([5]) });
    expect(screen.getByText(/new report for lesson 6/i)).toBeInTheDocument();
  });

  it('sends the open lesson with the save', async () => {
    const user = userEvent.setup();
    const { onSave } = renderForm({ lessonNumber: 7 });

    await rateAll(user);
    await user.selectOptions(instructorSelect(), INSTRUCTORS[0]);
    await user.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].lessonNumber).toBe(7);
  }, 20000);

  it('requests the last and first lesson with End and Home', async () => {
    const user = userEvent.setup();
    const onLessonChange = vi.fn();
    renderForm({ lessonNumber: 3, onLessonChange });

    lesson(3).focus();
    await user.keyboard('{End}');
    expect(onLessonChange).toHaveBeenLastCalledWith(LESSONS_PER_LEVEL);

    await user.keyboard('{Home}');
    expect(onLessonChange).toHaveBeenLastCalledWith(1);
  });
});

/* ------------------------------------------- Req 1.13: a rejected save retains */

describe('rejected save (Req 1.13)', () => {
  it('shows the API message and keeps every entered value', async () => {
    const user = userEvent.setup();
    const message = 'An evaluation for 2026-02-11 already exists for this student.';
    const { onSave } = renderForm({ onSave: vi.fn().mockRejectedValue(new Error(message)) });

    const scores = COMPETENCIES.map((_, index) => ((index + 1) % 5) + 1);

    await user.type(lessonTopicInput(), 'Gears and simple machines');
    await user.type(remarksInput(), 'Focused throughout, needs practice on gear ratios.');
    await rateAll(user, (index) => scores[index]);
    await user.selectOptions(instructorSelect(), INSTRUCTORS[1]);

    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());

    expect(onSave).toHaveBeenCalledTimes(1);

    // The API's own wording, announced without moving focus.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);

    // And not one entered value was cleared.
    expect(dateInput()).toHaveValue(DATE);
    expect(lessonTopicInput()).toHaveValue('Gears and simple machines');
    expect(remarksInput()).toHaveValue('Focused throughout, needs practice on gear ratios.');
    expect(instructorSelect()).toHaveValue(INSTRUCTORS[1]);
    COMPETENCIES.forEach((competency, index) => {
      expect(option(competency, scores[index])).toHaveAttribute('aria-checked', 'true');
    });

    // So the save is retryable straight away, with no re-entry.
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toMatchObject({
      studentId: STUDENT.id,
      date: DATE,
      lessonTopic: 'Gears and simple machines',
      instructorName: INSTRUCTORS[1],
    });
    // `userEvent.type` enters text one keystroke at a time, and this test types
    // two long strings, rates all five competencies, picks an instructor and
    // saves twice. That exceeds the 5s default under parallel load, which showed
    // up as an intermittent failure rather than a real one — so the budget is
    // raised here rather than the interaction being trimmed away.
  }, 30000);

  it('falls back to a stated message when the rejection carries none', async () => {
    const user = userEvent.setup();
    renderForm({
      evaluation: recordFixture({ instructorName: INSTRUCTORS[0] }),
      onSave: vi.fn().mockRejectedValue(new Error('')),
    });

    await user.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent.trim()).not.toBe('');
  });

  it('shows no error and keeps the values after a successful save', async () => {
    const user = userEvent.setup();
    const { onSave } = renderForm({ evaluation: recordFixture({ instructorName: INSTRUCTORS[0] }) });

    await user.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(lessonTopicInput()).toHaveValue('Gears');
  });
});

/* ------------------------------------- Req 1.10: the departed instructor stays */

describe('instructor options (Req 1.10)', () => {
  it('offers the record’s instructor even when the endpoint no longer lists them', () => {
    renderForm({ evaluation: recordFixture({ instructorName: DEPARTED }) });

    const select = instructorSelect();
    expect(within(select).getByRole('option', { name: DEPARTED })).toBeInTheDocument();
    for (const name of INSTRUCTORS) {
      expect(within(select).getByRole('option', { name })).toBeInTheDocument();
    }

    // And it is the selection, so re-opening the day edits it rather than blanking it.
    expect(select).toHaveValue(DEPARTED);
    expect(saveButton()).toBeEnabled();
  });

  it('keeps the departed name selectable after switching away from it', async () => {
    const user = userEvent.setup();
    renderForm({ evaluation: recordFixture({ instructorName: DEPARTED }) });

    await user.selectOptions(instructorSelect(), INSTRUCTORS[0]);
    expect(instructorSelect()).toHaveValue(INSTRUCTORS[0]);
    expect(within(instructorSelect()).getByRole('option', { name: DEPARTED })).toBeInTheDocument();

    await user.selectOptions(instructorSelect(), DEPARTED);
    expect(instructorSelect()).toHaveValue(DEPARTED);
  });

  it('saves the departed name unchanged', async () => {
    const user = userEvent.setup();
    const { onSave } = renderForm({ evaluation: recordFixture({ instructorName: DEPARTED }) });

    await user.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].instructorName).toBe(DEPARTED);
  });

  it('lists each known instructor once and nothing else when no record is loaded', () => {
    renderForm({ instructorNames: [...INSTRUCTORS, INSTRUCTORS[0], '  ', ''] });

    const names = within(instructorSelect())
      .getAllByRole('option')
      .map((node) => node.getAttribute('value'))
      .filter((value) => value !== '');

    expect(names).toEqual(INSTRUCTORS);
  });
});
