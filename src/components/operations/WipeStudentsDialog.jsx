'use client';

/**
 * The confirmation modal for the New Operations student bulk wipe.
 *
 * Three gates live here, and each one can stop the wipe on its own:
 *   1. an `.xlsx` export must complete before anything else is possible,
 *   2. the exact phrase `DELETE ALL STUDENTS` must be typed,
 *   3. only one wipe can be in flight at a time.
 *
 * The record count is a snapshot frozen when the dialog mounts. The page
 * polls the registry every three seconds, so recomputing the number here
 * would let it move under the user mid-decision; the copy states that the
 * wipe removes every record held at the moment it runs, which may differ
 * from the number shown. Req 3.1, 3.10, 9.5
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Trash2, X } from 'lucide-react';
import { downloadStudentExport } from '../../lib/studentExport';
import { matchesConfirmationPhrase, WIPE_CONFIRMATION_PHRASE } from '../../lib/wipeConfirmation';

/**
 * `XLSX.writeFile` is synchronous, so the export cannot be aborted part way.
 * The elapsed time is measured instead and an over-budget run is reported as
 * a failure. Req 2.2, 2.6
 */
export const EXPORT_TIME_BUDGET_MS = 10000;

/** Data cleared by the wipe, named in the dialog's accessible description. Req 3.2 */
const DELETED_DATA = [
  'Student records — every student in every branch',
  'Student branch history — the branch moves recorded against each student',
  'Live lesson progress — the per-student progress rows keyed by student name',
];

/** Data the wipe never touches, named in the same description. Req 3.2 */
const KEPT_DATA = [
  'Class schedule',
  'Instructors',
  'Leave records',
  'Operational rules',
  'CRM leads',
];

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * @param {object} props
 * @param {number} props.studentCount snapshot taken by the page at open time
 * @param {boolean} [props.filtersActive] search/level/branch/status differ from defaults
 * @param {Array<Record<string, unknown>>} [props.students] unfiltered registry rows, for the export
 * @param {() => void} props.onCancel
 * @param {() => Promise<void>} props.onConfirm resolves on success, rejects on failure
 */
