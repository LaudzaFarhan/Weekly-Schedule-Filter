'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  X, User, Calendar, Clock, CheckCircle2, AlertTriangle, BookOpen,
  Edit3, Check, UserCheck, Shield, ChevronRight, Filter, Info, ArrowRight,
} from 'lucide-react';
import { isSameTeacher } from '../../utils/instructorUtils';

/**
 * Format ISO timestamp into friendly readable string
 */
function formatTimestamp(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

/**
 * AttendanceDetailHistoryModal
 * 
 * Displays full breakdown of student attendance per lesson,
 * tracks which user account filled the attendance, and evaluates
 * whether the assigned/arranged instructor has completed the attendance.
 */
export default function AttendanceDetailHistoryModal({
  isOpen,
  onClose,
  row,
  category,
  maxLessons = 10,
  onOpenAttendanceEditor,
}) {
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'attended' | 'missing' | 'arranged'
  const [selectedTermKey, setSelectedTermKey] = useState('current');

  useEffect(() => {
    if (row) setSelectedTermKey('current');
  }, [row]);

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

  const termHistory = useMemo(() => {
    if (Array.isArray(row.termHistory) && row.termHistory.length > 0) {
      return row.termHistory;
    }
    return [];
  }, [row.termHistory]);

  const activeArchivedTerm = useMemo(() => {
    if (selectedTermKey === 'current') return null;
    return termHistory.find((t) => t.id === selectedTermKey || t.termName === selectedTermKey) || null;
  }, [selectedTermKey, termHistory]);

  const attendance = activeArchivedTerm ? (activeArchivedTerm.attendance || {}) : (row.attendance || {});
  const activeProgram = activeArchivedTerm ? (activeArchivedTerm.program || row.program) : (row.program || row.programCode);
  const studentTarget = activeArchivedTerm ? (activeArchivedTerm.totalMeetings || maxLessons) : (row.targetMeetings || maxLessons);
  const isViewingArchived = Boolean(activeArchivedTerm);

  const maxAttendedKey = Math.max(
    ...Object.keys(attendance).map(Number).filter((n) => !isNaN(n) && n > 0),
    0
  );
  const totalLessonsCount = Math.max(studentTarget, maxAttendedKey, 1);
  const lessonsList = Array.from({ length: totalLessonsCount }, (_, i) => i + 1);

  const mainTeacher = row.mainTeacher || (row.instructor && row.instructor !== 'Unassigned' && row.instructor !== '—' ? row.instructor : (row.originalInstructor || 'Unassigned'));
  const arrangedLessonNum = row.arrangedLesson ? Number(row.arrangedLesson) : null;
  const arrangedTeacher = row.arrangedTeacher || null;

  // Build structured lesson details
  const lessonRows = useMemo(() => {
    return lessonsList.map((lessonNum) => {
      const entry = attendance[lessonNum] || null;
      const isAttended = !!entry;
      const isArranged = arrangedLessonNum === lessonNum && Boolean(arrangedTeacher);
      const expectedTeacher = isArranged ? arrangedTeacher : mainTeacher;

      // Teacher Tracking Check:
      // Did the expected teacher fill the attendance?
      let teacherTrackingStatus = 'pending'; // 'filled_by_teacher' | 'filled_by_other' | 'pending'
      let trackingBadgeLabel = '';

      if (isAttended) {
        const recordedByStr = String(entry.recordedBy || entry.recordedByName || entry.user || '').trim();
        const recordedByLower = recordedByStr.toLowerCase();
        const expectedLower = String(expectedTeacher || '').toLowerCase().trim();

        const isMatch = isSameTeacher(recordedByLower, expectedLower) ||
                        (recordedByLower.includes(expectedLower) && expectedLower.length > 2) ||
                        (entry.teacher && isSameTeacher(entry.teacher, expectedTeacher));

        if (isMatch) {
          teacherTrackingStatus = 'filled_by_teacher';
          trackingBadgeLabel = `Filled by Assigned Teacher (${expectedTeacher})`;
        } else if (recordedByStr) {
          teacherTrackingStatus = 'filled_by_other';
          trackingBadgeLabel = `Filled by ${recordedByStr}`;
        } else {
          teacherTrackingStatus = 'filled_by_other';
          trackingBadgeLabel = 'Recorded (Pre-audit)';
        }
      } else {
        teacherTrackingStatus = 'pending';
        trackingBadgeLabel = expectedTeacher && expectedTeacher !== 'Unassigned'
          ? `Not Filled by ${expectedTeacher}`
          : 'Attendance Pending';
      }

      return {
        lessonNum,
        entry,
        isAttended,
        isArranged,
        expectedTeacher,
        mainTeacher,
        arrangedTeacher,
        arrangedDay: row.arrangedDay,
        arrangedTime: row.arrangedTime,
        teacherTrackingStatus,
        trackingBadgeLabel,
      };
    });
  }, [lessonsList, attendance, arrangedLessonNum, arrangedTeacher, mainTeacher, row.arrangedDay, row.arrangedTime]);

  const attendedCount = lessonRows.filter((l) => l.isAttended).length;
  const missingCount = lessonRows.length - attendedCount;
  const arrangedCount = lessonRows.filter((l) => l.isArranged).length;
  const completionPercent = Math.min(100, Math.round((attendedCount / studentTarget) * 100));

  const filteredLessons = useMemo(() => {
    if (filterTab === 'attended') return lessonRows.filter((l) => l.isAttended);
    if (filterTab === 'missing') return lessonRows.filter((l) => !l.isAttended);
    if (filterTab === 'arranged') return lessonRows.filter((l) => l.isArranged);
    return lessonRows;
  }, [lessonRows, filterTab]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="attendance-detail-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
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
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid var(--border-color, #e2e8f0)',
          width: '100%',
          maxWidth: '920px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'modalAppear 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            background: 'var(--bg-color, #f8fafc)',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <h3
                id="attendance-detail-modal-title"
                style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <User size={18} style={{ color: 'var(--primary-blue, #4f46e5)' }} />
                {row.studentName}
              </h3>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '6px',
                  background: 'rgba(79, 70, 229, 0.1)',
                  color: 'var(--primary-blue, #4f46e5)',
                }}
              >
                {category} · {row.program}
              </span>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  padding: '0.15rem 0.45rem',
                  borderRadius: '6px',
                  background: 'var(--bg-color, #f1f5f9)',
                  color: 'var(--text-secondary, #64748b)',
                  border: '1px solid var(--border-color, #e2e8f0)',
                }}
              >
                {row.branchName}
              </span>
              {attendedCount >= 7 && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '6px',
                    background: '#fef3c7',
                    color: '#b45309',
                    border: '1px solid #f59e0b',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <Clock size={10} strokeWidth={2.5} /> Need Update (≥7 Lessons)
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)', flexWrap: 'wrap' }}>
              <span>
                Main Instructor: <strong style={{ color: 'var(--text-main, #1e293b)' }}>{mainTeacher}</strong>
              </span>
              {row.day && row.day !== '—' && (
                <span>
                  Schedule: <strong style={{ color: 'var(--text-main, #1e293b)' }}>{row.day} ({row.time})</strong>
                </span>
              )}
              {arrangedTeacher && (
                <span style={{ color: '#b45309', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <BookOpen size={12} /> Lesson {arrangedLessonNum} Arranged with: <strong>{arrangedTeacher}</strong>
                </span>
              )}
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
              padding: '0.35rem',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Term History Switcher Bar */}
        {termHistory.length > 0 && (
          <div
            style={{
              padding: '0.6rem 1.5rem',
              background: 'rgba(79, 70, 229, 0.04)',
              borderBottom: '1px solid var(--border-color, #e2e8f0)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary, #64748b)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Shield size={12} /> Terms:
            </span>

            <button
              type="button"
              onClick={() => setSelectedTermKey('current')}
              style={{
                padding: '0.22rem 0.65rem',
                borderRadius: '6px',
                fontSize: '0.74rem',
                fontWeight: 700,
                cursor: 'pointer',
                border: selectedTermKey === 'current' ? '1.5px solid #4f46e5' : '1px solid var(--border-color, #cbd5e1)',
                background: selectedTermKey === 'current' ? '#4f46e5' : '#ffffff',
                color: selectedTermKey === 'current' ? '#ffffff' : 'var(--text-main, #334155)',
                boxShadow: selectedTermKey === 'current' ? '0 1px 3px rgba(79, 70, 229, 0.3)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Current Active Term ({row.program})
            </button>

            {termHistory.map((t, idx) => {
              const key = t.id || t.termName || `term_${idx}`;
              const isSelected = selectedTermKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedTermKey(key)}
                  style={{
                    padding: '0.22rem 0.65rem',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: isSelected ? '1.5px solid #4f46e5' : '1px solid var(--border-color, #cbd5e1)',
                    background: isSelected ? '#4f46e5' : '#ffffff',
                    color: isSelected ? '#ffffff' : 'var(--text-main, #334155)',
                    boxShadow: isSelected ? '0 1px 3px rgba(79, 70, 229, 0.3)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {t.termName || `Term ${idx + 1}`} ({t.program || 'Program'} · {t.attendedCount}/{t.totalMeetings || 10})
                </button>
              );
            })}
          </div>
        )}

        {/* Archived Term Banner Notice */}
        {isViewingArchived && activeArchivedTerm && (
          <div
            style={{
              padding: '0.55rem 1.5rem',
              background: activeArchivedTerm.graduationStatus === 'Graduated' ? '#f0fdf4' : activeArchivedTerm.graduationStatus === 'Skipped' ? '#fffbeb' : '#ecfdf5',
              borderBottom: `1px solid ${activeArchivedTerm.graduationStatus === 'Graduated' ? '#16a34a' : activeArchivedTerm.graduationStatus === 'Skipped' ? '#f59e0b' : '#10b981'}`,
              color: activeArchivedTerm.graduationStatus === 'Graduated' ? '#166534' : activeArchivedTerm.graduationStatus === 'Skipped' ? '#92400e' : '#065f46',
              fontSize: '0.76rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span>
                📋 Viewing History for <strong>{activeArchivedTerm.termName || 'Archived Term'}</strong> ({activeProgram}) · Completed: {activeArchivedTerm.completedDate || 'N/A'}
              </span>
              {activeArchivedTerm.graduationStatus === 'Graduated' && (
                <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', background: '#dcfce7', color: '#15803d', borderRadius: '4px', border: '1px solid #16a34a', fontWeight: 700 }}>
                  🎓 Graduated to {activeArchivedTerm.nextCategory || 'Junior'} ({activeArchivedTerm.nextProgram || ''})
                </span>
              )}
              {activeArchivedTerm.graduationStatus === 'Skipped' && (
                <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', background: '#fef3c7', color: '#b45309', borderRadius: '4px', border: '1px solid #f59e0b', fontWeight: 700 }}>
                  ⏭️ Skipped to {activeArchivedTerm.nextProgram || ''}
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: 'rgba(255,255,255,0.7)', borderRadius: '4px', border: '1px solid currentColor' }}>
              {activeArchivedTerm.paymentType || 'Paid Upfront'}
            </span>
          </div>
        )}

        {/* Attendance KPI Banner */}
        <div
          style={{
            padding: '0.85rem 1.5rem',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            background: 'var(--panel-bg, #ffffff)',
          }}
        >
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>
              <span>Attendance Progress</span>
              <span>{attendedCount} / {studentTarget} Meetings ({completionPercent}%)</span>
            </div>
            <div style={{ height: '7px', width: '100%', background: 'var(--border-color, #e2e8f0)', borderRadius: '99px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${completionPercent}%`,
                  background: completionPercent >= 70 ? '#059669' : 'var(--primary-blue, #4f46e5)',
                  borderRadius: '99px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* Filter Tabs */}
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setFilterTab('all')}
              style={{
                padding: '0.3rem 0.65rem',
                borderRadius: '8px',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: filterTab === 'all' ? '1.5px solid var(--primary-blue, #4f46e5)' : '1px solid var(--border-color, #e2e8f0)',
                background: filterTab === 'all' ? 'rgba(79, 70, 229, 0.1)' : 'transparent',
                color: filterTab === 'all' ? 'var(--primary-blue, #4f46e5)' : 'var(--text-secondary, #64748b)',
              }}
            >
              All Lessons ({lessonRows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('attended')}
              style={{
                padding: '0.3rem 0.65rem',
                borderRadius: '8px',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: filterTab === 'attended' ? '1.5px solid #059669' : '1px solid var(--border-color, #e2e8f0)',
                background: filterTab === 'attended' ? 'rgba(5, 150, 105, 0.12)' : 'transparent',
                color: filterTab === 'attended' ? '#047857' : 'var(--text-secondary, #64748b)',
              }}
            >
              ✓ Attended ({attendedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('missing')}
              style={{
                padding: '0.3rem 0.65rem',
                borderRadius: '8px',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: filterTab === 'missing' ? '1.5px solid #d97706' : '1px solid var(--border-color, #e2e8f0)',
                background: filterTab === 'missing' ? 'rgba(217, 119, 6, 0.12)' : 'transparent',
                color: filterTab === 'missing' ? '#b45309' : 'var(--text-secondary, #64748b)',
              }}
            >
              ⚠️ Not Filled ({missingCount})
            </button>
            {arrangedCount > 0 && (
              <button
                type="button"
                onClick={() => setFilterTab('arranged')}
                style={{
                  padding: '0.3rem 0.65rem',
                  borderRadius: '8px',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: filterTab === 'arranged' ? '1.5px solid #7c3aed' : '1px solid var(--border-color, #e2e8f0)',
                  background: filterTab === 'arranged' ? 'rgba(124, 58, 237, 0.12)' : 'transparent',
                  color: filterTab === 'arranged' ? '#6d28d9' : 'var(--text-secondary, #64748b)',
                }}
              >
                Arranged ({arrangedCount})
              </button>
            )}
          </div>
        </div>

        {/* Modal Body / Table */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem' }}>
          <div style={{ border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '10px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--bg-color, #f8fafc)', borderBottom: '1px solid var(--border-color, #e2e8f0)', color: 'var(--text-secondary, #64748b)' }}>
                  <th style={{ padding: '0.65rem 0.85rem', width: '90px' }}>Lesson</th>
                  <th style={{ padding: '0.65rem 0.85rem', minWidth: '150px' }}>Assigned Instructor</th>
                  <th style={{ padding: '0.65rem 0.85rem', width: '120px' }}>Attendance</th>
                  <th style={{ padding: '0.65rem 0.85rem', minWidth: '170px' }}>Filled By (Account)</th>
                  <th style={{ padding: '0.65rem 0.85rem', minWidth: '190px' }}>Teacher Tracking Status</th>
                  <th style={{ padding: '0.65rem 0.85rem', minWidth: '180px' }}>Notes / Remarks</th>
                  <th style={{ padding: '0.65rem 0.85rem', width: '90px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredLessons.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted, #94a3b8)' }}>
                      No lessons match the selected filter tab.
                    </td>
                  </tr>
                ) : (
                  filteredLessons.map((item) => {
                    const { lessonNum, entry, isAttended, isArranged, expectedTeacher, teacherTrackingStatus, trackingBadgeLabel } = item;

                    return (
                      <tr
                        key={lessonNum}
                        style={{
                          borderBottom: '1px solid var(--border-color, #e2e8f0)',
                          background: isArranged
                            ? 'rgba(245, 158, 11, 0.04)'
                            : isAttended
                              ? 'transparent'
                              : 'rgba(241, 245, 249, 0.4)',
                        }}
                      >
                        {/* Lesson # */}
                        <td style={{ padding: '0.65rem 0.85rem', fontWeight: 700 }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '26px',
                              height: '26px',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              background: isAttended ? 'rgba(5, 150, 105, 0.16)' : 'var(--bg-color, #f1f5f9)',
                              color: isAttended ? '#047857' : 'var(--text-secondary, #64748b)',
                              border: isAttended ? '1px solid rgba(5, 150, 105, 0.6)' : '1px solid var(--border-color, #cbd5e1)',
                            }}
                          >
                            {lessonNum}
                          </span>
                        </td>

                        {/* Assigned Instructor */}
                        <td style={{ padding: '0.65rem 0.85rem' }}>
                          {isArranged ? (
                            <div>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  fontWeight: 700,
                                  color: '#92400e',
                                  background: 'rgba(217, 119, 6, 0.15)',
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '5px',
                                  fontSize: '0.72rem',
                                }}
                              >
                                <BookOpen size={11} /> {expectedTeacher}
                                <span style={{ fontSize: '0.62rem', background: '#f59e0b', color: '#fff', padding: '0 3px', borderRadius: '3px' }}>
                                  REPLACED
                                </span>
                              </span>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted, #94a3b8)', marginTop: '2px' }}>
                                Main: {mainTeacher}
                              </div>
                            </div>
                          ) : (
                            <span style={{ fontWeight: 600, color: 'var(--text-main, #1e293b)' }}>
                              {expectedTeacher}
                            </span>
                          )}
                        </td>

                        {/* Attendance Status */}
                        <td style={{ padding: '0.65rem 0.85rem' }}>
                          {isAttended ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                color: '#047857',
                                background: 'rgba(5, 150, 105, 0.12)',
                                border: '1px solid rgba(5, 150, 105, 0.3)',
                                padding: '0.18rem 0.45rem',
                                borderRadius: '6px',
                              }}
                            >
                              <CheckCircle2 size={12} /> Attended
                            </span>
                          ) : (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                color: '#b45309',
                                background: 'rgba(245, 158, 11, 0.12)',
                                border: '1px solid rgba(245, 158, 11, 0.3)',
                                padding: '0.18rem 0.45rem',
                                borderRadius: '6px',
                              }}
                            >
                              <Clock size={11} /> Not Filled
                            </span>
                          )}
                        </td>

                        {/* Filled By Account & Timestamp */}
                        <td style={{ padding: '0.65rem 0.85rem' }}>
                          {isAttended ? (
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--text-main, #1e293b)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <User size={12} style={{ color: 'var(--text-muted)' }} />
                                {entry?.recordedBy || entry?.recordedByName || entry?.user || 'Unknown User'}
                              </div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted, #94a3b8)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <Calendar size={10} />
                                {entry?.date ? `Attended: ${entry.date}` : 'No date'}
                                {entry?.recordedAt && (
                                  <span>· {formatTimestamp(entry.recordedAt)}</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted, #94a3b8)' }}>
                              —
                            </span>
                          )}
                        </td>

                        {/* Teacher Tracking Status */}
                        <td style={{ padding: '0.65rem 0.85rem' }}>
                          {teacherTrackingStatus === 'filled_by_teacher' && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                color: '#065f46',
                                background: '#d1fae5',
                                border: '1px solid #10b981',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '6px',
                              }}
                              title={`Verified: Instructor ${expectedTeacher} marked this attendance`}
                            >
                              <Check size={11} strokeWidth={3} /> {trackingBadgeLabel}
                            </span>
                          )}

                          {teacherTrackingStatus === 'filled_by_other' && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                color: '#5b21b6',
                                background: '#ede9fe',
                                border: '1px solid #8b5cf6',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '6px',
                              }}
                              title={`Marked by admin or substitute account`}
                            >
                              <UserCheck size={11} /> {trackingBadgeLabel}
                            </span>
                          )}

                          {teacherTrackingStatus === 'pending' && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                color: '#92400e',
                                background: '#fef3c7',
                                border: '1px solid #f59e0b',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '6px',
                              }}
                              title={`Pending: ${expectedTeacher} has not yet marked lesson ${lessonNum}`}
                            >
                              <AlertTriangle size={11} /> {trackingBadgeLabel}
                            </span>
                          )}
                        </td>

                        {/* Notes / Remarks */}
                        <td style={{ padding: '0.65rem 0.85rem' }}>
                          {entry?.note ? (
                            <span style={{ fontSize: '0.76rem', color: 'var(--text-main, #1e293b)' }}>
                              {entry.note}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)', fontStyle: 'italic' }}>
                              No note
                            </span>
                          )}
                        </td>

                        {/* Action */}
                        <td style={{ padding: '0.65rem 0.85rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (onOpenAttendanceEditor) {
                                onOpenAttendanceEditor(row, lessonNum);
                              }
                            }}
                            title={`Edit Meeting ${lessonNum} attendance`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              padding: '0.22rem 0.45rem',
                              borderRadius: '5px',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              border: '1px solid var(--border-color, #e2e8f0)',
                              background: 'var(--bg-color, #f8fafc)',
                              color: 'var(--text-main, #1e293b)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Edit3 size={11} />
                            {isAttended ? 'Edit' : 'Tick'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Teacher Arrangement Notice Card */}
          {arrangedTeacher && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: 'rgba(217, 119, 6, 0.08)',
                border: '1px solid rgba(217, 119, 6, 0.25)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                fontSize: '0.76rem',
                color: '#92400e',
              }}
            >
              <Info size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Lesson Arrangement Active:</strong> Lesson {arrangedLessonNum} was substituted to{' '}
                <strong>{arrangedTeacher}</strong> on {row.arrangedDay || row.day} ({row.arrangedTime || row.time}).
                The tracking column will verify whether <strong>{arrangedTeacher}</strong> has filled the attendance for Lesson {arrangedLessonNum}.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-color, #f8fafc)',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary, #64748b)' }}>
            💡 Click <strong>Tick</strong> or <strong>Edit</strong> on any lesson row to update the date, notes, or mark attendance.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="modal-btn-primary"
            style={{
              padding: '0.45rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
