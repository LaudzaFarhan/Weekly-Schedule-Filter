'use client';

import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';
import { instructorBelongsToBranch } from '../utils/instructorUtils';
import KpiCard from '../components/ui/KpiCard';
import { Users, CheckCircle, CalendarX, Star, BookOpen, GraduationCap } from 'lucide-react';

export default function HomePage() {
  const {
    uniqueBaseTeachers, uniqueTimes, overallClasses, allClasses,
    leaveList, instructorProfiles, activeBranchName,
    disabledInstructors, trialPriorityList, branches
  } = useSchedule();

  const [selectedDay, setSelectedDay] = useState(() => {
    const today = DAY_NAMES[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
    return today || '';
  });
  const [selectedTime, setSelectedTime] = useState('');
  const [overviewBranch, setOverviewBranch] = useState('all');

  const branchOptions = ['all', ...(branches || []).map(b => b.name)];

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
  }, [overviewBranch, overallClasses, uniqueBaseTeachers, disabledInstructors, instructorProfiles, trialPriorityList, leaveList, branches]);

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
            <span className="subtext">Branch instructor summary</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            {/* Branch switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary, #f1f5f9)', borderRadius: '8px', padding: '0.35rem 0.6rem' }}>
              <button
                onClick={handlePrev}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}
              >
                ‹
              </button>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '120px', textAlign: 'center' }}>
                {overviewBranch === 'all' ? 'All Branches' : overviewBranch}
              </span>
              <button
                onClick={handleNext}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}
              >
                ›
              </button>
            </div>
            {/* Day/Time selectors */}
            <div className="home-controls">
              <div className="input-group">
                <select value={selectedDay} onChange={(e) => { setSelectedDay(e.target.value); setSelectedTime(''); }} disabled={availableDays.length === 0}>
                  <option value="" disabled>Select a Day...</option>
                  {availableDays.map((day) => <option key={day} value={day}>{day}</option>)}
                </select>
              </div>
              <div className="input-group">
                <select value={selectedTime} onChange={(e) => setSelectedTime(e.target.value)} disabled={sortedTimes.length === 0}>
                  <option value="" disabled>Select a Time...</option>
                  {sortedTimes.map((time) => <option key={time} value={time}>{time}</option>)}
                </select>
              </div>
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
    </section>
  );
}
