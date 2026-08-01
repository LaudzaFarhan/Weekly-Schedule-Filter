'use client';

/**
 * The Daily Meeting Evaluator: date, lesson topic, instructor, five coloured
 * star rows with a live descriptor line, instructor remarks, Save.
 *
 * Three requirements shape the markup rather than the styling:
 *
 *   - Each rating row is a `radiogroup` of five `radio`-role buttons with a
 *     roving tab stop, so a rating is reachable and settable from the keyboard
 *     (Req 1.18). Every option's accessible name carries the score AND its
 *     rubric descriptor — "Concept, 4 of 5, Good understanding with minimal
 *     prompting", never "star 4" — so a screen reader announces what the score
 *     means, not how it is drawn.
 *   - The italic line under each row is `descriptorFor(key, rating)` (Req 1.17).
 *     There is deliberately NO rubric wording written into this file: every
 *     descriptor comes from `src/lib/reportCardRubric.js` (Req 1.16).
 *   - A rejected save shows the API's own message and keeps every entered value
 *     (Req 1.13). Nothing is cleared on failure, so a save can be retried
 *     without re-entering five scores.
 *
 * The root carries `no-print`, which the `@media print` block in
 * `src/app/globals.css` uses to keep the evaluator off the printed report.
 */

import React, { useMemo, useState } from 'react';
import { Star, Save as SaveIcon, AlertCircle } from 'lucide-react';

import { useAuth } from '../../contexts/AuthContext';
import { COMPETENCIES, descriptorFor } from '../../lib/reportCardRubric';
import { LESSONS_PER_LEVEL } from '../../lib/programRules';

/** The five options of every row, worst-first, so left-to-right reads 1 → 5. */
const RATINGS = [1, 2, 3, 4, 5];

/** Off-screen but still announced. */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/** `null` for every competency — the unrated state, which is not a score of 0. */
function emptyScores() {
  const scores = {};
  for (const competency of COMPETENCIES) scores[competency.key] = null;
  return scores;
}

/** An integer in `[1,5]`, or `null`. Anything else is unrated, never coerced. */
function readScore(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Pre-fill from an existing record for the chosen date, so re-opening a day
 * edits it rather than starting blank. `null` gives an empty form.
 *
 * @param {Object|null} evaluation
 */
/**
 * The lesson numbers a level runs: `[1 … LESSONS_PER_LEVEL]`.
 *
 * Built from the curriculum rule rather than written out, so the row of buttons
 * follows the same constant the attendance ticks and the trend-chart window use.
 */
const LESSON_NUMBERS = Array.from({ length: LESSONS_PER_LEVEL }, (_, i) => i + 1);

/**
 * Does `recordedLessons` hold `number`?
 *
 * Accepts a `Set`, an array or nothing at all, so a caller that has not loaded a
 * history yet can simply omit the prop and every lesson reads as unrecorded.
 */
function recorded_has(recordedLessons, number) {
  if (!recordedLessons) return false;
  if (typeof recordedLessons.has === 'function') return recordedLessons.has(number);
  return Array.isArray(recordedLessons) && recordedLessons.includes(number);
}

function formFromEvaluation(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') {
    return { lessonTopic: '', instructorNotes: '', scores: emptyScores() };
  }

  const scores = emptyScores();
  for (const competency of COMPETENCIES) {
    scores[competency.key] = readScore(evaluation[competency.key]);
  }

  return {
    lessonTopic: evaluation.lessonTopic || '',
    instructorNotes: evaluation.instructorNotes || '',
    scores,
  };
}

/**
 * The instructor named on the student's most recent evaluation — the first
 * default of Req 1.11. "Most recent" is the greatest `(date, id)`, matching how
 * `reportCard.js` orders a history.
 *
 * Entries without a `date` are skipped, so being handed a list of student
 * records rather than a list of evaluations yields no default instead of
 * inventing one.
 *
 * @param {Array<Object>|undefined} history
 * @returns {string} the name, or `''`
 */
function instructorFromHistory(history) {
  if (!Array.isArray(history)) return '';

  let best = null;
  for (const row of history) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.date !== 'string' || row.date === '') continue;
    if (trimmed(row.instructorName) === '') continue;

    if (
      best === null ||
      row.date > best.date ||
      (row.date === best.date && Number(row.id || 0) > Number(best.id || 0))
    ) {
      best = row;
    }
  }

  return best ? trimmed(best.instructorName) : '';
}

