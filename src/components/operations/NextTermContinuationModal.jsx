'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  X, CheckCircle2, Clock, Calendar, AlertCircle, Sparkles,
  ArrowRight, ShieldCheck, History, BookOpen, User, DollarSign,
  RotateCcw, PauseCircle, Check, Info, FileText
} from 'lucide-react';
import {
  PROGRESS_UPDATE_STATUSES,
  suggestNextProgramCode,
  buildTermHistoryEntry,
} from '../../utils/progressUpdateUtils';
import { CONTINUATION_OPTIONS, levelsForCategory } from '../../lib/programRules';

export default function NextTermContinuationModal({
  isOpen,
  onClose,
  row,
  category = 'Kinder',
  user = null,
  onConfirmContinuation,
  onSetWaitPayment,
  onSetNotContinue,
}) {
  const [selectedMode, setSelectedMode] = useState('confirm_continue'); // 'confirm_continue' | 'wait_payment' | 'not_continue'
  const [nextTermStartDate, setNextTermStartDate] = useState('');
  const [nextProgramCode, setNextProgramCode] = useState('');
  const [termName, setTermName] = useState('');
  const [paymentType, setPaymentType] = useState('Upfront Paid'); // 'Upfront Paid' | 'Paid After Wait' | 'Transfer Confirmed'
  const [spaNote, setSpaNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Term history from row
  const termHistory = useMemo(() => {
    if (Array.isArray(row?.termHistory) && row.termHistory.length > 0) {
      return row.termHistory;
    }
    return [];
  }, [row?.termHistory]);

  const effectiveCategory = category || row?.category || 'Kinder';
  const availableLevels = useMemo(() => {
    return levelsForCategory(effectiveCategory) || [];
  }, [effectiveCategory]);

  const programOptions = useMemo(() => {
    const list = [...availableLevels];
    if (nextProgramCode && !list.includes(nextProgramCode)) {
      list.push(nextProgramCode);
    }
    return list.length ? list : ['K1', 'K2', 'K3', 'K4', 'KF1', 'KF2', 'J1', 'J2', 'J3', 'J4', 'Coder Basic', 'Coder Intermediate', 'Coder Advance'];
  }, [availableLevels, nextProgramCode]);

  useEffect(() => {
    if (row) {
      // Default next term start date: next week from today
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);
      const defaultDate = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth() + 1).padStart(2, '0')}-${String(nextWeek.getDate()).padStart(2, '0')}`;
      
      setNextTermStartDate(defaultDate);
      const suggested = suggestNextProgramCode(row.program || row.programCode || '', effectiveCategory);
      setNextProgramCode(suggested || availableLevels[0] || 'K1');
      setTermName(`Term ${termHistory.length + 1}`);
      setPaymentType(row.progressUpdateStatus === PROGRESS_UPDATE_STATUSES.WAIT_PAYMENT ? 'Paid After Wait' : 'Upfront Paid');
      setSpaNote(row.progressUpdateNote || '');
      
      if (row.progressUpdateStatus === PROGRESS_UPDATE_STATUSES.WAIT_PAYMENT) {
        setSelectedMode('confirm_continue'); // If wait payment was previously set, default to confirm continuation when opened
      } else {
        setSelectedMode('confirm_continue');
      }
    }
  }, [row, termHistory.length, effectiveCategory, availableLevels]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !row) return null;

  const attendedCount = Object.keys(row.attendance || {}).length;
  const currentProgram = row.program || row.programCode || 'Current Program';
  const instructorName = row.arrangedTeacher || row.instructor || 'Unassigned';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const userIdentifier = user?.fullname || user?.email || user?.name || 'SPA Staff';

      if (selectedMode === 'confirm_continue') {
        // Build archived term entry for current term
        const archivedEntry = buildTermHistoryEntry({
          termName: termName || `Term ${termHistory.length + 1}`,
          termNumber: termHistory.length + 1,
          program: currentProgram,
          category: category || row.category,
          startDate: null,
          completedDate: new Date().toISOString().split('T')[0],
          attendedCount,
          totalMeetings: row.targetMeetings || 10,
          attendance: row.attendance || {},
          paymentType,
          spaNote: spaNote.trim(),
          confirmedBy: userIdentifier,
        });

        const updatedHistory = [archivedEntry, ...termHistory];

        await onConfirmContinuation?.({
          row,
          nextProgramCode: nextProgramCode.trim() || currentProgram,
          nextTermStartDate,
          termHistory: updatedHistory,
          resetAttendance: true,
          continuation: 'Continue',
          progressUpdateStatus: 'Completed',
          spaNote: spaNote.trim(),
        });
      } else if (selectedMode === 'wait_payment') {
        await onSetWaitPayment?.({
          row,
          progressUpdateStatus: PROGRESS_UPDATE_STATUSES.WAIT_PAYMENT,
          progressUpdateNote: spaNote.trim() || 'Waiting for parent payment for next term',
          continuation: 'Continue',
        });
      } else if (selectedMode === 'not_continue') {
        await onSetNotContinue?.({
          row,
          continuation: 'Not Continue',
          progressUpdateStatus: 'Completed',
          progressUpdateNote: spaNote.trim() || 'Student not continuing next term',
        });
      }
      onClose();
    } catch (err) {
      console.error('Failed to submit next term confirmation:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="continuation-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(5px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--panel-bg, #ffffff)',
          color: 'var(--text-main, #1e293b)',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--border-color, #e2e8f0)',
          width: '100%',
          maxWidth: '820px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'modalAppear 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.2rem 1.5rem',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(to right, rgba(99, 102, 241, 0.05), transparent)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '40px', height: '40px', borderRadius: '12px',
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                color: '#ffffff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
              }}
            >
              <Sparkles size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h3 id="continuation-modal-title" style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                  Next Term Continuation Confirmation
                </h3>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '0.18rem 0.55rem',
                    borderRadius: '6px',
                    background: 'rgba(16, 185, 129, 0.12)',
                    color: '#047857',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                  }}
                >
                  Progress Update Done
                </span>
              </div>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary, #64748b)' }}>
                Confirm next term enrollment, record completed term history, and reset attendance for {row.studentName}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted, #94a3b8)',
              padding: '0.4rem',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            
            {/* Student Quick Summary Card */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.75rem',
                padding: '0.9rem 1.1rem',
                background: 'var(--bg-color, #f8fafc)',
                borderRadius: '12px',
                border: '1px solid var(--border-color, #e2e8f0)',
              }}
            >
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Student & Program
                </span>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', marginTop: '0.1rem' }}>
                  {row.studentName}
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)', fontWeight: 600 }}>
                  {currentProgram} ({category})
                </span>
              </div>

              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Completed Lessons
                </span>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#047857', marginTop: '0.1rem' }}>
                  {attendedCount} / {row.targetMeetings || 10} Meetings
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)' }}>
                  Main Teacher: {instructorName}
                </span>
              </div>

              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Current Status
                </span>
                <div style={{ marginTop: '0.15rem' }}>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '0.15rem 0.45rem',
                      borderRadius: '5px',
                      background: row.progressUpdateStatus === PROGRESS_UPDATE_STATUSES.WAIT_PAYMENT ? '#fff7ed' : '#ecfdf5',
                      color: row.progressUpdateStatus === PROGRESS_UPDATE_STATUSES.WAIT_PAYMENT ? '#c2410c' : '#047857',
                      border: `1px solid ${row.progressUpdateStatus === PROGRESS_UPDATE_STATUSES.WAIT_PAYMENT ? '#f97316' : '#10b981'}`,
                    }}
                  >
                    {row.progressUpdateStatus || 'Update Done'}
                  </span>
                </div>
              </div>
            </div>

            {/* Mode Selector Cards */}
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, display: 'block', marginBottom: '0.5rem' }}>
                Select Continuation Case / Action:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                
                {/* Case 1: Confirm Continue (Paid Upfront) */}
                <button
                  type="button"
                  onClick={() => setSelectedMode('confirm_continue')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '0.9rem 1rem',
                    borderRadius: '12px',
                    border: `2px solid ${selectedMode === 'confirm_continue' ? '#4f46e5' : 'var(--border-color, #e2e8f0)'}`,
                    background: selectedMode === 'confirm_continue' ? 'rgba(79, 70, 229, 0.06)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: '0.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#4f46e5', fontSize: '0.9rem' }}>
                      <CheckCircle2 size={16} />
                      Confirm Continue
                    </div>
                    {selectedMode === 'confirm_continue' && (
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, background: '#4f46e5', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                        Selected
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)', lineHeight: 1.4 }}>
                    Parent paid upfront or payment settled. Reset attendance (1–10) & record term history.
                  </p>
                </button>

                {/* Case 2: Wait Payment */}
                <button
                  type="button"
                  onClick={() => setSelectedMode('wait_payment')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '0.9rem 1rem',
                    borderRadius: '12px',
                    border: `2px solid ${selectedMode === 'wait_payment' ? '#f97316' : 'var(--border-color, #e2e8f0)'}`,
                    background: selectedMode === 'wait_payment' ? 'rgba(249, 115, 22, 0.06)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: '0.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#c2410c', fontSize: '0.9rem' }}>
                      <Clock size={16} />
                      Wait Payment
                    </div>
                    {selectedMode === 'wait_payment' && (
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, background: '#f97316', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                        Selected
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)', lineHeight: 1.4 }}>
                    Parent hasn't paid off yet. Mark as "Wait Payment" until invoice is settled.
                  </p>
                </button>

                {/* Case 3: Not Continue / Break */}
                <button
                  type="button"
                  onClick={() => setSelectedMode('not_continue')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '0.9rem 1rem',
                    borderRadius: '12px',
                    border: `2px solid ${selectedMode === 'not_continue' ? '#dc2626' : 'var(--border-color, #e2e8f0)'}`,
                    background: selectedMode === 'not_continue' ? 'rgba(220, 38, 38, 0.06)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: '0.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#dc2626', fontSize: '0.9rem' }}>
                      <PauseCircle size={16} />
                      Break / Stop
                    </div>
                    {selectedMode === 'not_continue' && (
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, background: '#dc2626', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                        Selected
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)', lineHeight: 1.4 }}>
                    Student will take a break or not continue for the upcoming term.
                  </p>
                </button>
              </div>
            </div>

            {/* Dynamic Form Sections based on Mode */}
            {selectedMode === 'confirm_continue' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  padding: '1.1rem',
                  borderRadius: '12px',
                  background: 'rgba(79, 70, 229, 0.03)',
                  border: '1px solid rgba(79, 70, 229, 0.15)',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {/* Next Term Start Date */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                      Next Term Start Date <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={nextTermStartDate}
                      onChange={(e) => setNextTermStartDate(e.target.value)}
                      className="modal-input-field"
                      style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px' }}
                    />
                  </div>

                  {/* Next Program Level Code */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                      Target Program / Next Term Level
                    </label>
                    <select
                      value={nextProgramCode}
                      onChange={(e) => setNextProgramCode(e.target.value)}
                      className="modal-select-field"
                      style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px' }}
                    >
                      {programOptions.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {lvl}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Payment Type */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                      Payment Confirmation Type
                    </label>
                    <select
                      value={paymentType}
                      onChange={(e) => setPaymentType(e.target.value)}
                      className="modal-select-field"
                      style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px' }}
                    >
                      <option value="Upfront Paid">Upfront Paid (Subscription in Advance)</option>
                      <option value="Paid After Wait">Invoice Settled / Bank Transfer</option>
                      <option value="Credit / Package Balance">Credit / Package Balance</option>
                    </select>
                  </div>
                </div>

                {/* Reset Attendance Notice Banner */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.6rem',
                    padding: '0.75rem 0.9rem',
                    background: 'rgba(16, 185, 129, 0.08)',
                    borderRadius: '8px',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    fontSize: '0.8rem',
                    color: '#065f46',
                  }}
                >
                  <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: '2px', color: '#10b981' }} />
                  <div>
                    <strong>Attendance Auto-Reset Active:</strong> Current {attendedCount} lesson records will be safely archived to the student's <em>Term History</em>. The attendance grid will reset to 0/10 for the new term starting on {nextTermStartDate || 'selected date'}.
                  </div>
                </div>
              </div>
            )}

            {selectedMode === 'wait_payment' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  padding: '1.1rem',
                  borderRadius: '12px',
                  background: 'rgba(249, 115, 22, 0.04)',
                  border: '1px solid rgba(249, 115, 22, 0.2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#c2410c', fontWeight: 700, fontSize: '0.88rem' }}>
                  <AlertCircle size={16} />
                  Waiting for Parent Payment Confirmation
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary, #64748b)' }}>
                  This student will show a <strong style={{ color: '#c2410c' }}>Wait Payment</strong> badge in the Live Progress table. Once parent confirms payment, open this modal again to execute <em>Confirm Continue</em> and reset attendance.
                </p>
              </div>
            )}

            {/* SPA Note */}
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                SPA Notes / Remarks:
              </label>
              <textarea
                value={spaNote}
                onChange={(e) => setSpaNote(e.target.value)}
                placeholder="Enter notes (e.g. Parent paid for 2 terms upfront, or Invoice #1042 sent on 2 Sep)..."
                className="modal-input-field"
                rows={2}
                style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px', fontSize: '0.82rem' }}
              />
            </div>

            {/* List of Assigned Terms History */}
            {termHistory.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  <History size={15} color="#4f46e5" />
                  Previously Assigned Terms ({termHistory.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {termHistory.map((t, idx) => (
                    <div
                      key={t.id || idx}
                      style={{
                        padding: '0.65rem 0.85rem',
                        background: 'var(--bg-color, #f8fafc)',
                        border: '1px solid var(--border-color, #e2e8f0)',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.78rem',
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 700, color: '#4f46e5' }}>{t.termName || `Term ${t.termNumber || idx + 1}`}</span>
                        <span style={{ margin: '0 0.4rem', color: 'var(--text-muted)' }}>·</span>
                        <span style={{ fontWeight: 600 }}>{t.program}</span>
                        {t.completedDate && (
                          <span style={{ color: 'var(--text-secondary)', marginLeft: '0.4rem' }}>
                            (Completed: {t.completedDate})
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ fontWeight: 700, color: '#047857' }}>
                          {t.attendedCount} / {t.totalMeetings || 10} Attended
                        </span>
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.35rem', background: '#ecfdf5', color: '#047857', borderRadius: '4px', border: '1px solid #10b981' }}>
                          {t.paymentType || 'Paid'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Footer Actions */}
          <div
            style={{
              padding: '1rem 1.5rem',
              borderTop: '1px solid var(--border-color, #e2e8f0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              background: 'var(--bg-color, #f8fafc)',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="action-btn"
              style={{
                padding: '0.55rem 1.1rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #cbd5e1)',
                background: '#ffffff',
                color: 'var(--text-main, #334155)',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="action-btn btn-primary"
              style={{
                padding: '0.55rem 1.3rem',
                borderRadius: '8px',
                border: 'none',
                background: selectedMode === 'confirm_continue'
                  ? 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)'
                  : selectedMode === 'wait_payment'
                  ? 'linear-gradient(135deg, #ea580c 0%, #f97316 100%)'
                  : 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)',
                color: '#ffffff',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: submitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
              }}
            >
              {selectedMode === 'confirm_continue' && <CheckCircle2 size={16} />}
              {selectedMode === 'wait_payment' && <Clock size={16} />}
              {selectedMode === 'not_continue' && <PauseCircle size={16} />}
              {submitting ? 'Saving...' : (
                selectedMode === 'confirm_continue' ? 'Confirm Continue & Reset Attendance'
                : selectedMode === 'wait_payment' ? 'Set as Wait Payment'
                : 'Confirm Break / Stop'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
