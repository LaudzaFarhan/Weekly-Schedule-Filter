'use client';

/**
 * Rubrics and Setup — the second Report Cards page.
 *
 * The scoring guidelines used to be a third mode inside the Report Cards page,
 * reached by a button next to Evaluate and Preview. They are reference material
 * rather than something you do to a student, so they now have their own page and
 * the evaluator is left to do one job.
 *
 * NOTE ON SCOPE: this page currently DISPLAYS the rubric, read-only. Editing it —
 * adding and removing competencies so the set can differ per program — is a
 * data-model change, not a UI one: the five competencies are five NOT NULL
 * columns on `internal_student_evaluations`, and they are baked into the
 * averages, the radar's five axes, the validator and the printed summary. That
 * work is scoped separately; see the note rendered at the foot of this page so
 * the limitation is visible to whoever opens it rather than only in a commit
 * message.
 */

import React from 'react';
import { ClipboardList, Info } from 'lucide-react';

import ScoringGuidelinesPanel from '../components/reportcards/ScoringGuidelinesPanel';
import { COMPETENCIES } from '../lib/reportCardRubric';

export default function NewRubricSetupPage() {
  return (
    <section className="dashboard-view active">
      <div className="panel" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.15rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <ClipboardList size={17} aria-hidden="true" />
            Rubrics and Setup
          </h2>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {`The ${COMPETENCIES.length} competencies every evaluation is scored against, and what each score from 1 to 5 means.`}
          </span>
        </div>
      </div>

      {/* The full 5 × 5 guidelines table — the same component the evaluator shows
          beside the form, in its wide variant. */}
      <ScoringGuidelinesPanel variant="full" />

      {/*
        Stated on the page, not buried in a comment: the rubric is fixed for now.
        Someone arriving here expecting to add a competency should find out why
        they cannot, rather than hunting for a button that does not exist.
      */}
      <div
        className="panel"
        style={{ marginTop: '1.5rem', display: 'flex', gap: '0.7rem', padding: '1rem 1.25rem', alignItems: 'flex-start' }}
      >
        <Info size={16} aria-hidden="true" style={{ color: 'var(--primary-blue)', flexShrink: 0, marginTop: '0.1rem' }} />
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text-main)' }}>Editing the rubric is not available yet.</strong>
          {' '}
          These {COMPETENCIES.length} competencies are stored as five fixed columns on every
          evaluation, so adding or removing one changes the shape of every record already
          saved — along with the averages, the radar chart and the printed report.
          Making the set configurable per program is planned as its own piece of work.
        </div>
      </div>
    </section>
  );
}
