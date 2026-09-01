'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  X, User, Calendar, Clock, Send, RotateCcw, CheckCircle2,
  FileText, AlertTriangle, Info, Save, ChevronRight, History,
  Layers, CheckCircle, ArrowRight,
} from 'lucide-react';
import { PROGRESS_UPDATE_STATUSES, PROGRESS_UPDATE_BADGES } from '../../utils/progressUpdateUtils';

const TIME_SLOT_OPTIONS = [
  '09:00 AM',
  '09:30 AM',
  '10:00 AM',
  '10:30 AM',
  '11:00 AM',
  '11:30 AM',
  '12:00 PM',
  '12:30 PM',
  '01:00 PM',
  '01:30 PM',
  '02:00 PM',
  '02:30 PM',
  '03:00 PM',
  '03:30 PM',
  '04:00 PM',
  '04:30 PM',
  '05:00 PM',
  '05:30 PM',
  '06:00 PM',
  '06:30 PM',
  '07:00 PM',
];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatCombinedSchedule(dateStr, timeStr) {
  if (!dateStr && !timeStr) return '';
  if (!dateStr) return timeStr;

  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        const weekday = DAY_NAMES[d.getDay()] || 'Day';
        const monthStr = MONTH_NAMES[month] || '';
        if (timeStr) {
          return `${weekday}, ${day} ${monthStr} ${year} · ${timeStr}`;
        }
        return `${weekday}, ${day} ${monthStr} ${year}`;
      }
    }
  } catch (e) {}

  return `${dateStr}${timeStr ? ` · ${timeStr}` : ''}`;
}

/**
 * ProgressUpdateModal
 * 
 * Interactive workflow modal with a Left-Hand History Panel:
 * - Left Panel: Progress Update & Reschedule History per term/program,
 *   tracking how many times rescheduled, completed updates, and historical timeline.
 * - Right Panel: Workflow Status Selector (Need Update, Offer, Scheduled, Reschedule, Done),
 *   Option Calendar Date Picker, Time Slot Dropdown, and communication notes.
 */
