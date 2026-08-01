import React from 'react';

import {
  ACADEMY_HEADER_TEXT,
  REPORT_TITLE,
  ACADEMIC_DIRECTOR_NAME,
  DEFAULT_LEAD_INSTRUCTOR_NAME,
} from '../../lib/reportCardBranding';
import { COMPETENCIES } from '../../lib/reportCardRubric';

/**
 * The Report_Document — the printable one-page Student Learning Journey Report,
 * and the only element visible under `@media print` (Req 5.1).
 *
 * Blocks, top to bottom, in the order the print stylesheet pins page breaks on
 * (Req 5.1): academy header, student row (name / instructor / current term /
 * overall grade), Performance Breakdown (the radar), Competency Mastery Summary,
 * Instructor Remarks, and the two signature lines with a name beneath each.
 *
 * Four rules in this file are load-bearing rather than stylistic:
 *
 *   1. NO academy name and NO person's name is written here (Req 5.2). Every one
 *      of those four values comes from `src/lib/reportCardBranding.js`, so a
 *      rebrand or a change of signatory is one edit in one configuration file.
 *      `Lead Instructor` and `Academic Director` are role labels, not names.
 *   2. Zero evaluations prints the band `NOT YET ASSESSED` and NOTHING numeric —
 *      no score, no competency value, no `/5` text anywhere (Req 3.4, 5.12). A
 *      `0.0/5` on a document a parent keeps reads as a failing grade. Every
 *      numeric branch below is gated on `averages` being present, and the
 *      document stays fully printable in that state.
 *   3. The Competency Mastery Summary prints the SAME five numbers handed to the
 *      radar — the single `averages` object this component is given — each to one
 *      decimal followed by ` / 5.0` (Req 3.7). It does not recompute anything, so
 *      the canvas and the printed lines cannot disagree, and an assessment is
 *      never held only inside a canvas.
 *   4. Every free-text value (lesson topic, instructor remarks, names) is
 *      rendered as React children, which React escapes. There is no
 *      `dangerouslySetInnerHTML` in this file (Req 5.13).
 *
 * The `radar` prop is a ready-rendered node — the page passes the dynamically
 * imported chart — so this module imports no charting code (Req 3.8).
 *
 * Presentational only: no hooks, no state, no data fetching. Styling comes from
 * the `.report-*` and `.term-badge*` classes in `src/app/globals.css`, which the
 * `@media print` block targets by the same names.
 */

/** Printed where a value is genuinely absent, never a zero (Req 4.5, 4.6). */
const EM_DASH = '\u2014';

/** The competency scale is fixed 1..5, so a meter is a fraction of 5. */
const SCALE_MAX = 5;

/**
 * A trimmed non-empty string, or `null`. Used for every free-text value so a
 * whitespace-only remark or instructor name falls through to its empty state
 * rather than printing a blank line.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function text(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * `T2 2026`, or an em dash where there is no such term.
 *
 * @param {{ year?: number, termNumber?: number }|null|undefined} point
 * @returns {string}
 */
function termLabel(point) {
  if (!point || !Number.isFinite(Number(point.termNumber))) return EM_DASH;
  const year = Number.isFinite(Number(point.year)) ? ` ${point.year}` : '';
  return `T${point.termNumber}${year}`;
}

/**
 * One `T1`..`T4` badge. `paid`, `unpaid` and `absent` are visually distinct and
 * the current term adds a ring, so the two axes stay independently readable.
 *
 * @param {{ badge: { termNumber: number, label: string, state: string, current: boolean } }} props
 */
