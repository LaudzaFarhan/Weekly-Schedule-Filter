'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { subscribeToInternalClasses } from '../services/internalScheduleService';
import { subscribeToInternalStudents } from '../services/internalStudentService';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { useNewOperationals } from '../hooks/useNewOperationals';
import { subscribeToActivity, displayUser } from '../services/newActivityService';
import { parseActivityChanges } from '../lib/scheduleActivityHelper';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';
import KpiCard from '../components/ui/KpiCard';
import {
  Users, User, GraduationCap, BookOpen, UserX, CheckCircle, CalendarX,
  TrendingUp, Calendar, MapPin, History, Building2, Star, X
} from 'lucide-react';

/** Kinder programs run 90 minutes; everything else 120. */
const isKinder = (program) => {
  const p = String(program || '').trim();
  return /^kf\d/i.test(p) || /^k\d/i.test(p) || /kinder/i.test(p);
};
const durationFor = (program) => (isKinder(program) ? 90 : 120);
const maxStudentsFor = (program) => (isKinder(program) ? 4 : 6);

/** Instructor capability from the New Ops level string. */
const canTeach = (level, category) => {
  const l = String(level || '').toLowerCase();
  if (category === 'Kinder') return l.includes('kinder');
  if (category === 'Junior') return l.includes('junior');
  if (category === 'Coder') return l.includes('coder');
  return true;
};

const atBranch = (instructor, branchName) => {
  if (!branchName) return true;
  const brs = Array.isArray(instructor.branches) ? instructor.branches : [];
  return brs.includes(branchName) || brs.includes('All Branches');
};

const formatHours = (mins) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

