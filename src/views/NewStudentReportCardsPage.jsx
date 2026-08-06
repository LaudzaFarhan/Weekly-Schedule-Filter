'use client';

/**
 * The Report_Cards_Page at `/new/report-cards` — task 13.1.
 *
 * This page owns four pieces of state and nothing else: the selected student,
 * the selected date, the mode (`evaluate` | `preview` | `rubric`) and the
 * evaluations and term rows loaded for that student. Every number on screen and
 * on paper is derived, on render, from `src/lib/reportCard.js`, so the radar,
 * the trend line, the grade badge and the printed Competency Mastery Summary
 * are one computation with several renderers (Req 3.11).
 *
 * The parts that are requirements rather than layout choices:
 *
 *   - Both charts load through `next/dynamic` with `{ ssr: false }` (Req 3.8).
 *     They reach `window` through Chart.js, so evaluating them during server
 *     rendering would break the build. Neither is imported statically anywhere
 *     in this file.
 *   - A chart that fails to arrive is replaced by the NUMERIC Competency
 *     Mastery Summary, never by an empty box (Req 3.9). Two independent guards
 *     carry that: a `.catch` on each dynamic import, which covers a chunk that
 *     never loads, and `ChartBoundary`, which covers a chart that loads and then
 *     throws while rendering. An assessment is never held only inside a canvas.
 *   - Students arrive through the shared 3 s polling helper, but evaluations and
 *     terms are requested ONCE PER STUDENT SELECTION (Req 6.9, 6.10). They
 *     change only through this page's own writes, so polling them would be load
 *     without information.
 *   - `params.studentId` is honoured on first render and on each change, the
 *     `NewLeavePage` precedent (`useState(params?.x)` plus an effect keyed on
 *     it), and otherwise the first student of the current tab is selected
 *     (Req 6.5, 6.6).
 *   - A failed load keeps the data last loaded successfully in state and raises
 *     a retry toast (Req 2.14). Nothing is discarded on failure.
 *   - Saving merges the record the API returned into the local list, replacing
 *     any record for the same day, and writes exactly one activity entry with
 *     source `students`. A failed log write does not fail the save
 *     (Req 2.17, 3.11).
 *   - Preview lays the document out on screen at print proportions with a Back
 *     control and opens no OS dialog (Req 5.4). Print / Export calls
 *     `window.print()` (Req 5.5), and from evaluate or rubric mode it first
 *     mounts the document off-screen-but-laid-out with
 *     `position: absolute; left: -10000px` — NEVER `display: none`, which would
 *     leave the canvases unsized and print them blank (Req 5.6).
 *   - With no student selected the page renders `.report-print-notice`, which is
 *     invisible on screen and revealed by the print stylesheet, so a print from
 *     that state produces a stated instruction rather than a blank sheet
 *     (Req 5.11).
 *   - Every on-screen wrapper this file introduces around non-report content
 *     carries `no-print`. `StudentSelectorPanel` and `EvaluationForm` already
 *     set it on their own roots.
 */

import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  Award,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Eye,
  Printer,
  RefreshCw,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ui/Toast';
import EvaluationForm from '../components/reportcards/EvaluationForm';
import ReportCardDocument from '../components/reportcards/ReportCardDocument';
import ScoringGuidelinesPanel from '../components/reportcards/ScoringGuidelinesPanel';
import StudentSelectorPanel from '../components/reportcards/StudentSelectorPanel';
import {
  NOT_ASSESSED,
  competencyAverages,
  lessonSeries,
  overallGrade,
  termSummary,
} from '../lib/reportCard';
import { COMPETENCIES } from '../lib/reportCardRubric';
import { REPORT_BRANDING } from '../lib/reportCardBranding';
import { PROGRAM_CATEGORIES, studentProgramCategory } from '../lib/studentFilter';
import { getAllInternalInstructors } from '../services/internalInstructorService';
import { subscribeToInternalStudents } from '../services/internalStudentService';
import { logActivity } from '../services/newActivityService';
import { getEvaluations, saveEvaluation } from '../services/studentEvaluationService';
import { getTerms, saveTerm } from '../services/studentTermService';

/** Printed and shown where a value is genuinely absent (Req 4.5, 4.6). */
const EM_DASH = '\u2014';

/**
 * A student name folded for comparison: trimmed, collapsed whitespace, lowercased.
 *
 * The schedule stores names typed by hand, so "John  Doe" and "john doe" are the
 * same student as far as opening a report card is concerned.
 */
function normaliseName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

/**
 * The two recorded term states, in the order the legend lists them, plus the
 * third for a term with no row at all.
 *
 * `state` matches the `.term-badge-{state}` class and the `badge.state` value
 * `termSummary()` produces, so the legend is keyed off the same vocabulary as
 * the badges rather than a parallel list that could fall out of step.
 */
const TERM_LEGEND = [
  { state: 'paid', label: 'Paid' },
  { state: 'unpaid', label: 'Unpaid' },
  { state: 'absent', label: 'Not recorded' },
];

/** One shared empty array, so a memo dependency does not change every render. */
const EMPTY = Object.freeze([]);

/** Canvas sizes in CSS pixels. Explicit, because the charts run `responsive: false`. */
const SCREEN_RADAR_SIZE = { width: 300, height: 300 };
const SCREEN_TREND_SIZE = { width: 460, height: 250 };
const REPORT_RADAR_SIZE = { width: 300, height: 300 };

