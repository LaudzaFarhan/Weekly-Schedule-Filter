import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';
import KpiCard from '../components/ui/KpiCard';
import { Users, CheckCircle, CalendarX } from 'lucide-react';

export default function HomePage() {
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

  const { availableCount, busyCount } = useMemo(() => {
    if (!selectedDay || !selectedTime) return { availableCount: '-', busyCount: '-' };

    const onLeave = new Set();
    leaveList.forEach((l) => {
      if (l.day === selectedDay) onLeave.add(l.name);
    });

    let available = 0;
    let busy = 0;
    uniqueBaseTeachers.forEach((teacher) => {
      if (onLeave.has(teacher)) return;
      const isBusy = allClasses.some(
        (c) =>
          c.teacher === teacher &&
          c.day === selectedDay &&
          doTimeSlotsOverlap(c.time, selectedTime)
      );
      if (isBusy) busy++;
      else available++;
    });
    return { availableCount: available, busyCount: busy };
  }, [selectedDay, selectedTime, uniqueBaseTeachers, allClasses, leaveList]);

  const handleDayChange = (e) => {
    setSelectedDay(e.target.value);
    setSelectedTime('');
  };

  return (
    <section className="dashboard-view active">
      <div className="panel home-overview-panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Dashboard Overview</h2>
            <span className="subtext">Select a time below to see availability stats</span>
          </div>
          <div className="home-controls">
            <div className="input-group">
              <select value={selectedDay} onChange={handleDayChange} disabled={availableDays.length === 0}>
                <option value="" disabled>Select a Day...</option>
                {availableDays.map((day) => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <select
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                disabled={sortedTimes.length === 0}
              >
                <option value="" disabled>Select a Time...</option>
                {sortedTimes.map((time) => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="panel-body">
          <div className="kpi-grid">
            <KpiCard
              icon={<Users size={24} />}
              title="Total Teachers"
              value={uniqueBaseTeachers.size}
              variant="blue"
            />
            <KpiCard
              icon={<CheckCircle size={24} />}
              title="Available Teachers"
              value={availableCount}
              variant="green"
            />
            <KpiCard
              icon={<CalendarX size={24} />}
              title="Busy Teachers"
              value={busyCount}
              variant="red"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