export default function NewHomePage({ onNavigate }) {
  const { branches, enabledBranches } = useSchedule();
  // Branch open days come from PostgreSQL, not the Sheets config.
  const { openDaysFor } = useNewOperationals();

  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);

  const [overviewBranch, setOverviewBranch] = useState('all');
  const [selectedDay, setSelectedDay] = useState(() => {
    const dow = new Date().getDay();
    return dow >= 1 && dow <= 6 ? (DAY_NAMES[dow - 1] || DAY_NAMES[0]) : DAY_NAMES[0];
  });
  const [selectedTime, setSelectedTime] = useState('');
  const [trendMetric, setTrendMetric] = useState('hours'); // 'hours' | 'sessions'
  const [listModal, setListModal] = useState(null);

  // ── New Operations data only (Postgres) ────────────────────────────────
  useEffect(() => {
    const unsub = subscribeToInternalClasses(
      (data) => { setClasses(data); setLoading(false); },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToInternalStudents((data) => setStudents(data || []));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToInternalInstructors((data) => setInstructors(data || []));
    return () => unsub();
  }, []);

  // Activity log from PostgreSQL, so it matches what other devices see.
  useEffect(() => {
    const unsub = subscribeToActivity(
      (data) => setHistory(data || []),
      () => setHistory([]),
      { limit: 12 }
    );
    return () => unsub();
  }, []);

  const branchList = useMemo(
    () => [...new Set([
      ...(enabledBranches || []).map((b) => b.name),
      ...(branches || []).map((b) => b.name),
    ])].filter(Boolean),
    [branches, enabledBranches]
  );
  const branchOptions = ['all', ...branchList];

  const stepBranch = (dir) => {
    const idx = branchOptions.indexOf(overviewBranch);
    const next = dir > 0
      ? (idx >= branchOptions.length - 1 ? 0 : idx + 1)
      : (idx <= 0 ? branchOptions.length - 1 : idx - 1);
    setOverviewBranch(branchOptions[next]);
    setSelectedTime('');
  };

  const targetBranch = overviewBranch === 'all' ? null : overviewBranch;

  const scopedClasses = useMemo(
    () => (targetBranch ? classes.filter((c) => c.branchName === targetBranch) : classes),
    [classes, targetBranch]
  );

  const scopedInstructors = useMemo(
    () => instructors.filter((i) => (i.status ? i.status === 'Active' : true) && atBranch(i, targetBranch)),
    [instructors, targetBranch]
  );

  const scopedStudents = useMemo(
    () => (targetBranch ? students.filter((s) => s.branchName === targetBranch) : students),
    [students, targetBranch]
  );

  // ── KPI stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const kinder = scopedInstructors.filter((i) => canTeach(i.level, 'Kinder'));
    const junior = scopedInstructors.filter((i) => canTeach(i.level, 'Junior'));
    const coder = scopedInstructors.filter((i) => canTeach(i.level, 'Coder'));

    // Students with no class anywhere in the New Ops schedule.
    const allocated = new Set();
    classes.forEach((c) => {
      String(c.student || '').split(',').forEach((n) => {
        const t = n.trim().toLowerCase();
        if (t) allocated.add(t);
      });
    });
    const unallocated = scopedStudents.filter(
      (s) => s.name && !allocated.has(s.name.trim().toLowerCase())
    );

    return {
      instructors: { count: scopedInstructors.length, list: scopedInstructors.map((i) => `${i.name} — ${i.level}`) },
      kinder: { count: kinder.length, list: kinder.map((i) => i.name) },
      junior: { count: junior.length, list: junior.map((i) => i.name) },
      coder: { count: coder.length, list: coder.map((i) => i.name) },
      students: { count: scopedStudents.length, list: scopedStudents.map((s) => `${s.name} — ${s.level || '—'}`) },
      unallocated: { count: unallocated.length, list: unallocated.map((s) => `${s.name} — ${s.branchName || '—'}`) },
    };
  }, [scopedInstructors, scopedStudents, classes]);

  // ── Slots (one lesson = day + time + teacher + branch) ─────────────────
  const slots = useMemo(() => {
    const map = new Map();
    for (const c of scopedClasses) {
      const key = `${c.day}||${c.time}||${c.teacher}||${c.branchName}`;
      if (!map.has(key)) {
        map.set(key, {
          day: c.day, time: c.time, teacher: c.teacher,
          branchName: c.branchName, program: c.program, students: [],
        });
      }
      map.get(key).students.push(c.student);
    }
    return [...map.values()];
  }, [scopedClasses]);

  // ── Availability for the chosen day + time ─────────────────────────────
  const timeOptions = useMemo(() => {
    const set = new Set(
      scopedClasses.filter((c) => c.day === selectedDay).map((c) => c.time).filter(Boolean)
    );
    return [...set].sort((a, b) => {
      const pa = parseTimeSlot(a); const pb = parseTimeSlot(b);
      if (!pa) return 1;
      if (!pb) return -1;
      return pa.start - pb.start;
    });
  }, [scopedClasses, selectedDay]);

  const availability = useMemo(() => {
    if (!selectedDay || !selectedTime) return { available: '-', busy: '-', freeList: [], busyList: [] };
    const freeList = []; const busyList = [];
    for (const inst of scopedInstructors) {
      const isBusy = scopedClasses.some(
        (c) => c.teacher === inst.name && c.day === selectedDay && c.time && doTimeSlotsOverlap(c.time, selectedTime)
      );
      (isBusy ? busyList : freeList).push(inst.name);
    }
    return { available: freeList.length, busy: busyList.length, freeList, busyList };
  }, [selectedDay, selectedTime, scopedInstructors, scopedClasses]);

  // ── Weekly trend: hours and sessions per day ───────────────────────────
  const weeklyTrend = useMemo(() => {
    const byDay = DAY_NAMES.map((day) => ({ day, minutes: 0, sessions: 0 }));
    for (const slot of slots) {
      const entry = byDay.find((d) => d.day === slot.day);
      if (!entry) continue;
      const parsed = parseTimeSlot(slot.time);
      entry.minutes += parsed ? parsed.end - parsed.start : durationFor(slot.program);
      entry.sessions += 1;
    }
    return byDay.map((d) => ({ ...d, hours: Math.round((d.minutes / 60) * 100) / 100 }));
  }, [slots]);

  const trendStats = useMemo(() => {
    const totalMinutes = weeklyTrend.reduce((s, d) => s + d.minutes, 0);
    const totalSessions = weeklyTrend.reduce((s, d) => s + d.sessions, 0);
    const activeDays = weeklyTrend.filter((d) => d.sessions > 0).length;
    const peak = weeklyTrend.reduce((best, d) => (d.minutes > best.minutes ? d : best), weeklyTrend[0]);
    return {
      totalMinutes,
      totalSessions,
      activeDays,
      avgMinutes: activeDays ? totalMinutes / activeDays : 0,
      avgSessions: activeDays ? totalSessions / activeDays : 0,
      peak,
      maxHours: Math.max(...weeklyTrend.map((d) => d.hours), 1),
      maxSessions: Math.max(...weeklyTrend.map((d) => d.sessions), 1),
    };
  }, [weeklyTrend]);

  // ── Branch summary table ──────────────────────────────────────────────
  const branchSummary = useMemo(() => branchList.map((name) => {
    const bClasses = classes.filter((c) => c.branchName === name);
    const bSlots = new Set(bClasses.map((c) => `${c.day}||${c.time}||${c.teacher}`)).size;
    const bInstructors = instructors.filter((i) => (i.status ? i.status === 'Active' : true) && atBranch(i, name));
    const openDays = openDaysFor(name);
    return {
      name,
      openDays: Array.isArray(openDays) ? openDays.length : 0,
      instructors: bInstructors.length,
      students: students.filter((s) => s.branchName === name).length,
      slots: bSlots,
      enrollments: bClasses.length,
    };
  }), [branchList, classes, instructors, students, openDaysFor]);

  // ── Slots at or over capacity ─────────────────────────────────────────
  const fullSlots = useMemo(() => slots
    .map((s) => ({ ...s, max: maxStudentsFor(s.program), used: s.students.length }))
    .filter((s) => s.used >= s.max)
    .sort((a, b) => (b.used - b.max) - (a.used - a.max)),
    [slots]
  );

  const todayName = useMemo(() => {
    const dow = new Date().getDay();
    return dow >= 1 && dow <= 6 ? DAY_NAMES[dow - 1] : null;
  }, []);

  const maxTrend = trendMetric === 'hours' ? trendStats.maxHours : trendStats.maxSessions;

  return (
    <section className="dashboard-view active">
      {/* ── Overview ───────────────────────────────────────────────────── */}
      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <TrendingUp size={20} /> Dashboard Overview
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Live New Operations data — instructors, students and class load.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Branch switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'var(--bg-color)', borderRadius: '20px', padding: '0.25rem 0.4rem', border: '1px solid var(--border-color)' }}>
              <button onClick={() => stepBranch(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0 0.35rem', color: 'var(--primary-blue)', fontWeight: 700 }}>‹</button>
              <span style={{ fontSize: '0.76rem', fontWeight: 700, minWidth: '120px', textAlign: 'center', color: 'var(--text-main)', letterSpacing: '0.02em' }}>
                {overviewBranch === 'all' ? 'ALL BRANCHES' : overviewBranch.toUpperCase()}
              </span>
              <button onClick={() => stepBranch(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0 0.35rem', color: 'var(--primary-blue)', fontWeight: 700 }}>›</button>
            </div>

            {/* Day */}
            <select
              value={selectedDay}
              onChange={(e) => { setSelectedDay(e.target.value); setSelectedTime(''); }}
              className="modal-select-field field-compact"
              style={{ minWidth: '125px' }}
            >
              {DAY_NAMES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Time */}
            <select
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              disabled={timeOptions.length === 0}
              className="modal-select-field field-compact"
              style={{ minWidth: '165px' }}
            >
              <option value="">{timeOptions.length ? 'Select time…' : 'No classes this day'}</option>
              {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="panel-body">
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '2rem', color: 'var(--text-secondary)' }}>
              <div className="loading-spinner" /> Loading New Operations data…
            </div>
          ) : (
            <>
              <div className="kpi-grid">
                <KpiCard
                  icon={<Users size={24} />}
                  title="Instructors"
                  value={stats.instructors.count}
                  variant="blue"
                  onClick={() => setListModal({ title: 'Instructors', list: stats.instructors.list })}
                />
                <KpiCard
                  icon={<BookOpen size={24} />}
                  title="Kinder Capable"
                  value={stats.kinder.count}
                  variant="orange"
                  onClick={() => setListModal({ title: 'Kinder Capable Instructors', list: stats.kinder.list })}
                />
                <KpiCard
                  icon={<GraduationCap size={24} />}
                  title="Coder Capable"
                  value={stats.coder.count}
                  variant="green"
                  onClick={() => setListModal({ title: 'Coder Capable Instructors', list: stats.coder.list })}
                />
                <KpiCard
                  icon={<UserX size={24} />}
                  title="Unallocated Students"
                  value={stats.unallocated.count}
                  variant="red"
                  onClick={() => setListModal({ title: 'Unallocated Students', list: stats.unallocated.list })}
                />
              </div>

              {/* Secondary stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.85rem', marginTop: '1rem' }}>
                {[
                  { label: 'Students', value: stats.students.count, color: '#4f46e5', onClick: () => setListModal({ title: 'Students', list: stats.students.list }) },
                  { label: 'Junior Capable', value: stats.junior.count, color: '#0891b2', onClick: () => setListModal({ title: 'Junior Capable Instructors', list: stats.junior.list }) },
                  { label: 'Class Slots', value: slots.length, color: '#059669' },
                  { label: 'Enrollments', value: scopedClasses.length, color: '#d97706' },
                  { label: 'Weekly Hours', value: formatHours(trendStats.totalMinutes), color: '#7c3aed' },
                ].map((s) => (
                  <div
                    key={s.label}
                    onClick={s.onClick}
                    style={{
                      background: `${s.color}12`, border: `1px solid ${s.color}33`, borderRadius: '10px',
                      padding: '0.8rem 1rem', cursor: s.onClick ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Availability for the picked day/time */}
              {selectedDay && selectedTime && (
                <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', fontWeight: 600 }}>
                    Instructor availability — {selectedDay} at {selectedTime}
                  </h3>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <KpiCard
                        icon={<CheckCircle size={24} />}
                        title="Free"
                        value={availability.available}
                        variant="green"
                        onClick={() => setListModal({ title: `Free — ${selectedDay} ${selectedTime}`, list: availability.freeList })}
                      />
                    </div>
                    <div style={{ flex: '1 1 200px' }}>
                      <KpiCard
                        icon={<CalendarX size={24} />}
                        title="Teaching"
                        value={availability.busy}
                        variant="red"
                        onClick={() => setListModal({ title: `Teaching — ${selectedDay} ${selectedTime}`, list: availability.busyList })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Weekly load + Quick actions / Activity ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem', marginTop: '1.5rem', alignItems: 'start' }}>
        {/* Weekly load chart */}
        <div className="panel" style={{ margin: 0 }}>
          <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Calendar size={17} /> Weekly Class Load
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {overviewBranch === 'all' ? 'All branches' : overviewBranch} · {trendStats.totalSessions} session{trendStats.totalSessions === 1 ? '' : 's'} · {formatHours(trendStats.totalMinutes)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.3rem' }}>
              {['hours', 'sessions'].map((m) => (
                <button
                  key={m}
                  onClick={() => setTrendMetric(m)}
                  style={{
                    fontSize: '0.75rem', fontWeight: 600, padding: '0.3rem 0.75rem', borderRadius: '99px', cursor: 'pointer',
                    border: trendMetric === m ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                    background: trendMetric === m ? 'var(--primary-blue-light)' : 'transparent',
                    color: trendMetric === m ? 'var(--primary-blue)' : 'var(--text-secondary)',
                    textTransform: 'capitalize',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-body">
            {trendStats.totalSessions === 0 ? (
              <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                No classes yet{targetBranch ? ` at ${targetBranch}` : ''}. Add them on the Schedule page.
              </div>
            ) : (
              <>
                {/* Mini KPIs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1.1rem' }}>
                  {[
                    { label: 'Busiest day', value: trendStats.peak?.day || '—' },
                    { label: 'Active days', value: `${trendStats.activeDays}/${DAY_NAMES.length}` },
                    {
                      label: 'Daily average',
                      value: trendMetric === 'hours'
                        ? formatHours(trendStats.avgMinutes)
                        : `${Math.round(trendStats.avgSessions * 10) / 10}`,
                    },
                  ].map((k) => (
                    <div key={k.label} style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '9px', padding: '0.6rem 0.8rem' }}>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>{k.value}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{k.label}</div>
                    </div>
                  ))}
                </div>

                {/* Bars */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.6rem', height: '170px', paddingTop: '0.5rem' }}>
                  {weeklyTrend.map((d) => {
                    const raw = trendMetric === 'hours' ? d.hours : d.sessions;
                    const pct = maxTrend > 0 ? (raw / maxTrend) * 100 : 0;
                    const isToday = d.day === todayName;
                    return (
                      <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', height: '100%' }}>
                        <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                          <div
                            title={`${d.day}: ${formatHours(d.minutes)} · ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}
                            style={{
                              width: '100%',
                              height: `${Math.max(pct, raw > 0 ? 4 : 1.5)}%`,
                              borderRadius: '7px 7px 3px 3px',
                              background: isToday
                                ? 'linear-gradient(180deg, #4f46e5, #6366f1)'
                                : raw > 0 ? 'rgba(79,70,229,0.32)' : 'var(--border-color)',
                              transition: 'height 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                          />
                        </div>
                        <span style={{ fontSize: '0.7rem', fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--primary-blue)' : 'var(--text-muted)' }}>
                          {d.day.slice(0, 3)}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                          {trendMetric === 'hours' ? (d.hours || 0) : d.sessions}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Quick actions + Activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-header">
              <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Quick Actions</h2>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[
                { page: 'schedule', label: 'Manage Schedule', icon: <Calendar size={16} />, color: '#4f46e5' },
                { page: 'operationals', label: 'Class Operation Slots', icon: <Building2 size={16} />, color: '#0891b2' },
                { page: 'trial-availability', label: 'Trial Availability', icon: <Star size={16} />, color: '#d97706' },
                { page: 'workload', label: 'Instructor Workload', icon: <TrendingUp size={16} />, color: '#059669' },
              ].map((a) => (
                <button
                  key={a.page}
                  onClick={() => onNavigate && onNavigate(a.page)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.65rem 0.85rem',
                    borderRadius: '9px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)',
                    cursor: 'pointer', width: '100%', textAlign: 'left',
                  }}
                >
                  <span style={{ width: '30px', height: '30px', borderRadius: '8px', background: `${a.color}1a`, color: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {a.icon}
                  </span>
                  <span style={{ flex: 1, fontSize: '0.84rem', fontWeight: 500, color: 'var(--text-main)' }}>{a.label}</span>
                  <span style={{ color: 'var(--text-muted)' }}>›</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <History size={16} /> Recent Activity
              </h2>
              <button
                onClick={() => onNavigate && onNavigate('activity')}
                className="btn"
                style={{ fontSize: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.3rem 0.7rem', color: 'var(--primary-blue)', background: 'transparent' }}
              >
                View all
              </button>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '210px', overflowY: 'auto' }}>
              {history.length === 0 ? (
                <div style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  No schedule activity yet.
                </div>
              ) : history.slice(0, 12).map((h, i) => {
                const meta = {
                  add: { color: '#059669', label: 'ADD' },
                  bulk: { color: '#4f46e5', label: 'BULK' },
                  edit: { color: '#d97706', label: 'EDIT' },
                  delete: { color: '#dc2626', label: 'DELETE' },
                }[h.action] || { color: 'var(--text-muted)', label: (h.action || '').toUpperCase() };
                const when = new Date(h.createdAt || h.at);
                const parsed = parseActivityChanges(h);

                return (
                  <div key={h.id ?? i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: meta.color, marginTop: '0.42rem', flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ color: 'var(--text-main)', fontWeight: parsed.hasChanges ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {parsed.title}
                      </div>

                      {parsed.hasChanges && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', margin: '0.15rem 0' }}>
                          {parsed.changes.map((c, ci) => (
                            <span
                              key={ci}
                              style={{
                                fontSize: '0.7rem', padding: '0.1rem 0.35rem', borderRadius: '4px',
                                background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)',
                                color: 'var(--text-main)',
                              }}
                            >
                              <strong style={{ color: '#d97706' }}>{c.field}:</strong>{' '}
                              <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{c.before}</span>{' '}
                              <span style={{ color: '#d97706' }}>→</span> {c.after}
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                        {meta.label} · {displayUser(h.userEmail)} · {isNaN(when.getTime()) ? '' : when.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Branch summary + full slots ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem', marginTop: '1.5rem', alignItems: 'start' }}>
        <div className="panel" style={{ margin: 0 }}>
          <div className="panel-header">
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <MapPin size={17} /> Branch Summary
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Click a row to focus the overview on that branch.
              </span>
            </div>
          </div>
          <div className="panel-body table-wrapper" style={{ padding: 0 }}>
            <table id="schedule-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '150px' }}>Branch</th>
                  <th style={{ textAlign: 'center' }}>Open days</th>
                  <th style={{ textAlign: 'center' }}>Instructors</th>
                  <th style={{ textAlign: 'center' }}>Students</th>
                  <th style={{ textAlign: 'center' }}>Slots</th>
                  <th style={{ textAlign: 'center' }}>Enrollments</th>
                </tr>
              </thead>
              <tbody>
                {branchSummary.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                      No branches configured.
                    </td>
                  </tr>
                ) : branchSummary.map((b) => (
                  <tr
                    key={b.name}
                    onClick={() => { setOverviewBranch(b.name); setSelectedTime(''); }}
                    style={{ cursor: 'pointer', background: overviewBranch === b.name ? 'var(--primary-blue-light)' : undefined }}
                  >
                    <td style={{ fontWeight: 600, fontSize: '0.84rem' }}>{b.name}</td>
                    <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{b.openDays}</td>
                    <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{b.instructors}</td>
                    <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{b.students}</td>
                    <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{b.slots}</td>
                    <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{b.enrollments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel" style={{ margin: 0 }}>
          <div className="panel-header">
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <UserX size={17} /> Slots at Capacity
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Kinder max 4 · Junior &amp; Coder max 6
              </span>
            </div>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '260px', overflowY: 'auto' }}>
            {fullSlots.length === 0 ? (
              <div style={{ padding: '0.85rem', textAlign: 'center', color: 'var(--success, #10b981)', fontSize: '0.82rem', fontWeight: 500 }}>
                No slot is full. Room everywhere. 🎉
              </div>
            ) : fullSlots.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.65rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: s.used > s.max ? 'rgba(239,68,68,0.06)' : 'var(--bg-color)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.teacher} · {s.day}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {s.time} · {s.program} · {s.branchName}
                  </div>
                </div>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 700, padding: '0.12rem 0.45rem', borderRadius: '5px', flexShrink: 0,
                  color: s.used > s.max ? 'var(--danger)' : '#d97706',
                  background: s.used > s.max ? 'rgba(239,68,68,0.12)' : 'rgba(217,119,6,0.12)',
                }}>
                  {s.used}/{s.max}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* List modal */}
      {listModal && (
        <div
          onClick={() => setListModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel-bg)', width: '100%', maxWidth: '420px', maxHeight: '80vh', borderRadius: '16px',
              border: '1px solid var(--border-color)', boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{listModal.title}</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {listModal.list.length} item{listModal.list.length === 1 ? '' : 's'}
                  {overviewBranch !== 'all' ? ` · ${overviewBranch}` : ''}
                </span>
              </div>
              <button onClick={() => setListModal(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: '1rem 1.25rem', overflowY: 'auto' }}>
              {listModal.list.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem' }}>
                  Nothing to show.
                </div>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {[...listModal.list].sort((a, b) => String(a).localeCompare(String(b))).map((item, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.7rem', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.84rem', color: 'var(--text-main)' }}>
                      <User size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