/** Off-screen but laid out. NEVER `display: none` — see the file header (Req 5.6). */
const OFFSCREEN_PRINT_STYLE = {
  position: 'absolute',
  left: '-10000px',
  top: 0,
  width: '186mm',
};

/** Ids compare as text: the registry sends numbers, navigation params send strings. */
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** Today as local `YYYY-MM-DD`. Never `toISOString()`, which shifts east of UTC. */
function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** `T2 2026`, or an em dash where there is no such term (Req 4.5, 4.6). */
function termPointLabel(point) {
  if (!point || !Number.isFinite(Number(point.termNumber))) return EM_DASH;
  const year = Number.isFinite(Number(point.year)) ? ` ${point.year}` : '';
  return `T${point.termNumber}${year}`;
}

/**
 * The saved record merged into the local list: any record for the same LESSON is
 * replaced rather than joined, which is the client half of the
 * one-row-per-lesson rule the API enforces with its upsert (Req 3.11).
 *
 * Keyed by lesson, not by day. Replacing by day would drop a different lesson
 * that happened to be graded the same afternoon — two lessons on one day is
 * normal, and the lessons do not run in order.
 *
 * A record with no lesson number is matched by id only, so rows predating the
 * lesson picker are never silently discarded by a save.
 *
 * @param {Array<Object>} list
 * @param {Object} saved
 * @returns {Array<Object>} a new list, ascending by lesson
 */
function mergeEvaluation(list, saved) {
  const savedLesson = Number(saved?.lessonNumber);
  const hasLesson = Number.isInteger(savedLesson) && savedLesson >= 1;

  const rows = (Array.isArray(list) ? list : []).filter((row) => {
    if (saved?.id != null && row?.id != null && String(row.id) === String(saved.id)) return false;
    if (!hasLesson) return true;
    return Number(row?.lessonNumber) !== savedLesson;
  });
  rows.push(saved);
  rows.sort((a, b) => {
    const lessonA = Number(a?.lessonNumber);
    const lessonB = Number(b?.lessonNumber);
    const okA = Number.isInteger(lessonA) && lessonA >= 1;
    const okB = Number.isInteger(lessonB) && lessonB >= 1;
    if (okA && okB && lessonA !== lessonB) return lessonA - lessonB;
    if (okA !== okB) return okA ? -1 : 1; // untagged rows last, as on the chart
    return (
      String(a?.date).localeCompare(String(b?.date)) || (Number(a?.id) || 0) - (Number(b?.id) || 0)
    );
  });
  return rows;
}

/** The saved term row merged in, replacing any row for the same `(year, termNumber)`. */
function mergeTerm(list, saved) {
  const rows = (Array.isArray(list) ? list : []).filter(
    (row) => !(Number(row?.year) === Number(saved?.year) && Number(row?.termNumber) === Number(saved?.termNumber))
  );
  rows.push(saved);
  return rows;
}

/**
 * The record supplying the printed remarks and the Lead Instructor name: the day
 * currently open if it holds one, else the student's most recent evaluation.
 *
 * @param {Array<Object>} evaluations
 * @param {string} date
 * @returns {Object|null}
 */
function reportSource(evaluations, date) {
  const rows = Array.isArray(evaluations) ? evaluations : [];
  const onDate = rows.find((row) => row?.date === date);
  if (onDate) return onDate;

  let latest = null;
  for (const row of rows) {
    if (!row || typeof row.date !== 'string') continue;
    if (
      latest === null ||
      row.date > latest.date ||
      (row.date === latest.date && (Number(row.id) || 0) > (Number(latest.id) || 0))
    ) {
      latest = row;
    }
  }
  return latest;
}

/**
 * The five averages as numbers — the same values a radar would plot, in the same
 * `x.x / 5.0` form the printed Competency Mastery Summary uses (Req 3.7).
 *
 * This is what stands in for a chart that could not be loaded or rendered
 * (Req 3.9): the assessment stays readable as text instead of disappearing with
 * the canvas.
 *
 * @param {Object} props
 * @param {Record<string, number>|null} props.averages
 * @param {string} [props.notice] why the numbers are here instead of a chart
 */
