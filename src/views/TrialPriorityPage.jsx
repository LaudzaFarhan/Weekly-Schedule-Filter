'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';
import { getInstructorBranch } from '../utils/instructorUtils';
import { leaveAppliesToDay } from '../utils/dateUtils';
import Badge from '../components/ui/Badge';
import Pagination from '../components/ui/Pagination';
import { Trash2 } from 'lucide-react';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { secondaryAuth } from '../services/firebase';
import { saveProfile } from '../services/profileService';

const PAGE_SIZE = 8;

export default function TrialPriorityPage() {
  const {
    uniqueBaseTeachers, trialPriorityList, updateTrialPriorityList,
    overallClasses, uniqueTimes, allTimeSlots, leaveList,
    disabledInstructors, users, updateUsers, refreshProfiles, branches,
    instructorProfiles, activeBranchName, allClasses
  } = useSchedule();
  const [selectedName, setSelectedName] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('fulltime');
  const [selectedLocation, setSelectedLocation] = useState(activeBranchName || '');
  const [workingDays, setWorkingDays] = useState([]);
  const [editIndex, setEditIndex] = useState(-1);
  const [page, setPage] = useState(1);
  const [selectedSlotData, setSelectedSlotData] = useState(null);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [distBranch, setDistBranch] = useState('all');
  const [distModalData, setDistModalData] = useState(null);

  // Filter the list for the management table — show all entries, not just active branch
  // This allows managing instructors from any branch in one place
  const filteredTrialPriorityList = useMemo(() => {
    return trialPriorityList;
  }, [trialPriorityList]);

  // Auto-update location dropdown when branch tab changes
  useEffect(() => {
    setSelectedLocation(activeBranchName);
  }, [activeBranchName]);

  // Auto-sync trial priority locations from instructor profiles
  // When a profile's location is updated (e.g. "Default Branch" → "Puri Indah"),
  // automatically update matching entries in the trial priority list
  useEffect(() => {
    if (!instructorProfiles || instructorProfiles.length === 0 || trialPriorityList.length === 0) return;

    let hasChanges = false;
    const updatedList = trialPriorityList.map(entry => {
      // Don't override "All Branches" — it's intentionally cross-branch
      if (entry.location === 'All Branches') return entry;

      const profile = instructorProfiles.find(p =>
        p.fullname === entry.name || p.nickname === entry.name
      );
      if (profile && profile.location && profile.location !== entry.location) {
        hasChanges = true;
        return { ...entry, location: profile.location };
      }
      return entry;
    });

    if (hasChanges) {
      updateTrialPriorityList(updatedList);
    }
  }, [instructorProfiles, trialPriorityList, updateTrialPriorityList]);

  // Auto-detect instructor's branch when selected from dropdown
  const handleInstructorSelect = (name) => {
    setSelectedName(name);
    const branch = getInstructorBranch(name, instructorProfiles, overallClasses);
    setSelectedLocation(branch === 'Unknown' ? activeBranchName : branch);
  };

  const profileNames = (instructorProfiles || []).map(p => p.fullname || p.nickname || p.id.split('@')[0]);
  const allPossibleTeachers = new Set([...uniqueBaseTeachers, ...profileNames]);

  // Show all instructors in dropdown — the Location field handles branch assignment
  // Only filter out disabled instructors and those already in the priority list (any branch)
  const sortedTeachers = [...allPossibleTeachers]
    .filter((t) => {
      if (disabledInstructors.has(t)) return false;
      // Check against FULL list (all branches) to prevent duplicates
      if (trialPriorityList.some(p => p.name === t)) return false;
      return true;
    })
    .sort();

  const canAdd = selectedName && selectedType && selectedLocation;
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    if (!canAdd || isAdding) return;
    setIsAdding(true);

    try {
      const days = selectedStatus === 'fulltime' ? DAY_NAMES : workingDays;
      const entry = { name: selectedName, type: selectedType, status: selectedStatus, workingDays: days, location: selectedLocation };

      let newList;
      if (editIndex >= 0) {
        newList = [...trialPriorityList];
        newList[editIndex] = entry;
        setEditIndex(-1);
      } else {
        const exists = filteredTrialPriorityList.some((p) => p.name === selectedName);
        if (exists) { alert(`${selectedName} is already in the priority list for this branch.`); return; }
        
        // Auto-create Firebase account and profile for new additions in the background
        // so it never blocks the UI or causes the button to hang
        (async () => {
          // Format email according to admin settings preference
          const email = `${selectedName.replace(/\s+/g, '')}@schedule.local`;
          const password = 'instructor123';
          
          try {
            // 1. Try to create auth user silently
            await createUserWithEmailAndPassword(secondaryAuth, email, password);
            await signOut(secondaryAuth); // Clear the secondary auth state immediately
          } catch (authError) {
            if (authError.code !== 'auth/email-already-in-use') {
               console.warn(`Could not create Firebase login account for ${selectedName}. Error: ${authError.message}`);
               return; // Exit if it's a real error (like network issue)
            }
            // If already in use, that's fine, we still want to sync their profile and role below!
          }
          
          try {
            // 2. Add to global users config for Admin Settings with Instructor role
            const newUsersList = { ...users, [email]: 'Instructor' };
            updateUsers(newUsersList);
            
            // 3. Create blank Firestore profile matching the specialization
            await saveProfile(email, {
              fullname: selectedName,
              nickname: selectedName,
              email: email,
              specialization: selectedType,
              location: selectedLocation,
              trainingProgress: {
                kinderFoundation: 0, kinderCore: 0,
                juniorFoundation: 0, juniorCore: 0,
                coderBasic: 0, coderIntermediate: 0, coderAdvance: 0
              }
            });
            // 4. Refresh profiles so it instantly shows up in the Instructor Profiles page
            if (refreshProfiles) refreshProfiles();
          } catch (syncError) {
            console.error("Failed to sync profile:", syncError);
            alert(`Could not create profile in Firestore for ${selectedName}. Error: ${syncError.message}`);
          }
        })();
        
        newList = [...trialPriorityList, entry];
      }
      
      updateTrialPriorityList(newList);
      setSelectedName(''); setSelectedType(''); setSelectedStatus('fulltime'); setSelectedLocation(activeBranchName); setWorkingDays([]);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = (index) => {
    const actualIndex = (page - 1) * PAGE_SIZE + index;
    const instructorToRemove = filteredTrialPriorityList[actualIndex];
    if (!instructorToRemove) return;
    updateTrialPriorityList(trialPriorityList.filter((p) => !(p.name === instructorToRemove.name && p.location === instructorToRemove.location)));
    setSelectedRows(prev => { const next = new Set(prev); next.delete(actualIndex); return next; });
  };

  const handleBulkRemove = () => {
    if (selectedRows.size === 0) return;
    const toRemove = [...selectedRows].map(i => filteredTrialPriorityList[i]).filter(Boolean);
    const names = toRemove.map(p => p.name);
    if (!confirm(`Remove ${selectedRows.size} instructor(s)?\n\n${names.join(', ')}`)) return;
    updateTrialPriorityList(trialPriorityList.filter((p) => !toRemove.some(r => r.name === p.name && r.location === p.location)));
    setSelectedRows(new Set());
  };

  const toggleRow = (actualIndex) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(actualIndex)) next.delete(actualIndex); else next.add(actualIndex);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    const pageIndices = paged.map((_, i) => (page - 1) * PAGE_SIZE + i);
    const allSelected = pageIndices.every(i => selectedRows.has(i));
    setSelectedRows(prev => {
      const next = new Set(prev);
      pageIndices.forEach(i => allSelected ? next.delete(i) : next.add(i));
      return next;
    });
  };

  const handleDayToggle = (day) => {
    setWorkingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const getCapabilities = (type) => {
    if (type === 'junior-coder') return 'Kinder, Junior & Coder';
    if (type === 'kinder-junior') return 'Kinder & Junior';
    return '—';
  };

  // Trial Overview Table
  const trialOverview = useMemo(() => {
    if (trialPriorityList.length === 0 || overallClasses.length === 0) return [];

    const FIXED_TRIAL_SLOTS = [
      "1.00 - 2.00 pm",
      "1.30 - 2.30 pm",
      "2.00 - 3.00 pm",
      "2.30 - 3.30 pm",
      "3.00 - 4.00 pm",
      "3.30 - 4.30 pm",
      "4.00 - 5.00 pm",
      "4.30 - 5.30 pm",
      "5.00 - 6.00 pm",
      "5.30 - 6.30 pm"
    ];

    // Filter classes by selected overview branch
    const classesForOverview = overviewBranch === 'all'
      ? overallClasses
      : overallClasses.filter(c => c.branchName === overviewBranch);

    return FIXED_TRIAL_SLOTS.map((timeSlot) => {
      const row = { time: timeSlot };
      DAY_NAMES.forEach((day) => {
        const slotData = { available: [], unavailable: [] };
        trialPriorityList.forEach((p) => {
          // Skip disabled instructors
          if (disabledInstructors.has(p.name)) return;
          // Filter by selected overview branch
          if (overviewBranch !== 'all') {
            if (p.location !== 'All Branches' && p.location !== overviewBranch) return;
          }
          
          let reason = '';
          let isAvailable = true;
          
          if (!p.workingDays.includes(day)) {
            isAvailable = false;
            reason = '(NOT AVAILABLE)';
          } else if (leaveList.some((l) => l.name === p.name && leaveAppliesToDay(l, day))) {
            isAvailable = false;
            reason = 'On Leave';
          } else {
            const busyClass = classesForOverview.find(
              (c) => c.teacher === p.name && c.day === day && doTimeSlotsOverlap(c.time, timeSlot)
            );
            if (busyClass) {
              isAvailable = false;
              const badge = busyClass.branchName ? `[${busyClass.branchName}] ` : '';
              reason = `Teaching ${badge}${busyClass.type || 'class'} (${busyClass.time})`;
            }
          }

          if (isAvailable) {
            slotData.available.push(p);
          } else {
            slotData.unavailable.push({ ...p, reason });
          }
        });
        row[day] = slotData;
      });
      return row;
    });
  }, [trialPriorityList, overallClasses, leaveList, disabledInstructors, overviewBranch]);

  // Student Distribution Overview Table
  const distributionOverview = useMemo(() => {
    if (overallClasses.length === 0) return [];

    const FIXED_TRIAL_SLOTS = [
      "1.00 - 2.00 pm", "1.30 - 2.30 pm", "2.00 - 3.00 pm", "2.30 - 3.30 pm",
      "3.00 - 4.00 pm", "3.30 - 4.30 pm", "4.00 - 5.00 pm", "4.30 - 5.30 pm",
      "5.00 - 6.00 pm", "5.30 - 6.30 pm"
    ];

    // Filter classes by selected distribution branch
    const classesForDist = distBranch === 'all'
      ? overallClasses
      : overallClasses.filter(c => c.branchName === distBranch);

    return FIXED_TRIAL_SLOTS.map((timeSlot) => {
      const row = { time: timeSlot };
      DAY_NAMES.forEach((day) => {
        // Find all classes matching this day & time
        const overlappingClasses = classesForDist.filter(c => 
          c.day === day && doTimeSlotsOverlap(c.time, timeSlot)
        );
        
        // Group by teacher to get student count
        const teacherCounts = {};
        overlappingClasses.forEach(c => {
          if (!teacherCounts[c.teacher]) teacherCounts[c.teacher] = { count: 0, classes: new Set() };
          teacherCounts[c.teacher].count += 1;
          if (c.program) teacherCounts[c.teacher].classes.add(c.program);
        });

        // Convert to array
        const activeTeachers = Object.entries(teacherCounts).map(([teacher, data]) => ({
          name: teacher,
          studentCount: data.count,
          programs: Array.from(data.classes)
        }));

        // Sort by student count descending
        activeTeachers.sort((a, b) => b.studentCount - a.studentCount);

        row[day] = {
          activeCount: activeTeachers.length,
          teachers: activeTeachers
        };
      });
      return row;
    });
  }, [overallClasses, distBranch]);

  const totalPages = Math.ceil(filteredTrialPriorityList.length / PAGE_SIZE);
  const paged = filteredTrialPriorityList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <section className="dashboard-view active">
      <div className="panel trial-priority-panel" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Trial Priority Instructors</h2>
            <span className="subtext">Assign instructors to trial categories</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {selectedRows.size > 0 && (
              <button className="btn btn-sm" onClick={handleBulkRemove} style={{ background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Trash2 size={14} />
                Remove {selectedRows.size} Selected
              </button>
            )}
            <Badge variant="orange">{filteredTrialPriorityList.length} Assigned</Badge>
          </div>
        </div>
        <div className="panel-body trial-body">
          <div className="trial-form">
            <div className="trial-form-row">
              <div className="input-group trial-input-name">
                <label>Instructor Name</label>
                <select value={selectedName} onChange={(e) => handleInstructorSelect(e.target.value)}>
                  <option value="" disabled>Select instructor...</option>
                  {sortedTeachers.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="input-group trial-input-type">
                <label>Specialization</label>
                <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                  <option value="" disabled>Select type...</option>
                  <option value="kinder-junior">Kinder &amp; Junior</option>
                  <option value="junior-coder">Junior &amp; Coder</option>
                </select>
              </div>
              <div className="input-group trial-input-location">
                <label>Location</label>
                <select value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}>
                  <option value="" disabled>Select branch...</option>
                  {branches?.map(b => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                  <option value="All Branches">All Branches</option>
                </select>
              </div>
              <div className="input-group trial-input-status">
                <label>Working Status</label>
                <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
                  <option value="fulltime">Full Time (All Days)</option>
                  <option value="parttime">Part Time (Select Days)</option>
                </select>
              </div>
              <button className="btn btn-primary trial-add-btn" disabled={!canAdd || isAdding} onClick={handleAdd}>
                {isAdding ? 'Adding...' : (editIndex >= 0 ? '+ Update' : '+ Add')}
              </button>
            </div>
            {selectedStatus === 'parttime' && (
              <div className="trial-form-row" style={{ marginTop: '1rem', borderTop: '1px dashed var(--border-color)', paddingTop: '1rem' }}>
                <div className="input-group" style={{ width: '100%' }}>
                  <label>Select Working Days</label>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                    {DAY_NAMES.map((day) => (
                      <label key={day} className="day-checkbox">
                        <input type="checkbox" checked={workingDays.includes(day)} onChange={() => handleDayToggle(day)} />
                        {day}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="trial-legend">
            <div className="trial-legend-item">
              <span className="trial-type-badge type-kinder-junior">Kinder &amp; Junior</span>
              <span className="trial-arrow">→</span>
              <span className="trial-legend-desc">Can trial <strong>Kinder</strong> &amp; <strong>Junior</strong></span>
            </div>
            <div className="trial-legend-item">
              <span className="trial-type-badge type-junior-coder">Junior &amp; Coder</span>
              <span className="trial-arrow">→</span>
              <span className="trial-legend-desc">Can trial <strong>All</strong> (Kinder, Junior &amp; Coder)</span>
            </div>
          </div>

          <div className="trial-table-wrapper">
            <table className="trial-table">
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={paged.length > 0 && paged.every((_, i) => selectedRows.has((page - 1) * PAGE_SIZE + i))}
                      onChange={toggleAllOnPage}
                      title="Select all on this page"
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                  </th>
                  <th>Instructor</th>
                  <th>Specialization</th>
                  <th>Location</th>
                  <th>Trial Capabilities</th>
                  <th>Working Days</th>
                  <th style={{ width: 60, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrialPriorityList.length === 0 ? (
                  <tr><td colSpan="7" className="empty-state-table">No priority instructors assigned yet.</td></tr>
                ) : (
                  paged.map((p, i) => {
                    const actualIndex = (page - 1) * PAGE_SIZE + i;
                    return (
                      <tr key={i} style={{ background: selectedRows.has(actualIndex) ? 'var(--danger-bg)' : undefined }}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={selectedRows.has(actualIndex)}
                            onChange={() => toggleRow(actualIndex)}
                            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                          />
                        </td>
                        <td>{p.name}</td>
                        <td><span className={`trial-type-badge type-${p.type}`}>{p.type === 'kinder-junior' ? 'Kinder & Junior' : 'Junior & Coder'}</span></td>
                        <td>{p.location ? <Badge variant="blue">{p.location}</Badge> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                        <td>{getCapabilities(p.type)}</td>
                        <td>{p.status === 'fulltime' ? 'All Days' : (p.workingDays || []).join(', ')}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn-icon btn-icon-danger" onClick={() => handleRemove(i)} title="Remove">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>

      {/* Trial Overview Table */}
      <div className="panel trial-overview-panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Trial Availability Overview</h2>
            <span className="subtext">Weekly overview of available trial slots</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary, #f1f5f9)', borderRadius: '8px', padding: '0.35rem 0.6rem' }}>
              <button
                onClick={() => {
                  const branchOptions = ['all', ...(branches || []).map(b => b.name)];
                  const currentIdx = branchOptions.indexOf(overviewBranch);
                  const prevIdx = currentIdx <= 0 ? branchOptions.length - 1 : currentIdx - 1;
                  setOverviewBranch(branchOptions[prevIdx]);
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}
                title="Previous branch"
              >
                ‹
              </button>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '110px', textAlign: 'center', color: 'var(--text-primary)' }}>
                {overviewBranch === 'all' ? 'All Branches' : overviewBranch}
              </span>
              <button
                onClick={() => {
                  const branchOptions = ['all', ...(branches || []).map(b => b.name)];
                  const currentIdx = branchOptions.indexOf(overviewBranch);
                  const nextIdx = currentIdx >= branchOptions.length - 1 ? 0 : currentIdx + 1;
                  setOverviewBranch(branchOptions[nextIdx]);
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}
                title="Next branch"
              >
                ›
              </button>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <span className="trial-avail-chip chip-kinder" style={{ fontSize: '0.7rem', gap: '3px' }}>K</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Kinder</span>
              <span className="trial-avail-chip chip-junior" style={{ fontSize: '0.7rem', gap: '3px' }}>J</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Junior</span>
              <span className="trial-avail-chip chip-coder" style={{ fontSize: '0.7rem', gap: '3px' }}>C</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Coder</span>
            </div>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ overflowX: 'auto' }}>
            <table className="trial-overview-table" style={{ width: '100%', textAlign: 'center', borderCollapse: 'collapse', marginTop: '1rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                  <th style={{ padding: 10, textAlign: 'left' }}>Time</th>
                  {DAY_NAMES.map((d) => <th key={d} style={{ padding: 10 }}>{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {overallClasses.length === 0 ? (
                  <tr><td colSpan={DAY_NAMES.length + 1} className="empty-state-table" style={{ padding: '2rem' }}>Click "Sync All Branches" to generate trial overview.</td></tr>
                ) : trialOverview.length === 0 ? (
                  <tr><td colSpan={DAY_NAMES.length + 1} className="empty-state-table" style={{ padding: '2rem' }}>No trial slots available.</td></tr>
                ) : (
                  trialOverview.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: 10, textAlign: 'left', fontWeight: 500 }}>{row.time}</td>
                      {DAY_NAMES.map((day) => (
                        <td key={day} style={{ padding: 10 }}>
                          {row[day].available.length > 0 ? (() => {
                            const avail = row[day].available;
                            const kinderCount = avail.length; // both types can do kinder
                            const juniorCount = avail.length; // both types can do junior
                            const coderCount = avail.filter((p) => p.type === 'junior-coder').length;
                            return (
                              <span 
                                style={{ cursor: 'pointer', display: 'inline-flex', gap: '4px', alignItems: 'center' }}
                                onClick={() => setSelectedSlotData({ day, time: row.time, ...row[day] })}
                              >
                                <span className="trial-avail-chip chip-kinder" title="Kinder available">
                                  {kinderCount}
                                </span>
                                <span className="trial-avail-chip chip-junior" title="Junior available">
                                  {juniorCount}
                                </span>
                                <span className="trial-avail-chip chip-coder" title="Coder available">
                                  {coderCount}
                                </span>
                              </span>
                            );
                          })() : (
                            <span 
                              className="trial-avail-none"
                              style={{ cursor: 'pointer' }}
                              onClick={() => setSelectedSlotData({ day, time: row.time, ...row[day] })}
                            >
                              —
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal */}
      {selectedSlotData && (
        <div className="modal-backdrop" onClick={() => setSelectedSlotData(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content panel" onClick={e => e.stopPropagation()} style={{ width: '90%', maxWidth: '500px', maxHeight: '80vh', overflowY: 'auto', padding: '1.5rem', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Instructor Availability</h3>
              <button className="btn-icon" onClick={() => setSelectedSlotData(null)} style={{ fontSize: '1.5rem', lineHeight: 1 }}>&times;</button>
            </div>
            <p style={{ margin: '0 0 1.5rem 0', color: 'var(--text-secondary)' }}>
              <strong>{selectedSlotData.day}</strong> at <strong>{selectedSlotData.time}</strong>
            </p>
            
            <h4 style={{ color: 'var(--success-color)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Available ({selectedSlotData.available.length})</h4>
            {selectedSlotData.available.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem 0' }}>
                {selectedSlotData.available.map((p, i) => (
                  <li key={i} style={{ padding: '0.75rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      {p.location && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>({p.location})</span>}
                    </div>
                    <Badge variant={p.type === 'kinder-junior' ? 'blue' : 'purple'}>
                      {p.type === 'kinder-junior' ? 'Kinder & Junior' : 'Junior & Coder'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '2rem' }}>No instructors available.</p>
            )}

            <h4 style={{ color: 'var(--danger-color)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Unavailable ({selectedSlotData.unavailable.length})</h4>
            {selectedSlotData.unavailable.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {selectedSlotData.unavailable.map((p, i) => (
                  <li key={i} style={{ padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 500 }}>{p.name}</span>
                        {p.location && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>({p.location})</span>}
                      </div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right', maxWidth: '60%' }}>{p.reason}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>All assigned priority instructors are available.</p>
            )}
          </div>
        </div>
      )}

      {/* Student Distribution Checker */}
      <div className="panel trial-overview-panel" style={{ marginTop: '1.5rem' }}>
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Student Distribution Checker</h2>
            <span className="subtext">View class load and total students per instructor</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary, #f1f5f9)', borderRadius: '8px', padding: '0.35rem 0.6rem' }}>
              <button
                onClick={() => {
                  const branchOptions = ['all', ...(branches || []).map(b => b.name)];
                  const currentIdx = branchOptions.indexOf(distBranch);
                  const prevIdx = currentIdx <= 0 ? branchOptions.length - 1 : currentIdx - 1;
                  setDistBranch(branchOptions[prevIdx]);
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}
                title="Previous branch"
              >
                ‹
              </button>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '110px', textAlign: 'center', color: 'var(--text-primary)' }}>
                {distBranch === 'all' ? 'All Branches' : distBranch}
              </span>
              <button
                onClick={() => {
                  const branchOptions = ['all', ...(branches || []).map(b => b.name)];
                  const currentIdx = branchOptions.indexOf(distBranch);
                  const nextIdx = currentIdx >= branchOptions.length - 1 ? 0 : currentIdx + 1;
                  setDistBranch(branchOptions[nextIdx]);
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}
                title="Next branch"
              >
                ›
              </button>
            </div>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ overflowX: 'auto' }}>
            <table className="trial-overview-table" style={{ width: '100%', textAlign: 'center', borderCollapse: 'collapse', marginTop: '1rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                  <th style={{ padding: 10, textAlign: 'left' }}>Time</th>
                  {DAY_NAMES.map((d) => <th key={d} style={{ padding: 10 }}>{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {overallClasses.length === 0 ? (
                  <tr><td colSpan={DAY_NAMES.length + 1} className="empty-state-table" style={{ padding: '2rem' }}>Click "Sync All Branches" to generate student distribution.</td></tr>
                ) : distributionOverview.length === 0 ? (
                  <tr><td colSpan={DAY_NAMES.length + 1} className="empty-state-table" style={{ padding: '2rem' }}>No classes found.</td></tr>
                ) : (
                  distributionOverview.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: 10, textAlign: 'left', fontWeight: 500 }}>{row.time}</td>
                      {DAY_NAMES.map((day) => (
                        <td key={day} style={{ padding: 10 }}>
                          {row[day].activeCount > 0 ? (
                            <span 
                              style={{ 
                                cursor: 'pointer', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                background: 'var(--primary-light, #eff6ff)',
                                color: 'var(--primary-dark, #1e3a8a)',
                                padding: '4px 8px',
                                borderRadius: '12px',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                border: '1px solid var(--primary-border, #bfdbfe)'
                              }}
                              onClick={() => setDistModalData({ day, time: row.time, teachers: row[day].teachers })}
                              title="Click to see student counts"
                            >
                              {row[day].activeCount} Class{row[day].activeCount !== 1 && 'es'}
                            </span>
                          ) : (
                            <span 
                              className="trial-avail-none"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              —
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Student Distribution Modal */}
      {distModalData && (
        <div className="modal-backdrop" onClick={() => setDistModalData(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content panel" onClick={e => e.stopPropagation()} style={{ width: '90%', maxWidth: '500px', maxHeight: '80vh', overflowY: 'auto', padding: '1.5rem', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Student Distribution</h3>
              <button className="btn-icon" onClick={() => setDistModalData(null)} style={{ fontSize: '1.5rem', lineHeight: 1 }}>&times;</button>
            </div>
            <p style={{ margin: '0 0 1.5rem 0', color: 'var(--text-secondary)' }}>
              <strong>{distModalData.day}</strong> at <strong>{distModalData.time}</strong>
            </p>
            
            <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              Active Classes ({distModalData.teachers.length})
            </h4>
            
            {distModalData.teachers.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem 0' }}>
                {distModalData.teachers.map((t, i) => (
                  <li key={i} style={{ padding: '0.75rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>{t.name}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.programs.join(', ')}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Badge variant={t.studentCount >= 6 ? 'danger' : t.studentCount >= 4 ? 'warning' : 'success'}>
                        {t.studentCount} student{t.studentCount > 1 ? 's' : ''}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>No classes active.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
