'use client';

import { useState, useMemo, Fragment } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { DAY_NAMES } from '../utils/constants';
import { getWeekdaysInRange, leaveAppliesToDay } from '../utils/dateUtils';
import { doTimeSlotsOverlap } from '../utils/timeUtils';
import { instructorBelongsToBranch } from '../utils/instructorUtils';
import Badge from '../components/ui/Badge';
import Pagination from '../components/ui/Pagination';
import { Trash2, ChevronLeft, ChevronRight, CalendarDays, Wand2, CheckCircle, MapPin } from 'lucide-react';

const PAGE_SIZE = 8;

/** Stable-ish color per instructor name so calendar pills are easy to scan. */
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
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return LEAVE_COLORS[Math.abs(hash) % LEAVE_COLORS.length];
}

/** Parse a YYYY-MM-DD string into a local Date at midnight. */
function parseISO(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Local YYYY-MM-DD key for a Date. */
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function LeavePage() {
  const { uniqueBaseTeachers, leaveList, updateLeaveList, disabledInstructors, overallClasses, instructorProfiles } = useSchedule();
  const [selectedInstructor, setSelectedInstructor] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [page, setPage] = useState(1);
  const [simulateKey, setSimulateKey] = useState(null);

  const getSimulateData = (leave) => {
    const affectedWeekdays = getWeekdaysInRange(leave.startDate, leave.endDate);
    
    // Group affected classes by day -> time
    const affectedClasses = {}; // day -> class[]
    
    (overallClasses || []).forEach(c => {
      if (c.teacher === leave.name && affectedWeekdays.includes(c.day)) {
        if (!affectedClasses[c.day]) affectedClasses[c.day] = [];
        // prevent duplicate classes for the same time and branch
        if (!affectedClasses[c.day].some(existing => existing.time === c.time && existing.branchName === c.branchName)) {
           affectedClasses[c.day].push(c);
        }
      }
    });

    const result = {}; 
    for (const day of Object.keys(affectedClasses)) {
      result[day] = [];
      const classesForDay = affectedClasses[day];
      
      classesForDay.forEach(c => {
        const substitutes = [];
        (uniqueBaseTeachers || []).forEach(t => {
          if (t === leave.name) return;
          if (disabledInstructors.has(t)) return;
          
          const isOnLeave = leaveList.some(l => l.name === t && leaveAppliesToDay(l, day));
          if (isOnLeave) return;

          if (c.branchName && !instructorBelongsToBranch(t, c.branchName, instructorProfiles, overallClasses)) return;

          const isBusy = overallClasses.some(
            oc => oc.teacher === t && oc.day === day && doTimeSlotsOverlap(oc.time, c.time)
          );
          if (isBusy) return;

          const p = (instructorProfiles || []).find(pr => pr.nickname === t || pr.fullname === t);
          if (!p) return; // skip garbage names from sheet (e.g. "Kinder HC Training")
          
          const workingDays = p.status === 'fulltime' ? DAY_NAMES : (p.workingDays || []);
          if (!workingDays.includes(day)) return;

          const branchTag = p.location || '';
          
          substitutes.push({ name: t, branch: branchTag });
        });
        
        result[day].push({ classInfo: c, substitutes });
      });
    }

    return result;
  };

  const sortedTeachers = [...uniqueBaseTeachers].filter(t => !disabledInstructors.has(t)).sort();
  const totalPages = Math.ceil(leaveList.length / PAGE_SIZE);
  const paged = leaveList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const canAdd = selectedInstructor && startDate && endDate && startDate <= endDate;

  const handleAdd = () => {
    if (!canAdd) return;
    const exists = leaveList.some(
      (l) => l.name === selectedInstructor && l.startDate === startDate && l.endDate === endDate
    );
    if (exists) {
      alert(`${selectedInstructor} already has this leave recorded.`);
      return;
    }
    const newList = [...leaveList, { name: selectedInstructor, startDate, endDate, reason }];
    updateLeaveList(newList);
    setSelectedInstructor('');
    setStartDate('');
    setEndDate('');
    setReason('');
  };

  const handleRemove = (index) => {
    const actualIndex = (page - 1) * PAGE_SIZE + index;
    const newList = leaveList.filter((_, i) => i !== actualIndex);
    updateLeaveList(newList);
    if (paged.length === 1 && page > 1) setPage(page - 1);
  };

  return (
    <section className="dashboard-view active">
      <div className="panel leave-panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Leave Management</h2>
            <span className="subtext">Mark instructors as on leave for specific date ranges</span>
          </div>
          <Badge variant="warning">{leaveList.length} On Leave</Badge>
        </div>
        <div className="panel-body leave-body">
          <div className="leave-form">
            <div className="leave-form-row">
              <div className="input-group leave-input-name">
                <label>Instructor</label>
                <select value={selectedInstructor} onChange={(e) => setSelectedInstructor(e.target.value)}>
                  <option value="" disabled>Select instructor...</option>
                  {sortedTeachers.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="input-group leave-input-day">
                <label>Start Date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="input-group leave-input-day">
                <label>End Date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="input-group leave-input-reason">
                <label>Reason (optional)</label>
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sick, Holiday..." />
              </div>
              <button className="btn btn-warning leave-add-btn" disabled={!canAdd} onClick={handleAdd}>
                + Mark On Leave
              </button>
            </div>
          </div>

          <div className="leave-table-wrapper">
            <table className="leave-table">
              <thead>
                <tr>
                  <th>Instructor</th>
                  <th>Dates</th>
                  <th>Reason</th>
                  <th style={{ width: 60, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {leaveList.length === 0 ? (
                  <tr><td colSpan="4" className="empty-state-table">No instructors on leave.</td></tr>
                ) : (
                  paged.map((l, i) => (
                    <Fragment key={i}>
                      <tr>
                        <td>{l.name}</td>
                        <td>{l.startDate} to {l.endDate}</td>
                        <td>{l.reason || '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button 
                            className="btn-icon" 
                            style={{ color: simulateKey === i ? 'var(--primary-blue)' : 'var(--text-secondary)', marginRight: '0.5rem' }} 
                            onClick={() => setSimulateKey(simulateKey === i ? null : i)}
                            title="Simulate Impact"
                          >
                            <Wand2 size={16} />
                          </button>
                          <button className="btn-icon btn-icon-danger" onClick={() => handleRemove(i)} title="Remove">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                      {simulateKey === i && (
                        <tr>
                          <td colSpan="4" style={{ padding: 0, borderBottom: '1px solid var(--border-color)' }}>
                            <div style={{ padding: '1rem', background: 'var(--panel-bg)', borderLeft: '3px solid var(--primary-blue)' }}>
                              <h4 style={{ fontSize: '0.85rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-main)' }}>
                                <Wand2 size={15} /> Impact Simulation for {l.name}
                              </h4>
                              {Object.keys(getSimulateData(l)).length === 0 ? (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                  No affected classes found for this leave period.
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                  {Object.entries(getSimulateData(l)).map(([day, items]) => (
                                    <div key={day}>
                                      <strong style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>{day}</strong>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {items.map((item, idx) => (
                                          <div key={idx} style={{ padding: '0.6rem 0.8rem', background: 'var(--bg-color)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                                                {item.classInfo.time} {item.classInfo.branchName && <span style={{ color: 'var(--text-muted)' }}>[{item.classInfo.branchName}]</span>}
                                              </span>
                                              <Badge variant="neutral">{item.classInfo.program}</Badge>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                                              Suggested Substitutes:
                                            </div>
                                            {item.substitutes.length === 0 ? (
                                              <div style={{ fontSize: '0.75rem', color: 'var(--warning)', fontStyle: 'italic' }}>
                                                No free instructors found.
                                              </div>
                                            ) : (
                                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                                {item.substitutes.map(sub => (
                                                  <span
                                                    key={sub.name}
                                                    style={{
                                                      display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                                                      fontSize: '0.72rem', fontWeight: 500,
                                                      padding: '0.2rem 0.5rem', borderRadius: '99px',
                                                      background: 'var(--success-bg)', color: 'var(--success)',
                                                      border: '1px solid var(--success)',
                                                    }}
                                                  >
                                                    <CheckCircle size={10} />
                                                    {sub.name}
                                                    {sub.branch && (
                                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.1rem', opacity: 0.7, fontWeight: 400 }}>
                                                        <MapPin size={8} /> {sub.branch}
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
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>

      <LeaveCalendar leaveList={leaveList} />
    </section>
  );
}

/* ─── Leave Calendar ──────────────────────────────────────── */

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function LeaveCalendar({ leaveList }) {
  // Which month the grid is showing. Defaults to the current month.
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  // Which day cell is selected (its leave list shows in the side panel).
  const [selectedKey, setSelectedKey] = useState(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const monthLabel = viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  // Map every date in the visible month → list of { name, reason } on leave.
  const leaveByDate = useMemo(() => {
    const map = new Map(); // dateKey → [{ name, reason }]
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0); // last day of month

    for (const l of leaveList || []) {
      const start = parseISO(l.startDate);
      const end = parseISO(l.endDate) || start;
      if (!start) continue; // legacy day-only leaves have no date — skip on calendar

      // Clip the leave range to the visible month for iteration.
      const from = start < monthStart ? monthStart : start;
      const to = end > monthEnd ? monthEnd : end;
      if (to < from) continue;

      const cursor = new Date(from);
      while (cursor <= to) {
        // Program runs Mon–Sat; skip Sundays in the leave fill.
        if (cursor.getDay() !== 0) {
          const key = dateKey(cursor);
          if (!map.has(key)) map.set(key, []);
          map.get(key).push({ name: l.name, reason: l.reason || '' });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [leaveList, year, month]);

  // Build the 6-row grid of dates (including leading/trailing blanks).
  const weeks = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const startWeekday = firstOfMonth.getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null); // leading blanks
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null); // trailing blanks

    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [year, month]);

  const todayKey = dateKey(new Date());

  const goPrev = () => { setViewDate(new Date(year, month - 1, 1)); setSelectedKey(null); };
  const goNext = () => { setViewDate(new Date(year, month + 1, 1)); setSelectedKey(null); };
  const goToday = () => {
    const d = new Date();
    setViewDate(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedKey(dateKey(d));
  };

  const totalOnLeaveThisMonth = useMemo(() => {
    const names = new Set();
    for (const list of leaveByDate.values()) list.forEach((e) => names.add(e.name));
    return names.size;
  }, [leaveByDate]);

  // Selected day details for the side panel.
  const selectedEntries = selectedKey ? (leaveByDate.get(selectedKey) || []) : [];
  const selectedDateLabel = selectedKey
    ? parseISO(selectedKey)?.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    : null;

  return (
    <div className="panel leave-panel" style={{ marginTop: '1.5rem' }}>
      <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div className="panel-header-left">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CalendarDays size={18} /> Leave Calendar
          </h2>
          <span className="subtext">
            Who&apos;s out this month
            {totalOnLeaveThisMonth > 0 && <> · {totalOnLeaveThisMonth} instructor{totalOnLeaveThisMonth === 1 ? '' : 's'}</>}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={goToday}
            style={{ padding: '0.35rem 0.7rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer' }}
          >
            Today
          </button>
          <button type="button" onClick={goPrev} aria-label="Previous month" style={navBtnStyle}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ minWidth: '140px', textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>{monthLabel}</span>
          <button type="button" onClick={goNext} aria-label="Next month" style={navBtnStyle}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: '1rem', alignItems: 'start' }}>
          {/* Calendar grid */}
          <div>
            {/* Weekday header */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
              {WEEKDAY_LABELS.map((w, idx) => (
                <div
                  key={w}
                  style={{
                    textAlign: 'center', fontSize: '0.72rem', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                    color: idx === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
                    padding: '0.25rem 0',
                  }}
                >
                  {w}
                </div>
              ))}
            </div>

            {/* Date grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                  {week.map((date, di) => {
                    if (!date) {
                      return <div key={di} style={{ minHeight: '84px', borderRadius: '8px', background: 'transparent' }} />;
                    }
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
                        onKeyDown={hasLeave ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedKey(isSelected ? null : key); } } : undefined}
                        title={hasLeave ? `${entries.length} on leave — click for details` : undefined}
                        style={{
                          minHeight: '84px',
                          borderRadius: '8px',
                          border: isSelected
                            ? '2px solid var(--primary-blue)'
                            : isToday ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                          background: isSelected
                            ? 'var(--primary-blue-light)'
                            : isSunday ? 'var(--bg-color)' : 'var(--panel-bg)',
                          padding: '0.35rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.2rem',
                          opacity: isSunday ? 0.6 : 1,
                          cursor: hasLeave ? 'pointer' : 'default',
                          transition: 'background 0.12s, border-color 0.12s',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{
                            fontSize: '0.72rem',
                            fontWeight: isToday ? 700 : 500,
                            color: isToday ? 'var(--primary-blue)' : 'var(--text-secondary)',
                          }}>
                            {date.getDate()}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                          {entries.slice(0, 2).map((e, ei) => {
                            const c = colorForName(e.name);
                            return (
                              <span
                                key={ei}
                                title={e.reason ? `${e.name} — ${e.reason}` : e.name}
                                style={{
                                  fontSize: '0.66rem',
                                  fontWeight: 600,
                                  background: c.bg,
                                  color: c.fg,
                                  borderRadius: '4px',
                                  padding: '0.05rem 0.3rem',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {e.name}
                              </span>
                            );
                          })}
                          {entries.length > 2 && (
                            <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--primary-blue)', paddingLeft: '0.2rem' }}>
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

          {/* Side panel — selected day's full leave list */}
          <div style={{
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            background: 'var(--bg-color)',
            padding: '0.9rem 1rem',
            minHeight: '200px',
            position: 'sticky',
            top: '1rem',
          }}>
            {!selectedKey ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', paddingTop: '2rem' }}>
                <CalendarDays size={28} style={{ opacity: 0.4, marginBottom: '0.5rem' }} />
                <p style={{ margin: 0 }}>Click a day with leave to see who&apos;s out.</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      {selectedDateLabel}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {selectedEntries.length} instructor{selectedEntries.length === 1 ? '' : 's'} on leave
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(null)}
                    aria-label="Clear selection"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1 }}
                  >
                    ✕
                  </button>
                </div>
                {selectedEntries.length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No one on leave this day.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    {selectedEntries.map((e, ei) => {
                      const c = colorForName(e.name);
                      return (
                        <div
                          key={ei}
                          style={{
                            display: 'flex', flexDirection: 'column', gap: '0.1rem',
                            padding: '0.4rem 0.55rem',
                            borderRadius: '6px',
                            background: 'var(--panel-bg)',
                            borderLeft: `3px solid ${c.fg}`,
                          }}
                        >
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>{e.name}</span>
                          {e.reason && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{e.reason}</span>
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

const navBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '30px',
  height: '30px',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};