export default function WipeStudentsDialog({
  studentCount,
  filtersActive = false,
  students = [],
  onCancel,
  onConfirm,
}) {
  // Frozen at mount: a later `studentCount` prop cannot move it. Req 3.1, 3.10, 9.5
  const [snapshotCount] = useState(() => {
    const n = Number(studentCount);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  });

  const [exportDone, setExportDone] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState('idle'); // 'idle' | 'running'
  const [wipeError, setWipeError] = useState(null);

  const dialogRef = useRef(null);
  const exportButtonRef = useRef(null);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const scopeId = `${baseId}-scope`;
  const inputId = `${baseId}-confirm`;

  const running = phase === 'running';

  // Derived on every render, so typing, deletion, paste, autofill and a
  // programmatic value replacement are all covered by the controlled input's
  // onChange. Req 2.5, 2.7, 2.8, 3.5, 3.6, 6.6
  const phraseOk = matchesConfirmationPhrase(text);
  const canType = exportDone;
  const canWipe = exportDone && phraseOk && !running;

  // Initial keyboard focus on the export action, not the input, not the wipe
  // button. Req 3.11
  useEffect(() => {
    exportButtonRef.current?.focus();
  }, []);

  const requestCancel = useCallback(() => {
    if (running) return; // cancel is disabled while a wipe is in flight. Req 6.6
    onCancel?.();
  }, [running, onCancel]);

  const handleExport = useCallback(() => {
    setExportError(null);
    try {
      const elapsedMs = downloadStudentExport(Array.isArray(students) ? students : []);
      if (elapsedMs > EXPORT_TIME_BUDGET_MS) {
        // Over budget counts as a failure: no arming, retry still allowed.
        // Req 2.6, 2.10
        setExportDone(false);
        setExportError(
          `The export did not finish within ${EXPORT_TIME_BUDGET_MS / 1000} seconds `
          + `(it took ${(elapsedMs / 1000).toFixed(1)} seconds). Try the export again.`,
        );
        return;
      }
      setExportDone(true); // Req 2.5
    } catch (err) {
      setExportDone(false);
      setExportError(
        `The export failed: ${err?.message || 'the spreadsheet could not be generated'}. `
        + 'Try the export again.',
      );
    }
  }, [students]);

  const handleWipe = useCallback(async () => {
    if (phase === 'running') return; // repeat activation is a no-op. Req 6.7
    if (!canWipe) return;
    setWipeError(null);
    setPhase('running');
    try {
      await onConfirm?.();
      // On success the page unmounts this dialog; nothing to reset here.
    } catch (err) {
      // Keep `text` and `exportDone` so the user can retry immediately. Req 6.4
      setPhase('idle');
      setWipeError(err?.message || 'The wipe failed. No records were deleted.');
    }
  }, [phase, canWipe, onConfirm]);

  /** Tab and Shift+Tab cycle across the dialog's focusable controls. Req 3.12 */
  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      requestCancel(); // Req 3.7
      return;
    }
    if (event.key !== 'Tab') return;

    const nodes = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || []);
    if (nodes.length === 0) {
      event.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !nodes.includes(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !nodes.includes(active)) {
      event.preventDefault();
      first.focus();
    }
  }, [requestCancel]);

  /** A mousedown on the overlay itself, never on the panel. Req 3.7 */
  const handleBackdropMouseDown = useCallback((event) => {
    if (event.target === event.currentTarget) requestCancel();
  }, [requestCancel]);

  const countLabel = useMemo(
    () => `${snapshotCount} student ${snapshotCount === 1 ? 'record' : 'records'}`,
    [snapshotCount],
  );

  return (
    <div
      onMouseDown={handleBackdropMouseDown}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={scopeId}
        style={{
          background: 'var(--panel-bg)',
          width: '100%',
          maxWidth: '560px',
          maxHeight: '92vh',
          borderRadius: '16px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
          animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-color)',
        }}>
          <h2
            id={titleId}
            style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)' }}
          >
            <AlertTriangle size={18} /> Delete All Student Records
          </h2>
          <button
            type="button"
            onClick={requestCancel}
            disabled={running}
            aria-label="Close"
            title="Close"
            style={{
              background: 'transparent', border: 'none', cursor: running ? 'not-allowed' : 'pointer',
              color: 'var(--text-muted)', padding: '0.25rem', borderRadius: '4px', display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Frozen snapshot count. Req 3.1, 3.10 */}
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            The student list currently holds <strong>{countLabel}</strong>. This action cannot be undone.
          </p>

          {/* Req 9.5 — the count is a snapshot, the wipe is not scoped to it */}
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            The wipe deletes every student record held at the moment it runs, which may differ from
            the number shown above.
          </p>

          {/* Req 3.9 — a narrowed view does not narrow the wipe */}
          {filtersActive && (
            <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600, color: 'var(--danger)' }}>
              Filters are active on this page. The wipe covers every student record in the database,
              not only the filtered rows shown on screen.
            </p>
          )}

          {/* Accessible description: what goes, what stays. Req 3.2 */}
          <div id={scopeId} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div>
              <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--danger)' }}>
                Will be deleted
              </h3>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {DELETED_DATA.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                Will be kept
              </h3>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {KEPT_DATA.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>

          {/* Req 3.3 — the schedule consequence, stated before the user commits */}
          <p style={{
            margin: 0,
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            background: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '0.7rem 0.8rem',
          }}>
            Class records keep their stored student names, so the weekly schedule looks unchanged. The
            Schedule page reports zero unallocated students until a new student list is imported.
          </p>

          {/* Step 1 — the mandatory export. Req 2.1, 2.10 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label className="modal-form-label" style={{ marginBottom: 0 }}>
              Step 1 — Download a backup
            </label>
            <button
              ref={exportButtonRef}
              type="button"
              onClick={handleExport}
              className="btn"
              style={{
                alignSelf: 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: 'transparent',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '0.5rem 1.2rem',
                fontSize: '0.85rem',
              }}
            >
              <Download size={16} /> Export student list (.xlsx)
            </button>
            {exportDone && (
              <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>
                Export downloaded. You can now type the confirmation phrase.
              </span>
            )}
            {exportError && (
              <span role="alert" style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>
                {exportError}
              </span>
            )}
          </div>

          {/* Step 2 — the typed phrase. Req 3.4, 3.5, 3.6, 2.8 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label className="modal-form-label" htmlFor={inputId} style={{ marginBottom: 0 }}>
              Step 2 — Type <code style={{ fontWeight: 700, letterSpacing: '0.03em' }}>{WIPE_CONFIRMATION_PHRASE}</code> to confirm
            </label>
            <input
              id={inputId}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!canType || running}
              autoComplete="off"
              placeholder={WIPE_CONFIRMATION_PHRASE}
              className="modal-input-field"
            />
            {!canType && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                The export must complete before the confirmation phrase can be typed.
              </span>
            )}
          </div>

          {wipeError && (
            <span role="alert" style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>
              {wipeError}
            </span>
          )}
        </div>

        {/* Actions Footer */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '0.75rem',
          background: 'var(--bg-color)',
        }}>
          {/* Progress indicator while the wipe runs. Req 6.6 */}
          {running && (
            <div
              className="loading-spinner"
              role="status"
              aria-label="Deleting all student records"
              style={{ width: '18px', height: '18px', borderWidth: '2px', margin: 0, marginRight: 'auto' }}
            />
          )}
          <button
            type="button"
            onClick={requestCancel}
            disabled={running}
            className="btn"
            style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleWipe}
            disabled={!canWipe}
            className="btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'transparent',
              border: '1px solid var(--danger-border)',
              color: 'var(--danger)',
              borderRadius: '10px',
              padding: '0.5rem 1.5rem',
              fontSize: '0.85rem',
              cursor: canWipe ? 'pointer' : 'not-allowed',
            }}
          >
            <Trash2 size={16} /> {running ? 'Deleting…' : 'Delete all students'}
          </button>
        </div>
      </div>
    </div>
  );
}
