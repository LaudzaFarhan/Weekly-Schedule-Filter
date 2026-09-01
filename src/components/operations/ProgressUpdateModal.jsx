'use client';

import React, { useState, useEffect } from 'react';
import {
  X, User, Calendar, Clock, Send, RotateCcw, CheckCircle2,
  FileText, AlertTriangle, Info, Save, ChevronRight,
} from 'lucide-react';
import { PROGRESS_UPDATE_STATUSES, PROGRESS_UPDATE_BADGES } from '../../utils/progressUpdateUtils';

/**
 * ProgressUpdateModal
 * 
 * Interactive workflow modal for SPA staff and Instructors to track
 * and advance student progress update stages:
 * - Need update progress (Notification)
 * - Update Offer (SPA contacted parent)
 * - Update Scheduled (Parent agreed, instructor notified)
 * - Update Reschedule (Parent requested reschedule)
 * - Update Done (Completed — SPA sends invoice to parent)
 */
export default function ProgressUpdateModal({
  isOpen,
  onClose,
  row,
  category,
  onSave,
}) {
  const [selectedStatus, setSelectedStatus] = useState(PROGRESS_UPDATE_STATUSES.NEED_UPDATE);
  const [scheduledDate, setScheduledDate] = useState('');
  const [updateNote, setUpdateNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (row) {
      const currentStatus = row.progressUpdateStatus || PROGRESS_UPDATE_STATUSES.NEED_UPDATE;
      setSelectedStatus(currentStatus);
      setScheduledDate(row.progressUpdateDate || '');
      setUpdateNote(row.progressUpdateNote || '');
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

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        progressUpdateStatus: selectedStatus,
        progressUpdateDate: selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_SCHEDULED || selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE ? scheduledDate : (selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_DONE ? scheduledDate || null : null),
        progressUpdateNote: updateNote.trim() || null,
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
      datePlaceholder: 'e.g. Friday, 4.30 PM or 2026-09-04 16:30',
    },
    {
      id: PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE,
      title: 'Update Reschedule',
      badge: 'Rescheduled',
      icon: RotateCcw,
      theme: { bg: 'rgba(244,63,94,0.08)', border: '#f43f5e', color: '#be123c', activeBg: '#fff1f2' },
      description: 'Parent could not attend scheduled time. SPA to reschedule.',
      requiresDate: true,
      datePlaceholder: 'e.g. Rescheduled to Tuesday 5:00 PM',
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
          maxWidth: '680px',
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
            padding: '1.2rem 1.5rem',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            background: 'var(--bg-color, #f8fafc)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h3
                id="progress-update-modal-title"
                style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <User size={18} style={{ color: 'var(--primary-blue, #4f46e5)' }} />
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
                  fontSize: '0.74rem',
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
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)', marginTop: '0.35rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <span>Assigned Instructor: <strong>{instructorName}</strong></span>
              <span>Attendance: <strong>{attendedCount} / {targetMeetings} Lessons</strong></span>
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

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main, #1e293b)', display: 'block', marginBottom: '0.6rem' }}>
              Progress Update Workflow Status
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {statusOptions.map((opt) => {
                const Icon = opt.icon;
                const isSelected = selectedStatus === opt.id;

                return (
                  <div
                    key={opt.id}
                    onClick={() => setSelectedStatus(opt.id)}
                    style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      border: isSelected ? `2px solid ${opt.theme.border}` : '1px solid var(--border-color, #e2e8f0)',
                      background: isSelected ? opt.theme.activeBg : opt.theme.bg,
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                    }}
                  >
                    <div
                      style={{
                        marginTop: '2px',
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        border: isSelected ? `5px solid ${opt.theme.border}` : '2px solid var(--border-color, #cbd5e1)',
                        background: '#ffffff',
                        flexShrink: 0,
                      }}
                    />

                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: opt.theme.color, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <Icon size={14} />
                          {opt.title}
                        </span>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', background: '#ffffff', color: opt.theme.color, border: `1px solid ${opt.theme.border}` }}>
                          {opt.badge}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary, #64748b)', margin: '0.25rem 0 0', lineHeight: 1.4 }}>
                        {opt.description}
                      </p>

                      {opt.actionNotice && isSelected && (
                        <div style={{ marginTop: '0.5rem', padding: '0.45rem 0.65rem', borderRadius: '6px', background: 'rgba(16,185,129,0.15)', border: '1px solid #10b981', color: '#065f46', fontSize: '0.72rem', fontWeight: 700 }}>
                          {opt.actionNotice}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Conditional Scheduled Date & Time Input */}
          {(selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_SCHEDULED || selectedStatus === PROGRESS_UPDATE_STATUSES.UPDATE_RESCHEDULE) && (
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main, #1e293b)', display: 'block', marginBottom: '0.35rem' }}>
                <Calendar size={13} style={{ display: 'inline', marginRight: '4px' }} />
                Scheduled Date & Time Slot
              </label>
              <input
                type="text"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                placeholder="e.g. Friday, 4.30 PM or 4 Sep 2026 @ 16:30"
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  border: '1.5px solid var(--border-color, #e2e8f0)',
                  fontSize: '0.82rem',
                  background: 'var(--bg-color, #f8fafc)',
                  color: 'var(--text-main, #1e293b)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted, #94a3b8)', marginTop: '0.25rem', display: 'block' }}>
                This schedule will be visible to instructors and SPA staff.
              </span>
            </div>
          )}

          {/* Remarks & Notes */}
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main, #1e293b)', display: 'block', marginBottom: '0.35rem' }}>
              <FileText size={13} style={{ display: 'inline', marginRight: '4px' }} />
              Progress Update Notes & Parent Communication
            </label>
            <textarea
              value={updateNote}
              onChange={(e) => setUpdateNote(e.target.value)}
              placeholder="Add parent notes, preferred days, feedback topic, or invoice followup notes..."
              rows={3}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
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
              marginTop: '0.5rem',
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
  );
}
