'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { 
  subscribeToInternalClasses, 
  createInternalClass, 
  updateInternalClass, 
  deleteInternalClass 
} from '../services/internalScheduleService';
import { DAY_NAMES, SCHEDULE_PAGE_SIZE, getWorkingDaysForBranch } from '../utils/constants';
import Pagination from '../components/ui/Pagination';
import { Plus, Pencil, Trash2, Search, X, Calendar, MapPin, User, BookOpen, Clock, AlertTriangle } from 'lucide-react';

// Common lesson time slots offered as one-tap presets in the Quick Add sidebar.
const TIME_PRESETS = [
  '09.00 - 10.00 am',
  '10.00 - 11.00 am',
  '11.00 - 12.00 pm',
  '1.00 - 2.00 pm',
  '2.00 - 3.00 pm',
  '3.00 - 4.00 pm',
  '4.00 - 5.00 pm',
  '5.00 - 6.00 pm',
  '6.00 - 7.00 pm',
];

export default function NewSchedulePage() {
  const { uniqueTeachers, enabledBranches, branches, instructorProfiles } = useSchedule();
  const { showToast } = useToast();

  // State
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [search, setSearch] = useState('');
  const [filterDay, setFilterDay] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterInstructor, setFilterInstructor] = useState('all');
  const [filterClassType, setFilterClassType] = useState('all');
  const [page, setPage] = useState(1);

  // Quick Add sidebar state — day → active branches → time → prefilled add.
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const [sideDay, setSideDay] = useState(DAY_NAMES.includes(todayName) ? todayName : 'Monday');
  const [sideBranch, setSideBranch] = useState('');
  const [sideTime, setSideTime] = useState('');

  // Modal/Form State
  const [showModal, setShowModal] = useState(false);
  const [editingClass, setEditingClass] = useState(null);
  
  const [form, setForm] = useState({
    day: 'Monday',
    time: '',
    program: '',
    teacher: '',
    student: '',
    branchName: '',
    classType: 'Regular',
    remarks: ''
  });

  const [formErrors, setFormErrors] = useState({});

  // Subscribe to real-time updates from Firestore
  useEffect(() => {
    const unsubscribe = subscribeToInternalClasses((data) => {
      setClasses(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const sortedTeachers = [...new Set([...uniqueTeachers, ...(instructorProfiles || []).map(p => p.fullname || p.nickname)])].filter(Boolean).sort();
  const branchList = [...new Set([...(enabledBranches || []).map(b => b.name), ...(branches || []).map(b => b.name)])].filter(Boolean);

  // Filters & Search
  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return classes.filter((c) => {
      if (filterDay !== 'all' && c.day !== filterDay) return false;
      if (filterBranch !== 'all' && c.branchName !== filterBranch) return false;
      if (filterInstructor !== 'all' && c.teacher !== filterInstructor) return false;
      const type = c.classType || 'Regular';
      if (filterClassType !== 'all' && type !== filterClassType) return false;
      if (s) {
        const match =
          (c.teacher && c.teacher.toLowerCase().includes(s)) ||
          (c.student && c.student.toLowerCase().includes(s)) ||
          (c.program && c.program.toLowerCase().includes(s)) ||
          (c.remarks && c.remarks.toLowerCase().includes(s)) ||
          (type.toLowerCase().includes(s));
        if (!match) return false;
      }
      return true;
    });
  }, [classes, search, filterDay, filterBranch, filterInstructor, filterClassType]);

  // Sort classes by day order and then time
  const dayOrder = {
    'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6, 'Sunday': 7
  };

  const sortedFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const orderA = dayOrder[a.day] || 99;
      const orderB = dayOrder[b.day] || 99;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.time || '').localeCompare(String(b.time || ''));
    });
  }, [filtered]);

  const totalPages = Math.ceil(sortedFiltered.length / SCHEDULE_PAGE_SIZE);
  const paged = sortedFiltered.slice((page - 1) * SCHEDULE_PAGE_SIZE, page * SCHEDULE_PAGE_SIZE);

  const openAddModal = () => {
    setEditingClass(null);
    setForm({
      day: 'Monday',
      time: '',
      program: '',
      teacher: sortedTeachers[0] || '',
      student: '',
      branchName: branchList[0] || '',
      classType: 'Regular',
      remarks: ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  const openEditModal = (c) => {
    setEditingClass(c);
    setForm({
      day: c.day || 'Monday',
      time: c.time || '',
      program: c.program || '',
      teacher: c.teacher || '',
      student: c.student || '',
      branchName: c.branchName || '',
      classType: c.classType || 'Regular',
      remarks: c.remarks || ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  // Branches that are operational (open) on the currently selected sidebar day.
  const branchesActiveOn = (day) =>
    branchList.filter((name) =>
      getWorkingDaysForBranch(name === 'All Branches' ? 'default' : name).includes(day)
    );
  const activeBranchesForDay = branchesActiveOn(sideDay);

  // Pick a day in the sidebar: sync the table filter and drop the selected
  // branch if it isn't open on the new day.
  const handleSideDay = (day) => {
    setSideDay(day);
    setFilterDay(day);
    setPage(1);
    if (sideBranch && !branchesActiveOn(day).includes(sideBranch)) {
      setSideBranch('');
      setFilterBranch('all');
    }
  };

  // Pick an active branch: focus the table on that day + branch so the list
  // shows what's already scheduled for that operational slot.
  const handleSideBranch = (name) => {
    const next = sideBranch === name ? '' : name;
    setSideBranch(next);
    setFilterBranch(next || 'all');
    setFilterDay(next ? sideDay : filterDay);
    setPage(1);
  };

  // Open the Add modal prefilled from the sidebar selections.
  const openQuickAdd = () => {
    if (!sideBranch) {
      showToast({ title: 'Pick an active branch first', variant: 'warning' });
      return;
    }
    setEditingClass(null);
    setForm({
      day: sideDay,
      time: sideTime,
      program: '',
      teacher: sortedTeachers[0] || '',
      student: '',
      branchName: sideBranch,
      classType: 'Regular',
      remarks: ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  const validateForm = () => {
    const errors = {};
    if (!form.time.trim()) errors.time = 'Time slot is required';
    if (!form.program.trim()) errors.program = 'Program/Lesson detail is required';
    if (!form.teacher) errors.teacher = 'Instructor is required';
    if (!form.student.trim()) errors.student = 'Student name is required';
    if (!form.branchName) errors.branchName = 'Branch is required';
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (editingClass) {
        await updateInternalClass(editingClass.id, form);
        showToast({ title: 'Class updated successfully', variant: 'success' });
      } else {
        await createInternalClass(form);
        showToast({ title: 'Class added successfully', variant: 'success' });
      }
      setShowModal(false);
    } catch (err) {
      console.error('Error saving class:', err);
      showToast({ title: 'Failed to save class', variant: 'error' });
    }
  };

  const handleDelete = async (classId, studentName) => {
    if (!window.confirm(`Delete the class for student "${studentName}"?`)) return;
    try {
      await deleteInternalClass(classId);
      showToast({ title: 'Class deleted successfully', variant: 'success' });
      // Reset page if it becomes empty
      if (paged.length === 1 && page > 1) {
        setPage(page - 1);
      }
    } catch (err) {
      console.error('Error deleting class:', err);
      showToast({ title: 'Failed to delete class', variant: 'error' });
    }
  };

  return (
    <section className="dashboard-view active">
      <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: '1.5rem', alignItems: 'start' }}>

        {/* Quick Add Sidebar — operational schedule by day & branch */}
        <div className="panel" style={{ margin: 0, position: 'sticky', top: '1rem' }}>
          <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.15rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Plus size={16} /> Quick Add
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Pick a day, an open branch, and a time.
            </span>
          </div>

          <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>

            {/* Day picker */}
            <div>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.5rem' }}>Day</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {DAY_NAMES.map((day) => (
                  <button
                    key={day}
                    onClick={() => handleSideDay(day)}
                    style={{
                      padding: '0.3rem 0.55rem', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer',
                      border: sideDay === day ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                      background: sideDay === day ? 'var(--primary-blue-light)' : 'transparent',
                      fontWeight: sideDay === day ? 600 : 400,
                      color: sideDay === day ? 'var(--primary-blue)' : 'var(--text-secondary)',
                    }}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>

            {/* Active branches for the selected day */}
            <div>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.5rem' }}>
                Open on {sideDay}
              </label>
              {activeBranchesForDay.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>No branches operate on {sideDay}.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {activeBranchesForDay.map((name) => (
                    <button
                      key={name}
                      onClick={() => handleSideBranch(name)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.45rem', width: '100%', textAlign: 'left',
                        padding: '0.45rem 0.6rem', borderRadius: '8px', fontSize: '0.82rem', cursor: 'pointer',
                        border: sideBranch === name ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                        background: sideBranch === name ? 'var(--primary-blue-light)' : 'transparent',
                        color: sideBranch === name ? 'var(--primary-blue)' : 'var(--text-main)',
                        fontWeight: sideBranch === name ? 600 : 400,
                      }}
                    >
                      <MapPin size={13} style={{ flexShrink: 0 }} /> {name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Time picker */}
            <div>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.5rem' }}>Time</label>
              <input
                type="text"
                placeholder="e.g. 1.00 - 2.00 pm"
                value={sideTime}
                onChange={(e) => setSideTime(e.target.value)}
                style={{ width: '100%', marginBottom: '0.5rem' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {TIME_PRESETS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setSideTime(t)}
                    title={t}
                    style={{
                      padding: '0.2rem 0.45rem', borderRadius: '5px', fontSize: '0.68rem', cursor: 'pointer',
                      border: sideTime === t ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                      background: sideTime === t ? 'var(--primary-blue-light)' : 'transparent',
                      color: sideTime === t ? 'var(--primary-blue)' : 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.replace(/\s/g, '')}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={openQuickAdd}
              disabled={!sideBranch}
              className="btn btn-primary"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                borderRadius: '10px', padding: '0.55rem', fontSize: '0.85rem',
                opacity: sideBranch ? 1 : 0.55, cursor: sideBranch ? 'pointer' : 'not-allowed',
              }}
            >
              <Plus size={16} /> Add to {sideBranch || 'schedule'}
            </button>
          </div>
        </div>

      <div className="panel full-schedule-panel">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Internal Operations Schedule</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Manage and view active classes directly inside the application.
            </p>
          </div>
          
          <button 
            onClick={openAddModal} 
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
          >
            <Plus size={16} /> Add Class
          </button>
        </div>

        {/* Filter Toolbar */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', background: 'var(--bg-color)' }}>
          <div className="input-group" style={{ margin: 0, flex: '1 1 200px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Search</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search student, teacher, class..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ paddingLeft: '2rem', width: '100%' }}
              />
            </div>
          </div>
          
          <div className="input-group" style={{ margin: 0, width: '150px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Branch</label>
            <select
              value={filterBranch}
              onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Branches</option>
              {branchList.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '160px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Instructor</label>
            <select
              value={filterInstructor}
              onChange={(e) => { setFilterInstructor(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Instructors</option>
              {sortedTeachers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '140px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Class Type</label>
            <select
              value={filterClassType}
              onChange={(e) => { setFilterClassType(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Types</option>
              <option value="Regular">Regular Class</option>
              <option value="Trial">Trial Class</option>
            </select>
          </div>
        </div>

        {/* Day Tabs */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <button
            onClick={() => { setFilterDay('all'); setPage(1); }}
            style={{
              padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
              border: filterDay === 'all' ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
              background: filterDay === 'all' ? 'var(--primary-blue-light)' : 'transparent',
              fontWeight: filterDay === 'all' ? 600 : 400,
              color: filterDay === 'all' ? 'var(--primary-blue)' : 'var(--text-secondary)',
              transition: 'all 0.2s'
            }}
          >
            All Days
          </button>
          {DAY_NAMES.map(day => (
            <button
              key={day}
              onClick={() => { setFilterDay(day); setPage(1); }}
              style={{
                padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
                border: filterDay === day ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                background: filterDay === day ? 'var(--primary-blue-light)' : 'transparent',
                fontWeight: filterDay === day ? 600 : 400,
                color: filterDay === day ? 'var(--primary-blue)' : 'var(--text-secondary)',
                transition: 'all 0.2s'
              }}
            >
              {day}
            </button>
          ))}
        </div>

        {/* Main Table */}
        <div className="panel-body table-wrapper" style={{ position: 'relative' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
              <div className="loading-spinner" style={{ marginBottom: '1rem' }} />
              <p>Fetching schedule from Firestore...</p>
            </div>
          ) : (
            <table id="schedule-table">
              <thead>
                <tr>
                  <th style={{ width: '120px' }}>Day</th>
                  <th style={{ width: '140px' }}>Time</th>
                  <th style={{ width: '150px' }}>Program / Lesson</th>
                  <th style={{ width: '120px' }}>Class Type</th>
                  <th>Student Name</th>
                  <th style={{ width: '180px' }}>Instructor</th>
                  <th style={{ width: '140px' }}>Branch</th>
                  <th>Remarks</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {classes.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <AlertTriangle size={32} style={{ color: 'var(--warning)', marginBottom: '0.5rem' }} />
                      <div style={{ fontWeight: 600 }}>No Classes Configured</div>
                      <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>Click "Add Class" to populate your website schedule.</div>
                    </td>
                  </tr>
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <div style={{ fontWeight: 600 }}>No results match your filters.</div>
                    </td>
                  </tr>
                ) : (
                  paged.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
                          {c.day}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Clock size={13} style={{ color: 'var(--text-muted)' }} />
                          {c.time}
                        </span>
                      </td>
                      <td>
                        <span style={{ 
                          background: c.program.toLowerCase().includes('trial') ? 'var(--primary-orange-light)' : 'var(--primary-blue-light)',
                          color: c.program.toLowerCase().includes('trial') ? 'var(--primary-orange)' : 'var(--primary-blue)',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}>
                          <BookOpen size={11} />
                          {c.program}
                        </span>
                      </td>
                      <td>
                        <span style={{ 
                          background: (c.classType || 'Regular') === 'Trial' ? 'rgba(249, 115, 22, 0.08)' : 'rgba(95, 61, 196, 0.08)',
                          border: (c.classType || 'Regular') === 'Trial' ? '1px solid rgba(249, 115, 22, 0.2)' : '1px solid rgba(95, 61, 196, 0.2)',
                          color: (c.classType || 'Regular') === 'Trial' ? '#ea580c' : '#5f3dc4',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}>
                          {(c.classType || 'Regular')}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <User size={13} style={{ color: 'var(--text-muted)' }} />
                          {c.student}
                        </span>
                      </td>
                      <td style={{ fontWeight: 500 }}>{c.teacher}</td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                          <MapPin size={13} style={{ color: 'var(--text-muted)' }} />
                          {c.branchName}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{c.remarks || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                          <button 
                            onClick={() => openEditModal(c)}
                            title="Edit Class"
                            style={{
                              background: 'transparent', border: '1px solid var(--border-color)', cursor: 'pointer',
                              padding: '0.3rem', borderRadius: '6px', color: 'var(--text-secondary)', display: 'flex'
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button 
                            onClick={() => handleDelete(c.id, c.student)}
                            title="Delete Class"
                            style={{
                              background: 'transparent', border: '1px solid var(--danger-border)', cursor: 'pointer',
                              padding: '0.3rem', borderRadius: '6px', color: 'var(--danger)', display: 'flex'
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
          {!loading && totalPages > 1 && (
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      </div>

      </div>

      {/* Add / Edit Class Modal */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: 'var(--panel-bg)',
            width: '100%',
            maxWidth: '500px',
            maxHeight: '92vh',
            borderRadius: '16px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
            animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
          }}>
            {/* Header */}
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-color)'
            }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                {editingClass ? 'Edit Operational Class' : 'Add Operational Class'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: '0.25rem', borderRadius: '4px', display: 'flex'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Form Content */}
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                
                {/* Branch and Day Row */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Branch *</label>
                    <select
                      value={form.branchName}
                      onChange={(e) => setForm({ ...form, branchName: e.target.value })}
                      className={`modal-select-field ${formErrors.branchName ? 'error' : ''}`}
                    >
                      <option value="">Select Branch</option>
                      {branchList.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                    {formErrors.branchName && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.branchName}</span>}
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Day *</label>
                    <select
                      value={form.day}
                      onChange={(e) => setForm({ ...form, day: e.target.value })}
                      className="modal-select-field"
                    >
                      {DAY_NAMES.map(day => <option key={day} value={day}>{day}</option>)}
                    </select>
                  </div>
                </div>

                {/* Time and Program Row */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Time Slot *</label>
                    <input
                      type="text"
                      placeholder="e.g. 1.00 - 2.00 pm"
                      value={form.time}
                      onChange={(e) => setForm({ ...form, time: e.target.value })}
                      className={`modal-input-field ${formErrors.time ? 'error' : ''}`}
                    />
                    {formErrors.time && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.time}</span>}
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Program / Lesson *</label>
                    <input
                      type="text"
                      placeholder="e.g. Trial Kinder, KF1.5"
                      value={form.program}
                      onChange={(e) => setForm({ ...form, program: e.target.value })}
                      className={`modal-input-field ${formErrors.program ? 'error' : ''}`}
                    />
                    {formErrors.program && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.program}</span>}
                  </div>
                </div>

                {/* Student and Instructor Row */}
                <div>
                  <label className="modal-form-label">Student Name(s) *</label>
                  <input
                    type="text"
                    placeholder="Type student name..."
                    value={form.student}
                    onChange={(e) => setForm({ ...form, student: e.target.value })}
                    className={`modal-input-field ${formErrors.student ? 'error' : ''}`}
                  />
                  {formErrors.student && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.student}</span>}
                </div>

                <div>
                  <label className="modal-form-label">Instructor *</label>
                  <select
                    value={form.teacher}
                    onChange={(e) => setForm({ ...form, teacher: e.target.value })}
                    className={`modal-select-field ${formErrors.teacher ? 'error' : ''}`}
                  >
                    <option value="">Select Instructor</option>
                    {sortedTeachers.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {formErrors.teacher && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.teacher}</span>}
                </div>

                <div>
                  <label className="modal-form-label">Class Type *</label>
                  <select
                    value={form.classType || 'Regular'}
                    onChange={(e) => setForm({ ...form, classType: e.target.value })}
                    className="modal-select-field"
                  >
                    <option value="Regular">Regular Class</option>
                    <option value="Trial">Trial Class</option>
                  </select>
                </div>

                {/* Remarks */}
                <div>
                  <label className="modal-form-label">Remarks / Notes</label>
                  <textarea
                    placeholder="Enter any additional details..."
                    value={form.remarks}
                    onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                    className="modal-textarea-field"
                  />
                </div>
              </div>

              {/* Actions Footer */}
              <div style={{
                padding: '1rem 1.5rem',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                background: 'var(--bg-color)'
              }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn"
                  style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ borderRadius: '10px', padding: '0.5rem 1.5rem', fontSize: '0.85rem' }}
                >
                  Save Class
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal animation style */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes modalAppear {
          from { opacity: 0; transform: scale(0.96) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}} />
    </section>
  );
}
