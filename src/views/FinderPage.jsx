'use client';

import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES, CARDS_PER_PAGE } from '../utils/constants';
import { leaveAppliesToDay } from '../utils/dateUtils';
import { instructorBelongsToBranch } from '../utils/instructorUtils';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';

export default function FinderPage() {
  const { uniqueBaseTeachers, uniqueTimes, overallClasses, leaveList, disabledInstructors, instructorProfiles, activeBranchName, allClasses, enabledBranches } = useSchedule();
  const [selectedInstructor, setSelectedInstructor] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [activeDay, setActiveDay] = useState(null);
  const [cardPage, setCardPage] = useState(0);

  const branchTeachers = useMemo(() => {
    const teachers = new Set();
    const classesToCheck = filterBranch === 'all' ? overallClasses : overallClasses.filter(c => c.branchName === filterBranch);
    classesToCheck.forEach(c => {
      if (c.teacher && c.teacher !== '-') teachers.add(c.teacher);
    });
    return teachers;
  }, [overallClasses, filterBranch]);

  const activeBranchForFilter = filterBranch === 'all' ? activeBranchName : filterBranch;

  const sortedTeachers = [...uniqueBaseTeachers].filter((t) => {
    if (disabledInstructors.has(t)) return false;
    if (filterBranch === 'all') return true;
    return instructorBelongsToBranch(t, filterBranch, instructorProfiles, overallClasses.filter(c => c.branchName === filterBranch));
  }).sort();

  // Use branch-filtered teachers for availability checks
  const teachersForAvailability = useMemo(() => {
    return [...uniqueBaseTeachers].filter((t) => {
      if (disabledInstructors.has(t)) return false;
      if (filterBranch === 'all') return true;
      return instructorBelongsToBranch(t, filterBranch, instructorProfiles, overallClasses.filter(c => c.branchName === filterBranch));
    });
  }, [uniqueBaseTeachers, disabledInstructors, instructorProfiles, filterBranch, overallClasses]);
  const availableDays = DAY_NAMES.filter(
    (day) => uniqueTimes[day] && uniqueTimes[day].size > 0
  );

  // Auto-select first day if none
  const currentDay = activeDay || availableDays[0] || null;

  const cards = useMemo(() => {
    if (!currentDay || !uniqueTimes[currentDay]) return [];

    const sortedSlots = Array.from(uniqueTimes[currentDay]).sort((a, b) => {
      const pA = parseTimeSlot(a); const pB = parseTimeSlot(b);
      if (!pA) return 1; if (!pB) return -1;
      return pA.start - pB.start;
    });

    return sortedSlots.map((timeSlot) => {
      const freeTeachers = [];
      const busyTeachers = [];

      const teachersToCheck = selectedInstructor === 'all'
        ? teachersForAvailability
        : [selectedInstructor];

      teachersToCheck.forEach((teacher) => {
        // Check leave (supporting both legacy 'day' and new start/endDate)
        const onLeave = leaveList.some((l) => l.name === teacher && leaveAppliesToDay(l, currentDay));
        if (onLeave) return;

        const isBusy = overallClasses.some(
          (c) => c.teacher === teacher && c.day === currentDay && doTimeSlotsOverlap(c.time, timeSlot)
        );

        if (isBusy) {
          const cls = overallClasses.find(
            (c) => c.teacher === teacher && c.day === currentDay && doTimeSlotsOverlap(c.time, timeSlot)
          );
          const badge = cls && cls.branchName ? `[${cls.branchName}] ` : '';
          busyTeachers.push({ name: teacher, detail: cls ? `${badge}${cls.program}` : '' });
        } else {
          freeTeachers.push({ name: teacher });
        }
      });

      return { timeSlot, freeTeachers, busyTeachers };
    });
  }, [currentDay, selectedInstructor, teachersForAvailability, uniqueTimes, overallClasses, leaveList, disabledInstructors]);

  const totalCardPages = Math.ceil(cards.length / CARDS_PER_PAGE);
  const visibleCards = cards.slice(cardPage * CARDS_PER_PAGE, (cardPage + 1) * CARDS_PER_PAGE);

  const totalFree = cards.reduce((sum, c) => sum + c.freeTeachers.length, 0);

  return (
    <section className="dashboard-view active">
      <div className="panel free-finder-panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Free Instructor Finder</h2>
            <span className="subtext">Who is free to be assigned another class?</span>
          </div>
          <div className="finder-controls">
            <div className="input-group-inline">
              <label>Branch</label>
              <select value={filterBranch} onChange={(e) => { setFilterBranch(e.target.value); setCardPage(0); }}>
                <option value="all">All Branches</option>
                {enabledBranches?.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
            </div>
            <div className="input-group-inline">
              <label>Instructor</label>
              <select value={selectedInstructor} onChange={(e) => setSelectedInstructor(e.target.value)} disabled={sortedTeachers.length === 0}>
                <option value="all">All Instructors</option>
                {sortedTeachers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Day tabs */}
        <div className="finder-day-tabs">
          {availableDays.map((day) => (
            <button
              key={day}
              className={`finder-day-tab ${currentDay === day ? 'active' : ''}`}
              onClick={() => { setActiveDay(day); setCardPage(0); }}
            >
              {day}
            </button>
          ))}
        </div>

        <div className="panel-body finder-body">
          {cards.length > 0 && (
            <div className="finder-summary">
              <strong>{totalFree}</strong> free slot(s) found on <strong>{currentDay}</strong>
            </div>
          )}

          {overallClasses.length === 0 ? (
            <div className="empty-state">
              <Search size={40} />
              <p>Click <strong>"Sync All Branches"</strong> to find free instructors across all locations.</p>
            </div>
          ) : cards.length === 0 ? (
            <div className="empty-state">
              <Search size={40} />
              <p>No schedule times found for this day.</p>
            </div>
          ) : (
            <>
              <div className="finder-cards-wrapper">
                <button className="finder-nav-btn" disabled={cardPage <= 0} onClick={() => setCardPage(cardPage - 1)}>
                  <ChevronLeft size={20} />
                </button>
                <div className="finder-cards-viewport">
                  <div className="finder-cards-track">
                    {visibleCards.map((card, i) => (
                      <div key={i} className="finder-card">
                        <div className="finder-card-header">{card.timeSlot}</div>
                        <div className="finder-card-body">
                          <div className="finder-section free">
                            <h4>✓ Free ({card.freeTeachers.length})</h4>
                            <ul>
                              {card.freeTeachers.map((t, j) => <li key={j}>{t.name}</li>)}
                              {card.freeTeachers.length === 0 && <li className="empty">None free</li>}
                            </ul>
                          </div>
                          <div className="finder-section busy">
                            <h4>✗ Busy ({card.busyTeachers.length})</h4>
                            <ul>
                              {card.busyTeachers.map((t, j) => <li key={j}>{t.name} <span className="finder-detail">{t.detail}</span></li>)}
                              {card.busyTeachers.length === 0 && <li className="empty">None busy</li>}
                            </ul>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <button className="finder-nav-btn" disabled={cardPage >= totalCardPages - 1} onClick={() => setCardPage(cardPage + 1)}>
                  <ChevronRight size={20} />
                </button>
              </div>
              <div className="finder-pagination">
                {Array.from({ length: totalCardPages }).map((_, i) => (
                  <button key={i} className={`finder-dot ${i === cardPage ? 'active' : ''}`} onClick={() => setCardPage(i)} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