export default function ProgressUpdateModal({
  isOpen,
  onClose,
  row,
  category,
  allStudentRows = [],
  user = null,
  onSave,
}) {
  const [selectedStatus, setSelectedStatus] = useState(PROGRESS_UPDATE_STATUSES.NEED_UPDATE);
  const [calendarDate, setCalendarDate] = useState('');
  const [timeSlot, setTimeSlot] = useState('04:30 PM');
  const [isCustomTime, setIsCustomTime] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [updateNote, setUpdateNote] = useState('');
  const [selectedHistoryProgram, setSelectedHistoryProgram] = useState('current');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (row) {
      const currentStatus = row.progressUpdateStatus || PROGRESS_UPDATE_STATUSES.NEED_UPDATE;
      setSelectedStatus(currentStatus);
      setUpdateNote(row.progressUpdateNote || '');
      setSelectedHistoryProgram('current');

      const rawDate = row.progressUpdateDate || '';
      if (rawDate) {
        // Extract date YYYY-MM-DD if present
        const dateMatch = rawDate.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          setCalendarDate(dateMatch[1]);
        } else {
          // If free text, set today as calendar default
          const today = new Date().toISOString().split('T')[0];
          setCalendarDate(today);
        }

        // Extract time
        const timeMatch = rawDate.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i);
        if (timeMatch) {
          const foundTime = timeMatch[1].toUpperCase();
          const matchSlot = TIME_SLOT_OPTIONS.find(
            (slot) => slot.replace(/\s+/g, '').toUpperCase() === foundTime.replace(/\s+/g, '').toUpperCase()
          );
          if (matchSlot) {
            setTimeSlot(matchSlot);
            setIsCustomTime(false);
          } else {
            setTimeSlot('__custom__');
            setIsCustomTime(true);
            setCustomTime(foundTime);
          }
        } else {
          setTimeSlot('04:30 PM');
          setIsCustomTime(false);
        }
      } else {
        const today = new Date().toISOString().split('T')[0];
        setCalendarDate(today);
        setTimeSlot('04:30 PM');
        setIsCustomTime(false);
        setCustomTime('');
      }
    }
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

  const attendedCount = Object.keys(row.attendance || {}).length;
  const targetMeetings = row.targetMeetings || (category === 'Coder' ? 12 : 10);
  const instructorName = row.arrangedTeacher || (row.instructor && row.instructor !== 'Unassigned' && row.instructor !== '—' ? row.instructor : 'Unassigned');

  // Parse & aggregate history
  const rawHistory = useMemo(() => {
    if (Array.isArray(row.progressUpdateHistory) && row.progressUpdateHistory.length > 0) {
      return row.progressUpdateHistory;
    }
    return [];
  }, [row.progressUpdateHistory]);

  // Reschedule and completion metrics
  const currentProgramName = row.program || row.levelCode || 'Current Program';
  const currentProgReschedules = rawHistory.filter(
    (h) => h.status === PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE && (!h.program || h.program === currentProgramName)
  ).length + (selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE && row.progressUpdateStatus !== PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE ? 1 : 0);

  const totalReschedules = rawHistory.filter(
    (h) => h.status === PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE
  ).length + (selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE && row.progressUpdateStatus !== PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE ? 1 : 0);

  const completedUpdates = rawHistory.filter(
    (h) => h.status === PROGRESS_UPDATE_STATUSES.UPDATE_DONE
  ).length + (selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_DONE && row.progressUpdateStatus !== PROGRESS_UPDATE_STATUSES.UPDATE_DONE ? 1 : 0);

  // Other programs recorded for this student
  const otherPrograms = (allStudentRows || []).filter(
    (r) => r.rowKey !== row.rowKey && r.program && r.program !== row.program
  );

  const effectiveTime = isCustomTime ? customTime.trim() : timeSlot;
  const finalScheduledSlot = formatCombinedSchedule(calendarDate, effectiveTime);

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const userIdentifier = user?.email || user?.name || 'SPA Staff';
      const isDateRequired = selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_SCHEDULED || selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE;

      const newHistoryEntry = {
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        status: selectedStatus,
        previousStatus: row.progressUpdateStatus || PROGRESS_UPDATE_STATUSES.NEED_UPDATE,
        scheduledDate: isDateRequired ? finalScheduledSlot : null,
        note: updateNote.trim() || null,
        user: userIdentifier,
        program: row.program,
        category: category || row.category,
      };

      const updatedHistory = [newHistoryEntry, ...rawHistory];

      await onSave({
        progressUpdateStatus: selectedStatus,
        progressUpdateDate: isDateRequired ? finalScheduledSlot : (selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_DONE ? finalScheduledSlot || null : null),
        progressUpdateNote: updateNote.trim() || null,
        progressUpdateHistory: updatedHistory,
      });
      onClose();
    } catch (err) {
      console.error('Failed to save progress update status:', err);
    } finally {
      setSaving(false);
    }
  };

  const statusOptions = [
    {
      id: PROGRESS_UPDATE_STATUSES.NEED_UPDATE,
      title: 'Need Update (Notification)',
      badge: 'Need Update',
      icon: Clock,
      theme: { bg: 'rgba(245,158,11,0.08)', border: '#f59e0b', color: '#b45309', activeBg: '#fef3c7' },
      description: `Student reached ${attendedCount} attended lessons in ${row.program}. Progress update is required.`,
    },
    {
      id: PROGRESS_UPDATE_STATUSES.UPDATE_OFFER,
      title: 'Update Offer',
      badge: 'Offer Sent',
      icon: Send,
      theme: { bg: 'rgba(59,130,246,0.08)', border: '#3b82f6', color: '#1d4ed8', activeBg: '#eff6ff' },
      description: 'SPA already contacted parent to offer available schedule options.',
    },
    {
      id: PROGRESS_UPDATE_STATUSES.UPDATE_SCHEDULED,
      title: 'Update Scheduled',
      badge: 'Scheduled',
      icon: Calendar,
      theme: { bg: 'rgba(139,92,246,0.08)', border: '#8b5cf6', color: '#6d28d9', activeBg: '#f3e8ff' },
      description: 'Parent agreed on schedule. Instructor informed of the date and time.',
      requiresDate: true,
    },
    {
      id: PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE,
      title: 'Update Reschedule',
      badge: 'Rescheduled',
      icon: RotateCcw,
      theme: { bg: 'rgba(244,63,94,0.08)', border: '#f43f5e', color: '#be123c', activeBg: '#fff1f2' },
      description: 'Parent could not attend scheduled time. SPA to reschedule.',
      requiresDate: true,
    },
    {
      id: PROGRESS_UPDATE_STATUSES.UPDATE_DONE,
      title: 'Update Done (Completed)',
      badge: 'Update Done',
      icon: CheckCircle2,
      theme: { bg: 'rgba(16,185,129,0.08)', border: '#10b981', color: '#047857', activeBg: '#ecfdf5' },
      description: 'Instructor completed progress update meeting. SPA to send invoice to parent.',
      actionNotice: '📋 Next Step: SPA sends invoice to parent for the upcoming term.',
    },
  ];

  const formatTimestamp = (iso) => {
    if (!iso) return 'Just now';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(iso);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-update-modal-title"
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
          maxWidth: '980px',
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
            padding: '1.1rem 1.5rem',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-color, #f8fafc)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div
              style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: 'rgba(79, 70, 229, 0.12)', color: '#4f46e5',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}
            >
              <User size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <h3
                  id="progress-update-modal-title"
                  style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}
                >
                  {row.studentName}
                </h3>
                <span
                  style={{
                    fontSize: '0.74rem',
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
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary, #64748b)', marginTop: '0.2rem', display: 'flex', gap: '0.85rem' }}>
                <span>Instructor: <strong>{instructorName}</strong></span>
                <span>Attendance: <strong>{attendedCount} / {targetMeetings} Lessons</strong></span>
              </div>
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
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal 2-Column Body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* Left Column: History & Reschedule Tracking */}
          <div
            style={{
              width: '360px',
              borderRight: '1px solid var(--border-color, #e2e8f0)',
              background: 'var(--bg-color, #f8fafc)',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              padding: '1.25rem 1.25rem',
              gap: '1.2rem',
            }}
          >
            <div>
              <h4 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-main, #1e293b)' }}>
                <History size={15} style={{ color: 'var(--primary-blue, #4f46e5)' }} />
                Progress & Reschedule History
              </h4>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #64748b)', margin: '0.2rem 0 0' }}>
                Tracks reschedule attempts and update milestones per term.
              </p>
            </div>

            {/* Reschedule & Milestone Metrics Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div
                style={{
                  padding: '0.65rem 0.75rem',
                  borderRadius: '8px',
                  background: currentProgReschedules > 0 ? '#fff1f2' : 'var(--panel-bg, #ffffff)',
                  border: currentProgReschedules > 0 ? '1px solid #f43f5e' : '1px solid var(--border-color, #e2e8f0)',
                }}
              >
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: currentProgReschedules > 0 ? '#be123c' : 'var(--text-secondary, #64748b)' }}>
                  Rescheduled ({row.program})
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: currentProgReschedules > 0 ? '#be123c' : 'var(--text-main, #1e293b)', marginTop: '0.15rem' }}>
                  {currentProgReschedules}x
                </div>
              </div>

              <div
                style={{
                  padding: '0.65rem 0.75rem',
                  borderRadius: '8px',
                  background: 'var(--panel-bg, #ffffff)',
                  border: '1px solid var(--border-color, #e2e8f0)',
                }}
              >
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary, #64748b)' }}>
                  All Terms Rescheduled
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main, #1e293b)', marginTop: '0.15rem' }}>
                  {totalReschedules}x
                </div>
              </div>
            </div>

            {/* Program / Term Breakdown */}
            <div>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary, #64748b)', marginBottom: '0.45rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Program / Term Timeline
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {rawHistory.length > 0 ? (
                  rawHistory.map((item, idx) => {
                    const badge = PROGRESS_UPDATE_BADGES[item.status] || PROGRESS_UPDATE_BADGES['Need update progress'];
                    const isReschedule = item.status === PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE;
                    const isDone = item.status === PROGRESS_UPDATE_STATUSES.UPDATE_DONE;

                    return (
                      <div
                        key={item.id || idx}
                        style={{
                          padding: '0.7rem 0.85rem',
                          borderRadius: '8px',
                          background: 'var(--panel-bg, #ffffff)',
                          border: isReschedule ? '1px solid #f43f5e' : (isDone ? '1px solid #10b981' : '1px solid var(--border-color, #e2e8f0)'),
                          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              background: badge?.bg || '#f1f5f9',
                              color: badge?.color || '#334155',
                              border: `1px solid ${badge?.borderColor || '#cbd5e1'}`,
                            }}
                          >
                            {badge?.shortLabel || item.status}
                          </span>
                          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted, #94a3b8)' }}>
                            {formatTimestamp(item.timestamp)}
                          </span>
                        </div>

                        {item.scheduledDate && (
                          <div style={{ fontSize: '0.72rem', color: '#6d28d9', fontWeight: 600, marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Calendar size={11} /> {item.scheduledDate}
                          </div>
                        )}

                        {item.note && (
                          <p style={{ fontSize: '0.72rem', color: 'var(--text-main, #1e293b)', margin: '0.25rem 0 0', lineHeight: 1.35 }}>
                            {item.note}
                          </p>
                        )}

                        <div style={{ fontSize: '0.64rem', color: 'var(--text-muted, #94a3b8)', marginTop: '0.35rem', textAlign: 'right' }}>
                          By {item.user || 'SPA Staff'}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div
                    style={{
                      padding: '0.85rem',
                      borderRadius: '8px',
                      background: 'var(--panel-bg, #ffffff)',
                      border: '1px solid var(--border-color, #e2e8f0)',
                      fontSize: '0.74rem',
                      color: 'var(--text-secondary, #64748b)',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#b45309', display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.2rem' }}>
                      <Clock size={12} /> Auto Notification Active
                    </div>
                    Student reached {attendedCount}/{targetMeetings} lessons in {row.program}. No prior reschedule recorded for this term.
                  </div>
                )}

                {/* Other Enrolled Programs for this Student if any */}
                {otherPrograms.length > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary, #64748b)', marginBottom: '0.35rem' }}>
                      Other Registered Programs
                    </div>
                    {otherPrograms.map((op) => (
                      <div
                        key={op.rowKey}
                        style={{
                          padding: '0.5rem 0.65rem',
                          borderRadius: '6px',
                          background: 'var(--panel-bg, #ffffff)',
                          border: '1px solid var(--border-color, #e2e8f0)',
                          fontSize: '0.7rem',
                          marginBottom: '0.35rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{op.program}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {Object.keys(op.attendance || {}).length} lessons · {op.progressUpdateStatus || 'Normal'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Workflow Status Form */}
          <form
            onSubmit={handleFormSubmit}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '1.25rem 1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.1rem',
            }}
          >
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main, #1e293b)', display: 'block', marginBottom: '0.5rem' }}>
                Progress Update Workflow Status
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {statusOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = selectedStatus === opt.id;

                  return (
                    <div
                      key={opt.id}
                      onClick={() => setSelectedStatus(opt.id)}
                      style={{
                        padding: '0.7rem 0.9rem',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        border: isSelected ? `2px solid ${opt.theme.border}` : '1px solid var(--border-color, #e2e8f0)',
                        background: isSelected ? opt.theme.activeBg : opt.theme.bg,
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.7rem',
                      }}
                    >
                      <div
                        style={{
                          marginTop: '2px',
                          width: '17px',
                          height: '17px',
                          borderRadius: '50%',
                          border: isSelected ? `5px solid ${opt.theme.border}` : '2px solid var(--border-color, #cbd5e1)',
                          background: '#ffffff',
                          flexShrink: 0,
                        }}
                      />

                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: opt.theme.color, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <Icon size={13} />
                            {opt.title}
                          </span>
                          <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', background: '#ffffff', color: opt.theme.color, border: `1px solid ${opt.theme.border}` }}>
                            {opt.badge}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #64748b)', margin: '0.2rem 0 0', lineHeight: 1.35 }}>
                          {opt.description}
                        </p>

                        {opt.actionNotice && isSelected && (
                          <div style={{ marginTop: '0.45rem', padding: '0.4rem 0.6rem', borderRadius: '6px', background: 'rgba(16,185,129,0.15)', border: '1px solid #10b981', color: '#065f46', fontSize: '0.72rem', fontWeight: 700 }}>
                            {opt.actionNotice}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Option Calendar Date & Time Slot Dropdown */}
            {(selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_SCHEDULED || selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main, #1e293b)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Calendar size={14} style={{ color: 'var(--primary-blue, #4f46e5)' }} />
                  {selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE ? 'Rescheduled Date & Time Slot' : 'Scheduled Date & Time Slot'}
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '0.6rem' }}>
                  {/* Option Calendar Date Picker */}
                  <div>
                    <label
                      htmlFor="progress-update-calendar-date"
                      style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary, #64748b)', display: 'block', marginBottom: '0.25rem' }}
                    >
                      Select Date
                    </label>
                    <input
                      id="progress-update-calendar-date"
                      aria-label="Select Date"
                      type="date"
                      value={calendarDate}
                      onChange={(e) => setCalendarDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.52rem 0.65rem',
                        borderRadius: '8px',
                        border: '1.5px solid var(--border-color, #e2e8f0)',
                        fontSize: '0.82rem',
                        background: 'var(--bg-color, #f8fafc)',
                        color: 'var(--text-main, #1e293b)',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Time Slot Dropdown */}
                  <div>
                    <label
                      htmlFor="progress-update-time-slot"
                      style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary, #64748b)', display: 'block', marginBottom: '0.25rem' }}
                    >
                      Select Time Slot
                    </label>
                    {!isCustomTime ? (
                      <select
                        id="progress-update-time-slot"
                        aria-label="Select Time Slot"
                        value={timeSlot}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') {
                            setIsCustomTime(true);
                            setCustomTime('');
                          } else {
                            setTimeSlot(e.target.value);
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '0.52rem 0.65rem',
                          borderRadius: '8px',
                          border: '1.5px solid var(--border-color, #e2e8f0)',
                          fontSize: '0.82rem',
                          background: 'var(--bg-color, #f8fafc)',
                          color: 'var(--text-main, #1e293b)',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      >
                        {TIME_SLOT_OPTIONS.map((slot) => (
                          <option key={slot} value={slot}>
                            {slot}
                          </option>
                        ))}
                        <option value="__custom__">✏️ Custom Time...</option>
                      </select>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <input
                          id="progress-update-time-slot"
                          aria-label="Select Time Slot"
                          type="text"
                          value={customTime}
                          onChange={(e) => setCustomTime(e.target.value)}
                          placeholder="e.g. 4.15 PM"
                          style={{
                            flex: 1,
                            padding: '0.52rem 0.65rem',
                            borderRadius: '8px',
                            border: '1.5px solid var(--border-color, #e2e8f0)',
                            fontSize: '0.82rem',
                            background: 'var(--bg-color, #f8fafc)',
                            color: 'var(--text-main, #1e293b)',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomTime(false);
                            setTimeSlot('04:30 PM');
                          }}
                          style={{
                            padding: '0.35rem 0.55rem',
                            fontSize: '0.72rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color, #cbd5e1)',
                            background: 'var(--panel-bg, #ffffff)',
                            cursor: 'pointer',
                          }}
                        >
                          List
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Formatted Preview Badge */}
                {finalScheduledSlot && (
                  <div
                    style={{
                      marginTop: '0.2rem',
                      padding: '0.4rem 0.65rem',
                      borderRadius: '6px',
                      background: 'rgba(139,92,246,0.08)',
                      border: '1px solid rgba(139,92,246,0.25)',
                      color: '#6d28d9',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    <Clock size={12} />
                    <span>Scheduled for: <strong>{finalScheduledSlot}</strong></span>
                  </div>
                )}
              </div>
            )}

            {/* Remarks & Notes */}
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main, #1e293b)', display: 'block', marginBottom: '0.3rem' }}>
                <FileText size={13} style={{ display: 'inline', marginRight: '4px' }} />
                Progress Update Notes & Communication History
              </label>
              <textarea
                value={updateNote}
                onChange={(e) => setUpdateNote(e.target.value)}
                placeholder="Add parent notes, reschedule reason, preferred day/time, or invoice follow-up notes..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '8px',
                  border: '1.5px solid var(--border-color, #e2e8f0)',
                  fontSize: '0.82rem',
                  background: 'var(--bg-color, #f8fafc)',
                  color: 'var(--text-main, #1e293b)',
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Footer Buttons */}
            <div
              style={{
                marginTop: 'auto',
                paddingTop: '0.75rem',
                borderTop: '1px solid var(--border-color, #e2e8f0)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                onClick={onClose}
                className="btn"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-color, #e2e8f0)',
                  borderRadius: '8px',
                  padding: '0.45rem 1rem',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary"
                style={{
                  padding: '0.45rem 1.25rem',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                <Save size={14} />
                {saving ? 'Saving...' : 'Save Workflow Status'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
