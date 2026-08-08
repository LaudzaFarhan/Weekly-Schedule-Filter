'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '../components/ui/Toast';
import { useSchedule } from '../contexts/ScheduleContext';
import { subscribeToInternalStudents } from '../services/internalStudentService';
import { subscribeToInternalClasses } from '../services/internalScheduleService';
import { subscribeToLiveProgress } from '../services/newLiveProgressService';
import Pagination from '../components/ui/Pagination';
import {
  calculatePredictedEndDate,
  calculateSubscriptionStatus,
  parseProgressDetails,
  formatDateFriendly,
  formatDateISO,
  DEFAULT_TARGET_MEETINGS,
} from '../utils/subscriptionUtils';
import {
  Search, X, User, MapPin, Clock, Calendar, GraduationCap, AlertTriangle,
  CheckCircle, HelpCircle, Edit3, ShieldAlert, Sparkles, RefreshCw, Filter, Plus,
} from 'lucide-react';

const PAGE_SIZE = 5;

// Local overrides for student start date / target meetings (persisted in localStorage)
const SUB_OVERRIDES_KEY = 'newOpsStudentSubscriptionOverrides';
function readOverrides() {
  try { return JSON.parse(localStorage.getItem(SUB_OVERRIDES_KEY) || '{}'); } catch { return {}; }
}
function saveOverride(studentName, data) {
  if (!studentName) return;
  const store = readOverrides();
  const key = String(studentName).trim().toLowerCase();
  store[key] = { ...(store[key] || {}), ...data };
  try { localStorage.setItem(SUB_OVERRIDES_KEY, JSON.stringify(store)); } catch { /* ignore */ }
}