function MasterySummary({ averages, notice }) {
  if (!averages) {
    return <p className="report-remarks-empty">No evaluations yet</p>;
  }

  return (
    <div style={{ width: '100%' }}>
      {notice ? (
        <p
          role="status"
          style={{
            margin: '0 0 0.6rem',
            fontSize: '0.72rem',
            color: 'var(--text-secondary)',
          }}
        >
          {notice}
        </p>
      ) : null}
      <div className="report-mastery">
        {COMPETENCIES.map((competency) => {
          const value = Number(averages[competency.key]);
          const ratio = Math.max(0, Math.min(1, value / 5));
          return (
            <div className="report-mastery-row" key={competency.key}>
              <span className="report-mastery-label">{competency.label}</span>
              <span className="report-mastery-meter">
                <span
                  className="report-mastery-meter-fill"
                  style={{
                    width: `${(ratio * 100).toFixed(1)}%`,
                    '--report-meter-color': competency.color,
                  }}
                />
              </span>
              <span className="report-mastery-value">{`${value.toFixed(1)} / 5.0`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Shown while a chart chunk is in flight. */
function ChartLoading() {
  return (
    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>Loading chart…</p>
  );
}

/**
 * The stand-in for a chart module that never arrived. `next/dynamic` renders it
 * with the props the chart would have had, so `averages` is already here and the
 * numbers can be printed straight away (Req 3.9).
 */
function ChartUnavailable({ averages }) {
  return (
    <MasterySummary
      averages={averages}
      notice="The chart could not be loaded, so the competency averages are shown as numbers."
    />
  );
}

/**
 * A chart that loads and then throws — a Chart.js registration clash, a canvas
 * the browser refuses — must not take the assessment down with it. This boundary
 * renders the same numeric summary in that case (Req 3.9).
 *
 * A class component because that is the only way to catch a render error in
 * React; there is no hook equivalent.
 */
class ChartBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('A report card chart failed to render:', error);
  }

  render() {
    if (this.state.failed) {
      return (
        <MasterySummary
          averages={this.props.averages}
          notice="The chart could not be drawn, so the competency averages are shown as numbers."
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Both charts are client-only (Req 3.8) and both degrade to the numeric summary
 * if their chunk cannot be fetched (Req 3.9). The `.catch` returns a module
 * whose default export takes the chart's own props, so the swap is invisible to
 * the call site.
 */
const CompetencyRadarChart = dynamic(
  () =>
    import('../components/reportcards/CompetencyRadarChart').catch((error) => {
      console.error('Could not load the competency radar chart:', error);
      return { default: ChartUnavailable };
    }),
  { ssr: false, loading: () => <ChartLoading /> }
);

const ProgressTrendChart = dynamic(
  () =>
    import('../components/reportcards/ProgressTrendChart').catch((error) => {
      console.error('Could not load the progress trend chart:', error);
      return { default: ChartUnavailable };
    }),
  { ssr: false, loading: () => <ChartLoading /> }
);

/** `requestAnimationFrame`, with a timer fallback for environments without it. */
const nextFrame = (callback) =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 16);

const cancelFrame = (handle) => {
  if (handle == null) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
};

/**
 * @param {Object} props
 * @param {(page: string, params?: object) => void} [props.onNavigate]
 * @param {{ studentId?: number|string, studentName?: string }|null} [props.params]
 */
export default function NewStudentReportCardsPage({ onNavigate, params, initialMode = 'evaluate', page } = {}) {
  const { user } = useAuth();
  const { showToast } = useToast();

  // ── Owned state ──────────────────────────────────────────────────────────
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [category, setCategory] = useState(PROGRAM_CATEGORIES[0]);
  // The student the user (or a navigation param) picked. The effective
  // selection is derived below, so "the first student of the tab" needs no
  // second piece of state and cannot fall out of step with the tab.
  const [pickedStudentId, setPickedStudentId] = useState(params?.studentId ?? null);
  const [date, setDate] = useState(() => todayISO());
  /**
   * Which lesson's report is open, or `null` for "the day the date field names".
   *
   * The lesson picker selects a REPORT, not a label: lesson 3 opens lesson 3's
   * evaluation with its own scores, topic, remarks and date. Records are still
   * keyed by date in the database — this resolves a lesson to the record tagged
   * with it, so no identity changed to make the picker work.
   */
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [mode, setMode] = useState(page === 'report-cards-list' ? 'list' : initialMode);

  useEffect(() => {
    if (page === 'report-cards-list') setMode('list');
    else if (page === 'report-cards') setMode('evaluate');
  }, [page]);

  const [evaluations, setEvaluations] = useState(EMPTY);
  const [termRows, setTermRows] = useState(EMPTY);
  /** Which student the data in state belongs to; `null` before the first success. */
  const [dataStudentId, setDataStudentId] = useState(null);
  /**
   * The last load failure as `{ studentId, token, message }`. Carrying the
   * student and the retry token with the message means the effect never has to
   * clear this on the way in, so "is this load failing" and "is this load in
   * flight" both stay derived values rather than two more pieces of state to
   * keep in step.
   */
  const [loadFailure, setLoadFailure] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [instructorNames, setInstructorNames] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [savingTerm, setSavingTerm] = useState(null);
  const [printMount, setPrintMount] = useState(false);
  const printMountRef = useRef(null);
  const printTimerRef = useRef(null);

  // ── Students: the shared 3 s poll (Req 6.9) ──────────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeToInternalStudents((data) => {
      setStudents(Array.isArray(data) ? data : []);
      setStudentsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Instructor names for the form's `<select>` (Req 1.10). Fetched once: the
  // list is a lookup, not live data, and a failure leaves the form usable with
  // whatever name the record already carries.
  useEffect(() => {
    let cancelled = false;
    getAllInternalInstructors()
      .then((list) => {
        if (cancelled) return;
        const names = (Array.isArray(list) ? list : [])
          .map((instructor) => instructor?.name)
          .filter((name) => typeof name === 'string' && name.trim() !== '');
        setInstructorNames(names);
      })
      .catch((error) => {
        console.warn('Could not load the instructor list:', error?.message || error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Req 6.5 — the param wins on first render (the `useState` above) and on each
  // change, following the `NewLeavePage` precedent. A navigation param is state
  // owned outside React, so it is read in an effect exactly as `NewLeavePage`
  // and `LeavePage` read theirs; `react-hooks/set-state-in-effect` flags all
  // three the same way.
  useEffect(() => {
    if (params?.studentId != null && params.studentId !== '') {
      setPickedStudentId(params.studentId);
    }
  }, [params?.studentId]);

  /**
   * Resolve `params.studentName` when no id came with the navigation.
   *
   * The schedule grid navigates here from a class card, and `internal_classes`
   * stores a student NAME rather than an id — so the name is resolved against the
   * registry here, where the registry already lives, instead of the grid taking a
   * second subscription to the whole student list for one button.
   *
   * Waits for the registry to arrive: on the first render `students` is empty and
   * resolving then would silently fall back to the first student of the default
   * tab. A name matching nothing leaves the selection alone rather than jumping.
   */
  useEffect(() => {
    if (params?.studentId != null && params.studentId !== '') return;
    const wanted = normaliseName(params?.studentName);
    if (!wanted || students.length === 0) return;
    const match = students.find((st) => normaliseName(st?.name) === wanted);
    if (match) setPickedStudentId(match.id);
  }, [params?.studentId, params?.studentName, students]);

  /**
   * The effective selection: the picked student while that student is still in
   * the registry, otherwise the first student of the current tab (Req 6.6). A
   * student deleted under the page therefore falls back rather than leaving the
   * screen pointing at a record that no longer exists.
   */
  const selectedStudent = useMemo(() => {
    const picked = students.find((student) => sameId(student?.id, pickedStudentId));
    if (picked) return picked;
    return students.find((student) => studentProgramCategory(student) === category) || null;
  }, [students, pickedStudentId, category]);

  const selectedStudentId = selectedStudent?.id ?? null;

  /**
   * A student opened from a navigation param can belong to another tab, so the
   * tab shown follows the selection. Derived rather than synchronised into state
   * by an effect: there is only ever one right answer for a given selection, and
   * an effect would render one frame of the wrong tab first.
   */
  const activeCategory = selectedStudent ? studentProgramCategory(selectedStudent) : category;

  // ── Evaluations and terms: once per selection, never on a poll (Req 6.9) ──
  useEffect(() => {
    if (selectedStudentId == null) return undefined;

    // A new student means a new set of reports. Keeping "lesson 3" selected here
    // would leave the picker pointing at this student's lesson 3 while the date
    // field still named the previous student's, so the selection is cleared with
    // the data it belonged to.
    setSelectedLesson(null);

    let cancelled = false;
    const token = reloadToken;

    Promise.all([
      getEvaluations({ studentId: selectedStudentId }),
      getTerms({ studentId: selectedStudentId }),
    ])
      .then(([loadedEvaluations, loadedTerms]) => {
        if (cancelled) return;
        setEvaluations(Array.isArray(loadedEvaluations) ? loadedEvaluations : EMPTY);
        setTermRows(Array.isArray(loadedTerms) ? loadedTerms : EMPTY);
        setDataStudentId(selectedStudentId);
        setLoadFailure(null);
      })
      .catch((error) => {
        if (cancelled) return;
        // Req 2.14 — nothing already loaded is discarded. The last successful
        // load stays in state, and the toast offers the retry.
        console.error('Could not load the report card data:', error);
        setLoadFailure({
          studentId: selectedStudentId,
          token,
          message: error?.message || 'The report card data could not be loaded.',
        });
        showToast({
          title: 'Could not load this student’s report card data',
          message: `${error?.message || 'The request failed.'} Click here to retry.`,
          variant: 'error',
          duration: 0,
          onClick: () => setReloadToken((current) => current + 1),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedStudentId, reloadToken, showToast]);

  /**
   * True when the data in state is this student's. The rows are retained across
   * a failure (Req 2.14), so this flag is what keeps one student's numbers from
   * being drawn under another student's name while a load is failing.
   */
  const dataReady = dataStudentId != null && sameId(dataStudentId, selectedStudentId);

  /** The failure that belongs to the selection and the retry currently in view. */
  const dataError =
    loadFailure && sameId(loadFailure.studentId, selectedStudentId) && loadFailure.token === reloadToken
      ? loadFailure.message
      : null;

  /** In flight: a student is selected, its data is not here, and nothing failed. */
  const dataLoading = selectedStudentId != null && !dataReady && dataError === null;

  const shownEvaluations = dataReady ? evaluations : EMPTY;
  const shownTerms = dataReady ? termRows : EMPTY;

  // ── Everything below is derived, on every render, from one module ─────────
  const averages = useMemo(() => competencyAverages(shownEvaluations), [shownEvaluations]);
  const grade = useMemo(() => overallGrade(averages), [averages]);
  const series = useMemo(() => lessonSeries(shownEvaluations), [shownEvaluations]);
  const terms = useMemo(() => termSummary(shownTerms), [shownTerms]);

  const assessed = grade.rank !== NOT_ASSESSED.rank;
  const evaluationForDate = useMemo(
    () => shownEvaluations.find((row) => row?.date === date) || null,
    [shownEvaluations, date]
  );

  /** Lesson number → the report tagged with it, for this student. */
  const evaluationsByLesson = useMemo(() => {
    const byLesson = new Map();
    for (const row of shownEvaluations) {
      const lesson = Number(row?.lessonNumber);
      if (!Number.isInteger(lesson) || lesson < 1) continue;
      // Records arrive in `eval_date ASC, id ASC` order, so the last write for a
      // lesson wins — the most recent report is the one the picker opens.
      byLesson.set(lesson, row);
    }
    return byLesson;
  }, [shownEvaluations]);

  /** The lessons that already have a report, so the picker can mark them. */
  const recordedLessons = useMemo(
    () => new Set(evaluationsByLesson.keys()),
    [evaluationsByLesson]
  );

  /**
   * The report the form is editing.
   *
   * With a lesson selected it is that lesson's report, or `null` when the lesson
   * has none yet — deliberately `null` rather than falling back to whatever sits
   * on today's date, so opening an unrecorded lesson starts a blank report
   * instead of quietly re-editing a different lesson's.
   */
  const editingEvaluation =
    selectedLesson === null ? evaluationForDate : evaluationsByLesson.get(selectedLesson) || null;

  /**
   * Open a lesson's report: select it, and move the date field to that report's
   * own date so the saved record is the one being looked at. An unrecorded lesson
   * opens blank, dated today.
   */
  const handleLessonChange = useCallback(
    (lesson) => {
      setSelectedLesson(lesson);
      if (lesson === null) return;
      const existing = evaluationsByLesson.get(lesson);
      setDate(existing?.date || todayISO());
    },
    [evaluationsByLesson]
  );
  const latest = useMemo(() => reportSource(shownEvaluations, date), [shownEvaluations, date]);
  const headerInstructor =
    (typeof latest?.instructorName === 'string' && latest.instructorName.trim()) ||
    REPORT_BRANDING.defaultLeadInstructorName;

  // ── Save (Req 2.17, 3.11) ────────────────────────────────────────────────
  const handleSave = useCallback(
    async (payload) => {
      if (!selectedStudent) return;

      setSaving(true);
      try {
        const saved = await saveEvaluation({ ...payload, studentId: selectedStudent.id });

        // Req 3.11 — the record the API returned is merged in, and every derived
        // value recomputes from that list on the next render.
        setEvaluations((previous) => mergeEvaluation(dataReady ? previous : EMPTY, saved));
        setTermRows((previous) => (dataReady ? previous : EMPTY));
        setDataStudentId(selectedStudent.id);
        setLoadFailure(null);
        if (saved?.date) setDate(saved.date);

        showToast({
          title: `Evaluation saved for ${selectedStudent.name || 'this student'}`,
          message: saved?.date ? `Recorded for ${saved.date}.` : undefined,
          variant: 'success',
        });

        // Req 2.17 — exactly one entry, source `students`, and a failed write
        // never turns a successful save into a failure. `logActivity` returns
        // null instead of throwing; the try/catch covers the rest.
        try {
          await logActivity({
            action: editingEvaluation ? 'edit' : 'add',
            source: 'students',
            summary: `Report card evaluation ${editingEvaluation ? 'updated' : 'recorded'} for ${
              selectedStudent.name || `student ${selectedStudent.id}`
            } on ${saved?.date || payload?.date || todayISO()}`,
            count: 1,
            userEmail: user?.email,
          });
        } catch (logError) {
          console.warn('Could not record the evaluation in the activity log:', logError?.message || logError);
        }

        return saved;
      } finally {
        setSaving(false);
      }
      // The save error itself is deliberately not caught: `EvaluationForm`
      // catches it, shows the API's own message and keeps every entered value
      // (Req 1.13).
    },
    [selectedStudent, dataReady, editingEvaluation, showToast, user?.email]
  );

  // ── Term badges: mark a term paid or unpaid (Req 4.1, 4.9) ───────────────
  const handleToggleTerm = useCallback(
    async (badge) => {
      if (!selectedStudent || !badge) return;
      const nextPaid = badge.state !== 'paid';

      setSavingTerm(badge.termNumber);
      try {
        const saved = await saveTerm({
          studentId: selectedStudent.id,
          year: terms.year,
          termNumber: badge.termNumber,
          paid: nextPaid,
          paidAt: nextPaid ? todayISO() : null,
        });
        setTermRows((previous) => mergeTerm(dataReady ? previous : EMPTY, saved));
        setDataStudentId(selectedStudent.id);
        showToast({
          title: `${badge.label} ${terms.year} marked ${nextPaid ? 'paid' : 'unpaid'}`,
          variant: 'success',
        });
      } catch (error) {
        showToast({
          title: 'Could not update the term',
          message: error?.message || 'The request failed.',
          variant: 'error',
        });
      } finally {
        setSavingTerm(null);
      }
    },
    [selectedStudent, terms.year, dataReady, showToast]
  );

  // ── Print (Req 5.5, 5.6) ─────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    // Preview already has the document mounted and laid out, and with no
    // student selected the print stylesheet reveals the notice (Req 5.11), so
    // both go straight to the dialog.
    if (mode === 'preview' || !selectedStudent) {
      if (typeof window !== 'undefined' && typeof window.print === 'function') window.print();
      return;
    }
    setPrintMount(true);
  }, [mode, selectedStudent]);

  /**
   * The off-screen print pass. Two frames give the canvases a chance to paint at
   * their real size, then the mount is pulled back into the flow with a
   * synchronous style write immediately before `window.print()` — no repaint
   * happens between the two, and the document is never removed from layout
   * (Req 5.6).
   */
  useEffect(() => {
    if (!printMount) return undefined;

    let second = null;
    const first = nextFrame(() => {
      second = nextFrame(() => {
        const node = printMountRef.current;
        if (node) {
          node.style.position = 'static';
          node.style.left = 'auto';
        }
        try {
          if (typeof window !== 'undefined' && typeof window.print === 'function') window.print();
        } finally {
          if (node) {
            node.style.position = OFFSCREEN_PRINT_STYLE.position;
            node.style.left = OFFSCREEN_PRINT_STYLE.left;
          }
          printTimerRef.current = setTimeout(() => setPrintMount(false), 0);
        }
      });
    });

    return () => {
      cancelFrame(first);
      cancelFrame(second);
      if (printTimerRef.current) {
        clearTimeout(printTimerRef.current);
        printTimerRef.current = null;
      }
    };
  }, [printMount]);

  const signatories = useMemo(
    () => ({
      leadInstructor: REPORT_BRANDING.defaultLeadInstructorName,
      academicDirector: REPORT_BRANDING.academicDirectorName,
    }),
    []
  );

  /** The document, with its radar wrapped in the Req 3.9 fallback chain. */
  const renderDocument = () => (
    <ReportCardDocument
      student={selectedStudent}
      averages={averages}
      grade={grade}
      terms={terms}
      latest={latest}
      signatories={signatories}
      radar={
        <ChartBoundary averages={averages}>
          <CompetencyRadarChart averages={averages} size={REPORT_RADAR_SIZE} />
        </ChartBoundary>
      }
    />
  );

  const modeButton = (value, label, Icon) => {
    const active = mode === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setMode(value)}
        aria-pressed={active}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          cursor: 'pointer',
          padding: '0.45rem 0.85rem',
          borderRadius: '10px',
          fontSize: '0.8rem',
          fontWeight: active ? 700 : 500,
          background: active ? 'var(--primary-blue)' : 'transparent',
          color: active ? '#ffffff' : 'var(--text-secondary)',
          border: `1px solid ${active ? 'var(--primary-blue)' : 'var(--border-color)'}`,
        }}
      >
        <Icon size={15} aria-hidden="true" />
        {label}
      </button>
    );
  };

  return (
    <section className="dashboard-view active">
      {/*
        Req 5.11 — invisible on screen (`.report-print-notice { display: none }`)
        and revealed only by the print stylesheet, so a print requested with no
        student selected produces this instruction instead of a blank sheet.
      */}
      {!selectedStudent ? (
        <div className="report-print-notice">
          Select a student on the Report Cards page before printing a Student Learning Journey
          Report.
        </div>
      ) : null}

      {/* Page header and the mode switch — chrome, so it never prints. */}
      <div
        className="panel no-print"
        style={{ margin: '0 0 1.25rem' }}
      >
        <div
          className="panel-header"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: 600,
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
              }}
            >
              <ClipboardList size={20} aria-hidden="true" />
              {mode === 'list' ? 'Report List' : 'Report Cards'}
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              {mode === 'list'
                ? 'Browse all student report cards, filter by program or branch, and open student evaluations.'
                : 'Record a daily evaluation, follow the progress and print the Student Learning Journey Report.'}
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
            {modeButton('list', 'Report List', Users)}
            {modeButton('evaluate', 'Evaluate', ClipboardList)}
            {modeButton('preview', 'Preview Report', Eye)}

            <button
              type="button"
              className="btn btn-primary"
              onClick={handlePrint}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                borderRadius: '10px',
                padding: '0.5rem 1rem',
                fontSize: '0.8rem',
              }}
            >
              <Printer size={15} aria-hidden="true" />
              Print / Export PDF
            </button>
          </div>
        </div>
      </div>

      {mode === 'list' ? (
        <div
          className="no-print"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(300px, 340px) minmax(0, 1fr)',
            gap: '1.25rem',
            alignItems: 'start',
          }}
        >
          {/* Main Student Selector / Report List Panel */}
          <StudentSelectorPanel
            students={students}
            category={activeCategory}
            onCategoryChange={(next) => {
              setCategory(next);
              setPickedStudentId(null);
            }}
            selectedStudentId={selectedStudentId}
            onSelectStudent={(id) => setPickedStudentId(id)}
          />

          {/* Selected Student Overview & Quick Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minWidth: 0 }}>
            {selectedStudent ? (
              <div className="panel" style={{ margin: 0 }}>
                <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>{selectedStudent.name}</h3>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {selectedStudent.branchName || 'All Branches'} · {selectedStudent.program || 'No program assigned'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setMode('evaluate')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                  >
                    <ClipboardList size={15} /> Evaluate Report Card
                  </button>
                </div>

                <div className="panel-body" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
                    <div>
                      <h4 style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 0.5rem' }}>
                        Competency Mastery Summary
                      </h4>
                      <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', margin: '0 0 0.8rem' }}>
                        Average ratings derived from {shownEvaluations.length} evaluation{shownEvaluations.length === 1 ? '' : 's'} on record:
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {(COMPETENCIES[activeCategory] || []).map((c) => {
                          const avg = averages[c.key] || 0;
                          return (
                            <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', padding: '0.35rem 0.65rem', borderRadius: '8px', background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                              <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{c.label}</span>
                              <span style={{ fontWeight: 700, color: avg > 0 ? 'var(--primary-blue)' : 'var(--text-muted)' }}>
                                {avg > 0 ? `${avg.toFixed(1)} / 5.0` : 'Unassessed'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <ChartBoundary averages={averages}>
                        <CompetencyRadarChart averages={averages} size={{ width: 250, height: 250 }} />
                      </ChartBoundary>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel" style={{ margin: 0, padding: '2.5rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Users size={36} style={{ opacity: 0.4, marginBottom: '0.6rem' }} />
                <h4 style={{ margin: '0 0 0.3rem', fontSize: '0.95rem', color: 'var(--text-main)' }}>Select a Student</h4>
                <p style={{ margin: 0, fontSize: '0.82rem' }}>Pick a program tab (K, J, C) and click a student from the Report List on the left to view their report card.</p>
              </div>
            )}
          </div>
        </div>
      ) : mode === 'preview' ? (
        // Req 5.4 — the document laid out on screen at print proportions, with a
        // way back, and no operating-system dialog opened.
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
          <div
            className="no-print"
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignSelf: 'flex-start',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => setMode('evaluate')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
                padding: '0.45rem 0.85rem',
                borderRadius: '10px',
                fontSize: '0.8rem',
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
              }}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Back to evaluate
            </button>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Preview only — nothing is printed until you choose Print / Export PDF.
            </span>
          </div>

          {selectedStudent ? (
            renderDocument()
          ) : (
            <p className="no-print" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Select a student to preview a report.
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>
          {/* Student header: name, instructor, start term, current term, badges. */}
          <div className="panel no-print" style={{ margin: 0 }}>
            <div className="panel-body" style={{ padding: '1rem 1.25rem' }}>
              {!selectedStudent ? (
                <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                  <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                    {studentsLoading
                      ? 'Loading students…'
                      : 'No student selected yet. Pick a student from the Report List to record an evaluation.'}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setMode('list')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      borderRadius: '10px',
                      padding: '0.5rem 1rem',
                      fontSize: '0.8rem',
                    }}
                  >
                    <Users size={15} aria-hidden="true" />
                    Open Report List
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '1.25rem',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'grid', gap: '0.35rem', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: '1.15rem',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        <User size={18} aria-hidden="true" />
                        {selectedStudent.name || EM_DASH}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setMode('list')}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          borderRadius: '8px',
                          padding: '0.3rem 0.65rem',
                          fontSize: '0.75rem',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-color)',
                          cursor: 'pointer',
                        }}
                      >
                        <Users size={13} aria-hidden="true" />
                        Change Student (Report List)
                      </button>
                    </div>
                      <span
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.9rem',
                          fontSize: '0.78rem',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <span>{`Instructor: ${headerInstructor}`}</span>
                        {/* Req 4.6 — an em dash, never a term label, when there is none. */}
                        <span>{`Start term: ${termPointLabel(terms.startTerm)}`}</span>
                        {/* Req 4.5 — an em dash when no term is paid. */}
                        <span>{`Current term: ${termPointLabel(terms.currentTerm)}`}</span>
                        <span>{`${selectedStudent.level || EM_DASH} · ${
                          selectedStudent.branchName || EM_DASH
                        }`}</span>
                      </span>

                      {/*
                        Req 4.9 — paid, unpaid and absent are three visually
                        distinct styles from `globals.css`, and the current badge
                        adds a ring on top of its state colour, so the two axes
                        stay independently readable. Each badge is a real button,
                        so the state is also in the accessible name rather than
                        carried by colour alone.
                      */}
                      <span data-tour="term-badges" className="term-badge-row">
                        {terms.badges.map((badge) => (
                          <button
                            key={badge.termNumber}
                            type="button"
                            className={[
                              'term-badge',
                              `term-badge-${badge.state}`,
                              badge.current ? 'term-badge-current' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => handleToggleTerm(badge)}
                            disabled={savingTerm === badge.termNumber}
                            aria-label={`${badge.label} ${terms.year}: ${badge.state}${
                              badge.current ? ', current term' : ''
                            }. Mark ${badge.state === 'paid' ? 'unpaid' : 'paid'}.`}
                            title={`${badge.label} ${terms.year} — ${badge.state}${
                              badge.current ? ' (current term)' : ''
                            }`}
                            style={{ cursor: 'pointer' }}
                          >
                            {badge.label}
                          </button>
                        ))}
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {`Terms ${terms.year}`}
                        </span>
                      </span>

                      {/*
                        What the badge colours mean. Req 4.9 asks for three
                        visually distinct states, but "distinct" is not the same
                        as "self-explanatory": green and amber say nothing about
                        which is paid until something says so. The swatches reuse
                        the `.term-badge-*` classes, so this legend cannot drift
                        from the badges above it.

                        `no-print`: the printed report card is
                        `ReportCardDocument`, and a parent has no business reading
                        an interaction hint about clicking.
                      */}
                      <span className="term-legend no-print">
                        {TERM_LEGEND.map(({ state, label }) => (
                          <span key={state} className="term-legend-item">
                            <span
                              aria-hidden="true"
                              className={`term-badge term-badge-${state} term-legend-swatch`}
                            />
                            {label}
                          </span>
                        ))}
                        <span className="term-legend-item">
                          <span
                            aria-hidden="true"
                            className="term-badge term-badge-paid term-badge-current term-legend-swatch"
                          />
                          Current term
                        </span>
                        <span className="term-legend-hint">
                          Click a term to switch it between paid and unpaid.
                        </span>
                      </span>
                    </div>

                    <div style={{ textAlign: 'right', display: 'grid', gap: '0.15rem' }}>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          justifyContent: 'flex-end',
                        }}
                      >
                        <Award size={13} aria-hidden="true" />
                        Overall grade
                      </span>
                      {/* Req 3.4 — no number and no `/5` text at all when unassessed. */}
                      {dataLoading && !dataReady ? (
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          Loading…
                        </span>
                      ) : (
                        <>
                          {assessed ? (
                            <span style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                              {`${grade.score.toFixed(1)} / 5.0`}
                            </span>
                          ) : null}
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              letterSpacing: '0.05em',
                              color: assessed ? 'var(--primary-blue)' : 'var(--text-muted)',
                            }}
                          >
                            {grade.label}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Req 2.14 — the retry is reachable without waiting for a toast. */}
                {dataError && !dataReady ? (
                  <div
                    role="alert"
                    style={{
                      marginTop: '0.9rem',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '0.6rem',
                      border: '1px solid var(--danger-border)',
                      background: 'var(--danger-bg)',
                      color: 'var(--danger)',
                      borderRadius: '8px',
                      padding: '0.6rem 0.75rem',
                      fontSize: '0.78rem',
                    }}
                  >
                    <span>{dataError}</span>
                    <button
                      type="button"
                      onClick={() => setReloadToken((token) => token + 1)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        cursor: 'pointer',
                        borderRadius: '8px',
                        padding: '0.3rem 0.7rem',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: 'transparent',
                        color: 'var(--danger)',
                        border: '1px solid var(--danger-border)',
                      }}
                    >
                      <RefreshCw size={13} aria-hidden="true" />
                      Retry
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {/* The standalone guidelines view moved to its own page,
                `report-cards-rubric`, so this page has two modes rather than
                three. The compact reference beside the form stays. */}
            {(
              <>
                {/* Evaluation form — already carries `no-print` on its own root. */}
                <EvaluationForm
                  evaluation={editingEvaluation}
                  lessonNumber={selectedLesson}
                  onLessonChange={handleLessonChange}
                  recordedLessons={recordedLessons}
                  date={date}
                  onDateChange={setDate}
                  evaluations={shownEvaluations}
                  student={selectedStudent}
                  instructorNames={instructorNames}
                  onSave={handleSave}
                  saving={saving}
                />

                {/*
                  On-screen chart panels. The wrapper is not part of the report,
                  so it carries `no-print`; the printed radar comes from the
                  document itself.
                */}
                <div
                  className="no-print"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    gap: '1.25rem',
                  }}
                >
                  <div className="panel" style={{ margin: 0 }}>
                    <div className="panel-header" style={{ display: 'block' }}>
                      <h3
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 600,
                          margin: 0,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        <Award size={16} aria-hidden="true" />
                        Competency Map
                      </h3>
                      <p
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-secondary)',
                          margin: '0.2rem 0 0',
                        }}
                      >
                        The average of every evaluation on record.
                      </p>
                    </div>
                    <div
                      data-tour="radar"
                      className="panel-body"
                      style={{
                        padding: '1rem',
                        display: 'flex',
                        justifyContent: 'center',
                        minHeight: `${SCREEN_RADAR_SIZE.height}px`,
                      }}
                    >
                      <ChartBoundary averages={averages}>
                        <CompetencyRadarChart averages={averages} size={SCREEN_RADAR_SIZE} />
                      </ChartBoundary>
                    </div>
                  </div>

                  <div className="panel" style={{ margin: 0 }}>
                    <div className="panel-header" style={{ display: 'block' }}>
                      <h3
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 600,
                          margin: 0,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        <TrendingUp size={16} aria-hidden="true" />
                        Average Progress Trend
                      </h3>
                      <p
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-secondary)',
                          margin: '0.2rem 0 0',
                        }}
                      >
                        One point per lesson, labelled with its place in the whole history.
                      </p>
                    </div>
                    <div
                      className="panel-body"
                      style={{
                        padding: '1rem',
                        display: 'flex',
                        justifyContent: 'center',
                        minHeight: `${SCREEN_TREND_SIZE.height}px`,
                      }}
                    >
                      {/*
                        `averages` is passed alongside `series` so the Req 3.9
                        fallback has the numbers to print; the chart itself reads
                        only `series` and `size`.
                      */}
                      <ChartBoundary averages={averages}>
                        <ProgressTrendChart
                          series={series}
                          averages={averages}
                          size={SCREEN_TREND_SIZE}
                        />
                      </ChartBoundary>
                    </div>
                  </div>
                </div>

                {/* The compact rubric reference beside the form (Req 1.16). */}
                <div className="no-print">
                  <ScoringGuidelinesPanel variant="compact" />
                </div>

                <div
                  className="no-print"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  <CalendarDays size={14} aria-hidden="true" />
                  <span>
                    {dataReady
                      ? `${shownEvaluations.length} evaluation${
                          shownEvaluations.length === 1 ? '' : 's'
                        } on record${
                          onNavigate ? ' · open the Student Database to edit this student' : ''
                        }`
                      : 'No evaluation data loaded for this student yet.'}
                  </span>
                </div>
              </>
            )}
          </div>
      )}

      {/*
        Req 5.6 — printing from evaluate or rubric mode mounts the document
        off-screen but fully laid out (`position: absolute; left: -10000px`).
        `display: none` would leave the canvases unsized and print them blank, so
        it is never used here, and this wrapper deliberately carries no
        `no-print` class.
      */}
      {printMount && selectedStudent ? (
        <div ref={printMountRef} style={OFFSCREEN_PRINT_STYLE} aria-hidden="true">
          {renderDocument()}
        </div>
      ) : null}
    </section>
  );
}
