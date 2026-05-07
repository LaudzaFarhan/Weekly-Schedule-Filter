'use client';

import { useState, useMemo } from 'react';
import { submitTrialLead } from '../services/trialSubmit';
import { Send, Clock, Calendar } from 'lucide-react';
import { useSchedule } from '../contexts/ScheduleContext';
import { DAY_NAMES } from '../utils/constants';
import { parseTimeSlot, doTimeSlotsOverlap } from '../utils/timeUtils';

export default function TrialInputPage() {
  const { uniqueTimes, uniqueBaseTeachers, allClasses, leaveList, disabledInstructors } = useSchedule();
  const [form, setForm] = useState({
    program: '', student: '', instructor: '', day: '', time: '', date: '', remarks: '',
  });
  const [status, setStatus] = useState({ message: '', type: '' });
  const [submitting, setSubmitting] = useState(false);
  const [datePage, setDatePage] = useState(0);
  const [quickFillText, setQuickFillText] = useState('');
  const [baseMonth, setBaseMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const programs = ['Trial Kinder', 'Trial Junior', 'Trial Coder'];

  const TRIAL_SLOTS = useMemo(() => {
    if (!form.day) return [];
    if (form.day === 'Sunday') return [];
    
    const isSaturday = form.day === 'Saturday';
    const startHour = isSaturday ? 10 : 11;
    
    const slots = [];
    for (let hour = startHour; hour <= 18; hour++) {
      for (let min of [0, 30]) {

        const formatTime = (h, m) => {
          const isPM = h >= 12;
          const displayH = h > 12 ? h - 12 : h;
          const ampm = isPM ? 'pm' : 'am';
          return `${displayH}.${m === 0 ? '00' : '30'} ${ampm}`;
        };
        const startStr = formatTime(hour, min);
        const endHour = hour + 1;
        const endStr = formatTime(endHour, min);
        
        const startIsPM = hour >= 12;
        const endIsPM = endHour >= 12;
        
        let slotString = '';
        if (startIsPM === endIsPM) {
          slotString = `${startStr.replace(/ am| pm/g, '')} - ${endStr}`;
        } else {
          slotString = `${startStr} - ${endStr}`;
        }
        slots.push(slotString);
      }
    }
    return slots;
  }, [form.day]);

  const currentMonthDates = useMemo(() => {
    const [yearStr, monthStr] = baseMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1; // 0-indexed
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dates = [];
    
    // JS getDay() is 0 for Sunday, 1 for Monday
    const getDayName = (d) => {
      const dayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
      return DAY_NAMES[dayIndex];
    };

    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(year, month, i);
      dates.push({
        dateObj: d,
        dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`,
        dayNum: i,
        dayName: getDayName(d)
      });
    }
    return dates;
  }, [baseMonth]);

  const DATES_PER_PAGE = 10;
  const visibleDates = useMemo(() => {
    return currentMonthDates.slice(datePage * DATES_PER_PAGE, (datePage + 1) * DATES_PER_PAGE);
  }, [currentMonthDates, datePage]);
  const totalDatePages = Math.ceil(currentMonthDates.length / DATES_PER_PAGE);

  const availableInstructors = useMemo(() => {
    if (!uniqueBaseTeachers) return [];
    if (!form.day || !form.time) return Array.from(uniqueBaseTeachers);

    const onLeave = new Set();
    if (leaveList) {
      leaveList.forEach((l) => {
        if (l.day === form.day) onLeave.add(l.name);
      });
    }

    const available = [];
    uniqueBaseTeachers.forEach((teacher) => {
      if (disabledInstructors.has(teacher)) return;
      if (onLeave.has(teacher)) return;
      const isBusy = allClasses?.some(
        (c) =>
          c.teacher === teacher &&
          c.day === form.day &&
          doTimeSlotsOverlap(c.time, form.time)
      );
      if (!isBusy) available.push(teacher);
    });

    return available;
  }, [form.day, form.time, uniqueBaseTeachers, allClasses, leaveList, disabledInstructors]);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleQuickFill = () => {
    if (!quickFillText) return;
    
    const lines = quickFillText.split('\n');
    let student = form.student;
    let dateStr = form.date;
    let dayName = form.day;
    let newBaseMonth = baseMonth;
    let program = form.program;
    let instructor = form.instructor;
    let timeSlotStr = form.time;
    let remarksArr = [];

    lines.forEach(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim().toLowerCase();
        const value = parts.slice(1).join(':').trim();

        if (key.includes('student')) {
          student = value;
        } else if (key.includes('date trial')) {
          const d = new Date(value);
          if (!isNaN(d.getTime())) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            dateStr = `${year}-${month}-${day}`;
            
            const dayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
            dayName = DAY_NAMES[dayIndex];
            newBaseMonth = `${year}-${month}`;
          }
        } else if (key.includes('age')) {
          const age = parseInt(value, 10);
          if (!isNaN(age)) {
            if (age >= 4 && age <= 7) program = 'Trial Kinder';
            else if (age >= 8 && age <= 10) program = 'Trial Junior';
            else if (age >= 11) program = 'Trial Coder';
          }
        } else if (key.includes('experience')) {
          remarksArr.push(line);
        } else if (key.includes('time')) {
          const cleaned = value.toLowerCase().replace(/\s+/g, '');
          let isPM = cleaned.includes('pm');
          const isAM = cleaned.includes('am');
          
          const match = cleaned.match(/(\d{1,2})[:.]?(\d{2})?/);
          if (match) {
            let hour = parseInt(match[1], 10);
            let min = match[2] ? parseInt(match[2], 10) : 0;
            
            if (isPM && hour < 12) hour += 12;
            if (isAM && hour === 12) hour = 0;
            // Map unambiguous afternoon hours (1-6) without AM/PM to PM automatically
            if (hour >= 1 && hour <= 6 && !isAM && !isPM) hour += 12;
            
            const formatTime = (h, m) => {
              const isPostMeridian = h >= 12;
              const displayH = h > 12 ? h - 12 : h;
              const ampm = isPostMeridian ? 'pm' : 'am';
              return `${displayH}.${m === 0 ? '00' : '30'} ${ampm}`;
            };
            
            const startStr = formatTime(hour, min);
            const endStr = formatTime(hour + 1, min);
            const startIsPM = hour >= 12;
            const endIsPM = (hour + 1) >= 12;
            
            if (startIsPM === endIsPM) {
              timeSlotStr = `${startStr.replace(/ am| pm/g, '')} - ${endStr}`;
            } else {
              timeSlotStr = `${startStr} - ${endStr}`;
            }
          }
        }
      }
    });

    if (uniqueBaseTeachers && uniqueBaseTeachers.size > 0) {
      const teachersArr = Array.from(uniqueBaseTeachers);
      instructor = teachersArr[Math.floor(Math.random() * teachersArr.length)];
    }

    setForm(prev => ({
      ...prev,
      program,
      student,
      date: dateStr,
      day: dayName,
      time: timeSlotStr,
      instructor,
      remarks: remarksArr.join('\n')
    }));
    
    if (newBaseMonth !== baseMonth) {
      setBaseMonth(newBaseMonth);
      setDatePage(0);
    }
    
    setQuickFillText('');
  };

  const handleProgramSelect = (program) => {
    setForm((prev) => ({ ...prev, program }));
  };

  const handleTimeSelect = (day, time) => {
    setForm((prev) => ({ ...prev, day, time }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.program || !form.day || !form.time) {
      alert('Please select a program, day, and time from the left panel.');
      return;
    }

    setSubmitting(true);
    setStatus({ message: '', type: '' });

    const dayFormatMap = {
      'Monday': '1. Monday',
      'Tuesday': '2. Tuesday',
      'Wednesday': '3. Wednesday',
      'Thursday': '4. Thursday',
      'Friday': '5. Friday',
      'Saturday': '6. Saturday',
      'Sunday': '7. Sunday'
    };

    const rowData = {
      colA: 'Trial Leads',
      colB: form.program,
      colC: form.student,
      colD: form.instructor,
      colE: dayFormatMap[form.day] || form.day,
      colF: form.time,
      colG: form.date,
      colH: form.remarks,
    };

    try {
      await submitTrialLead(rowData);
      setStatus({ message: 'Success! Trial Lead added to spreadsheet.', type: 'success' });
      alert('✅ Success! Trial Lead added to spreadsheet.');
      setForm({ program: '', student: '', instructor: '', day: '', time: '', date: '', remarks: '' });
    } catch (error) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
      alert(`❌ Error: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Organize available times by day using the predefined 1-hour TRIAL_SLOTS
  const availableSchedules = useMemo(() => {
    const schedules = [];
    if (!form.day) return schedules; // Require date selection first

    const validTimes = [];
    const onLeave = new Set();
    if (leaveList) {
      leaveList.forEach((l) => {
        if (l.day === form.day) onLeave.add(l.name);
      });
    }

    TRIAL_SLOTS.forEach(slot => {
      let hasFreeInstructor = false;
      
      if (uniqueBaseTeachers) {
        for (const teacher of uniqueBaseTeachers) {
          if (disabledInstructors.has(teacher)) continue;
          if (onLeave.has(teacher)) continue;
          const isBusy = allClasses?.some(
            (c) =>
              c.teacher === teacher &&
              c.day === form.day &&
              doTimeSlotsOverlap(c.time, slot)
          );
          if (!isBusy) {
            hasFreeInstructor = true;
            break;
          }
        }
      }
      
      if (hasFreeInstructor) {
        validTimes.push(slot);
      }
    });

    if (validTimes.length > 0) {
      schedules.push({ day: form.day, times: validTimes });
    }

    return schedules;
  }, [form.day, uniqueBaseTeachers, allClasses, leaveList, TRIAL_SLOTS, disabledInstructors]);

  return (
    <section className="dashboard-view active">
      <div className="trial-input-split">
        
        {/* Left Pane - Selection */}
        <div className="trial-left-pane">
          <div className="panel">
            <div className="panel-header">
              <h2>Select Program</h2>
            </div>
            <div className="panel-content">
              <div className="program-cards">
                {programs.map((prog) => (
                  <div 
                    key={prog} 
                    className={`program-card ${form.program === prog ? 'active' : ''}`}
                    onClick={() => handleProgramSelect(prog)}
                  >
                    {prog}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {form.program && (
            <div className="panel animation-fade-in" style={{ marginBottom: '1rem' }}>
              <div className="panel-header">
                <h2>Select Trial Date</h2>
                <input 
                  type="month" 
                  value={baseMonth} 
                  onChange={(e) => {
                    if (e.target.value) {
                      setBaseMonth(e.target.value);
                      setDatePage(0);
                    }
                  }}
                  style={{ 
                    padding: '0.4rem 0.6rem', 
                    borderRadius: '8px', 
                    border: '1px solid var(--border-color)', 
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                    fontFamily: 'inherit',
                    outline: 'none'
                  }}
                />
              </div>
              <div className="panel-content" style={{ padding: '1rem 1.5rem' }}>
                <div className="date-scroll-container" style={{ justifyContent: 'center' }}>
                  {visibleDates.map(({ dateStr, dayNum, dayName }) => (
                    <button
                      key={dateStr}
                      type="button"
                      className={`date-chip ${form.date === dateStr ? 'active' : ''}`}
                      onClick={() => {
                        setForm(prev => ({ ...prev, date: dateStr, day: dayName, time: '' }));
                      }}
                    >
                      <span className="date-chip-day">{dayName.substring(0, 3)}</span>
                      <span className="date-chip-num">{dayNum}</span>
                    </button>
                  ))}
                </div>
                {totalDatePages > 1 && (
                  <div className="mini-pagination" style={{ marginTop: '0.75rem', borderTop: 'none' }}>
                    <button 
                      type="button" 
                      onClick={() => setDatePage(p => Math.max(0, p - 1))} 
                      disabled={datePage === 0}
                    >
                      &lt;
                    </button>
                    <span>{datePage + 1} / {totalDatePages}</span>
                    <button 
                      type="button" 
                      onClick={() => setDatePage(p => Math.min(totalDatePages - 1, p + 1))} 
                      disabled={datePage === totalDatePages - 1}
                    >
                      &gt;
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {form.program && form.date && (
            <div className="available-schedules-container animation-fade-in">
              <h3>Available Schedules for {form.program}</h3>
              {availableSchedules.length > 0 ? (
                availableSchedules.map(({ day, times }) => (
                  <div key={day} className="schedule-day-group">
                    <h4>{day}</h4>
                    <div className="time-chips">
                      {times.map(t => (
                        <button 
                          key={`${day}-${t}`}
                          type="button"
                          className={`time-chip ${form.day === day && form.time === t ? 'active' : ''}`}
                          onClick={() => handleTimeSelect(day, t)}
                        >
                          <Clock size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="subtext">No available schedules loaded for this day.</p>
              )}
            </div>
          )}
        </div>

        {/* Right Pane - Form */}
        <div className="trial-right-pane panel">
          <div className="panel-header">
            <div className="panel-header-left">
              <h2>Input Trial Leads</h2>
              <span className="subtext">Fill in student details</span>
            </div>
          </div>
          <div className="panel-content">
            
            <div className="quick-fill-section" style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px dashed var(--border-color)' }}>
              <div className="input-group">
                <label style={{ color: 'var(--primary-blue)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  Chatbot Quick Fill
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleQuickFill}>Auto-Fill</button>
                </label>
                <textarea 
                  placeholder="Parent Name : Dewi Harsono&#10;Student : Sky Rianto&#10;Age : 8&#10;..." 
                  value={quickFillText}
                  onChange={(e) => setQuickFillText(e.target.value)}
                  style={{ minHeight: '120px', fontSize: '0.8rem' }}
                />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="trial-input-form">
              <div className="form-grid">
                
                <div className="input-group">
                  <label htmlFor="trial-program">Program (Auto-filled)</label>
                  <input type="text" id="trial-program" value={form.program} readOnly placeholder="Select on the left" className="readonly-input" />
                </div>

                <div className="input-group">
                  <label htmlFor="trial-day-time">Day & Time (Auto-filled)</label>
                  <input 
                    type="text" 
                    id="trial-day-time" 
                    value={form.day && form.time ? `${form.day}, ${form.time}` : ''} 
                    readOnly 
                    placeholder="Select on the left" 
                    className="readonly-input" 
                  />
                </div>

                <div className="input-group">
                  <label htmlFor="trial-date">Trial Date</label>
                  <input type="date" id="trial-date" value={form.date} onChange={handleChange('date')} required />
                </div>

                <div className="input-group">
                  <label htmlFor="trial-student">Student Name</label>
                  <input type="text" id="trial-student" placeholder="e.g. Ebenezer" value={form.student} onChange={handleChange('student')} required />
                </div>
                
                <div className="input-group">
                  <label htmlFor="trial-instructor">Instructor</label>
                  <select 
                    id="trial-instructor" 
                    value={form.instructor} 
                    onChange={handleChange('instructor')} 
                    required
                  >
                    <option value="" disabled>Select an instructor</option>
                    {availableInstructors.map(inst => (
                      <option key={inst} value={inst}>{inst}</option>
                    ))}
                  </select>
                </div>
                
                <div className="input-group full-width">
                  <label htmlFor="trial-remarks">Remarks</label>
                  <textarea id="trial-remarks" placeholder="Optional comments..." value={form.remarks} onChange={handleChange('remarks')} />
                </div>
              </div>
              
              <div className="form-actions">
                {status.message && (
                  <div className={`status-message ${status.type}`}>{status.message}</div>
                )}
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  <Send size={18} />
                  {submitting ? 'Submitting...' : 'Submit Trial'}
                </button>
              </div>
            </form>
          </div>
        </div>

      </div>
    </section>
  );
}
