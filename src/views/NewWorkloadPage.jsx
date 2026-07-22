'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { subscribeToInternalClasses } from '../services/internalScheduleService';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { resolveBranchWorkingDays } from './NewOperationalsPage';
import { DAY_NAMES } from '../utils/constants';
import {
  buildWorkloadReport,
  buildIdleWorkloadRow,
  summarizeWorkload,
  classifyWeekly,
  classifyDaily,
  formatHoursMinutes,
  formatMinutesToClock,
  DEFAULT_THRESHOLDS,
} from '../utils/workloadUtils';
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
  const [detail, setDetail] = useState(null); // { teacher, day, dayData }

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

  const branchList = [...new Set((branches || []).map((b) => b.name))].filter(Boolean);

  // Working days per instructor, derived from the Operationals config of the
  // branch(es) they teach at. Falls back to the default branch calendar.
  const workingDaysFor = (teacher) => {
    const inst = instructors.find((i) => i.name === teacher);
    const brs = inst?.branches || [];
    const days = new Set();
    if (brs.length === 0) {
      resolveBranchWorkingDays({ name: 'default' }).forEach((d) => days.add(d));
    } else {
      brs.forEach((bn) => {
        const branch = (branches || []).find((b) => b.name === bn) || { name: bn };
        resolveBranchWorkingDays(branch).forEach((d) => days.add(d));
      });
    }
    return days;
  };

  // Build the report from New Operations classes only. Instructors with no
  // classes are added as idle rows so the whole registry is represented.
  const report = useMemo(() => {
    const scoped = branchFilter === 'all'
      ? classes
      : classes.filter((c) => c.branchName === branchFilter);
    const base = buildWorkloadReport(scoped, {});
    const existing = new Set(base.map((r) => r.teacher));
    const extras = [];
    instructors.forEach((i) => {
      if (!i.name) return;
      if (branchFilter !== 'all' && !(i.branches || []).includes(branchFilter)) return;
      if (!existing.has(i.name)) { extras.push(buildIdleWorkloadRow(i.name)); existing.add(i.name); }
    });
    return base.concat(extras);
  }, [classes, instructors, branchFilter]);

  const summary = useMemo(() => summarizeWorkload(report, thresholds), [report, thresholds]);
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
    { label: 'Instructors', value: report.length, icon: Users, color: '#4f46e5' },
    { label: 'Total hours / week', value: formatHoursMinutes(summary.totalHours || 0), icon: Clock, color: '#0891b2' },
    { label: 'Overloaded', value: summary.overloadedCount || 0, icon: AlertOctagon, color: '#dc2626' },
  ];

  return (
    <section className="dashboard-view active">
      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <BarChart3 size={20} /> Workload
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Hours per instructor from the New Operations schedule.
            </p>
          </div>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'white', fontSize: '0.85rem', cursor: 'pointer' }}
          >
            <option value="all">All Branches</option>
            {branchList.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
                {kpis.map((k) => (
                  <div key={k.label} style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <k.icon size={22} style={{ color: k.color }} />
                    <div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{k.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Heatmap */}
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.15rem' }}>Daily Workload Heatmap</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Hours per day, per instructor. Red cells exceed {thresholds.dailyRed}h.</span>
                {sorted.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '1rem' }}>No instructors or classes yet.</p>
                ) : (
                  <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                    <div style={{ minWidth: `${160 + DAY_NAMES.length * 64}px` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: `160px repeat(${DAY_NAMES.length}, 1fr)`, gap: '4px', marginBottom: '4px' }}>
                        <div />
                        {DAY_NAMES.map((d) => (
                          <div key={d} style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', textTransform: 'uppercase' }}>{d.slice(0, 3)}</div>
                        ))}
                      </div>
                      {sorted.slice(0, 30).map((r) => {
                        const wd = workingDaysFor(r.teacher);
                        return (
                          <div key={r.teacher} style={{ display: 'grid', gridTemplateColumns: `160px repeat(${DAY_NAMES.length}, 1fr)`, gap: '4px', marginBottom: '4px', alignItems: 'center' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '0.5rem' }} title={r.teacher}>{r.teacher}</div>
                            {DAY_NAMES.map((d) => {
                              const dd = r.byDay[d];
                              const hrs = dd.hours;
                              const hasData = hrs > 0;
                              const isWorking = wd.has(d);
                              return (
                                <button
                                  key={d}
                                  type="button"
                                  disabled={!hasData}
                                  onClick={hasData ? () => setDetail({ teacher: r.teacher, day: d, dayData: dd }) : undefined}
                                  title={hasData ? `${r.teacher} · ${d}: ${formatHoursMinutes(hrs)} (${dd.sessions} sessions) — click for details` : `${r.teacher} · ${d}: ${isWorking ? 'Free' : 'Holiday'}`}
                                  style={{
                                    height: 28, borderRadius: 4, border: 'none', padding: 0,
                                    background: hasData ? cellColor(hrs) : (isWorking ? 'var(--bg-color)' : 'repeating-linear-gradient(45deg, var(--bg-color), var(--bg-color) 4px, var(--border-color) 4px, var(--border-color) 8px)'),
                                    color: hrs > thresholds.dailyAmber ? 'white' : (hrs > 0 ? 'white' : (isWorking ? 'var(--text-muted)' : '#9ca3af')),
                                    fontSize: hasData ? '0.7rem' : '0.6rem', fontWeight: 600,
                                    cursor: hasData ? 'pointer' : 'default',
                                    opacity: isWorking || hasData ? 1 : 0.65,
                                  }}
                                >
                                  {hrs > 0 ? formatHoursMinutes(hrs) : (isWorking ? 'FREE' : 'HOLIDAY')}
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
                      <th style={{ textAlign: 'right' }}>Hours / week</th>
                      <th style={{ textAlign: 'center' }}>Sessions</th>
                      <th style={{ textAlign: 'center' }}>Students</th>
                      <th style={{ textAlign: 'center' }}>Active days</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => {
                      const cls = classifyWeekly(r.weekly.hours, thresholds);
                      const st = STATUS[cls] || STATUS.idle;
                      return (
                        <tr key={r.teacher}>
                          <td style={{ fontWeight: 600 }}>{r.teacher}</td>
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
            <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{detail.teacher} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {detail.day}</span></h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  <strong>{formatHoursMinutes(detail.dayData.hours)}</strong> teaching · {detail.dayData.sessions} session{detail.dayData.sessions === 1 ? '' : 's'} · {detail.dayData.students} student{detail.dayData.students === 1 ? '' : 's'}
                  {detail.dayData.busiestStartMin !== null && (
                    <> · {formatMinutesToClock(detail.dayData.busiestStartMin)} – {formatMinutesToClock(detail.dayData.busiestEndMin)}</>
                  )}
                </div>
              </div>
              <button onClick={() => setDetail(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={18} /></button>
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
                      {s.studentDetails.map((sd, idx) => (
                        <span key={`${sd.student}-${idx}`} style={{ fontSize: '0.74rem', padding: '0.18rem 0.55rem', borderRadius: '6px', background: 'var(--bg-color)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                          {sd.student || '—'}
                        </span>
                      ))}
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