/**
 * The signed-in user's matching instructor name — the second default of
 * Req 1.11. Compared after trimming and disregarding letter case, and the
 * value returned is the name as the instructor list spells it, so the `<select>`
 * has a matching option.
 *
 * Both the account's display name and the local part of its email are tried,
 * because this app signs in with `username@schedule.local` addresses and only
 * some accounts carry a display name.
 *
 * @param {{ displayName?: string, email?: string }|null|undefined} user
 * @param {Array<string>} instructorNames
 * @returns {string} the matching name as spelled in `instructorNames`, or `''`
 */
function instructorFromSignedInUser(user, instructorNames) {
  if (!user) return '';

  const email = trimmed(user.email);
  const candidates = [trimmed(user.displayName), email ? email.split('@')[0] : ''].filter(Boolean);
  if (candidates.length === 0) return '';

  for (const candidate of candidates) {
    const folded = candidate.toLowerCase();
    const match = instructorNames.find((name) => trimmed(name).toLowerCase() === folded);
    if (match) return trimmed(match);
  }
  return '';
}

/**
 * @param {Object} props
 * @param {Object|null} [props.evaluation] the existing record for `date`, if any — pre-fills the form
 * @param {string} props.date ISO `YYYY-MM-DD`, the day being evaluated
 * @param {(date: string) => void} [props.onDateChange] called with the new ISO date
 * @param {Array<Object>} [props.students] the selected student's evaluation history, used
 *   only for the Req 1.11 instructor default (alias of `evaluations`)
 * @param {Array<Object>} [props.evaluations] the selected student's evaluation history
 * @param {Object|null} [props.student] the selected student record; `student.id` goes on the payload
 * @param {Array<string>} [props.instructorNames] names from `/api/new/instructors`
 * @param {(payload: Object) => Promise<any>} props.onSave rejects with the API's message
 * @param {boolean} [props.saving] true while a save is in flight
 */
