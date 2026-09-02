'use client';

import React, { useState, useEffect } from 'react';
import { X, Calendar, CalendarOff, CheckCircle2, UserCheck, AlertCircle, Sparkles } from 'lucide-react';
import { parseStudentLeave, formatDatePretty } from '../../utils/studentLeaveUtils';

/**
 * Add days to a "YYYY-MM-DD" string and return "YYYY-MM-DD".
 */
function addDays(isoDate, days) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return isoDate;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function StudentLeaveModal({
  isOpen,
  onClose,
  member,
  classInfo,
  defaultDate = '',
  onSave,
  onClear,
  saving = false,
}) {
  const [mode, setMode] = useState('single'); // 'single' | 'range' | 'indefinite'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  // Initialise state when opened or member changes
  useEffect(() => {
    if (!isOpen) return;
    setError('');

    const parsed = parseStudentLeave(member);
    if (parsed.isIzin && parsed.startDate) {
      if (parsed.mode === 'range' && parsed.endDate && parsed.startDate !== parsed.endDate) {
        setMode('range');
        setStartDate(parsed.startDate);
        setEndDate(parsed.endDate);
      } else {
        setMode('single');
        setStartDate(parsed.startDate);
        setEndDate(parsed.startDate);
      }
      setReason(parsed.reason || '');
    } else if (parsed.isIzin && parsed.isGeneric) {
      setMode('indefinite');
      setStartDate(defaultDate || new Date().toISOString().slice(0, 10));
      setEndDate('');
      setReason(parsed.reason || '');
    } else {
      // Default new leave
      setMode('single');
      const seed = defaultDate || new Date().toISOString().slice(0, 10);
      setStartDate(seed);
      setEndDate(addDays(seed, 7));
      setReason('');
    }
  }, [isOpen, member, defaultDate]);

  if (!isOpen) return null;

  const currentLeave = parseStudentLeave(member);
  const isCurrentlyOnLeave = currentLeave.isIzin;

  const handlePreset = (days) => {
    if (!startDate) return;
    setEndDate(addDays(startDate, days));
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    setError('');

    if (mode === 'single') {
      if (!startDate) {
        setError('Please select a session date.');
        return;
      }
      onSave?.({
        isIzin: true,
        mode: 'single',
        startDate,
        endDate: startDate,
        reason: reason.trim(),
      });
    } else if (mode === 'range') {
      if (!startDate || !endDate) {
        setError('Please select both start and end dates.');
        return;
      }
      if (startDate > endDate) {
        setError('End date cannot be before start date.');
        return;
      }
      onSave?.({
        isIzin: true,
        mode: 'range',
        startDate,
        endDate,
        reason: reason.trim(),
      });
    } else {
      onSave?.({
        isIzin: true,
        mode: 'indefinite',
        startDate: null,
        endDate: null,
        reason: reason.trim(),
      });
    }
  };

  const studentName = member?.student || 'Student';
  const program = member?.program || classInfo?.program || '';
  const day = classInfo?.day || member?.day || '';
  const time = classInfo?.time || member?.time || '';
  const teacher = classInfo?.teacher || member?.teacher || '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-leave-title"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--panel-bg, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          animation: 'modalAppear 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.2rem 1.4rem 1rem',
          borderBottom: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '0.8rem',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <CalendarOff size={18} style={{ color: '#d97706' }} />
              <h3 id="student-leave-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main, #0f172a)' }}>
                {isCurrentlyOnLeave ? 'Edit Leave (Izin)' : 'Declare Student Leave (Izin)'}
              </h3>
            </div>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary, #64748b)' }}>
              <strong>{studentName}</strong> {program && `· ${program}`} {day && time && `· ${day}, ${time}`} {teacher && `(${teacher})`}
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted, #94a3b8)',
              padding: '0.2rem',
              lineHeight: 0,
              borderRadius: '6px',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ padding: '1.2rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error && (
            <div style={{
              padding: '0.6rem 0.8rem',
              borderRadius: '8px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              fontSize: '0.78rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Mode Tabs */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary, #475569)', marginBottom: '0.4rem' }}>
              Leave Duration / Type
            </label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '0.4rem',
              background: 'rgba(0,0,0,0.03)',
              padding: '0.25rem',
              borderRadius: '10px',
              border: '1px solid var(--border-color, #e2e8f0)',
            }}>
              <button
                type="button"
                onClick={() => setMode('single')}
                style={{
                  padding: '0.45rem 0.5rem',
                  borderRadius: '7px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: mode === 'single' ? 700 : 500,
                  cursor: 'pointer',
                  background: mode === 'single' ? 'var(--primary-blue, #2563eb)' : 'transparent',
                  color: mode === 'single' ? '#ffffff' : 'var(--text-secondary, #64748b)',
                  boxShadow: mode === 'single' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                Single Date
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('range');
                  if (!endDate || endDate <= startDate) {
                    setEndDate(addDays(startDate || defaultDate, 7));
                  }
                }}
                style={{
                  padding: '0.45rem 0.5rem',
                  borderRadius: '7px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: mode === 'range' ? 700 : 500,
                  cursor: 'pointer',
                  background: mode === 'range' ? 'var(--primary-blue, #2563eb)' : 'transparent',
                  color: mode === 'range' ? '#ffffff' : 'var(--text-secondary, #64748b)',
                  boxShadow: mode === 'range' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                Date Range
              </button>
              <button
                type="button"
                onClick={() => setMode('indefinite')}
                style={{
                  padding: '0.45rem 0.5rem',
                  borderRadius: '7px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: mode === 'indefinite' ? 700 : 500,
                  cursor: 'pointer',
                  background: mode === 'indefinite' ? 'var(--primary-blue, #2563eb)' : 'transparent',
                  color: mode === 'indefinite' ? '#ffffff' : 'var(--text-secondary, #64748b)',
                  boxShadow: mode === 'indefinite' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                All Weeks
              </button>
            </div>
          </div>

          {/* Date Picker Section */}
          {mode === 'single' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary, #475569)', marginBottom: '0.35rem' }}>
                Leaving on Session Date *
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="modal-input-field"
                  style={{
                    flex: 1,
                    padding: '0.55rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color, #cbd5e1)',
                    fontSize: '0.85rem',
                    color: 'var(--text-main, #0f172a)',
                    background: 'var(--bg-color, #ffffff)',
                  }}
                />
              </div>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.73rem', color: 'var(--text-muted, #94a3b8)' }}>
                The student will be marked on leave for this specific session ({formatDatePretty(startDate) || 'chosen date'}).
              </p>
            </div>
          )}

          {mode === 'range' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary, #475569)', marginBottom: '0.35rem' }}>
                    Start Date (Leaving) *
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="modal-input-field"
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      fontSize: '0.85rem',
                      color: 'var(--text-main, #0f172a)',
                      background: 'var(--bg-color, #ffffff)',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary, #475569)', marginBottom: '0.35rem' }}>
                    End Date (Until) *
                  </label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="modal-input-field"
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      fontSize: '0.85rem',
                      color: 'var(--text-main, #0f172a)',
                      background: 'var(--bg-color, #ffffff)',
                    }}
                  />
                </div>
              </div>

              {/* Quick Range Presets */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>Quick range:</span>
                <button
                  type="button"
                  onClick={() => handlePreset(7)}
                  style={{
                    padding: '0.2rem 0.5rem',
                    borderRadius: '5px',
                    border: '1px solid var(--border-color, #e2e8f0)',
                    background: 'var(--bg-color, #ffffff)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: 'var(--text-secondary, #475569)',
                  }}
                >
                  +1 Week
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(14)}
                  style={{
                    padding: '0.2rem 0.5rem',
                    borderRadius: '5px',
                    border: '1px solid var(--border-color, #e2e8f0)',
                    background: 'var(--bg-color, #ffffff)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: 'var(--text-secondary, #475569)',
                  }}
                >
                  +2 Weeks
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset(30)}
                  style={{
                    padding: '0.2rem 0.5rem',
                    borderRadius: '5px',
                    border: '1px solid var(--border-color, #e2e8f0)',
                    background: 'var(--bg-color, #ffffff)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: 'var(--text-secondary, #475569)',
                  }}
                >
                  +1 Month
                </button>
              </div>

              <p style={{ margin: '0.4rem 0 0', fontSize: '0.73rem', color: 'var(--text-muted, #94a3b8)' }}>
                Leaving from <strong>{formatDatePretty(startDate) || '...'}</strong> to <strong>{formatDatePretty(endDate) || '...'}</strong>.
              </p>
            </div>
          )}

          {mode === 'indefinite' && (
            <div style={{
              padding: '0.75rem 0.9rem',
              borderRadius: '8px',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              fontSize: '0.78rem',
              color: '#b45309',
            }}>
              <strong>Indefinite Leave:</strong> The student will be marked absent for all weeks until manually marked attending.
            </div>
          )}

          {/* Reason Field */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary, #475569)', marginBottom: '0.35rem' }}>
              Reason / Note (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Sick, Family trip, School exams..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="modal-input-field"
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #cbd5e1)',
                fontSize: '0.85rem',
                color: 'var(--text-main, #0f172a)',
                background: 'var(--bg-color, #ffffff)',
              }}
            />
            {/* Reason Chips */}
            <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
              {['Sick', 'Vacation', 'School Exam', 'Family Event'].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setReason(chip)}
                  style={{
                    padding: '0.15rem 0.45rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color, #e2e8f0)',
                    background: reason === chip ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    color: reason === chip ? 'var(--primary-blue, #2563eb)' : 'var(--text-secondary, #64748b)',
                    fontSize: '0.68rem',
                    cursor: 'pointer',
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Footer Actions */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.6rem',
            marginTop: '0.5rem',
            paddingTop: '0.9rem',
            borderTop: '1px solid var(--border-color, #e2e8f0)',
          }}>
            <div>
              {isCurrentlyOnLeave && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onClear?.()}
                  style={{
                    padding: '0.5rem 0.85rem',
                    borderRadius: '8px',
                    border: '1px solid #10b981',
                    background: 'rgba(16, 185, 129, 0.08)',
                    color: '#047857',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <UserCheck size={14} /> Mark Attending
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                style={{
                  padding: '0.5rem 0.9rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  background: 'transparent',
                  color: 'var(--text-secondary, #64748b)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: '0.5rem 1.2rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#d97706',
                  color: '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  boxShadow: '0 2px 4px rgba(217, 119, 6, 0.25)',
                }}
              >
                <CheckCircle2 size={14} /> {isCurrentlyOnLeave ? 'Update Leave' : 'Confirm Leave'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