function TermBadge({ badge }) {
  const state = badge?.state === 'paid' || badge?.state === 'unpaid' ? badge.state : 'absent';
  const className = [
    'term-badge',
    `term-badge-${state}`,
    badge?.current ? 'term-badge-current' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return <span className={className}>{badge?.label || `T${badge?.termNumber}`}</span>;
}

/**
 * @param {Object} props
 * @param {{ name?: string }|null} props.student
 * @param {Record<string, number>|null} props.averages Competency_Averages, `null` for none
 * @param {{ score: number|null, label: string }} props.grade the Overall_Grade
 * @param {{ badges?: Array<Object>, currentTerm?: Object|null, startTerm?: Object|null }} props.terms
 * @param {{ instructorName?: string|null, instructorNotes?: string|null, lessonTopic?: string|null, date?: string }|null} props.latest
 *   the evaluation supplying the remarks and the Lead Instructor name (Req 5.3)
 * @param {{ leadInstructor?: string, academicDirector?: string }} [props.signatories]
 * @param {React.ReactNode} [props.radar] the ready-rendered Performance Breakdown chart
 */
export default function ReportCardDocument({
  student,
  averages,
  grade,
  terms,
  latest,
  signatories,
  radar,
}) {
  // Req 3.4 / 5.12: this one flag gates every number on the page. When it is
  // false nothing numeric and no `/5` text is rendered anywhere.
  const assessed = Boolean(averages) && Number.isFinite(Number(grade?.score));
  const gradeLabel = text(grade?.label) || 'NOT YET ASSESSED';

  const studentName = text(student?.name) || EM_DASH;

  // Req 5.3: the instructor recorded on the evaluation wins; then whatever the
  // page passed; then the configured default. Never a name written into this file.
  const leadInstructor =
    text(latest?.instructorName) ||
    text(signatories?.leadInstructor) ||
    DEFAULT_LEAD_INSTRUCTOR_NAME;
  const academicDirector = text(signatories?.academicDirector) || ACADEMIC_DIRECTOR_NAME;

  const badges = Array.isArray(terms?.badges) ? terms.badges : [];
  const lessonTopic = text(latest?.lessonTopic);
  // The lesson this day was tagged as. Optional, so an untagged evaluation
  // prints no Lesson line at all rather than a blank one or a "Lesson —".
  const lessonNumber = Number.isInteger(Number(latest?.lessonNumber))
    && Number(latest.lessonNumber) >= 1
    ? Number(latest.lessonNumber)
    : null;
  const remarks = text(latest?.instructorNotes);

  return (
    <div id="report-card-print">
      {/* 1. Academy header — both lines are configuration (Req 5.2). */}
      <header className="report-doc-header">
        <div className="report-doc-academy">{ACADEMY_HEADER_TEXT}</div>
        <div className="report-doc-title">{REPORT_TITLE}</div>
      </header>

      {/* 2. Student row: name / instructor / current term / overall grade. */}
      <div className="report-student-row">
        <div className="report-field">
          <span className="report-field-label">Student</span>
          <span className="report-field-value">{studentName}</span>
        </div>

        <div className="report-field">
          <span className="report-field-label">Instructor</span>
          <span className="report-field-value">{leadInstructor}</span>
        </div>

        <div className="report-field">
          <span className="report-field-label">Current Term</span>
          <span className="report-field-value">{termLabel(terms?.currentTerm)}</span>
          {badges.length > 0 && (
            <span className="term-badge-row">
              {badges.map((badge) => (
                <TermBadge key={badge?.termNumber ?? badge?.label} badge={badge} />
              ))}
            </span>
          )}
        </div>

        <div className="report-field report-grade">
          <span className="report-field-label">Overall Grade</span>
          {/* No score element at all when unassessed — not a zero, not a dash
              followed by `/5` (Req 3.4, 5.12). */}
          {assessed && (
            <span className="report-grade-score">{`${Number(grade.score).toFixed(1)} / 5.0`}</span>
          )}
          <span className={assessed ? 'report-grade-label' : 'report-grade-label report-grade-unassessed'}>
            {gradeLabel}
          </span>
        </div>
      </div>

      {/* 3. Performance Breakdown — the radar the page handed in, already rendered. */}
      <section className="report-section">
        <h3 className="report-section-title">Performance Breakdown</h3>
        <div className="report-chart-slot">
          {assessed ? (
            radar
          ) : (
            // Req 3.10 / 5.12: state it, rather than print an axis with no plot.
            <p className="report-remarks-empty">No evaluations yet</p>
          )}
        </div>
      </section>

      {/* 4. Competency Mastery Summary — the same five numbers as the radar. */}
      <section className="report-section">
        <h3 className="report-section-title">Competency Mastery Summary</h3>
        {assessed ? (
          <div className="report-mastery">
            {COMPETENCIES.map((competency) => {
              const value = Number(averages[competency.key]);
              const ratio = Math.max(0, Math.min(1, value / SCALE_MAX));
              return (
                <div className="report-mastery-row" key={competency.key}>
                  <span className="report-mastery-label">{competency.label}</span>
                  <span className="report-mastery-meter">
                    <span
                      className="report-mastery-meter-fill"
                      // The meter colour is a custom property, so the printed
                      // bar matches the rubric colour of that competency.
                      style={{
                        width: `${(ratio * 100).toFixed(1)}%`,
                        '--report-meter-color': competency.color,
                      }}
                    />
                  </span>
                  {/* Req 3.7: one decimal, then ` / 5.0`. */}
                  <span className="report-mastery-value">{`${value.toFixed(1)} / 5.0`}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="report-remarks-empty">
            No competency scores have been recorded for this student yet.
          </p>
        )}
      </section>

      {/* 5. Instructor Remarks — free text, rendered as children and so escaped. */}
      <section className="report-section">
        <h3 className="report-section-title">Instructor Remarks</h3>
        {lessonNumber !== null && (
          <div className="report-field">
            <span className="report-field-label">Lesson</span>
            <span className="report-field-value">{`Lesson ${lessonNumber}`}</span>
          </div>
        )}
        {lessonTopic && (
          <div className="report-field">
            <span className="report-field-label">Lesson Topic</span>
            <span className="report-field-value">{lessonTopic}</span>
          </div>
        )}
        <div className="report-remarks-body">
          {remarks || (
            <span className="report-remarks-empty">No remarks recorded for this lesson.</span>
          )}
        </div>
      </section>

      {/* 6. Two signature lines, a name beneath each (Req 5.1, 5.2, 5.3). */}
      <div className="report-signatures">
        <div className="report-signature">
          <div className="report-signature-rule" />
          <div className="report-signature-name">{leadInstructor}</div>
          <div className="report-signature-role">Lead Instructor</div>
        </div>
        <div className="report-signature">
          <div className="report-signature-rule" />
          <div className="report-signature-name">{academicDirector}</div>
          <div className="report-signature-role">Academic Director</div>
        </div>
      </div>
    </div>
  );
}
