'use client';

import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { subscribeToInternalClasses } from '../services/internalScheduleService';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { subscribeToLeaves, createLeave, deleteLeave, updateLeave } from '../services/newLeaveService';
import { useNewOperationals } from '../hooks/useNewOperationals';
import { doTimeSlotsOverlap } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';
import Pagination from '../components/ui/Pagination';
import {
  CalendarOff, CalendarDays, Trash2, Wand2, CheckCircle, MapPin, Plus, X,
  ChevronLeft, ChevronRight, AlertTriangle, User
} from 'lucide-react';

const PAGE_SIZE = 8;

const LEAVE_COLORS = [
  { bg: '#dbeafe', fg: '#1e40af' },
  { bg: '#fef3c7', fg: '#92400e' },
  { bg: '#dcfce7', fg: '#166534' },
  { bg: '#fce7f3', fg: '#9d174d' },
  { bg: '#ede9fe', fg: '#5b21b6' },
  { bg: '#ffedd5', fg: '#9a3412' },
  { bg: '#cffafe', fg: '#155e75' },
  { bg: '#fee2e2', fg: '#991b1b' },
];

function colorForName(name) {
  let hash = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return LEAVE_COLORS[Math.abs(hash) % LEAVE_COLORS.length];
}

/** "YYYY-MM-DD" -> local Date at midnight. */
function parseISO(str) {
  if (!str) return null;
  const [y, m, d] = String(str).split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Local "YYYY-MM-DD" key for a Date. */
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Day names covered by a leave range (e.g. Mon–Wed -> [Monday, Tuesday, Wednesday]). */
function weekdaysInRange(startISO, endISO) {
  const start = parseISO(startISO);
  const end = parseISO(endISO) || start;
  if (!start || !end || end < start) return [];
  const days = new Set();
  const cursor = new Date(start);
  // Cap the walk at 60 days — long ranges cover the whole week anyway.
  let guard = 0;
  while (cursor <= end && guard < 60) {
    const idx = cursor.getDay();
    days.add(idx === 0 ? 'Sunday' : DAY_NAMES[idx - 1]);
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return [...days].filter(Boolean);
}

/** Does a leave record cover a given day name? */
function leaveCoversDay(leave, dayName) {
  return weekdaysInRange(leave.startDate, leave.endDate).includes(dayName);
}

/** Is a leave active on a specific date? */
function leaveCoversDate(leave, date) {
  const start = parseISO(leave.startDate);
  const end = parseISO(leave.endDate) || start;
  if (!start || !end) return false;
  return date >= start && date <= end;
}

const canTeach = (level, category) => {
  const l = String(level || '').toLowerCase();
  if (!category) return true;
  if (category === 'Kinder') return l.includes('kinder');
  if (category === 'Junior') return l.includes('junior');
  if (category === 'Coder') return l.includes('coder');
  return true;
};

const categorize = (program) => {
  const s = String(program || '').toLowerCase();
  if (s.includes('kinder') || /^kf|^k\d/.test(s)) return 'Kinder';
  if (s.includes('junior') || /^jf|^j\d/.test(s)) return 'Junior';
  if (s.includes('coder')) return 'Coder';
  return null;
};

const atBranch = (instructor, branchName) => {
  if (!branchName) return true;
  const brs = Array.isArray(instructor.branches) ? instructor.branches : [];
  return brs.includes(branchName) || brs.includes('All Branches');
};

export default function NewLeavePage({ params }) {
  const { branches, enabledBranches } = useSchedule();
  const { showToast } = useToast();
  // Branch open days come from PostgreSQL, not the Sheets config.
  const { openDaysFor } = useNewOperationals();

  const [leaves, setLeaves] = useState([]);
  const [classes, setClasses] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [name, setName] = useState(params?.instructor || '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const [page, setPage] = useState(1);
  const [simulateId, setSimulateId] = useState(null);
  const [crossBranch, setCrossBranch] = useState(false);
  const [branchFilter, setBranchFilter] = useState('all');

  useEffect(() => {
    if (params?.instructor) setName(params.instructor);
  }, [params?.instructor]);

  // ── New Operations data only ───────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeToLeaves(
      (data) => { setLeaves(data || []); setLoadError(null); setLoading(false); },
      (err) => { setLoadError(err?.message || 'Unable to load leave records.'); setLoading(false); }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToInternalClasses((data) => setClasses(data || []), () => setClasses([]));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToInternalInstructors((data) => setInstructors(data || []));
    return () => unsub();
  }, []);

  const activeInstructors = useMemo(
    () => instructors.filter((i) => (i.status ? i.status === 'Active' : true)),
    [instructors]
  );

  const branchList = useMemo(
    () => [...new Set([
      ...(enabledBranches || []).map((b) => b.name),
      ...(branches || []).map((b) => b.name),
    ])].filter(Boolean),
    [branches, enabledBranches]
  );

  const instructorOptions = useMemo(
    () => activeInstructors
      .filter((i) => branchFilter === 'all' || atBranch(i, branchFilter))
      .map((i) => i.name)
      .filter(Boolean)
      .sort(),
    [activeInstructors, branchFilter]
  );

  const instructorByName = useMemo(() => {
    const map = new Map();
    activeInstructors.forEach((i) => map.set(i.name, i));
    return map;
  }, [activeInstructors]);

  // Leave list scoped by the branch filter (via the instructor's branches).
  const visibleLeaves = useMemo(() => {
    if (branchFilter === 'all') return leaves;
    return leaves.filter((l) => {
      const inst = instructorByName.get(l.name);
      return inst ? atBranch(inst, branchFilter) : false;
    });
  }, [leaves, branchFilter, instructorByName]);

  const totalPages = Math.max(1, Math.ceil(visibleLeaves.length / PAGE_SIZE));
  const paged = visibleLeaves.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const onLeaveToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return visibleLeaves.filter((l) => leaveCoversDate(l, today));
  }, [visibleLeaves]);

  const canAdd = name && startDate && endDate && startDate <= endDate && !saving;

  const handleAdd = async () => {
    if (!canAdd) return;
    setSaving(true);
    try {
      await createLeave({ name, startDate, endDate, reason: reason.trim() || null });
      showToast({ title: `${name} marked on leave`, variant: 'success' });
      setName('');
      setStartDate('');
      setEndDate('');
      setReason('');
    } catch (err) {
      showToast({ title: 'Could not save leave', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (leave) => {
    if (!window.confirm(`Remove ${leave.name}'s leave (${leave.startDate} to ${leave.endDate})?`)) return;
    try {
      await deleteLeave(leave.id);
      showToast({ title: 'Leave removed', variant: 'success' });
      if (simulateId === leave.id) setSimulateId(null);
    } catch (err) {
      showToast({ title: 'Could not remove leave', message: err.message, variant: 'error' });
    }
  };

  const handleStatus = async (leave, status) => {
    try {
      await updateLeave(leave.id, { status });
      showToast({ title: `Marked ${status.toLowerCase()}`, variant: 'success' });
    } catch (err) {
      showToast({ title: 'Could not update status', message: err.message, variant: 'error' });
    }
  };

  /**
   * Classes hit by a leave, with substitute suggestions. A substitute must be
   * an active New Ops instructor at the class's branch, able to teach the
   * program's category, not on leave that day, and free at that time.
   */
  const simulate = (leave) => {
    const affectedDays = weekdaysInRange(leave.startDate, leave.endDate);

    // One entry per lesson (day + time + branch), not per enrolled student.
    const lessons = new Map();
    for (const c of classes) {
      if (c.teacher !== leave.name) continue;
      if (!affectedDays.includes(c.day)) continue;
      const key = `${c.day}||${c.time}||${c.branchName}`;
      if (!lessons.has(key)) {
        lessons.set(key, { ...c, students: [] });
      }
      lessons.get(key).students.push(c.student);
    }

    const byDay = {};
    for (const lesson of lessons.values()) {
      const category = categorize(lesson.program);
      const subs = [];

      for (const cand of activeInstructors) {
        if (cand.name === leave.name) continue;

        // Branch scope: strict by default, any-branch when the toggle is on.
        if (!crossBranch && !atBranch(cand, lesson.branchName)) continue;

        if (!canTeach(cand.level, category)) continue;

        const candOnLeave = leaves.some(
          (l) => l.name === cand.name && l.id !== leave.id && leaveCoversDay(l, lesson.day)
        );
        if (candOnLeave) continue;

        const busy = classes.some(
          (c) => c.teacher === cand.name && c.day === lesson.day && c.time && doTimeSlotsOverlap(c.time, lesson.time)
        );
        if (busy) continue;

        subs.push({
          name: cand.name,
          level: cand.level,
          sameBranch: atBranch(cand, lesson.branchName),
        });
      }

      if (!byDay[lesson.day]) byDay[lesson.day] = [];
      byDay[lesson.day].push({ lesson, category, subs });
    }

    // Order days the way the week runs.
    return DAY_NAMES.concat('Sunday')
      .filter((d) => byDay[d])
      .map((d) => [d, byDay[d]]);
  };

  return (
    <section className="dashboard-view active">
      {/* ── Record leave ───────────────────────────────────────────────── */}
      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <CalendarOff size={20} /> Leave Management
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Mark New Operations instructors as on leave for a date range, and see which classes need cover.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.75rem', fontWeight: 700, padding: '0.25rem 0.7rem', borderRadius: '99px',
              color: onLeaveToday.length ? '#b45309' : 'var(--success, #10b981)',
              background: onLeaveToday.length ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.12)',
            }}>
              {onLeaveToday.length} on leave today
            </span>
            <select
              value={branchFilter}
              onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}
              className="modal-select-field field-compact"
              style={{ minWidth: '170px' }}
            >
              <option value="all">All Branches</option>
              {branchList.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <div className="panel-body">
          {/* Add form */}
          <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.1rem' }}>
            <div style={{ flex: '1 1 190px' }}>
              <label className="modal-form-label">Instructor *</label>
              <select
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="modal-select-field"
                style={{ width: '100%' }}
              >
                <option value="">
                  {instructorOptions.length ? 'Select instructor…' : 'No instructors available'}
                </option>
                {instructorOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 145px' }}>
              <label className="modal-form-label">Start date *</label>
              <input
                type="date"
                className="modal-input-field"
                value={startDate}
                max={endDate || undefined}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div style={{ flex: '1 1 145px' }}>
              <label className="modal-form-label">End date *</label>
              <input
                type="date"
                className={`modal-input-field ${startDate && endDate && endDate < startDate ? 'error' : ''}`}
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div style={{ flex: '2 1 200px' }}>
              <label className="modal-form-label">Reason (optional)</label>
              <input
                type="text"
                className="modal-input-field"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Sick, Annual leave, Training"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!canAdd}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.65rem 1.2rem', fontSize: '0.85rem' }}
            >
              <Plus size={16} /> {saving ? 'Saving…' : 'Mark On Leave'}
            </button>
          </div>

          {startDate && endDate && endDate < startDate && (
            <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginBottom: '0.75rem' }}>
              End date must be on or after the start date.
            </div>
          )}

          {loadError && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem',
              padding: '0.7rem 0.9rem', borderRadius: '10px',
              background: 'var(--danger-bg, rgba(239,68,68,0.1))', border: '1px solid rgba(239,68,68,0.35)',
            }}>
              <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '0.1rem' }} />
              <span style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>
                {loadError} If the table is missing, run <code>init_db.sql</code> on the database.
              </span>
            </div>
          )}

          {/* Leave table */}
          <div className="table-wrapper">
            <table id="schedule-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '150px' }}>Instructor</th>
                  <th style={{ minWidth: '110px' }}>Level</th>
                  <th style={{ minWidth: '190px' }}>Dates</th>
                  <th style={{ minWidth: '140px' }}>Reason</th>
                  <th style={{ minWidth: '110px' }}>Status</th>
                  <th style={{ width: 100, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>Loading leave records…</td></tr>
                ) : visibleLeaves.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    No instructors on leave{branchFilter !== 'all' ? ` at ${branchFilter}` : ''}.
                  </td></tr>
                ) : paged.map((l) => {
                  const inst = instructorByName.get(l.name);
                  const days = weekdaysInRange(l.startDate, l.endDate).length;
                  const isOpen = simulateId === l.id;
                  return (
                    <Fragment key={l.id}>
                      <tr style={isOpen ? { background: 'var(--primary-blue-light)' } : undefined}>
                        <td style={{ fontWeight: 600, fontSize: '0.84rem' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: colorForName(l.name), flexShrink: 0 }} />
                            {l.name}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{inst?.level || '—'}</td>
                        <td style={{ fontSize: '0.8rem' }}>
                          {l.startDate} → {l.endDate}
                          <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                            {days} weekday{days === 1 ? '' : 's'} affected
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{l.reason || '—'}</td>
                        <td>
                          <select
                            value={l.status || 'Approved'}
                            onChange={(e) => handleStatus(l, e.target.value)}
                            className="modal-select-field field-compact"
                            style={{ width: '100%' }}
                          >
                            {['Approved', 'Pending', 'Rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => setSimulateId(isOpen ? null : l.id)}
                            title="Simulate impact and suggest substitutes"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isOpen ? 'var(--primary-blue)' : 'var(--text-secondary)', padding: '0.25rem', marginRight: '0.3rem' }}
                          >
                            <Wand2 size={16} />
                          </button>
                          <button
                            onClick={() => handleRemove(l)}
                            title="Remove leave"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.25rem' }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan="6" style={{ padding: 0 }}>
                            <div style={{ padding: '1rem 1.1rem', background: 'var(--bg-color)', borderLeft: '3px solid var(--primary-blue)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
                                <h4 style={{ fontSize: '0.86rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-main)' }}>
                                  <Wand2 size={15} /> Impact for {l.name}
                                </h4>
                                <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                                  <input type="checkbox" checked={crossBranch} onChange={(e) => setCrossBranch(e.target.checked)} />
                                  Include instructors from other branches
                                </label>
                              </div>

                              {simulate(l).length === 0 ? (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                  No classes fall inside this leave period.
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                                  {simulate(l).map(([day, items]) => (
                                    <div key={day}>
                                      <strong style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>{day}</strong>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {items.map((item, idx) => (
                                          <div key={idx} style={{ padding: '0.6rem 0.8rem', background: 'var(--panel-bg)', borderRadius: '9px', border: '1px solid var(--border-color)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                                              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                                                {item.lesson.time}
                                                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {item.lesson.branchName}</span>
                                              </span>
                                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--primary-blue)', background: 'var(--primary-blue-light)', padding: '0.1rem 0.45rem', borderRadius: '5px' }}>
                                                  {item.lesson.program}
                                                </span>
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                  {item.lesson.students.length} student{item.lesson.students.length === 1 ? '' : 's'}
                                                </span>
                                              </span>
                                            </div>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                                              Available substitutes{item.category ? ` (${item.category}-capable)` : ''}:
                                            </div>
                                            {item.subs.length === 0 ? (
                                              <div style={{ fontSize: '0.75rem', color: '#b45309', fontStyle: 'italic' }}>
                                                No free instructor can cover this class.
                                              </div>
                                            ) : (
                                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                                {item.subs.map((s) => (
                                                  <span
                                                    key={s.name}
                                                    title={s.level}
                                                    style={{
                                                      display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                      fontSize: '0.72rem', fontWeight: 600,
                                                      padding: '0.2rem 0.55rem', borderRadius: '99px',
                                                      background: s.sameBranch ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.14)',
                                                      color: s.sameBranch ? 'var(--success, #059669)' : '#b45309',
                                                      border: `1px solid ${s.sameBranch ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}`,
                                                    }}
                                                  >
                                                    <CheckCircle size={10} />
                                                    {s.name}
                                                    {!s.sameBranch && (
                                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.1rem', opacity: 0.85, fontWeight: 400 }}>
                                                        <MapPin size={9} /> other branch
                                                      </span>
                                                    )}
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {visibleLeaves.length > PAGE_SIZE && (
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      </div>

      <LeaveCalendar leaves={visibleLeaves} instructorByName={instructorByName} openDaysFor={openDaysFor} />
    </section>
  );
}

/* ─── Leave Calendar ─────────────────────────────────────────────────── */

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function LeaveCalendar({ leaves, instructorByName, openDaysFor }) {
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedKey, setSelectedKey] = useState(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  /**
   * Map each date in the visible month to who is on leave. A leave only shows
   * on days the instructor's branch actually operates, so a Sunday closure
   * doesn't read as a missed shift.
   */
  const leaveByDate = useMemo(() => {
    const map = new Map();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    for (const l of leaves || []) {
      const start = parseISO(l.startDate);
      const end = parseISO(l.endDate) || start;
      if (!start || !end) continue;

      const from = start < monthStart ? monthStart : start;
      const to = end > monthEnd ? monthEnd : end;
      if (to < from) continue;

      // Working days come from the instructor's first branch, if we know it.
      // Null means "show every date" — used when the branch has no rules yet.
      const inst = instructorByName.get(l.name);
      const branchName = (Array.isArray(inst?.branches) ? inst.branches : [])
        .find((b) => b && b !== 'All Branches');
      const configured = branchName ? openDaysFor(branchName) : [];
      const workingDays = configured.length ? configured : null;

      const cursor = new Date(from);
      while (cursor <= to) {
        const idx = cursor.getDay();
        const dayName = idx === 0 ? 'Sunday' : DAY_NAMES[idx - 1];
        if (!workingDays || workingDays.includes(dayName)) {
          const key = dateKey(cursor);
          if (!map.has(key)) map.set(key, []);
          map.get(key).push({ name: l.name, reason: l.reason || '', status: l.status });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [leaves, year, month, instructorByName, openDaysFor]);

  const weeks = useMemo(() => {
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [year, month]);

  const todayKey = dateKey(new Date());

  const uniqueThisMonth = useMemo(() => {
    const names = new Set();
    for (const list of leaveByDate.values()) list.forEach((e) => names.add(e.name));
    return names.size;
  }, [leaveByDate]);

  const selectedEntries = selectedKey ? (leaveByDate.get(selectedKey) || []) : [];
  const selectedLabel = selectedKey
    ? parseISO(selectedKey)?.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    : null;

  const navBtn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '30px', height: '30px', borderRadius: '8px', cursor: 'pointer',
    border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)',
  };

  return (
    <div className="panel" style={{ marginTop: '1.5rem' }}>
      <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <CalendarDays size={17} /> Leave Calendar
          </h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Who&apos;s out this month
            {uniqueThisMonth > 0 && ` · ${uniqueThisMonth} instructor${uniqueThisMonth === 1 ? '' : 's'}`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              setViewDate(new Date(d.getFullYear(), d.getMonth(), 1));
              setSelectedKey(dateKey(d));
            }}
            style={{ padding: '0.35rem 0.7rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer' }}
          >
            Today
          </button>
          <button type="button" onClick={() => { setViewDate(new Date(year, month - 1, 1)); setSelectedKey(null); }} aria-label="Previous month" style={navBtn}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ minWidth: '140px', textAlign: 'center', fontWeight: 600, fontSize: '0.88rem' }}>{monthLabel}</span>
          <button type="button" onClick={() => { setViewDate(new Date(year, month + 1, 1)); setSelectedKey(null); }} aria-label="Next month" style={navBtn}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="panel-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: '1rem', alignItems: 'start' }}>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
              {WEEKDAY_LABELS.map((w, idx) => (
                <div key={w} style={{
                  textAlign: 'center', fontSize: '0.7rem', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.25rem 0',
                  color: idx === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
                }}>
                  {w}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                  {week.map((date, di) => {
                    if (!date) return <div key={di} style={{ minHeight: '82px' }} />;
                    const key = dateKey(date);
                    const isSunday = date.getDay() === 0;
                    const isToday = key === todayKey;
                    const isSelected = key === selectedKey;
                    const entries = leaveByDate.get(key) || [];
                    const hasLeave = entries.length > 0;
                    return (
                      <div
                        key={di}
                        onClick={hasLeave ? () => setSelectedKey(isSelected ? null : key) : undefined}
                        role={hasLeave ? 'button' : undefined}
                        tabIndex={hasLeave ? 0 : -1}
                        onKeyDown={hasLeave ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedKey(isSelected ? null : key); }
                        } : undefined}
                        title={hasLeave ? `${entries.length} on leave — click for details` : undefined}
                        style={{
                          minHeight: '82px', borderRadius: '8px', padding: '0.35rem',
                          display: 'flex', flexDirection: 'column', gap: '0.2rem',
                          border: isSelected ? '2px solid var(--primary-blue)'
                            : isToday ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                          background: isSelected ? 'var(--primary-blue-light)'
                            : isSunday ? 'var(--bg-color)' : 'var(--panel-bg)',
                          opacity: isSunday ? 0.65 : 1,
                          cursor: hasLeave ? 'pointer' : 'default',
                        }}
                      >
                        <span style={{
                          fontSize: '0.7rem', fontWeight: isToday ? 700 : 500,
                          color: isToday ? 'var(--primary-blue)' : 'var(--text-secondary)',
                        }}>
                          {date.getDate()}
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                          {entries.slice(0, 2).map((e, ei) => {
                            const c = colorForName(e.name);
                            return (
                              <span
                                key={ei}
                                title={e.reason ? `${e.name} — ${e.reason}` : e.name}
                                style={{
                                  fontSize: '0.64rem', fontWeight: 600, background: c.bg, color: c.fg,
                                  borderRadius: '4px', padding: '0.05rem 0.3rem',
                                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}
                              >
                                {e.name}
                              </span>
                            );
                          })}
                          {entries.length > 2 && (
                            <span style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--primary-blue)', paddingLeft: '0.2rem' }}>
                              +{entries.length - 2} more
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Selected day panel */}
          <div style={{
            border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-color)',
            padding: '0.9rem 1rem', minHeight: '200px', position: 'sticky', top: '1rem',
          }}>
            {!selectedKey ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', paddingTop: '2rem' }}>
                <CalendarDays size={26} style={{ opacity: 0.4, marginBottom: '0.5rem' }} />
                <p style={{ margin: 0 }}>Click a day with leave to see who&apos;s out.</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)' }}>{selectedLabel}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {selectedEntries.length} instructor{selectedEntries.length === 1 ? '' : 's'} on leave
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(null)}
                    aria-label="Clear selection"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                  >
                    <X size={15} />
                  </button>
                </div>
                {selectedEntries.length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No one on leave this day.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    {selectedEntries.map((e, ei) => {
                      const c = colorForName(e.name);
                      return (
                        <div key={ei} style={{
                          display: 'flex', flexDirection: 'column', gap: '0.1rem',
                          padding: '0.45rem 0.6rem', borderRadius: '7px',
                          background: 'var(--panel-bg)', borderLeft: `3px solid ${c.fg}`,
                        }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <User size={12} style={{ color: 'var(--text-muted)' }} /> {e.name}
                          </span>
                          {e.reason && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{e.reason}</span>}
                          {e.status && e.status !== 'Approved' && (
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: e.status === 'Rejected' ? 'var(--danger)' : '#b45309' }}>
                              {e.status.toUpperCase()}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