export default function EvaluationForm({
  evaluation = null,
  date,
  onDateChange,
  // The lesson picker is CONTROLLED by the page, because picking a lesson picks
  // which report is being edited — the page is what owns that selection and
  // hands the matching record back as `evaluation`. Keeping it in local state
  // here would let the highlighted number disagree with the loaded record.
  lessonNumber = null,
  onLessonChange,
  /** Lesson numbers this student already has a report for, so the picker shows it. */
  recordedLessons = null,
  students,
  evaluations,
  student = null,
  instructorNames,
  onSave,
  saving = false,
}) {
  const { user } = useAuth();

  /** The student's evaluation history. Either prop name is accepted. */
  const history = Array.isArray(evaluations)
    ? evaluations
    : Array.isArray(students)
      ? students
      : [];

  /** Clean, de-duplicated instructor names in the order the API returned them. */
  const knownNames = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const name of Array.isArray(instructorNames) ? instructorNames : []) {
      const value = trimmed(name);
      if (value === '' || seen.has(value)) continue;
      seen.add(value);
      list.push(value);
    }
    return list;
  }, [instructorNames]);

  const [form, setForm] = useState(() => formFromEvaluation(evaluation));
  const [error, setError] = useState('');

  /**
   * Re-prefill when the day, the student or the underlying record changes, and
   * not on every render, so typing is never clobbered. Adjusting state during
   * render (rather than in an effect) means the form never paints one frame of
   * the previous day's values.
   */
  const syncKey = [
    student?.id ?? '',
    date ?? '',
    evaluation?.id ?? '',
    evaluation?.updatedAt ?? '',
    // Switching between two lessons that have no report yet leaves the student,
    // the date and the (absent) record identical, so without this the form would
    // keep whatever was typed against the previous lesson.
    lessonNumber ?? '',
  ].join('|');
  const [lastSyncKey, setLastSyncKey] = useState(syncKey);
  /**
   * The instructor the user picked. `null` means "nothing picked for this day
   * yet", which is what lets the default below apply; `''` is a deliberate
   * clearing and keeps Save disabled.
   */
  const [instructorChoice, setInstructorChoice] = useState(null);

  if (lastSyncKey !== syncKey) {
    setLastSyncKey(syncKey);
    setForm(formFromEvaluation(evaluation));
    setInstructorChoice(null);
    setError('');
  }

  /**
   * The instructor default (Req 1.11), in order: the name on the record being
   * edited → the name on this student's most recent evaluation → the signed-in
   * user's matching instructor name → empty.
   *
   * Derived rather than written into state, so it settles by itself when the
   * instructor list or the signed-in user arrives after first render, and a
   * pick by the user always outranks it.
   */
  const defaultInstructor =
    trimmed(evaluation?.instructorName) ||
    instructorFromHistory(history) ||
    instructorFromSignedInUser(user, knownNames);

  const selectedInstructor =
    instructorChoice === null ? defaultInstructor : trimmed(instructorChoice);

  /**
   * The record's own instructor is always selectable, even after that person
   * leaves and drops out of `/api/new/instructors`, so an old record stays
   * editable (Req 1.10). Same for whatever is currently selected — a default
   * taken from history can name a departed instructor too.
   */
  const instructorOptions = useMemo(() => {
    const options = [...knownNames];
    for (const extra of [trimmed(evaluation?.instructorName), selectedInstructor]) {
      if (extra !== '' && !options.includes(extra)) options.push(extra);
    }
    return options;
  }, [knownNames, evaluation?.instructorName, selectedInstructor]);

  const unrated = COMPETENCIES.filter((c) => form.scores[c.key] === null);
  /**
   * Req 1.12 — an unrated competency, no instructor or no lesson keeps Save
   * disabled.
   *
   * The lesson is required because it identifies the report: the API upserts on
   * `(student_id, lesson_number)`, so a save without one has nothing to land on.
   */
  const canSave =
    unrated.length === 0 && selectedInstructor !== '' && lessonNumber !== null && !saving;

  const setScore = (key, rating) => {
    setForm((previous) => ({ ...previous, scores: { ...previous.scores, [key]: rating } }));
  };

  /**
   * Arrow keys move and set in one step, which is how a radio group behaves
   * natively; Home and End jump to 1 and 5. The buttons themselves handle
   * Enter and Space for free.
   */
  const handleRowKeyDown = (event, key) => {
    const current = form.scores[key];
    let next = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = current === null ? 1 : Math.min(5, current + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = current === null ? 5 : Math.max(1, current - 1);
    } else if (event.key === 'Home') {
      next = 1;
    } else if (event.key === 'End') {
      next = 5;
    } else {
      return;
    }

    event.preventDefault();
    setScore(key, next);

    // Focus follows the selection, as it does in a native radio group —
    // otherwise the roving tab stop moves to the newly checked option while the
    // keyboard is still on the old one.
    const options = event.currentTarget.querySelectorAll('[role="radio"]');
    options[next - 1]?.focus();
  };

  /**
   * The same arrow / Home / End behaviour for the lesson picker, over 1..N
   * instead of 1..5.
   *
   * A radio group is ONE tab stop with arrows moving inside it. Ten separately
   * tabbable buttons would put ten stops between the instructor select and the
   * first rating row, which is why this mirrors `handleRowKeyDown` rather than
   * leaving the buttons to default behaviour.
   */
  const handleLessonKeyDown = (event) => {
    const current = lessonNumber;
    let next = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = current === null ? 1 : Math.min(LESSONS_PER_LEVEL, current + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = current === null ? LESSONS_PER_LEVEL : Math.max(1, current - 1);
    } else if (event.key === 'Home') {
      next = 1;
    } else if (event.key === 'End') {
      next = LESSONS_PER_LEVEL;
    } else {
      return;
    }

    event.preventDefault();
    onLessonChange?.(next);

    const options = event.currentTarget.querySelectorAll('[role="radio"]');
    options[next - 1]?.focus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSave || typeof onSave !== 'function') return;

    const payload = {
      studentId: student?.id ?? null,
      date,
      lessonTopic: trimmed(form.lessonTopic) || null,
      lessonNumber,
      instructorNotes: trimmed(form.instructorNotes) || null,
      instructorName: selectedInstructor,
    };
    for (const competency of COMPETENCIES) {
      payload[competency.key] = form.scores[competency.key];
    }

    setError('');
    try {
      await onSave(payload);
    } catch (err) {
      // Req 1.13 — the API's message, and not one word of the form is cleared.
      setError(err?.message || 'The evaluation could not be saved.');
    }
  };

  return (
    <form className="panel no-print" onSubmit={handleSubmit} noValidate>
      <div className="panel-header" style={{ display: 'block' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Daily Meeting Evaluator</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
          {student?.name
            ? `Rate ${student.name} on the five competencies for this teaching day.`
            : 'Rate the five competencies for this teaching day.'}
        </p>
      </div>

      <div
        className="panel-body"
        style={{ padding: '1.25rem 1.5rem', display: 'grid', gap: '1.1rem' }}
      >
        {/* Date / lesson topic / instructor */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 150px' }}>
            <label className="modal-form-label" htmlFor="evaluation-date">
              Date *
            </label>
            <input
              id="evaluation-date"
              type="date"
              value={date || ''}
              onChange={(event) => onDateChange?.(event.target.value)}
              className="modal-input-field"
            />
          </div>

          <div style={{ flex: '2 1 220px' }}>
            <label className="modal-form-label" htmlFor="evaluation-lesson-topic">
              Lesson Topic
            </label>
            <input
              id="evaluation-lesson-topic"
              type="text"
              placeholder="e.g. Gears and simple machines"
              value={form.lessonTopic}
              onChange={(event) => setForm({ ...form, lessonTopic: event.target.value })}
              className="modal-input-field"
            />
          </div>

          <div style={{ flex: '1 1 180px' }}>
            <label className="modal-form-label" htmlFor="evaluation-instructor">
              Instructor *
            </label>
            <select
              id="evaluation-instructor"
              value={selectedInstructor}
              onChange={(event) => setInstructorChoice(event.target.value)}
              className="modal-select-field"
            >
              <option value="">Select instructor</option>
              {instructorOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/*
          Which lesson of the level this day was. Optional — the evaluation is
          still keyed by date, so a day can be recorded without tagging it.

          A `radiogroup` of real buttons rather than a `<select>`: the whole
          point is that all ten are visible and one press away, the way the
          attendance ticks read. Pressing the chosen number again clears it, so a
          tag applied by mistake can be removed without reloading the day.
        */}
        <div>
          <span className="modal-form-label" id="evaluation-lesson-number-label">
            Lesson
          </span>
          <div
            role="radiogroup"
            aria-labelledby="evaluation-lesson-number-label"
            onKeyDown={handleLessonKeyDown}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.15rem' }}
          >
            {LESSON_NUMBERS.map((number) => {
              const picked = lessonNumber === number;
              const recorded = recorded_has(recordedLessons, number);
              return (
                <button
                  key={number}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  // A bare digit tells a screen reader nothing. The name says
                  // which lesson it opens and whether a report already exists,
                  // because that is the difference between editing and starting
                  // one — and on screen that difference is carried by a dot.
                  aria-label={
                    `Lesson ${number}: ${recorded ? 'edit the recorded report' : 'no report yet'}`
                  }
                  title={
                    `Lesson ${number} of ${LESSONS_PER_LEVEL} — ${
                      recorded ? 'report recorded' : 'not recorded yet'
                    }`
                  }
                  // Roving tab stop, as on the rating rows: one stop for the
                  // whole group, landing on the selected lesson.
                  tabIndex={picked || (lessonNumber === null && number === 1) ? 0 : -1}
                  onClick={() => onLessonChange?.(number)}
                  style={{
                    position: 'relative',
                    width: '2rem',
                    height: '2rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '7px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: picked
                      ? 'var(--primary-blue)'
                      : recorded
                        ? 'var(--success-bg)'
                        : 'var(--card-bg)',
                    color: picked
                      ? '#ffffff'
                      : recorded
                        ? 'var(--free-text)'
                        : 'var(--text-secondary)',
                    border: `1px solid ${
                      picked
                        ? 'var(--primary-blue)'
                        : recorded
                          ? 'var(--success-border)'
                          : 'var(--border-color)'
                    }`,
                  }}
                >
                  {number}
                  {/* A second, non-colour cue that a report exists, so the state
                      does not rest on green alone. */}
                  {recorded && !picked && (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        top: '2px',
                        right: '3px',
                        width: '4px',
                        height: '4px',
                        borderRadius: '50%',
                        background: 'var(--free-text)',
                      }}
                    />
                  )}
                </button>
              );
            })}
            <span
              style={{
                alignSelf: 'center',
                marginLeft: '0.3rem',
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
              }}
            >
              {lessonNumber
                ? recorded_has(recordedLessons, lessonNumber)
                  ? `Editing the Lesson ${lessonNumber} report`
                  : `New report for Lesson ${lessonNumber}`
                : 'Pick a lesson to open its report'}
            </span>
          </div>
        </div>

        {/* The five rating rows */}
        <div role="group" aria-label="Competency ratings" style={{ display: 'grid', gap: '0.9rem' }}>
          {COMPETENCIES.map((competency) => {
            const selected = form.scores[competency.key];
            const groupLabelId = `rating-label-${competency.key}`;
            const descriptorId = `rating-descriptor-${competency.key}`;
            const descriptor = descriptorFor(competency.key, selected);

            return (
              <div
                key={competency.key}
                style={{
                  border: '1px solid var(--border-color)',
                  borderLeft: `3px solid ${competency.color}`,
                  borderRadius: '10px',
                  padding: '0.7rem 0.9rem',
                  background: 'var(--bg-color)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    id={groupLabelId}
                    style={{ fontSize: '0.85rem', fontWeight: 700, color: competency.color }}
                  >
                    {competency.label}
                  </span>

                  <div
                    role="radiogroup"
                    aria-labelledby={groupLabelId}
                    aria-describedby={descriptorId}
                    onKeyDown={(event) => handleRowKeyDown(event, competency.key)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    {RATINGS.map((rating) => {
                      const isSelected = selected === rating;
                      const filled = selected !== null && rating <= selected;
                      // Req 1.18 — the score and its meaning, never "star 4".
                      const optionLabel = `${competency.label}, ${rating} of 5, ${descriptorFor(
                        competency.key,
                        rating
                      )}`;

                      return (
                        <button
                          key={rating}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          aria-label={optionLabel}
                          title={optionLabel}
                          // Roving tab stop: one stop per row, landing on the
                          // selection, or on the first option when unrated.
                          tabIndex={isSelected || (selected === null && rating === 1) ? 0 : -1}
                          onClick={() => setScore(competency.key, rating)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: '0.15rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            lineHeight: 0,
                            color: filled ? competency.color : 'var(--text-muted)',
                          }}
                        >
                          <Star
                            size={22}
                            aria-hidden="true"
                            fill={filled ? competency.color : 'none'}
                            strokeWidth={1.75}
                          />
                        </button>
                      );
                    })}

                    <span style={{ ...VISUALLY_HIDDEN }}>
                      {selected === null ? 'Not yet rated' : `${selected} of 5`}
                    </span>
                  </div>
                </div>

                {/* Req 1.17 — the live descriptor, straight from the rubric module. */}
                <p
                  id={descriptorId}
                  style={{
                    margin: '0.45rem 0 0',
                    fontStyle: 'italic',
                    fontSize: '0.75rem',
                    lineHeight: 1.5,
                    color: selected === null ? 'var(--text-muted)' : 'var(--text-secondary)',
                  }}
                >
                  {selected === null ? 'Not yet rated' : descriptor}
                </p>
              </div>
            );
          })}
        </div>

        {/* Instructor remarks */}
        <div>
          <label className="modal-form-label" htmlFor="evaluation-notes">
            Instructor Remarks
          </label>
          <textarea
            id="evaluation-notes"
            rows={3}
            placeholder="What went well, and what to work on next session..."
            value={form.instructorNotes}
            onChange={(event) => setForm({ ...form, instructorNotes: event.target.value })}
            className="modal-textarea-field"
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>

        {/*
          Req 1.13 — the API's own message. `role="alert"` announces it without
          moving focus, so the form keeps the values that are still in it.
        */}
        {error ? (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              border: '1px solid var(--danger-border)',
              background: 'var(--danger-bg)',
              color: 'var(--danger)',
              borderRadius: '8px',
              padding: '0.6rem 0.75rem',
              fontSize: '0.8rem',
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <span>{error}</span>
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          {/*
            Why Save is disabled, in text: a disabled control with no stated
            reason is a dead end. Not the descriptor wording, so no rubric text
            is duplicated here.
          */}
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {lessonNumber === null
              ? 'Pick the lesson this report is for to save.'
              : unrated.length > 0
              ? `Rate all five competencies to save — still to rate: ${unrated
                  .map((c) => c.label)
                  .join(', ')}.`
              : selectedInstructor === ''
                ? 'Choose an instructor to save.'
                : evaluation
                  ? 'Saving updates this day’s evaluation.'
                  : ''}
          </span>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSave}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              borderRadius: '10px',
              padding: '0.5rem 1.2rem',
              fontSize: '0.85rem',
              opacity: canSave ? 1 : 0.55,
              cursor: canSave ? 'pointer' : 'not-allowed',
            }}
          >
            <SaveIcon size={16} />
            {saving ? 'Saving...' : 'Save Evaluation'}
          </button>
        </div>
      </div>
    </form>
  );
}
