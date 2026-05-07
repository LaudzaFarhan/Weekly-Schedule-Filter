'use client';

import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';
import Badge from '../components/ui/Badge';

const LIST_PAGE_SIZE = 8;

function PaginatedList({ items, emptyText }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(items.length / LIST_PAGE_SIZE);
  const paged = items.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE);

  return (
    <>
      <ul className="instructor-list">
        {items.length === 0 ? (
          <li className="empty-list-item">{emptyText}</li>
        ) : (
          paged.map((item, i) => (
            <li key={i} className="instructor-item">
              <span className="instructor-name">{item.name}</span>
              {item.detail && <span className="instructor-detail">{item.detail}</span>}
            </li>
          ))
        )}
      </ul>
      {totalPages > 1 && (
        <div className="mini-pagination">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
          <span>{page}/{totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>→</button>
        </div>
      )}
    </>
  );
}

export default function AvailabilityPage() {
  const { uniqueBaseTeachers, uniqueTimes, allClasses, leaveList } = useSchedule();
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedTime, setSelectedTime] = useState('');

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

  const { available, busy, onLeave } = useMemo(() => {
    if (!selectedDay || !selectedTime) {
      return { available: [], busy: [], onLeave: [] };
    }

    const onLeaveSet = new Set();
    const onLeaveItems = [];
    leaveList.forEach((l) => {
      if (l.day === selectedDay) {
        onLeaveSet.add(l.name);
        onLeaveItems.push({ name: l.name, detail: l.reason || 'On Leave' });
      }
    });

    const availableItems = [];
    const busyItems = [];

    uniqueBaseTeachers.forEach((teacher) => {
      if (onLeaveSet.has(teacher)) return;
      const busyClass = allClasses.find(
        (c) =>
          c.teacher === teacher &&
          c.day === selectedDay &&
          doTimeSlotsOverlap(c.time, selectedTime)
      );
      if (busyClass) {
        busyItems.push({ name: teacher, detail: `${busyClass.time} — ${busyClass.program}` });
      } else {
        availableItems.push({ name: teacher });
      }
    });

    return { available: availableItems, busy: busyItems, onLeave: onLeaveItems };
  }, [selectedDay, selectedTime, uniqueBaseTeachers, allClasses, leaveList]);

  return (
    <section className="dashboard-view active">
      <div className="panel availability-panel">
        <div className="panel-header">
          <h2>Slot Availability Checker</h2>
        </div>
        <div className="panel-body">
          <div className="search-controls">
            <div className="input-group">
              <label htmlFor="avail-day">Day</label>
              <select id="avail-day" value={selectedDay} onChange={(e) => { setSelectedDay(e.target.value); setSelectedTime(''); }} disabled={availableDays.length === 0}>
                <option value="" disabled>Select a Day...</option>
                {availableDays.map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="avail-time">Time Slot</label>
              <select id="avail-time" value={selectedTime} onChange={(e) => setSelectedTime(e.target.value)} disabled={sortedTimes.length === 0}>
                <option value="" disabled>Select a Time...</option>
                {sortedTimes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="results-grid results-grid-3">
            <div className="result-column">
              <h3>
                <span className="col-label available-label">✓ Available</span>
                <Badge variant="success">{available.length}</Badge>
              </h3>
              <PaginatedList items={available} emptyText="Select day & time..." />
            </div>
            <div className="result-column">
              <h3>
                <span className="col-label busy-label">✗ Busy</span>
                <Badge variant="neutral">{busy.length}</Badge>
              </h3>
              <PaginatedList items={busy} emptyText="Select day & time..." />
            </div>
            <div className="result-column">
              <h3>
                <span className="col-label onleave-label">✈ On Leave</span>
                <Badge variant="warning">{onLeave.length}</Badge>
              </h3>
              <PaginatedList items={onLeave} emptyText="No one on leave" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
