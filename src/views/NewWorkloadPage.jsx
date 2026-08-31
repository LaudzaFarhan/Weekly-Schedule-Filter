'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { subscribeToInternalClasses } from '../services/internalScheduleService';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { subscribeToInternalStudents } from '../services/internalStudentService';
import { useNewOperationals } from '../hooks/useNewOperationals';
import { DAY_NAMES } from '../utils/constants';
import {
  buildWorkloadReport,
  buildIdleWorkloadRow,
  summarizeWorkload,
  classifyWeekly,
  classifyDaily,
  formatHoursMinutes,
  formatMinutesToClock,
  normalizeDayName,
  DEFAULT_THRESHOLDS,
} from '../utils/workloadUtils';
import { getInstructorDisplayName, isInstructorMatch } from '../utils/instructorUtils';
import { BarChart3, Users, Clock, AlertOctagon, MapPin, X } from 'lucide-react';

const STATUS = {
  idle: { label: 'Idle', color: 'var(--text-muted)', bg: 'var(--bg-color)' },
  low: { label: 'Light', color: '#4f46e5', bg: 'rgba(79,70,229,0.1)' },
  normal: { label: 'Healthy', color: '#059669', bg: 'rgba(5,150,105,0.1)' },
  overload: { label: 'Overload', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
};

export default function NewWorkloadPage() {
  const { branches } = useSchedule();

  const [classes, setClasses] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [branchFilter, setBranchFilter] = useState('all');
  const [employmentFilter, setEmploymentFilter] = useState('all');
  const [detail, setDetail] = useState(null); // { teacher, day, dayData, isPartTime, isOutsidePartTime, availableDays }

  // Branch open days come from PostgreSQL, not the Sheets config.
  const { openDaysFor } = useNewOperationals();

  const thresholds = DEFAULT_THRESHOLDS;

  useEffect(() => {
    const unsub = subscribeToInternalClasses(
      (data) => { setClasses(data); setLoadError(null); setLoading(false); },
      (err) => { setLoadError(err?.message || 'Unable to load schedule.'); setLoading(false); }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToInternalInstructors((data) => setInstructors(data));
    return () => unsub();
  }, []);

  const [studentRegistry, setStudentRegistry] = useState([]);

  useEffect(() => {
    const unsub = subscribeToInternalStudents((data) => setStudentRegistry(data || []));
    return () => unsub();
  }, []);

  const studentBranchMap = useMemo(() => {
    const map = new Map();
    for (const s of studentRegistry || []) {
      const bName = s.branchName || s.branch_name;
      if (s.name && bName) {
        map.set(s.name.trim().toLowerCase(), bName);
      }
    }
    return map;
  }, [studentRegistry]);

  const branchList = [...new Set((branches || []).map((b) => b.name))].filter(Boolean);

  const getInstructorProfile = (teacher) => {
    return instructors.find((i) => isInstructorMatch(teacher, i));
  };

  const isInstructorPartTime = (instOrTeacher) => {
    const inst = typeof instOrTeacher === 'object' && instOrTeacher !== null
      ? instOrTeacher
      : getInstructorProfile(instOrTeacher);
    const empType = inst?.employmentType || inst?.employment_type;
    return empType === 'Part-Time' || inst?.status === 'parttime';
  };

  const getInstructorAvailableDays = (instOrTeacher) => {
    const inst = typeof instOrTeacher === 'object' && instOrTeacher !== null
      ? instOrTeacher
      : getInstructorProfile(instOrTeacher);
    const raw = Array.isArray(inst?.availableDays)
      ? inst.availableDays
      : (Array.isArray(inst?.available_days) ? inst.available_days : (Array.isArray(inst?.workingDays) ? inst.workingDays : []));
    return raw.map((d) => normalizeDayName(d) || d).filter(Boolean);
  };

  // Working days per instructor. For Part-Time instructors, their declared available
  // days are used. For Full-Time instructors, days come from branch operating rules.
  const workingDaysFor = (teacher) => {
    const inst = getInstructorProfile(teacher);
    const isPT = isInstructorPartTime(inst);
    if (isPT) {
      const avDays = getInstructorAvailableDays(inst);
      if (avDays.length > 0) {
        return new Set(avDays);
      }
    }
    const brs = inst?.branches || [];
    const days = new Set();
    const sources = brs.length ? brs : branchList;
    sources.forEach((bn) => openDaysFor(bn).forEach((d) => days.add(d)));
    if (days.size === 0) DAY_NAMES.forEach((d) => days.add(d));
    return days;
  };

  // Adaptive thresholds for Part-Time instructors based on their working days
  const getInstructorThresholds = (teacher) => {
    const inst = getInstructorProfile(teacher);
    const isPT = isInstructorPartTime(inst);
    if (isPT) {
      const avDays = getInstructorAvailableDays(inst);
      const numDays = Math.max(1, avDays.length || 2);
      return {
        dailyAmber: thresholds.dailyAmber,
        dailyRed: thresholds.dailyRed,
        weeklyAmber: Math.min(thresholds.weeklyAmber, numDays * thresholds.dailyAmber),
        weeklyRed: Math.min(thresholds.weeklyRed, numDays * thresholds.dailyRed),
      };
    }
    return thresholds;
  };

  // Build the report from New Operations classes only. Instructors with no
  // classes are added as idle rows so the whole registry is represented.
  const report = useMemo(() => {
    const scoped = branchFilter === 'all'
      ? classes
      : classes.filter((c) => {
          if (c.branchName !== branchFilter) return false;
          if (c.student && studentBranchMap.size > 0) {
            const names = String(c.student).split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
            for (const name of names) {
              const official = studentBranchMap.get(name);
              if (official && official.toLowerCase() !== branchFilter.toLowerCase()) {
                return false;
              }
            }
          }
          return true;
        });
    const base = buildWorkloadReport(scoped, { instructorProfiles: instructors });
    const filteredBase = base.filter((r) => {
      const profile = instructors.find((i) => isInstructorMatch(r.teacher, i));
      if (!profile) return false;
      if (branchFilter !== 'all') {
        const brs = Array.isArray(profile.branches) ? profile.branches : [profile.location].filter(Boolean);
        if (!brs.includes('All Branches') && !brs.includes(branchFilter) && profile.location !== branchFilter) return false;
      }
      if (employmentFilter !== 'all') {
        const isPT = isInstructorPartTime(profile);
        const empType = isPT ? 'Part-Time' : 'Full-Time';
        if (empType !== employmentFilter) return false;
      }
      return true;
    });

    const existing = new Set(filteredBase.map((r) => r.teacher));
    const extras = [];
    instructors.forEach((i) => {
      const displayName = getInstructorDisplayName(i);
      if (!displayName) return;
      const brs = Array.isArray(i.branches) ? i.branches : [i.location].filter(Boolean);
      if (branchFilter !== 'all' && !brs.includes('All Branches') && !brs.includes(branchFilter) && i.location !== branchFilter) return;
      const isPT = isInstructorPartTime(i);
      const empType = isPT ? 'Part-Time' : 'Full-Time';
      if (employmentFilter !== 'all' && empType !== employmentFilter) return;
      if (!existing.has(displayName) && !existing.has(i.name)) {
        extras.push(buildIdleWorkloadRow(displayName));
        existing.add(displayName);
      }
    });
    return filteredBase.concat(extras);
  }, [classes, instructors, branchFilter, employmentFilter, studentBranchMap]);

  const summary = useMemo(() => {
    const baseSummary = summarizeWorkload(report, thresholds);
    let overloadedCount = 0;
    let ftCount = 0;
    let ptCount = 0;

    report.forEach((r) => {
      const inst = getInstructorProfile(r.teacher);
      const isPT = isInstructorPartTime(inst);
      if (isPT) ptCount++;
      else ftCount++;

      const t = getInstructorThresholds(r.teacher);
      if (r.weekly.hours > t.weeklyRed) {
        overloadedCount++;
      }
    });

    return {
      ...baseSummary,
      overloadedCount,
      ftCount,
      ptCount,
    };
  }, [report, thresholds, instructors]);

  const sorted = useMemo(
    () => [...report].sort((a, b) => b.weekly.hours - a.weekly.hours),
    [report]
  );

  const heatmapMax = useMemo(() => {
    let m = 0;
    report.forEach((r) => DAY_NAMES.forEach((d) => { if (r.byDay[d].hours > m) m = r.byDay[d].hours; }));
    return m;
  }, [report]);

  const cellColor = (hours) => {
    if (hours <= 0) return 'var(--bg-color)';
    if (hours > thresholds.dailyRed) return 'rgba(239,68,68,0.85)';
    if (hours > thresholds.dailyAmber) return 'rgba(245,158,11,0.75)';
    const intensity = heatmapMax > 0 ? Math.min(1, hours / Math.max(thresholds.dailyAmber, 1)) : 0;
    return `rgba(79,70,229,${0.25 + intensity * 0.55})`;
  };

  const kpis = [
    {
      label: 'Instructors',
      value: report.length,
      subtext: `${summary.ftCount || 0} Full-Time · ${summary.ptCount || 0} Part-Time`,
      icon: Users,
      color: '#4f46e5',
    },
    {
      label: 'Total hours / week',
      value: formatHoursMinutes(summary.totalHours || 0),
      subtext: `Avg ${formatHoursMinutes(summary.avgHours || 0)} / instructor`,
      icon: Clock,
      color: '#0891b2',
    },
    {
      label: 'Overloaded',
      value: summary.overloadedCount || 0,
      subtext: summary.overloadedCount > 0 ? 'Exceeding capacity limit' : 'All within capacity limits',
      icon: AlertOctagon,
      color: summary.overloadedCount > 0 ? '#dc2626' : '#059669',
    },
  ];

  return (
    <section className="dashboard-view active">
      <div data-tour="workload-header" className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <BarChart3 size={20} /> Workload
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Hours per instructor from the New Operations schedule.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              data-tour="workload-employment-filter"
              value={employmentFilter}
              onChange={(e) => setEmploymentFilter(e.target.value)}
              style={{ padding: '0.5rem 0.85rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'white', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              <option value="all">All Employment Types</option>
              <option value="Full-Time">Full-Time Only</option>
              <option value="Part-Time">Part-Time Only</option>
            </select>
            <select
              data-tour="workload-branch-filter"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'white', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              <option value="all">All Branches</option>
              {branchList.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
              <div className="loading-spinner" style={{ marginBottom: '1rem' }} />
              <p>Loading workload from the database...</p>
            </div>
          ) : loadError ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              <AlertOctagon size={28} style={{ color: 'var(--danger)' }} />
              <div style={{ fontWeight: 600, marginTop: '0.5rem', color: 'var(--text-main)' }}>Couldn&apos;t load workload</div>
              <div style={{ fontSize: '0.82rem' }}>{loadError}</div>
            </div>
          ) : (
            <>
              {/* KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
                {kpis.map((k) => (
                  <div key={k.label} style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <k.icon size={22} style={{ color: k.color }} />
                    <div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{k.label}</div>
                      {k.subtext && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{k.subtext}</div>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Heatmap */}
              <div data-tour="workload-table">
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.15rem' }}>Daily Workload Heatmap</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Hours per day, per instructor. Red cells exceed {thresholds.dailyRed}h.</span>
                {sorted.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '1rem' }}>No instructors or classes match the filter.</p>
                ) : (
                  <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                    <div style={{ minWidth: `${170 + DAY_NAMES.length * 64}px` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: `170px repeat(${DAY_NAMES.length}, 1fr)`, gap: '4px', marginBottom: '4px' }}>
                        <div />
                        {DAY_NAMES.map((d) => (
                          <div key={d} style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', textTransform: 'uppercase' }}>{d.slice(0, 3)}</div>
                        ))}
                      </div>
                      {sorted.slice(0, 30).map((r) => {
                        const wd = workingDaysFor(r.teacher);
                        const inst = getInstructorProfile(r.teacher);
                        const isPartTime = isInstructorPartTime(inst);
                        const avDays = isPartTime ? getInstructorAvailableDays(inst) : [];
                        const ptDaysFormatted = avDays.map((d) => d.slice(0, 3)).join(', ');

                        return (
                          <div key={r.teacher} style={{ display: 'grid', gridTemplateColumns: `170px repeat(${DAY_NAMES.length}, 1fr)`, gap: '4px', marginBottom: '4px', alignItems: 'center' }}>
                            <div
                              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden', paddingRight: '0.5rem' }}
                              title={`${r.teacher} (${isPartTime ? `Part-Time: ${ptDaysFormatted || 'No days configured'}` : 'Full-Time'})`}
                            >
                              <span style={{ fontSize: '0.78rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.teacher}</span>
                              {isPartTime ? (
                                <span
                                  style={{
                                    fontSize: '0.6rem',
                                    fontWeight: 700,
                                    padding: '0.08rem 0.35rem',
                                    borderRadius: '4px',
                                    background: 'rgba(245, 158, 11, 0.15)',
                                    color: '#b45309',
                                    border: '1px solid rgba(245, 158, 11, 0.3)',
                                    flexShrink: 0,
                                  }}
                                  title={`Part-Time (${ptDaysFormatted || 'No days set'})`}
                                >
                                  PT
                                </span>
                              ) : (
                                <span
                                  style={{
                                    fontSize: '0.6rem',
                                    fontWeight: 600,
                                    padding: '0.08rem 0.35rem',
                                    borderRadius: '4px',
                                    background: 'var(--bg-color)',
                                    color: 'var(--text-muted)',
                                    border: '1px solid var(--border-color)',
                                    flexShrink: 0,
                                  }}
                                  title="Full-Time"
                                >
                                  FT
                                </span>
                              )}
                            </div>
                            {DAY_NAMES.map((d) => {
                              const dd = r.byDay[d];
                              const hrs = dd.hours;
                              const hasData = hrs > 0;
                              const isWorking = wd.has(d);
                              const isOutsidePartTime = isPartTime && !isWorking && hasData;

                              return (
                                <button
                                  key={d}
                                  type="button"
                                  disabled={!hasData}
                                  onClick={hasData ? () => setDetail({
                                    teacher: r.teacher,
                                    day: d,
                                    dayData: dd,
                                    isPartTime,
                                    isOutsidePartTime,
                                    availableDays: avDays,
                                  }) : undefined}
                                  title={hasData
                                    ? `${r.teacher} · ${d}: ${formatHoursMinutes(hrs)} (${dd.sessions} sessions)${isOutsidePartTime ? ' [⚠️ Off-day assignment]' : ''} — click for details`
                                    : `${r.teacher} · ${d}: ${isWorking ? 'Free' : (isPartTime ? 'Off (Part-Time)' : 'Holiday')}`}
                                  style={{
                                    height: 28, borderRadius: 4,
                                    border: isOutsidePartTime ? '1.5px solid #f59e0b' : 'none',
                                    padding: 0,
                                    background: hasData ? cellColor(hrs) : (isWorking ? 'var(--bg-color)' : 'repeating-linear-gradient(45deg, var(--bg-color), var(--bg-color) 4px, var(--border-color) 4px, var(--border-color) 8px)'),
                                    color: hrs > thresholds.dailyAmber ? 'white' : (hrs > 0 ? 'white' : (isWorking ? 'var(--text-muted)' : '#9ca3af')),
                                    fontSize: hasData ? '0.7rem' : '0.6rem', fontWeight: 600,
                                    cursor: hasData ? 'pointer' : 'default',
                                    opacity: isWorking || hasData ? 1 : 0.65,
                                    position: 'relative',
                                  }}
                                >
                                  {hrs > 0 ? formatHoursMinutes(hrs) : (isWorking ? 'FREE' : (isPartTime ? 'OFF' : 'HOLIDAY'))}
                                  {isOutsidePartTime && (
                                    <span
                                      style={{
                                        position: 'absolute',
                                        top: -2,
                                        right: -2,
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        background: '#f59e0b',
                                        border: '1px solid white',
                                      }}
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                    {sorted.length > 30 && (
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Showing top 30 by hours.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Instructor table */}
              <div className="table-wrapper">
                <table id="schedule-table">
                  <thead>
                    <tr>
                      <th>Instructor</th>
                      <th>Employment</th>
                      <th style={{ textAlign: 'right' }}>Hours / week</th>
                      <th style={{ textAlign: 'center' }}>Sessions</th>
                      <th style={{ textAlign: 'center' }}>Students</th>
                      <th style={{ textAlign: 'center' }}>Active days</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => {
                      const inst = getInstructorProfile(r.teacher);
                      const isPartTime = isInstructorPartTime(inst);
                      const avDays = isPartTime ? getInstructorAvailableDays(inst) : [];
                      const ptDaysFormatted = avDays.map((d) => d.slice(0, 3)).join(', ');

                      const t = getInstructorThresholds(r.teacher);
                      const cls = classifyWeekly(r.weekly.hours, t);
                      const st = STATUS[cls] || STATUS.idle;
                      return (
                        <tr key={r.teacher}>
                          <td style={{ fontWeight: 600 }}>{r.teacher}</td>
                          <td>
                            {isPartTime ? (
                              <span style={{
                                fontSize: '0.72rem',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '6px',
                                background: 'rgba(245, 158, 11, 0.12)',
                                color: '#b45309',
                                fontWeight: 600,
                                border: '1px solid rgba(245, 158, 11, 0.25)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                              }}>
                                Part-Time {ptDaysFormatted ? `(${ptDaysFormatted})` : ''}
                              </span>
                            ) : (
                              <span style={{
                                fontSize: '0.72rem',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '6px',
                                background: 'var(--bg-color)',
                                color: 'var(--text-secondary)',
                                fontWeight: 500,
                                border: '1px solid var(--border-color)',
                              }}>
                                Full-Time
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>{formatHoursMinutes(r.weekly.hours)}</td>
                          <td style={{ textAlign: 'center' }}>{r.weekly.sessions}</td>
                          <td style={{ textAlign: 'center' }}>{r.weekly.students}</td>
                          <td style={{ textAlign: 'center' }}>{r.weekly.activeDays}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: st.color, background: st.bg, padding: '0.15rem 0.55rem', borderRadius: '99px' }}>{st.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Session detail modal */}
      {detail && (
        <div
          onClick={() => setDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--panel-bg, white)', borderRadius: '12px', maxWidth: '640px', width: '100%', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{detail.teacher} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {detail.day}</span></h3>
                  {detail.isPartTime ? (
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '0.12rem 0.45rem', borderRadius: '4px', background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b' }}>
                      Part-Time ({detail.availableDays?.map((d) => d.slice(0, 3)).join(', ') || 'No days set'})
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '0.12rem 0.45rem', borderRadius: '4px', background: 'var(--bg-color)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                      Full-Time
                    </span>
                  )}
                </div>
                {detail.isOutsidePartTime && (
                  <div style={{ fontSize: '0.74rem', color: '#b45309', background: '#fef3c7', padding: '0.25rem 0.55rem', borderRadius: '6px', marginTop: '0.4rem', border: '1px dashed #f59e0b', fontWeight: 500 }}>
                    ⚠️ Scheduled on an off-day (outside instructor&apos;s Part-Time available days)
                  </div>
                )}
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                  <strong>{formatHoursMinutes(detail.dayData.hours)}</strong> teaching · {detail.dayData.sessions} session{detail.dayData.sessions === 1 ? '' : 's'} · {detail.dayData.students} student{detail.dayData.students === 1 ? '' : 's'}
                  {detail.dayData.busiestStartMin !== null && (
                    <> · {formatMinutesToClock(detail.dayData.busiestStartMin)} – {formatMinutesToClock(detail.dayData.busiestEndMin)}</>
                  )}
                </div>
              </div>
              <button onClick={() => setDetail(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '0.2rem' }}><X size={18} /></button>
            </div>
            <div style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {(detail.dayData.sessionList || []).map((s, i) => (
                <div key={`${s.time}-${i}`} style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.75rem 0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{s.time}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{Math.round(s.durationMin)}m · {s.students} student{s.students === 1 ? '' : 's'}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                      {s.programs?.length > 0 && (
                        <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--primary-blue, #4f46e5)', background: 'var(--primary-blue-light, rgba(79,70,229,0.12))', padding: '0.15rem 0.5rem', borderRadius: '99px' }}>{s.programs.join(', ')}</span>
                      )}
                      {s.branches?.length > 0 && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><MapPin size={10} /> {s.branches.join(' · ')}</span>
                      )}
                    </div>
                  </div>
                  {(s.studentDetails?.length || 0) > 0 && (
                    <div style={{ marginTop: '0.55rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {s.studentDetails.map((sd, idx) => {
                        const isIzin = !!(sd.notArranged || sd.isIzin || (typeof sd.remarks === 'string' && sd.remarks.toLowerCase().includes('izin')));
                        return (
                          <span
                            key={`${sd.student}-${idx}`}
                            style={{
                              fontSize: '0.74rem', padding: '0.2rem 0.6rem', borderRadius: '6px',
                              background: isIzin ? '#fef3c7' : 'var(--bg-color)',
                              color: isIzin ? '#92400e' : 'var(--text-secondary)',
                              border: isIzin ? '1px dashed #f59e0b' : '1px solid var(--border-color)',
                              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                              fontWeight: isIzin ? 600 : 400,
                            }}
                          >
                            <span style={{ textDecoration: isIzin ? 'line-through' : 'none' }}>
                              {sd.student || '—'}
                            </span>
                            {isIzin && (
                              <span style={{
                                fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.02em',
                                color: '#b45309', background: '#fde68a', border: '1px solid #f59e0b',
                                padding: '0.05rem 0.35rem', borderRadius: '4px',
                              }}>
                                Izin
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

