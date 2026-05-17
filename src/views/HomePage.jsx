'use client';

import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';
import { instructorBelongsToBranch } from '../utils/instructorUtils';
import KpiCard from '../components/ui/KpiCard';
import { Users, CheckCircle, CalendarX, BookOpen, GraduationCap } from 'lucide-react';

export default function HomePage({ onNavigate }) {
  const {
    uniqueBaseTeachers, uniqueTimes, overallClasses,
    leaveList, instructorProfiles,
    disabledInstructors, trialPriorityList, enabledBranches, lastSyncTime
  } = useSchedule();

  const [selectedDay, setSelectedDay] = useState(() => {
    const today = DAY_NAMES[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
    return today || '';
  });
  const [selectedTime, setSelectedTime] = useState('');
  const [overviewBranch, setOverviewBranch] = useState('all');

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
    const onLeaveCount = leaveList.filter(l => {
      if (disabledInstructors?.has(l.name)) return false;
      if (!targetBranch) return true;
      return instructorBelongsToBranch(l.name, targetBranch, instructorProfiles, classesForBranch);
    }).length;

    return {
      total: allInstructors.length,
      kinder: kinderInstructors.length,
      coder: coderInstructors.length,
      onLeave: onLeaveCount,
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
      if (l.day === selectedDay) onLeave.add(l.name);
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
              value={branchStats.total}
              variant="blue"
            />
            <KpiCard
              icon={<BookOpen size={24} />}
              title="Kinder Instructors"
              value={branchStats.kinder}
              variant="orange"
            />
            <KpiCard
              icon={<GraduationCap size={24} />}
              title="Coder Instructors"
              value={branchStats.coder}
              variant="green"
            />
            <KpiCard
              icon={<CalendarX size={24} />}
              title="On Leave"
              value={branchStats.onLeave}
              variant="red"
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

      {/* Bottom Grid: Weekly Trend + Quick Actions + Activity Feed */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* Weekly Schedule Trend */}
        <div className="panel">
          <div className="panel-header">
            <h2>Weekly Schedule Trend</h2>
            <a href="#" onClick={(e) => { e.preventDefault(); }} style={{ fontSize: '0.8rem', color: 'var(--primary-blue)', textDecoration: 'none' }}>View Full Master</a>
          </div>
          <div className="panel-body">
            {overallClasses.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                Sync schedule to see weekly trend
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', height: '120px', padding: '0.5rem 0' }}>
                {DAY_NAMES.map(day => {
                  const dayClasses = overallClasses.filter(c => c.day === day);
                  const maxClasses = Math.max(...DAY_NAMES.map(d => overallClasses.filter(c => c.day === d).length), 1);
                  const height = Math.max((dayClasses.length / maxClasses) * 100, 4);
                  return (
                    <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
                      <div style={{ width: '100%', maxWidth: '32px', height: `${height}%`, background: day === selectedDay ? 'var(--primary-blue)' : 'var(--primary-blue-light)', borderRadius: '4px 4px 0 0', transition: 'height 0.3s' }} />
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{day.slice(0, 3)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
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

        {/* Activity Feed */}
        <div className="panel">
          <div className="panel-header">
            <h2>Activity Feed</h2>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '200px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.8rem' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)', marginTop: '0.4rem', flexShrink: 0 }} />
              <div>
                <span style={{ fontWeight: 500 }}>Admin</span>
                <span style={{ color: 'var(--text-muted)' }}> logged in</span>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Just now</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.8rem' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--primary-blue)', marginTop: '0.4rem', flexShrink: 0 }} />
              <div>
                <span style={{ fontWeight: 500 }}>Admin</span>
                <span style={{ color: 'var(--text-muted)' }}> synced all branches</span>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{lastSyncTime ? `${getRelativeTime()}` : '—'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.8rem' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--warning)', marginTop: '0.4rem', flexShrink: 0 }} />
              <div>
                <span style={{ fontWeight: 500 }}>System</span>
                <span style={{ color: 'var(--text-muted)' }}> loaded schedule from cache</span>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>On page load</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
