'use client';

import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { submitTrialLead } from '../services/trialSubmit';
import { Send, Clock, Calendar, MapPin } from 'lucide-react';
import { useSchedule } from '../contexts/ScheduleContext';
import { DAY_NAMES, getWorkingDaysForBranch } from '../utils/constants';
import { parseTimeSlot, doTimeSlotsOverlap } from '../utils/timeUtils';
import { leaveAppliesToDay } from '../utils/dateUtils';
import { isValidTeacherName } from '../utils/instructorUtils';
import { parseQuickFill } from '../utils/quickFillParser';
import { useToast } from '../components/ui/Toast';

export default function TrialInputPage() {
  const {
    uniqueTimes, uniqueBaseTeachers, overallClasses, leaveList,
    disabledInstructors, instructorProfiles, activeBranchName,
    enabledBranches, branches, changeActiveBranch, trialPriorityList,
  } = useSchedule();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    program: '', student: '', instructor: '', day: '', time: '', date: '', remarks: '',
    branchName: '',
  });

  // The form's branch is what scopes everything (instructor list, available
  // times, leaves). Defaults to the global active branch but Quick Fill or
  // the manual picker can switch it.
  const targetBranchName = form.branchName || activeBranchName;

  // Classes scoped to the target branch — replaces the previous `allClasses`
  // which was tied to the global active branch only.
  const branchClasses = useMemo(
    () => overallClasses.filter((c) => c.branchName === targetBranchName),
    [overallClasses, targetBranchName]
  );

  const filteredTeachers = useMemo(() => {
    const branchTeachers = new Set();
    branchClasses.forEach(c => {
      if (isValidTeacherName(c.teacher)) branchTeachers.add(c.teacher);
    });

    return [...uniqueBaseTeachers].filter((t) => {
      if (disabledInstructors?.has(t)) return false;
      const profile = instructorProfiles?.find(p => p.fullname === t || p.nickname === t);
      if (profile) {
        return profile.location === 'All Branches' || profile.location === targetBranchName;
      }
      return branchTeachers.has(t);
    });
  }, [uniqueBaseTeachers, branchClasses, disabledInstructors, instructorProfiles, targetBranchName]);
  const [status, setStatus] = useState({ message: '', type: '' });
  const [submitting, setSubmitting] = useState(false);
  const [datePage, setDatePage] = useState(0);
  const [quickFillText, setQuickFillText] = useState('');
  const [availabilityOverlay, setAvailabilityOverlay] = useState(null);
  const [baseMonth, setBaseMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const programs = ['Trial Kinder', 'Trial Junior', 'Trial Coder'];

  const TRIAL_SLOTS = useMemo(() => {
    if (!form.day) return [];
    
    const isWeekend = form.day === 'Saturday' || form.day === 'Sunday';
    const startHour = isWeekend ? 10 : 11;
    
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
    const validDays = getWorkingDaysForBranch(targetBranchName);
    const [yearStr, monthStr] = baseMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1; // 0-indexed
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dates = [];
    
    const getDayName = (d) => {
      const dow = d.getDay();
      const name = dow === 0 ? 'Sunday' : DAY_NAMES[dow - 1];
      return validDays.includes(name) ? name : null;
    };

    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(year, month, i);
      const dayName = getDayName(d);
      if (!dayName) continue; // skip Holidays from the picker
      dates.push({
        dateObj: d,
        dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`,
        dayNum: i,
        dayName,
      });
    }
    return dates;
  }, [baseMonth, targetBranchName]);

  const DATES_PER_PAGE = 10;
  const visibleDates = useMemo(() => {
    return currentMonthDates.slice(datePage * DATES_PER_PAGE, (datePage + 1) * DATES_PER_PAGE);
  }, [currentMonthDates, datePage]);
  const totalDatePages = Math.ceil(currentMonthDates.length / DATES_PER_PAGE);

  const availableInstructors = useMemo(() => {
    if (!filteredTeachers) return [];
    if (!form.day || !form.time) return Array.from(filteredTeachers);

    const onLeave = new Set();
    if (leaveList) {
      leaveList.forEach((l) => {
        if (leaveAppliesToDay(l, form.day)) onLeave.add(l.name);
      });
    }

    const available = [];
    filteredTeachers.forEach((teacher) => {
      if (disabledInstructors.has(teacher)) return;
      if (onLeave.has(teacher)) return;

      // If they are explicitly part-time in trial priority, check their working days
      if (trialPriorityList) {
        const priorityInfo = trialPriorityList.find(p => p.name === teacher);
        if (priorityInfo && priorityInfo.status === 'parttime') {
          if (!priorityInfo.workingDays?.includes(form.day)) {
            return; // Not a working day for this part-timer
          }
        }
      }

      const isBusy = branchClasses?.some(
        (c) =>
          c.teacher === teacher &&
          c.day === form.day &&
          doTimeSlotsOverlap(c.time, form.time)
      );
      if (!isBusy) available.push(teacher);
    });

    return available;
  }, [form.day, form.time, filteredTeachers, branchClasses, leaveList, disabledInstructors, trialPriorityList]);

  // Determine ready instructors based on profile specialization
  const readyInstructors = useMemo(() => {
    if (!form.program || !instructorProfiles) return [];
    
    return instructorProfiles.filter(profile => {
      // Must be in the target branch
      if (profile.location !== 'All Branches' && profile.location !== targetBranchName) return false;

      // Must be available for the selected slot if day/time are picked
      // If no day/time picked, we just show who has the specialization
      if (form.day && form.time && !availableInstructors.includes(profile.fullname) && !availableInstructors.includes(profile.nickname)) {
        // We match by fullname or nickname. If they aren't in availableInstructors, they aren't available.
        // For simplicity, let's just check availability by checking if they are not busy
        const nameMatches = availableInstructors.includes(profile.fullname) || availableInstructors.includes(profile.nickname) || availableInstructors.includes(profile.id);
        if (!nameMatches && availableInstructors.length > 0) return false;
      }

      if (form.program.includes('Kinder')) {
        return profile.specialization === 'kinder-junior' || profile.specialization === 'all';
      } else if (form.program.includes('Junior')) {
        return profile.specialization === 'kinder-junior' || profile.specialization === 'junior-coder' || profile.specialization === 'all';
      } else if (form.program.includes('Coder')) {
        return profile.specialization === 'junior-coder' || profile.specialization === 'all';
      }
      return false;
    });
  }, [form.program, form.day, form.time, instructorProfiles, availableInstructors, targetBranchName]);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  /**
   * Quick Fill: parses a chatbot transcript using the shared parser, then
   * pre-fills the form. The parser is data-driven so adding branches in
   * Admin → Branches automatically extends what we can detect.
   */
  const handleQuickFill = () => {
    if (!quickFillText) return;

    const parsed = parseQuickFill(quickFillText, { branches: enabledBranches });

    // Build the next form state. We only overwrite fields the parser found
    // values for, so any manual edits the user already made are preserved.
    setForm((prev) => {
      const next = { ...prev };
      if (parsed.student) next.student = parsed.student;
      if (parsed.program) next.program = parsed.program;
      if (parsed.date) next.date = parsed.date;
      if (parsed.day) next.day = parsed.day;
      if (parsed.time) next.time = parsed.time;
      if (parsed.branchName) next.branchName = parsed.branchName;
      if (parsed.remarks) {
        next.remarks = next.remarks
          ? `${next.remarks}\n${parsed.remarks}`
          : parsed.remarks;
      }
      return next;
    });

    // If the parser detected a branch and the global active branch is
    // different, switch the global view too — this is what makes the trial
    // land in the right branch's schedule. We only switch when the branch
    // is enabled and known.
    if (parsed.branchId) {
      const target = (branches || []).find((b) => b.id === parsed.branchId);
      if (target && changeActiveBranch) changeActiveBranch(target.id);
    }

    // Surface anything the parser couldn't resolve. We don't auto-pick an
    // instructor anymore — the user picks from "Ready Instructors" so the
    // assignment is intentional.
    const messageParts = [];
    if (parsed.branchName) messageParts.push(`Branch: ${parsed.branchName}`);
    if (parsed.program) messageParts.push(parsed.program);
    if (parsed.day && parsed.time) messageParts.push(`${parsed.day} ${parsed.time}`);

    if (parsed.warnings.length > 0) {
      showToast({
        title: 'Quick Fill — review needed',
        message: parsed.warnings.join(' '),
        details: messageParts,
        variant: 'warning',
        duration: 7000,
      });
    } else if (messageParts.length > 0) {
      showToast({
        title: 'Quick Fill applied',
        message: 'Review the form and pick an instructor.',
        details: messageParts,
        variant: 'success',
        duration: 5000,
      });
    } else {
      showToast({
        title: 'Quick Fill — nothing detected',
        message: 'No recognised fields in the pasted text.',
        variant: 'warning',
        duration: 5000,
      });
    }

    if (parsed.date && parsed.date.slice(0, 7) !== baseMonth) {
      setBaseMonth(parsed.date.slice(0, 7));
      setDatePage(0);
    }

    setQuickFillText('');

    if (parsed.day && parsed.time) {
      setAvailabilityOverlay('checking');
      
      let slotAvailable = false;
      const targetBranch = parsed.branchName || targetBranchName;
      const bClasses = overallClasses.filter((c) => c.branchName === targetBranch);
      
      const bTeachers = new Set();
      bClasses.forEach(c => {
        if (isValidTeacherName(c.teacher)) bTeachers.add(c.teacher);
      });

      const teachersInBranch = [...uniqueBaseTeachers].filter((t) => {
        if (disabledInstructors?.has(t)) return false;
        const profile = instructorProfiles?.find(p => p.fullname === t || p.nickname === t);
        if (profile) {
          return profile.location === 'All Branches' || profile.location === targetBranch;
        }
        return bTeachers.has(t);
      });

      const onLeave = new Set();
      if (leaveList) {
        leaveList.forEach((l) => {
          if (leaveAppliesToDay(l, parsed.day)) onLeave.add(l.name);
        });
      }

      for (const teacher of teachersInBranch) {
        if (onLeave.has(teacher)) continue;

        // Check if they are part-time and if this is a working day
        if (trialPriorityList) {
          const priorityInfo = trialPriorityList.find(p => p.name === teacher);
          if (priorityInfo && priorityInfo.status === 'parttime') {
            if (!priorityInfo.workingDays?.includes(parsed.day)) {
              continue; // Not a working day for this part-timer
            }
          }
        }
        
        if (parsed.program && instructorProfiles) {
           const profile = instructorProfiles.find(p => p.fullname === teacher || p.nickname === teacher || p.id === teacher);
           if (profile) {
             let canTeach = false;
             if (parsed.program.includes('Kinder') && (profile.specialization === 'kinder-junior' || profile.specialization === 'all')) canTeach = true;
             else if (parsed.program.includes('Junior') && (profile.specialization === 'kinder-junior' || profile.specialization === 'junior-coder' || profile.specialization === 'all')) canTeach = true;
             else if (parsed.program.includes('Coder') && (profile.specialization === 'junior-coder' || profile.specialization === 'all')) canTeach = true;
             if (!canTeach) continue;
           }
        }

        const isBusy = bClasses.some(
          (c) =>
            c.teacher === teacher &&
            c.day === parsed.day &&
            doTimeSlotsOverlap(c.time, parsed.time)
        );
        if (!isBusy) {
          slotAvailable = true;
          break;
        }
      }

      setTimeout(() => {
        const result = slotAvailable ? 'available' : 'unavailable';
        setAvailabilityOverlay(result);
        
        // Only auto-close if available. If unavailable, wait for user to read and click "Got it"
        if (result === 'available') {
          setTimeout(() => {
            setAvailabilityOverlay(null);
          }, 2500);
        }
      }, 1000);
    }
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
    if (!targetBranchName) {
      alert('Pick a branch before submitting so the trial lands in the right schedule.');
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
    };

    // Pass branch info to the server so the row is appended to the correct
    // branch's "Trial Leads" tab. The Apps Script / native API can read
    // branchName / branchId and route accordingly. Old single-branch setups
    // still work because colA…colH stay backward compatible.
    const rowData = {
      colA: 'Trial Leads',
      colB: form.program,
      colC: form.student,
      colD: form.instructor,
      colE: dayFormatMap[form.day] || form.day,
      colF: form.time,
      colG: form.date,
      colH: form.remarks,
      branchName: targetBranchName,
      branchId: (branches || []).find((b) => b.name === targetBranchName)?.id || null,
    };

    try {
      await submitTrialLead(rowData, { branches });
      setStatus({ message: `Success! Trial Lead added to ${targetBranchName}.`, type: 'success' });
      showToast({
        title: 'Trial submitted',
        message: `${form.student || 'Lead'} → ${targetBranchName} · ${form.day} ${form.time}`,
        variant: 'success',
        duration: 5000,
      });
      setForm({ program: '', student: '', instructor: '', day: '', time: '', date: '', remarks: '', branchName: '' });
    } catch (error) {
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
      showToast({
        title: 'Trial submission failed',
        message: error.message || 'Unknown error',
        variant: 'error',
        duration: 7000,
      });
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
        if (leaveAppliesToDay(l, form.day)) onLeave.add(l.name);
      });
    }

    TRIAL_SLOTS.forEach(slot => {
      let hasFreeInstructor = false;
      
      if (filteredTeachers) {
        for (const teacher of filteredTeachers) {
          if (disabledInstructors.has(teacher)) continue;
          if (onLeave.has(teacher)) continue;
          const isBusy = branchClasses?.some(
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
  }, [form.day, filteredTeachers, branchClasses, leaveList, TRIAL_SLOTS, disabledInstructors]);

  return (
    <section className="dashboard-view active">
      
      {/* Top Pane - Ready Instructors */}
      <div className="trial-ready-instructors panel animation-fade-in" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header" style={{ padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--primary-blue)' }}>Ready Instructors</h3>
            <span className="subtext" style={{ fontSize: '0.8rem' }}>Based on Specialization</span>
          </div>
        </div>
        <div className="panel-content" style={{ padding: '0' }}>
          {!form.program ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Select a program below to see qualified instructors.
            </div>
          ) : readyInstructors.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No instructors have profiles matching this program specialization.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: '0.5rem 1.25rem', margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
              {readyInstructors.map(profile => {
                let trainingLevel = '—';
                if (form.program.includes('Kinder')) {
                  const level = Math.max(profile.trainingProgress?.kinderFoundation || 0, profile.trainingProgress?.kinderCore || 0);
                  trainingLevel = level > 0 ? `Lvl ${level}` : '—';
                } else if (form.program.includes('Junior')) {
                  const level = Math.max(profile.trainingProgress?.juniorFoundation || 0, profile.trainingProgress?.juniorCore || 0);
                  trainingLevel = level > 0 ? `Lvl ${level}` : '—';
                } else if (form.program.includes('Coder')) {
                  const level = Math.max(profile.trainingProgress?.coderBasic || 0, profile.trainingProgress?.coderIntermediate || 0, profile.trainingProgress?.coderAdvance || 0);
                  trainingLevel = level > 0 ? `Lvl ${level}` : '—';
                }

                const isAvailableNow = availableInstructors.includes(profile.fullname) || availableInstructors.includes(profile.nickname) || availableInstructors.includes(profile.id);

                return (
                  <li key={profile.id} style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '0.5rem', background: '#f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <strong style={{ fontSize: '0.95rem' }}>{profile.fullname || profile.nickname || profile.id}</strong>
                        {(() => {
                          const instName = profile.fullname || profile.nickname || profile.id;
                          const trialEntry = (trialPriorityList || []).find(t => t.name === instName);
                          const isPartTime = trialEntry?.status === 'parttime';
                          return (
                            <span style={{ 
                              fontSize: '0.65rem', 
                              padding: '0.15rem 0.4rem', 
                              borderRadius: '4px', 
                              background: isPartTime ? 'var(--primary-blue-light)' : 'var(--success-bg)', 
                              color: isPartTime ? 'var(--primary-blue)' : 'var(--success)',
                              fontWeight: 600
                            }}>
                              {isPartTime ? 'PT' : 'FT'}
                            </span>
                          );
                        })()}
                      </div>
                      {form.time && (
                        <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: isAvailableNow ? 'var(--success-color)' : 'var(--danger-color)', color: 'white' }}>
                          {isAvailableNow ? 'Free' : 'Busy'}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', alignItems: 'center' }}>
                      <span>Training: <strong style={{color: 'var(--text-color)'}}>{trainingLevel}</strong></span>
                      <button 
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                        onClick={() => setForm(p => ({ ...p, instructor: profile.fullname || profile.nickname || profile.id }))}
                      >
                        Select
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <MapPin size={14} style={{ color: 'var(--text-muted)' }} />
              <select
                value={form.branchName || ''}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((p) => ({ ...p, branchName: name, instructor: '' }));
                  const target = (branches || []).find((b) => b.name === name);
                  if (target && changeActiveBranch) changeActiveBranch(target.id);
                }}
                style={{
                  padding: '0.4rem 0.6rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  background: 'white',
                  cursor: 'pointer',
                }}
                title="Branch the trial will be booked into"
              >
                <option value="">Select Branch…</option>
                {(enabledBranches || []).map((b) => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
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
                  placeholder={`Paste the chatbot transcript. Recognised lines (any order, EN/ID):
  Parent / Orang tua : Dewi Harsono
  Student / Anak    : Sky Rianto
  Phone / WA        : 08123456789
  Age / Umur        : 8
  Branch / Cabang   : Gading Serpong
  Date / Tanggal    : 21/12/2025
  Time / Jam        : 1pm  (or 13.00, 1.30 sore)
  Notes / Catatan   : ...`}
                  value={quickFillText}
                  onChange={(e) => setQuickFillText(e.target.value)}
                  style={{ minHeight: '140px', fontSize: '0.8rem', fontFamily: 'inherit' }}
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
                    {availableInstructors.map(inst => {
                      const trialEntry = (trialPriorityList || []).find(t => t.name === inst);
                      const isPartTime = trialEntry?.status === 'parttime';
                      const label = `${inst} (${isPartTime ? 'Part-time' : 'Full-time'})`;
                      return (
                        <option key={inst} value={inst}>{label}</option>
                      );
                    })}
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

      {/* Availability Overlay */}
      {availabilityOverlay && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(255,255,255,0.4)',
          backdropFilter: 'blur(12px)',
          animation: 'fadeIn 0.5s ease-out',
          transition: 'all 0.5s ease',
        }}>
          <div style={{
            padding: '4rem 6rem',
            background: 'white',
            borderRadius: '24px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            textAlign: 'center',
            transform: availabilityOverlay === 'checking' ? 'scale(0.95)' : 'scale(1)',
            transition: 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem'
          }}>
            {availabilityOverlay === 'checking' && (
              <>
                <div className="spin" style={{ width: '64px', height: '64px', border: '6px solid var(--border-color)', borderTopColor: 'var(--primary-blue)', borderRadius: '50%' }} />
                <h2 style={{ fontSize: '2.2rem', color: 'var(--primary-blue)', margin: 0 }}>Checking Slot...</h2>
              </>
            )}
            {availabilityOverlay === 'available' && (
              <>
                <div style={{ width: '88px', height: '88px', borderRadius: '50%', background: 'var(--success-bg)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3.5rem' }}>✓</div>
                <h2 style={{ fontSize: '2.8rem', color: 'var(--success)', margin: 0 }}>Slot Available</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', margin: 0 }}>We found instructors for this time.</p>
              </>
            )}
            {availabilityOverlay === 'unavailable' && (
              <>
                <div style={{ width: '88px', height: '88px', borderRadius: '50%', background: 'var(--danger-bg)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3.5rem' }}>×</div>
                <h2 style={{ fontSize: '2.8rem', color: 'var(--danger)', margin: 0 }}>Slot Not Available</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', margin: '0.5rem 0 0.5rem 0' }}>No instructors are free at this time. Please contact the SPA to arrange the schedule.</p>
                <div style={{ background: '#fef2f2', padding: '1.2rem', borderRadius: '12px', border: '1px dashed #fca5a5', textAlign: 'left', maxWidth: '450px' }}>
                  <h4 style={{ color: '#991b1b', margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>💡</span> Recommendation
                  </h4>
                  <p style={{ color: '#991b1b', fontSize: '0.95rem', margin: 0, lineHeight: 1.5 }}>
                    Optimize students into fewer classes! If there are two teachers who each only have 2 students, consider merging them under 1 teacher. Check with the SPA if this is doable.
                  </p>
                </div>
                <button 
                  onClick={() => setAvailabilityOverlay(null)} 
                  style={{ 
                    marginTop: '1rem', 
                    padding: '0.75rem 2.5rem', 
                    background: 'white', 
                    border: '1px solid #fca5a5', 
                    borderRadius: '8px', 
                    cursor: 'pointer', 
                    fontWeight: 600, 
                    color: '#991b1b',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = '#fef2f2'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = 'white'; }}
                >
                  Got It
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

    </section>
  );
}
