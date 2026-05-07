'use client';

import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { doTimeSlotsOverlap, parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';
import Badge from '../components/ui/Badge';
import Pagination from '../components/ui/Pagination';
import { Trash2 } from 'lucide-react';

const PAGE_SIZE = 8;

export default function TrialPriorityPage() {
  const {
    uniqueBaseTeachers, trialPriorityList, updateTrialPriorityList,
    allClasses, uniqueTimes, allTimeSlots, leaveList,
    disabledInstructors,
  } = useSchedule();
  const [selectedName, setSelectedName] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('fulltime');
  const [workingDays, setWorkingDays] = useState([]);
  const [editIndex, setEditIndex] = useState(-1);
  const [page, setPage] = useState(1);
  const [selectedSlotData, setSelectedSlotData] = useState(null);

  const sortedTeachers = [...uniqueBaseTeachers].filter((t) => !disabledInstructors.has(t)).sort();
  const totalPages = Math.ceil(trialPriorityList.length / PAGE_SIZE);
  const paged = trialPriorityList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const canAdd = selectedName && selectedType;

  const handleAdd = () => {
    if (!canAdd) return;
    const days = selectedStatus === 'fulltime' ? DAY_NAMES : workingDays;
    const entry = { name: selectedName, type: selectedType, status: selectedStatus, workingDays: days };

    let newList;
    if (editIndex >= 0) {
      newList = [...trialPriorityList];
      newList[editIndex] = entry;
      setEditIndex(-1);
    } else {
      const exists = trialPriorityList.some((p) => p.name === selectedName);
      if (exists) { alert(`${selectedName} is already in the priority list.`); return; }
      newList = [...trialPriorityList, entry];
    }
    updateTrialPriorityList(newList);
    setSelectedName(''); setSelectedType(''); setSelectedStatus('fulltime'); setWorkingDays([]);
  };

  const handleRemove = (index) => {
    const actualIndex = (page - 1) * PAGE_SIZE + index;
    updateTrialPriorityList(trialPriorityList.filter((_, i) => i !== actualIndex));
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
    if (trialPriorityList.length === 0 || allClasses.length === 0) return [];

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

    return FIXED_TRIAL_SLOTS.map((timeSlot) => {
      const row = { time: timeSlot };
      DAY_NAMES.forEach((day) => {
        const slotData = { available: [], unavailable: [] };
        trialPriorityList.forEach((p) => {
          // Skip disabled instructors
          if (disabledInstructors.has(p.name)) return;
          let reason = '';
          let isAvailable = true;
          
          if (!p.workingDays.includes(day)) {
            isAvailable = false;
            reason = 'Not working on this day';
          } else if (leaveList.some((l) => l.name === p.name && l.day === day)) {
            isAvailable = false;
            reason = 'On Leave';
          } else {
            const busyClass = allClasses.find(
              (c) => c.teacher === p.name && c.day === day && doTimeSlotsOverlap(c.time, timeSlot)
            );
            if (busyClass) {
              isAvailable = false;
              reason = `Teaching ${busyClass.type || 'class'} (${busyClass.time})`;
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
  }, [trialPriorityList, allClasses, leaveList, disabledInstructors]);

  return (
    <section className="dashboard-view active">
      <div className="panel trial-priority-panel" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <div className="panel-header-left">
            <h2>Trial Priority Instructors</h2>
            <span className="subtext">Assign instructors to trial categories</span>
          </div>
          <Badge variant="orange">{trialPriorityList.length} Assigned</Badge>
        </div>
        <div className="panel-body trial-body">
          <div className="trial-form">
            <div className="trial-form-row">
              <div className="input-group trial-input-name">
                <label>Instructor Name</label>
                <select value={selectedName} onChange={(e) => setSelectedName(e.target.value)}>
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
              <div className="input-group trial-input-status">
                <label>Working Status</label>
                <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
                  <option value="fulltime">Full Time (All Days)</option>
                  <option value="parttime">Part Time (Select Days)</option>
                </select>
              </div>
              <button className="btn btn-primary trial-add-btn" disabled={!canAdd} onClick={handleAdd}>
                + {editIndex >= 0 ? 'Update' : 'Add'}
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
                  <th>Instructor</th>
                  <th>Specialization</th>
                  <th>Trial Capabilities</th>
                  <th>Working Days</th>
                  <th style={{ width: 60, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {trialPriorityList.length === 0 ? (
                  <tr><td colSpan="5" className="empty-state-table">No priority instructors assigned yet.</td></tr>
                ) : (
                  paged.map((p, i) => (
                    <tr key={i}>
                      <td>{p.name}</td>
                      <td><span className={`trial-type-badge type-${p.type}`}>{p.type === 'kinder-junior' ? 'Kinder & Junior' : 'Junior & Coder'}</span></td>
                      <td>{getCapabilities(p.type)}</td>
                      <td>{p.status === 'fulltime' ? 'All Days' : (p.workingDays || []).join(', ')}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn-icon btn-icon-danger" onClick={() => handleRemove(i)} title="Remove">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
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
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span className="trial-avail-chip chip-kinder" style={{ fontSize: '0.7rem', gap: '3px' }}>K</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Kinder</span>
            <span className="trial-avail-chip chip-junior" style={{ fontSize: '0.7rem', gap: '3px' }}>J</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Junior</span>
            <span className="trial-avail-chip chip-coder" style={{ fontSize: '0.7rem', gap: '3px' }}>C</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Coder</span>
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
                {trialOverview.length === 0 ? (
                  <tr><td colSpan="8" className="empty-state-table" style={{ padding: '2rem' }}>Sync the schedule to generate trial overview.</td></tr>
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
                    <span style={{ fontWeight: 500 }}>{p.name}</span>
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
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
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
    </section>
  );
}
