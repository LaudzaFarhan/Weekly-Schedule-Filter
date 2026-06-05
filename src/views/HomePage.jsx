'use client';

import { useState, useMemo, useEffect } from 'react';
import { subscribeToActivities } from '../services/activityService';
import { useSchedule } from '../contexts/ScheduleContext';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';
import { instructorBelongsToBranch } from '../utils/instructorUtils';
import { leaveAppliesToDay } from '../utils/dateUtils';
import { computeWeeklyByDay, formatHoursMinutes } from '../utils/workloadUtils';
import KpiCard from '../components/ui/KpiCard';
import { Users, CheckCircle, CalendarX, BookOpen, GraduationCap, TrendingUp, ChevronRight, MapPin } from 'lucide-react';

export default function HomePage({ onNavigate }) {
  const {
    uniqueBaseTeachers, uniqueTimes, overallClasses,
    leaveList, instructorProfiles,
    disabledInstructors, trialPriorityList, enabledBranches, lastSyncTime
  } = useSchedule();

  const [activities, setActivities] = useState([]);
  
  useEffect(() => {
    const unsubscribe = subscribeToActivities(15, (logs) => {
      setActivities(logs);
    });
    return () => unsubscribe();
  }, []);

  const [selectedDay, setSelectedDay] = useState(() => {
    // JS getDay(): 0=Sun, 1=Mon … 6=Sat. We only support Mon–Sat,
    // so default to today when in range, otherwise the first listed day.
    const dow = new Date().getDay();
    if (dow >= 1 && dow <= 6) return DAY_NAMES[dow - 1] || '';
    return DAY_NAMES[0] || '';
  });
  const [selectedTime, setSelectedTime] = useState('');
  const [overviewBranch, setOverviewBranch] = useState('all');
  const [trendMetric, setTrendMetric] = useState('hours'); // 'hours' | 'sessions'
  const [trendBranch, setTrendBranch] = useState('all');
  const [listModal, setListModal] = useState(null);
  const [isLogSidebarOpen, setIsLogSidebarOpen] = useState(false);
  const [fullLogs, setFullLogs] = useState([]);

  useEffect(() => {
    if (isLogSidebarOpen) {
      const unsubscribe = subscribeToActivities(100, (logs) => {
        setFullLogs(logs);
      });
      return () => unsubscribe();
    }
  }, [isLogSidebarOpen]);

  const getRelativeTime = () => {
    if (!lastSyncTime) return null;
    const mins = Math.round((Date.now() - lastSyncTime.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return lastSyncTime.toLocaleDateString();
  };

  const branchOptions = ['all', ...(enabledBranches || []).map(b => b.name)];

  const handlePrev = () => {
    const idx = branchOptions.indexOf(overviewBranch);
    const prevIdx = idx <= 0 ? branchOptions.length - 1 : idx - 1;
    setOverviewBranch(branchOptions[prevIdx]);
  };

  const handleNext = () => {
    const idx = branchOptions.indexOf(overviewBranch);
    const nextIdx = idx >= branchOptions.length - 1 ? 0 : idx + 1;
    setOverviewBranch(branchOptions[nextIdx]);
  };

  // Branch-specific stats
  const branchStats = useMemo(() => {
    const targetBranch = overviewBranch === 'all' ? null : overviewBranch;
    const classesForBranch = targetBranch
      ? overallClasses.filter(c => c.branchName === targetBranch)
      : overallClasses;

    // All instructors for this branch (enabled only)
    const allInstructors = [...uniqueBaseTeachers].filter(t => {
      if (disabledInstructors?.has(t)) return false;
      if (!targetBranch) return true;
      return instructorBelongsToBranch(t, targetBranch, instructorProfiles, classesForBranch);
    });

    // Kinder instructors (kinder-junior type in trial priority)
    const kinderInstructors = (trialPriorityList || []).filter(p => {
      if (disabledInstructors?.has(p.name)) return false;
      if (targetBranch && p.location !== 'All Branches' && p.location !== targetBranch) return false;
      return p.type === 'kinder-junior';
    });

    // Coder instructors (junior-coder type in trial priority)
    const coderInstructors = (trialPriorityList || []).filter(p => {
      if (disabledInstructors?.has(p.name)) return false;
      if (targetBranch && p.location !== 'All Branches' && p.location !== targetBranch) return false;
      return p.type === 'junior-coder';
    });

    // Instructors on leave today or any day
    const onLeaveInstructors = leaveList.filter(l => {
      if (disabledInstructors?.has(l.name)) return false;
      if (!targetBranch) return true;
      return instructorBelongsToBranch(l.name, targetBranch, instructorProfiles, classesForBranch);
    });

    return {
      total: { count: allInstructors.length, list: allInstructors },
      kinder: { count: kinderInstructors.length, list: kinderInstructors.map(k => k.name) },
      coder: { count: coderInstructors.length, list: coderInstructors.map(c => c.name) },
      onLeave: { count: onLeaveInstructors.length, list: onLeaveInstructors.map(l => l.name) },
    };
  }, [overviewBranch, overallClasses, uniqueBaseTeachers, disabledInstructors, instructorProfiles, trialPriorityList, leaveList, enabledBranches]);

  // Availability stats (day/time based)
  const filteredTeachers = useMemo(() => {
    const targetBranch = overviewBranch === 'all' ? null : overviewBranch;
    const classesForBranch = targetBranch
      ? overallClasses.filter(c => c.branchName === targetBranch)
      : overallClasses;

    return [...uniqueBaseTeachers].filter(t => {
      if (disabledInstructors?.has(t)) return false;
      if (!targetBranch) return true;
      return instructorBelongsToBranch(t, targetBranch, instructorProfiles, classesForBranch);
    });
  }, [uniqueBaseTeachers, overallClasses, disabledInstructors, instructorProfiles, overviewBranch]);

  const availableDays = DAY_NAMES.filter(
    (day) => uniqueTimes[day] && uniqueTimes[day].size > 0
  );

  const sortedTimes = useMemo(() => {
    if (!selectedDay || !uniqueTimes[selectedDay]) return [];
    return Array.from(uniqueTimes[selectedDay]).sort((a, b) => {
      const pA = parseTimeSlot(a);
      const pB = parseTimeSlot(b);
      if (!pA) return 1;
      if (!pB) return -1;
      return pA.start - pB.start;
    });
  }, [selectedDay, uniqueTimes]);

  const { availableCount, busyCount } = useMemo(() => {
    if (!selectedDay || !selectedTime) return { availableCount: '-', busyCount: '-' };

    const classesToCheck = overviewBranch === 'all' ? overallClasses : overallClasses.filter(c => c.branchName === overviewBranch);

    const onLeave = new Set();
    leaveList.forEach((l) => {
      if (leaveAppliesToDay(l, selectedDay)) onLeave.add(l.name);
    });

    let available = 0;
    let busy = 0;
    filteredTeachers.forEach((teacher) => {
      if (onLeave.has(teacher)) return;
      const isBusy = classesToCheck.some(
        (c) => c.teacher === teacher && c.day === selectedDay && doTimeSlotsOverlap(c.time, selectedTime)
      );
      if (isBusy) busy++;
      else available++;
    });
    return { availableCount: available, busyCount: busy };
  }, [selectedDay, selectedTime, filteredTeachers, overallClasses, leaveList, overviewBranch]);

  // Weekly trend metrics — aggregated per day, scoped to the trend panel's
  // branch filter (independent from the dashboard carousel above).
  const weeklyTrend = useMemo(() => {
    const scoped = trendBranch === 'all'
      ? overallClasses
      : overallClasses.filter(c => c.branchName === trendBranch);
    return computeWeeklyByDay(scoped, { disabledInstructors });
  }, [overallClasses, trendBranch, disabledInstructors]);

  const todayName = useMemo(() => {
    const dow = new Date().getDay();
    return dow >= 1 && dow <= 6 ? DAY_NAMES[dow - 1] : null;
  }, []);

  const trendStats = useMemo(() => {
    const totalHours = weeklyTrend.reduce((s, d) => s + d.hours, 0);
    const totalSessions = weeklyTrend.reduce((s, d) => s + d.sessions, 0);
    const activeDays = weeklyTrend.filter(d => d.sessions > 0).length;
    const avgHours = activeDays > 0 ? totalHours / activeDays : 0;
    const avgSessions = activeDays > 0 ? totalSessions / activeDays : 0;
    const peakByHours = weeklyTrend.reduce((best, d) => (d.hours > best.hours ? d : best), weeklyTrend[0]);
    const peakBySessions = weeklyTrend.reduce((best, d) => (d.sessions > best.sessions ? d : best), weeklyTrend[0]);
    const maxHours = Math.max(...weeklyTrend.map(d => d.hours), 1);
    const maxSessions = Math.max(...weeklyTrend.map(d => d.sessions), 1);

    // Activity Index: how concentrated is the load in the busiest day, vs an
    // even spread? 100% = the busiest day equals the daily average. >100%
    // means the peak day exceeds the average — the higher, the more
    // imbalanced the week.
    const activityIndex = avgHours > 0
      ? Math.round((peakByHours.hours / avgHours) * 100)
      : 0;

    return {
      totalHours, totalSessions, activeDays,
      avgHours, avgSessions,
      peakByHours, peakBySessions,
      maxHours, maxSessions,
      activityIndex,
    };
  }, [weeklyTrend]);

  return (
    <section className="dashboard-view active">
      <div className="panel home-overview-panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Dashboard Overview</h2>
            <span className="subtext">Branch instructor distribution and availability</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {/* Branch switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg-color)', borderRadius: '20px', padding: '0.3rem 0.5rem' }}>
              <button
                onClick={handlePrev}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0.1rem 0.3rem', color: 'var(--primary-blue)', fontWeight: 600 }}
              >
                ‹
              </button>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, minWidth: '100px', textAlign: 'center', color: 'var(--text-main)' }}>
                {overviewBranch === 'all' ? 'ALL BRANCHES' : overviewBranch.toUpperCase()}
              </span>
              <button
                onClick={handleNext}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0.1rem 0.3rem', color: 'var(--primary-blue)', fontWeight: 600 }}
              >
                ›
              </button>
            </div>
            {/* Day pill */}
            <button
              onClick={() => {
                const currentIdx = availableDays.indexOf(selectedDay);
                const nextIdx = currentIdx >= availableDays.length - 1 ? 0 : currentIdx + 1;
                setSelectedDay(availableDays[nextIdx] || '');
                setSelectedTime('');
              }}
              style={{ background: 'var(--bg-color)', borderRadius: '20px', padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-main)', border: 'none', cursor: 'pointer' }}
            >
              {selectedDay || 'Monday'}
            </button>
            {/* Time selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'var(--bg-color)', borderRadius: '20px', padding: '0.3rem 0.8rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>🕐</span>
              <select
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                disabled={sortedTimes.length === 0}
                style={{ background: 'none', border: 'none', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-main)', cursor: 'pointer', outline: 'none' }}
              >
                <option value="">Select Time...</option>
                {sortedTimes.map((time) => <option key={time} value={time}>{time}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="panel-body">
          <div className="kpi-grid">
            <KpiCard
              icon={<Users size={24} />}
              title="All Instructors"
              value={branchStats.total.count}
              variant="blue"
              onClick={() => setListModal({ title: 'All Instructors', list: branchStats.total.list })}
            />
            <KpiCard
              icon={<BookOpen size={24} />}
              title="Kinder Instructors"
              value={branchStats.kinder.count}
              variant="orange"
              onClick={() => setListModal({ title: 'Kinder Instructors', list: branchStats.kinder.list })}
            />
            <KpiCard
              icon={<GraduationCap size={24} />}
              title="Coder Instructors"
              value={branchStats.coder.count}
              variant="green"
              onClick={() => setListModal({ title: 'Coder Instructors', list: branchStats.coder.list })}
            />
            <KpiCard
              icon={<CalendarX size={24} />}
              title="On Leave"
              value={branchStats.onLeave.count}
              variant="red"
              onClick={() => setListModal({ title: 'On Leave', list: branchStats.onLeave.list })}
            />
          </div>

          {/* Availability stats when day/time selected */}
          {selectedDay && selectedTime && (
            <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)' }}>
              <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                Availability for {selectedDay} at {selectedTime}
              </h3>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <KpiCard
                  icon={<CheckCircle size={24} />}
                  title="Available"
                  value={availableCount}
                  variant="green"
                />
                <KpiCard
                  icon={<CalendarX size={24} />}
                  title="Busy"
                  value={busyCount}
                  variant="red"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Grid: Weekly Trend (60%) + Quick Actions/Activity stack (20%) + Instructors in Training (20%) */}
      <div className="bottom-grid">
        {/* Weekly Schedule Trend */}
        <div className="panel trend-panel">
          <WeeklyTrendHeader
            stats={trendStats}
            metric={trendMetric}
            onMetricChange={setTrendMetric}
            branch={trendBranch}
            onBranchChange={setTrendBranch}
            enabledBranches={enabledBranches || []}
            onViewFull={() => onNavigate && onNavigate('schedule')}
          />
          {overallClasses.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Sync schedule to see weekly trend
            </div>
          ) : (
            <>
              <WeeklyTrendKPIs stats={trendStats} metric={trendMetric} />
              <WeeklyTrendChart
                data={weeklyTrend}
                max={trendMetric === 'hours' ? trendStats.maxHours : trendStats.maxSessions}
                avgValue={trendMetric === 'hours' ? trendStats.avgHours : trendStats.avgSessions}
                metric={trendMetric}
                todayName={todayName}
                selectedDay={selectedDay}
              />
            </>
          )}
        </div>

        {/* Quick Actions + Activity Feed stacked in one column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minHeight: 0 }}>
          {/* Quick Actions (top) */}
          <div className="panel">
            <div className="panel-header">
              <h2>Quick Actions</h2>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                onClick={() => onNavigate && onNavigate('availability')}
                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'white', cursor: 'pointer', width: '100%', textAlign: 'left', transition: 'transform 0.15s, box-shadow 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(4px)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(79, 70, 229, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckCircle size={16} style={{ color: 'var(--primary-blue)' }} />
                </div>
                <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 500 }}>Check Instructor Slot</span>
                <span style={{ color: 'var(--text-muted)' }}>›</span>
              </button>
              <button
                onClick={() => onNavigate && onNavigate('leave')}
                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'white', cursor: 'pointer', width: '100%', textAlign: 'left', transition: 'transform 0.15s, box-shadow 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(4px)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(249, 115, 22, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CalendarX size={16} style={{ color: 'var(--primary-orange)' }} />
                </div>
                <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 500 }}>Request Leave Approval</span>
                <span style={{ color: 'var(--text-muted)' }}>›</span>
              </button>
            </div>
          </div>

          {/* Activity Feed (bottom) */}
          <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Activity Feed</h2>
              <button 
                onClick={() => setIsLogSidebarOpen(true)}
                style={{ fontSize: '0.8rem', background: 'none', border: 'none', color: 'var(--primary-blue)', cursor: 'pointer', fontWeight: 500 }}
              >
                View All
              </button>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {activities.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  No recent activity
                </div>
              ) : (
                activities.map(act => {
                  let color = 'var(--text-muted)';
                  if (act.action.includes('login') || act.action.includes('logged in')) color = 'var(--success)';
                  else if (act.action.includes('sync')) color = 'var(--primary-blue)';
                  else if (act.action.includes('logout') || act.action.includes('logged out') || act.action.includes('close')) color = 'var(--warning)';

                  const timeStr = act.timestamp ? new Date(act.timestamp.toMillis ? act.timestamp.toMillis() : act.timestamp).toLocaleString(undefined, {
                    hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric'
                  }) : 'Just now';

                  return (
                    <div key={act.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.8rem' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, marginTop: '0.4rem', flexShrink: 0 }} />
                      <div>
                        <span style={{ fontWeight: 500 }}>{act.user}</span>
                        <span style={{ color: 'var(--text-muted)' }}> {act.action}</span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{timeStr}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Instructors in Training (right column placeholder) */}
        <InstructorsInTrainingPanel
          profiles={instructorProfiles}
          disabledInstructors={disabledInstructors}
          onNavigate={onNavigate}
        />
      </div>

      {/* KPI Instructor List Modal */}
      {listModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }} onClick={() => setListModal(null)}>
          <div style={{ backgroundColor: '#fff', borderRadius: '12px', width: '400px', maxWidth: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} onClick={e => e.stopPropagation()}>
            {(() => {
              const stats = { fulltime: 0, parttime: 0, freelance: 0, unknown: 0 };
              const decoratedList = listModal.list.map(name => {
                const entry = trialPriorityList?.find(p => p.name === name);
                const status = entry?.status || 'unknown';
                stats[status] = (stats[status] || 0) + 1;
                return { name, status };
              }).sort((a, b) => a.name.localeCompare(b.name));

              return (
                <>
                  <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h2 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--text-main)', marginBottom: '0.25rem' }}>{listModal.title}</h2>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {stats.fulltime > 0 && <span>Full Time: <strong>{stats.fulltime}</strong></span>}
                        {stats.parttime > 0 && <span>Part Time: <strong>{stats.parttime}</strong></span>}
                        {stats.freelance > 0 && <span>Freelance: <strong>{stats.freelance}</strong></span>}
                        {stats.unknown > 0 && <span>Unassigned: <strong>{stats.unknown}</strong></span>}
                      </div>
                    </div>
                    <button onClick={() => setListModal(null)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)', marginTop: '-4px' }}>&times;</button>
                  </div>
                  <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
                    {decoratedList.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No instructors found.</div>
                    ) : (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {decoratedList.map((item, i) => {
                          const isClickable = listModal.title === 'On Leave';
                          return (
                            <li 
                              key={i} 
                              style={{ 
                                padding: '0.75rem', 
                                backgroundColor: 'var(--bg-color)', 
                                borderRadius: '8px', 
                                fontSize: '0.9rem', 
                                color: 'var(--text-main)', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between', 
                                cursor: isClickable ? 'pointer' : 'default', 
                                transition: 'background-color 0.2s' 
                              }}
                              onMouseEnter={(e) => {
                                if (isClickable) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                              }}
                              onMouseLeave={(e) => {
                                if (isClickable) e.currentTarget.style.backgroundColor = 'var(--bg-color)';
                              }}
                              onClick={() => {
                                if (!isClickable) return;
                                setListModal(null);
                                if (onNavigate) onNavigate('leave', { instructor: item.name });
                              }}
                              title={isClickable ? "Click to manage leave for this instructor" : ""}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--primary-blue)' }} />
                                {item.name}
                              </div>
                              {item.status !== 'unknown' && (
                                <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '12px', backgroundColor: item.status === 'fulltime' ? '#dcfce7' : item.status === 'parttime' ? '#fef3c7' : '#e0e7ff', color: item.status === 'fulltime' ? '#166534' : item.status === 'parttime' ? '#92400e' : '#3730a3', fontWeight: 500 }}>
                                  {item.status === 'fulltime' ? 'Full Time' : item.status === 'parttime' ? 'Part Time' : 'Freelance'}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Activity Log Sidebar */}
      {isLogSidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 9999, display: 'flex', justifyContent: 'flex-end', backdropFilter: 'blur(2px)' }} onClick={() => setIsLogSidebarOpen(false)}>
          <div style={{ backgroundColor: '#fff', width: '400px', maxWidth: '90%', height: '100%', display: 'flex', flexDirection: 'column', boxShadow: '-5px 0 25px rgba(0,0,0,0.1)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--text-main)' }}>All Activity Logs</h2>
              <button onClick={() => setIsLogSidebarOpen(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
            </div>
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {fullLogs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Loading logs...</div>
              ) : (
                fullLogs.map(act => {
                  let color = 'var(--text-muted)';
                  if (act.action.includes('login') || act.action.includes('logged in')) color = 'var(--success)';
                  else if (act.action.includes('sync')) color = 'var(--primary-blue)';
                  else if (act.action.includes('logout') || act.action.includes('logged out') || act.action.includes('close')) color = 'var(--warning)';

                  const timeStr = act.timestamp ? new Date(act.timestamp.toMillis ? act.timestamp.toMillis() : act.timestamp).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                  }) : 'Just now';

                  return (
                    <div key={act.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.8rem', fontSize: '0.85rem' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, marginTop: '0.4rem', flexShrink: 0 }} />
                      <div>
                        <span style={{ fontWeight: 600 }}>{act.user}</span>
                        <span style={{ color: 'var(--text-muted)' }}> {act.action}</span>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{timeStr}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Weekly Trend — header with title, metric toggle, peak chip, and the
 * "View Full Master" button. Standalone so the chart body can render
 * cleanly underneath.
 */
function WeeklyTrendHeader({ stats, metric, onMetricChange, branch, onBranchChange, enabledBranches, onViewFull }) {
  const peakDay = metric === 'hours' ? stats.peakByHours : stats.peakBySessions;
  const peakLabel = peakDay && peakDay.hours > 0
    ? metric === 'hours'
      ? `Peak: ${peakDay.day} · ${formatHoursMinutes(peakDay.hours)}`
      : `Peak: ${peakDay.day} · ${peakDay.sessions} sessions`
    : null;

  return (
    <div className="trend-header">
      <div className="trend-header-left">
        <div className="trend-title-row">
          <h2>Weekly Schedule Trend</h2>
          <div className="trend-toggle" role="tablist">
            <button
              type="button"
              data-active={metric === 'hours'}
              onClick={() => onMetricChange('hours')}
            >
              Hours
            </button>
            <button
              type="button"
              data-active={metric === 'sessions'}
              onClick={() => onMetricChange('sessions')}
            >
              Sessions
            </button>
          </div>
          <div className="trend-branch-select" title="Filter chart by branch">
            <MapPin size={13} />
            <select
              value={branch}
              onChange={(e) => onBranchChange(e.target.value)}
            >
              <option value="all">All Branches</option>
              {(enabledBranches || []).map((b) => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="trend-meta">
          {peakLabel && (
            <span className="trend-peak-chip">
              <TrendingUp size={13} />
              {peakLabel}
            </span>
          )}
          <span className="trend-meta-text">
            {stats.activeDays} working day{stats.activeDays === 1 ? '' : 's'} tracked
          </span>
        </div>
      </div>
      <button type="button" className="trend-view-full" onClick={onViewFull}>
        View Full Master <ChevronRight size={16} />
      </button>
    </div>
  );
}

/** KPI strip with weekly total, daily average, and activity index. */
function WeeklyTrendKPIs({ stats, metric }) {
  const totalLabel = metric === 'hours'
    ? formatHoursMinutes(stats.totalHours)
    : `${stats.totalSessions}`;
  const avgLabel = metric === 'hours'
    ? formatHoursMinutes(stats.avgHours)
    : stats.avgSessions.toFixed(1);

  // Color-code activity index: green when balanced (≤120%), amber 120–160,
  // red above 160 — that means one day is dramatically heavier than the rest.
  const idx = stats.activityIndex;
  const indexClass = idx === 0 ? '' : idx <= 120 ? 'success' : '';
  const indexColor = idx === 0
    ? 'var(--text-muted)'
    : idx <= 120
      ? 'var(--success)'
      : idx <= 160
        ? 'var(--warning)'
        : 'var(--danger)';

  return (
    <div className="trend-kpi-row">
      <div className="trend-kpi-card">
        <span className="trend-kpi-label">Weekly Total</span>
        <span className="trend-kpi-value primary">{totalLabel}</span>
      </div>
      <div className="trend-kpi-card">
        <span className="trend-kpi-label">Average / Day</span>
        <span className="trend-kpi-value">{avgLabel}</span>
      </div>
      <div className="trend-kpi-card">
        <span className="trend-kpi-label">Activity Index</span>
        <span className="trend-kpi-value" style={{ color: indexColor }} title="Peak day load divided by daily average. 100% = balanced. Higher means one day carries much more load than the rest.">
          {idx > 0 ? `${idx}%` : '—'}
        </span>
      </div>
    </div>
  );
}

/**
 * Weekly trend chart — pill bars per day with a gradient fill on the
 * busiest day, dashed average line, and metric values floating above
 * each bar.
 */
function WeeklyTrendChart({ data, max, avgValue, metric, todayName, selectedDay }) {
  const ceiling = Math.max(max, 1);
  // Identify the visual leader so it renders with the gradient fill.
  // Today/selected day takes precedence if it has data — feels more
  // "current" than highlighting historical Saturday on a Tuesday.
  const todayEntry = data.find((d) => d.day === todayName);
  const selectedEntry = data.find((d) => d.day === selectedDay);
  const peakEntry = data.reduce((best, d) => {
    const v = metric === 'hours' ? d.hours : d.sessions;
    const bv = metric === 'hours' ? best.hours : best.sessions;
    return v > bv ? d : best;
  }, data[0]);
  const activeDay = (selectedEntry && (selectedEntry.hours > 0 || selectedEntry.sessions > 0))
    ? selectedEntry.day
    : (todayEntry && (todayEntry.hours > 0 || todayEntry.sessions > 0))
      ? todayEntry.day
      : peakEntry?.day;

  const formatValue = (d) => metric === 'hours' ? formatHoursMinutes(d.hours) : `${d.sessions}`;
  const valueOf = (d) => metric === 'hours' ? d.hours : d.sessions;

  const avgPct = ceiling > 0 ? (avgValue / ceiling) * 100 : 0;

  const [hoveredDay, setHoveredDay] = useState(null);

  return (
    <div>
      <div className="trend-chart">
        {/* Average reference line */}
        {avgValue > 0 && (
          <div
            className="trend-avg-line"
            style={{ bottom: `${avgPct}%` }}
          />
        )}

        {data.map((d) => {
          const v = valueOf(d);
          const pct = ceiling > 0 ? (v / ceiling) * 100 : 0;
          const isActive = d.day === activeDay && v > 0;
          const isHovered = d.day === hoveredDay;
          return (
            <div
              key={d.day}
              className={`trend-bar-col ${isHovered ? 'is-hovered' : ''}`}
              onMouseEnter={() => setHoveredDay(d.day)}
              onMouseLeave={() => setHoveredDay((prev) => (prev === d.day ? null : prev))}
              onFocus={() => setHoveredDay(d.day)}
              onBlur={() => setHoveredDay((prev) => (prev === d.day ? null : prev))}
              tabIndex={v > 0 ? 0 : -1}
              role="button"
              aria-label={`${d.day}: ${v > 0 ? `${formatHoursMinutes(d.hours)}, ${d.sessions} sessions, ${d.students} students` : 'no classes'}`}
            >
              <div
                className={`trend-bar-value ${isActive ? 'active' : ''} ${isHovered ? 'is-hovered' : ''}`}
                style={{ bottom: `${pct}%` }}
              >
                {v > 0 ? formatValue(d) : '—'}
              </div>
              <div
                className={`trend-bar ${isActive ? 'active' : ''} ${isHovered ? 'is-hovered' : ''}`}
                style={{ height: `${Math.max(2, pct)}%` }}
              />
              {isHovered && v > 0 && (
                <div
                  className="trend-bar-tooltip"
                  style={{ bottom: `calc(${pct}% + 1.4rem)` }}
                  role="tooltip"
                >
                  <div className="trend-bar-tooltip-title">{d.day}</div>
                  <div className="trend-bar-tooltip-row">
                    <span>Hours</span>
                    <strong>{formatHoursMinutes(d.hours)}</strong>
                  </div>
                  <div className="trend-bar-tooltip-row">
                    <span>Sessions</span>
                    <strong>{d.sessions}</strong>
                  </div>
                  <div className="trend-bar-tooltip-row">
                    <span>Students</span>
                    <strong>{d.students}</strong>
                  </div>
                  {d.peakSlot && (
                    <div className="trend-bar-tooltip-row">
                      <span>Busiest slot</span>
                      <strong>{d.peakSlot}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="trend-day-labels">
        {data.map((d) => {
          const isActive = d.day === activeDay && (d.hours > 0 || d.sessions > 0);
          const isHovered = d.day === hoveredDay;
          return (
            <div key={d.day} className="trend-day-cell">
              <span className={`trend-day-name ${isActive ? 'active' : ''} ${isHovered ? 'is-hovered' : ''}`}>
                {d.day.slice(0, 3)}
              </span>
              <span className="trend-day-meta">
                {d.sessions > 0 ? `${d.sessions} session${d.sessions === 1 ? '' : 's'}` : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ─── Instructors in Training panel ───────────────────────────── */

/**
 * Mirror of the training modules defined in the Profile page so we can
 * compute "still in training" without importing the full ProfilePage.
 * If the structure ever drifts, surface it on Profile and import from
 * a shared constants file.
 */
const TRAINING_MODULES = [
  { id: 'kinderFoundation', label: 'Kinder Foundation', max: 2 },
  { id: 'kinderCore', label: 'Kinder Core', max: 4 },
  { id: 'juniorFoundation', label: 'Junior Foundation', max: 2 },
  { id: 'juniorCore', label: 'Junior Core', max: 4 },
  { id: 'coderBasic', label: 'Coder Basic', max: 2 },
  { id: 'coderIntermediate', label: 'Coder Intermediate', max: 2 },
  { id: 'coderAdvance', label: 'Coder Advance', max: 2 },
];

const TRAINING_MAX_TOTAL = TRAINING_MODULES.reduce((s, m) => s + m.max, 0);

function trainingSummary(profile) {
  const tp = profile.trainingProgress || {};
  let earned = 0;
  const missing = [];
  for (const m of TRAINING_MODULES) {
    const v = Math.max(0, Math.min(m.max, tp[m.id] || 0));
    earned += v;
    if (v < m.max) missing.push({ ...m, current: v });
  }
  return {
    earned,
    total: TRAINING_MAX_TOTAL,
    pct: TRAINING_MAX_TOTAL > 0 ? earned / TRAINING_MAX_TOTAL : 0,
    missing,
    isInTraining: missing.length > 0,
  };
}

function InstructorsInTrainingPanel({ profiles, disabledInstructors, onNavigate }) {
  const inTraining = useMemo(() => {
    if (!profiles || profiles.length === 0) return [];
    return profiles
      .filter((p) => {
        const name = p.fullname || p.nickname || p.id?.split('@')[0];
        if (!name) return false;
        if (disabledInstructors?.has(name)) return false;
        return true;
      })
      .map((p) => ({
        profile: p,
        name: p.fullname || p.nickname || p.id.split('@')[0],
        location: p.location || null,
        summary: trainingSummary(p),
      }))
      .filter((row) => row.summary.isInTraining)
      // Lowest progress first — they need the most attention
      .sort((a, b) => a.summary.pct - b.summary.pct);
  }, [profiles, disabledInstructors]);

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="panel-header-left">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <GraduationCap size={16} /> In Training
          </h2>
        </div>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '200px', gap: '0.75rem' }}>
        <GraduationCap size={36} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
        <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Coming Soon</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', maxWidth: '180px' }}>Training progress tracking will be available here.</span>
      </div>
    </div>
  );
}