export default function NewStudentSubscriptionsPage() {
  const { showToast } = useToast();
  const { enabledBranches, branches } = useSchedule();

  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [liveProgress, setLiveProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState(readOverrides);

  // Filters & Paging
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [page, setPage] = useState(1);

  // Edit Modal State
  const [editingRow, setEditingRow] = useState(null);
  const [draftStartDate, setDraftStartDate] = useState('');
  const [draftTarget, setDraftTarget] = useState(DEFAULT_TARGET_MEETINGS);
  const [customTopUpVal, setCustomTopUpVal] = useState('');

  // Real-time Subscriptions
  useEffect(() => {
    let unmounted = false;

    const unsubStudents = subscribeToInternalStudents((data) => {
      if (!unmounted) setStudents(data || []);
    });
    const unsubClasses = subscribeToInternalClasses((data) => {
      if (!unmounted) setClasses(data || []);
    });
    const unsubProgress = subscribeToLiveProgress((data) => {
      if (!unmounted) {
        setLiveProgress(data || []);
        setLoading(false);
      }
    });

    return () => {
      unmounted = true;
      unsubStudents();
      unsubClasses();
      unsubProgress();
    };
  }, []);

  const branchList = [...new Set([...(enabledBranches || []).map(b => b.name), ...(branches || []).map(b => b.name)])].filter(Boolean);

  // Helper: Find live progress for a student
  const getProgressForStudent = (studentName) => {
    if (!studentName || !Array.isArray(liveProgress)) return null;
    const nameKey = String(studentName).trim().toLowerCase();
    return liveProgress.find((p) => String(p.studentName || '').trim().toLowerCase() === nameKey) || null;
  };

  // Helper: Find assigned instructor & schedule details
  const getScheduleForStudent = (studentName) => {
    if (!studentName || !Array.isArray(classes)) return null;
    const nameKey = String(studentName).trim().toLowerCase();
    return classes.find((c) => c.student && String(c.student).trim().toLowerCase() === nameKey) || null;
  };

  // Edit Modal Handlers
  const openEditModal = (row) => {
    setEditingRow(row);
    setDraftStartDate(row.startDateStr || '');
    setDraftTarget(row.targetMeetings || DEFAULT_TARGET_MEETINGS);
    setCustomTopUpVal('');
  };

  const handleApplyCustomTopUp = () => {
    const val = parseInt(customTopUpVal, 10);
    if (!isNaN(val) && val > 0 && val <= 100) {
      setDraftTarget((prev) => prev + val);
      showToast({
        title: `+${val} Meetings Top-Up Added`,
        message: `New total target: ${draftTarget + val} meetings`,
        variant: 'success',
      });
      setCustomTopUpVal('');
    } else {
      showToast({
        title: 'Invalid Meeting Count',
        message: 'Please enter a valid number of meetings to add (1–100).',
        variant: 'error',
      });
    }
  };

  // Build full subscription rows
  const subscriptionRows = useMemo(() => {
    return students.map((st) => {
      const nameKey = String(st.name || '').trim().toLowerCase();
      const sched = getScheduleForStudent(st.name);
      const prog = getProgressForStudent(st.name);
      const override = overrides[nameKey] || {};

      const { attendedCount, firstMeetingDate } = parseProgressDetails(prog);
      const startDateStr = override.startDate || firstMeetingDate || (st.createdAt ? formatDateISO(st.createdAt) : null);
      const targetMeetings = override.targetMeetings || DEFAULT_TARGET_MEETINGS;

      const category = (st.level || '').toLowerCase().includes('kinder')
        ? 'Kinder'
        : (st.level || '').toLowerCase().includes('coder')
        ? 'Coder'
        : 'Junior';

      const statusResult = calculateSubscriptionStatus({
        startDateStr,
        targetMeetings,
        attendedCount,
      });

      return {
        id: st.id,
        name: st.name,
        level: st.level || '—',
        category,
        branchName: st.branchName || sched?.branchName || '—',
        instructor: sched?.teacher || '—',
        day: sched?.day || '—',
        time: sched?.time || '—',
        startDateStr,
        targetMeetings,
        attendedCount,
        progressPercent: Math.min(100, Math.round((attendedCount / targetMeetings) * 100)),
        predictedEndDate: statusResult.predictedEndDate,
        predictedEndStr: statusResult.predictedEndDate ? formatDateISO(statusResult.predictedEndDate) : '—',
        status: statusResult.status,
        isOverdue: statusResult.isOverdue,
        daysRemaining: statusResult.daysRemaining,
      };
    });
  }, [students, classes, liveProgress, overrides]);

  // Overall Statistics
  const stats = useMemo(() => {
    const total = subscriptionRows.length;
    const active = subscriptionRows.filter((r) => r.status === 'Active').length;
    const endingSoon = subscriptionRows.filter((r) => r.status === 'Ending Soon').length;
    const overdue = subscriptionRows.filter((r) => r.status === 'Overdue').length;
    const completed = subscriptionRows.filter((r) => r.status === 'Completed').length;
    return { total, active, endingSoon, overdue, completed };
  }, [subscriptionRows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return subscriptionRows.filter((r) => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (filterBranch !== 'all' && r.branchName !== filterBranch) return false;
      if (filterCategory !== 'all' && r.category !== filterCategory) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = r.name.toLowerCase().includes(q);
        const matchInst = r.instructor.toLowerCase().includes(q);
        const matchBranch = r.branchName.toLowerCase().includes(q);
        const matchLevel = r.level.toLowerCase().includes(q);
        if (!matchName && !matchInst && !matchBranch && !matchLevel) return false;
      }

      return true;
    });
  }, [subscriptionRows, filterStatus, filterBranch, filterCategory, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);



  const handleSaveModal = (e) => {
    e.preventDefault();
    if (!editingRow) return;

    saveOverride(editingRow.name, {
      startDate: draftStartDate || null,
      targetMeetings: Number(draftTarget) || DEFAULT_TARGET_MEETINGS,
    });
    setOverrides(readOverrides());
    showToast({ title: 'Subscription updated successfully', variant: 'success' });
    setEditingRow(null);
  };

  return (
    <section className="dashboard-view active">
      <div className="panel full-schedule-panel">
        {/* Header */}
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={20} style={{ color: 'var(--primary-blue, #4f46e5)' }} /> Student Subscription Management
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Track meeting progress, predicted end dates (+2 weeks buffer for absences), and overdue subscriptions.
            </p>
          </div>
        </div>

        {/* Stats Summary Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}>
          <div style={{ background: 'var(--panel-bg)', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Total Students</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '0.2rem' }}>{stats.total}</div>
          </div>
          <div style={{ background: 'var(--panel-bg)', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#047857' }}>Active Subscriptions</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#047857', marginTop: '0.2rem' }}>{stats.active}</div>
          </div>
          <div style={{ background: 'var(--panel-bg)', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#b45309' }}>Ending Soon</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b45309', marginTop: '0.2rem' }}>{stats.endingSoon}</div>
          </div>
          <div style={{ background: stats.overdue > 0 ? 'rgba(220, 38, 38, 0.08)' : 'var(--panel-bg)', padding: '0.85rem 1rem', borderRadius: '12px', border: `1px solid ${stats.overdue > 0 ? 'rgba(220, 38, 38, 0.3)' : 'var(--border-color)'}`, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <AlertTriangle size={13} /> Overdue Subscriptions
            </span>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#dc2626', marginTop: '0.2rem' }}>{stats.overdue}</div>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', background: 'var(--bg-color)' }}>
          <div className="input-group" style={{ margin: 0, flex: '1 1 200px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Search Student</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search name, instructor, branch..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ paddingLeft: '2rem', width: '100%' }}
              />
            </div>
          </div>

          <div className="input-group" style={{ margin: 0, width: '140px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Status</label>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Status</option>
              <option value="Active">Active</option>
              <option value="Ending Soon">Ending Soon</option>
              <option value="Overdue">Overdue</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '140px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Branch</label>
            <select
              value={filterBranch}
              onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Branches</option>
              {branchList.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '130px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Category</label>
            <select
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Programs</option>
              <option value="Kinder">Kinder</option>
              <option value="Junior">Junior</option>
              <option value="Coder">Coder</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="panel-body table-wrapper" style={{ position: 'relative' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
              <div className="loading-spinner" style={{ marginBottom: '1rem' }} />
              <p>Calculating subscription timelines & attendance records...</p>
            </div>
          ) : (
            <table id="schedule-table" style={{ minWidth: '1100px' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: '170px' }}>Student Name</th>
                  <th style={{ width: '140px' }}>Program / Level</th>
                  <th style={{ width: '130px' }}>Branch</th>
                  <th style={{ width: '140px' }}>Instructor</th>
                  <th style={{ width: '160px' }}>Progress (Attended)</th>
                  <th style={{ width: '130px' }}>1st Meeting</th>
                  <th style={{ width: '150px' }}>Predicted End Date</th>
                  <th style={{ width: '130px', textAlign: 'center' }}>Status</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <AlertTriangle size={32} style={{ color: 'var(--warning)', marginBottom: '0.5rem' }} />
                      <div style={{ fontWeight: 600 }}>No subscription records match filters</div>
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((r) => {
                    const badgeBg = r.status === 'Overdue'
                      ? 'rgba(220, 38, 38, 0.12)'
                      : r.status === 'Ending Soon'
                      ? 'rgba(245, 158, 11, 0.14)'
                      : r.status === 'Completed'
                      ? 'rgba(16, 185, 129, 0.12)'
                      : 'rgba(5, 150, 105, 0.12)';

                    const badgeColor = r.status === 'Overdue'
                      ? '#dc2626'
                      : r.status === 'Ending Soon'
                      ? '#b45309'
                      : r.status === 'Completed'
                      ? '#059669'
                      : '#047857';

                    return (
                      <tr key={r.id} style={{ background: r.isOverdue ? 'rgba(220, 38, 38, 0.02)' : 'transparent' }}>
                        <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <User size={14} style={{ color: 'var(--text-muted)' }} />
                            {r.name}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            background: 'rgba(79, 70, 229, 0.08)', color: 'var(--primary-blue, #4f46e5)',
                            padding: '0.15rem 0.5rem', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 600,
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          }}>
                            <GraduationCap size={11} /> {r.level}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)' }}>
                            <MapPin size={12} style={{ color: 'var(--text-muted)' }} /> {r.branchName}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>{r.instructor}</td>

                        {/* Attended progress bar */}
                        <td>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', fontWeight: 600, marginBottom: '0.2rem' }}>
                              <span>{r.attendedCount} / {r.targetMeetings} meetings</span>
                              <span>{r.progressPercent}%</span>
                            </div>
                            <div style={{ width: '100%', height: '6px', background: 'var(--border-color)', borderRadius: '99px', overflow: 'hidden' }}>
                              <div style={{
                                width: `${r.progressPercent}%`, height: '100%',
                                background: r.isOverdue ? '#dc2626' : 'var(--primary-blue, #4f46e5)',
                                borderRadius: '99px', transition: 'width 0.3s ease',
                              }} />
                            </div>
                          </div>
                        </td>

                        {/* First meeting date */}
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Calendar size={12} style={{ color: 'var(--text-muted)' }} />
                            {formatDateFriendly(r.startDateStr)}
                          </span>
                        </td>

                        {/* Predicted End Date */}
                        <td style={{ fontSize: '0.82rem', fontWeight: r.isOverdue ? 700 : 500, color: r.isOverdue ? '#dc2626' : 'var(--text-main)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Clock size={12} style={{ color: r.isOverdue ? '#dc2626' : 'var(--text-muted)' }} />
                            {formatDateFriendly(r.predictedEndStr)}
                          </span>
                          <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                            (+2 wks buffer included)
                          </span>
                        </td>

                        {/* Subscription Status Badge */}
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            background: badgeBg, color: badgeColor, border: `1px solid ${badgeColor}33`,
                            padding: '0.18rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700,
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap',
                          }}>
                            {r.status === 'Overdue' ? <AlertTriangle size={11} /> : <CheckCircle size={11} />}
                            {r.status}
                          </span>
                        </td>

                        {/* Edit Action */}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => openEditModal(r)}
                            title="Edit Subscription Start Date & Package"
                            style={{
                              background: 'transparent', border: '1px solid var(--border-color)', cursor: 'pointer',
                              padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.74rem', color: 'var(--text-secondary)',
                              display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600,
                            }}
                          >
                            <Edit3 size={13} /> Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {!loading && totalPages > 1 && (
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingRow && (() => {
        const meetingsLeft = Math.max(0, draftTarget - editingRow.attendedCount);
        const currentEnd = calculatePredictedEndDate(draftStartDate, draftTarget);
        return (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem',
        }}>
          <div style={{
            background: 'var(--panel-bg)', width: '100%', maxWidth: '520px', borderRadius: '16px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)', overflow: 'hidden', border: '1px solid var(--border-color)',
          }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Edit Subscription Package</h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{editingRow.name} · {editingRow.level}</p>
              </div>
              <button type="button" onClick={() => setEditingRow(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveModal} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Current Meeting Status Summary */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem',
                background: 'rgba(79,70,229,0.04)', border: '1px solid rgba(79,70,229,0.12)',
                borderRadius: '10px', padding: '0.75rem 1rem',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Attended</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#4f46e5' }}>{editingRow.attendedCount}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Target</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)' }}>{draftTarget}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Remaining</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: meetingsLeft <= 2 ? '#dc2626' : '#059669' }}>{meetingsLeft}</div>
                </div>
              </div>

              {/* Start Date */}
              <div>
                <label className="modal-form-label">1st Meeting Date (Start Date)</label>
                <input
                  type="date"
                  value={draftStartDate}
                  onChange={(e) => setDraftStartDate(e.target.value)}
                  className="modal-input-field"
                />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                  Predicted end: {currentEnd ? formatDateFriendly(currentEnd) : '—'} ({draftTarget} weeks + 2 weeks buffer)
                </span>
              </div>

              {/* Package Selection */}
              <div>
                <label className="modal-form-label">Package Meetings Count</label>
                <select
                  value={draftTarget}
                  onChange={(e) => setDraftTarget(Number(e.target.value))}
                  className="modal-select-field"
                >
                  <option value={12}>3 Months Package (12 Meetings - Standard)</option>
                  <option value={24}>6 Months Package (24 Meetings)</option>
                  <option value={36}>1 Year Package (36 Meetings)</option>
                  <option value={10}>10 Meetings (Legacy short package)</option>
                  {/* Show current value if it's a custom number from top-ups */}
                  {![10, 12, 24, 36].includes(draftTarget) && (
                    <option value={draftTarget}>Custom ({draftTarget} Meetings)</option>
                  )}
                </select>
              </div>

              {/* Top Up Section */}
              <div style={{
                background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: '10px', padding: '0.85rem 1rem',
              }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#047857', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <RefreshCw size={14} /> Top Up Meetings
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem' }}>
                  Add extra meetings on top of the current package ({draftTarget} meetings). This will extend the subscription.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {[4, 8, 12].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setDraftTarget((prev) => prev + n);
                        showToast({ title: `+${n} meetings added`, message: `New total: ${draftTarget + n} meetings`, variant: 'success' });
                      }}
                      style={{
                        padding: '0.35rem 0.75rem', borderRadius: '8px', cursor: 'pointer',
                        fontSize: '0.78rem', fontWeight: 700, border: '1.5px solid rgba(16,185,129,0.35)',
                        background: 'rgba(16,185,129,0.08)', color: '#047857',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      +{n} Meetings
                    </button>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      placeholder="Custom (e.g. 5)"
                      value={customTopUpVal}
                      onChange={(e) => setCustomTopUpVal(e.target.value)}
                      style={{
                        width: '135px',
                        padding: '0.4rem 0.65rem',
                        borderRadius: '8px',
                        border: '1.5px solid var(--border-color)',
                        fontSize: '0.8rem',
                        background: 'var(--panel-bg)',
                        color: 'var(--text-main)',
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleApplyCustomTopUp();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleApplyCustomTopUp}
                      style={{
                        padding: '0.4rem 0.85rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#10b981',
                        color: 'white',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        boxShadow: '0 2px 6px rgba(16,185,129,0.25)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Plus size={14} /> Insert Top-Up
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setEditingRow(null)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
        );
      })()}
    </section>
  );
}
