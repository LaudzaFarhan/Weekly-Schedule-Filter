'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import {
  subscribeToInternalMeetings,
  createInternalMeeting,
  updateInternalMeeting,
  deleteInternalMeeting,
  predictTeacherConflicts
} from '../services/internalMeetingService';
import { getAllInternalInstructors } from '../services/internalInstructorService';
import { subscribeToInternalClasses } from '../services/internalScheduleService';
import {
  Calendar, Clock, MapPin, Users, Plus, Pencil, Trash2, CheckCircle2,
  AlertTriangle, XCircle, Search, Video, UserCheck, Check, AlertCircle, HelpCircle, X, ExternalLink, CheckSquare, Square, ChevronDown
} from 'lucide-react';
import Pagination from '../components/ui/Pagination';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_TIME_SLOTS = [
  '10.30-12.00pm',
  '11.00-12.30pm',
  '01.00-02.30pm',
  '02.30-04.00pm',
  '03.00-04.30pm',
  '04.30-06.00pm',
  '05.00-06.30pm'
];

function getDayFromDate(dateString) {
  if (!dateString) return 'Monday';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return 'Monday';
  return DAYS_OF_WEEK[d.getDay()];
}

function buildGoogleCalendarUrl(meeting, instructorsList = []) {
  if (!meeting) return '';
  const title = encodeURIComponent(meeting.title || 'Staff Meeting');
  const details = encodeURIComponent(
    `Meeting Agenda: ${meeting.agenda || 'N/A'}\nBranch: ${meeting.branchName || 'All Branches'}\nLocation: ${meeting.location || 'N/A'}`
  );
  const location = encodeURIComponent(meeting.location || 'Google Meet');

  const dateStr = (meeting.meetingDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  let startHour = 13, startMin = 0, endHour = 14, endMin = 30;

  if (meeting.time) {
    const parts = meeting.time.split('-').map(s => s.trim());
    if (parts.length === 2) {
      const parseSingle = (str) => {
        const isPM = /pm/i.test(str);
        const numbers = str.replace(/[a-z]/gi, '').trim().split('.').map(n => parseInt(n, 10));
        let h = numbers[0] || 12;
        const m = numbers[1] || 0;
        if (isPM && h < 12) h += 12;
        if (!isPM && h === 12) h = 0;
        return { h, m };
      };
      const s = parseSingle(parts[0]);
      const e = parseSingle(parts[1]);
      startHour = s.h; startMin = s.m;
      endHour = e.h; endMin = e.m;
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const startIso = `${dateStr}T${pad(startHour)}${pad(startMin)}00`;
  const endIso = `${dateStr}T${pad(endHour)}${pad(endMin)}00`;

  const invitedNames = (meeting.invitedTeachers || []).map(t => (typeof t === 'string' ? t : t.name).toLowerCase());
  const emails = instructorsList
    .filter(i => invitedNames.includes(String(i.name).toLowerCase()))
    .map(i => i.email || `${i.name.toLowerCase().replace(/\s+/g, '')}@thelab.id`);

  const guestsParam = emails.length > 0 ? `&add=${encodeURIComponent(emails.join(','))}` : '';

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startIso}/${endIso}&details=${details}&location=${location}${guestsParam}`;
}

const MEETINGS_PAGE_SIZE = 4;

/**
 * Custom Animated Dropdown Pill Component for Sidebar Filter
 */
function CustomWidgetDropdown({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value) || options[0];

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.45rem',
          padding: '0.35rem 0.85rem',
          borderRadius: '20px',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-color)',
          color: 'var(--text-main)',
          fontSize: '0.78rem',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: open ? '0 0 0 3px rgba(79,70,229,0.15), 0 2px 6px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.04)',
          outline: 'none',
          whiteSpace: 'nowrap'
        }}
      >
        <span>{selectedOption?.label}</span>
        <ChevronDown
          size={14}
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            color: 'var(--primary-blue)',
            flexShrink: 0
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 100,
            minWidth: '150px',
            background: 'var(--panel-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: '14px',
            boxShadow: '0 12px 30px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
            padding: '0.4rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.2rem',
            animation: 'fadeInDown 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          {options.map(opt => {
            const isSelected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justify: 'space-between',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: isSelected ? 'rgba(79,70,229,0.08)' : 'transparent',
                  color: isSelected ? 'var(--primary-blue)' : 'var(--text-main)',
                  fontSize: '0.78rem',
                  fontWeight: isSelected ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>{opt.label}</span>
                {isSelected && <Check size={13} style={{ color: 'var(--primary-blue)', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Custom Time Slot Input with Animated Popup Menu for Active & Standard Slots
 */
function CustomTimeSlotSelect({ value, onChange, activeSlots, day }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="e.g. 10.30-12.00pm or 01.00-02.30pm"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          className="modal-input-field"
          style={{ paddingRight: '2.2rem', width: '100%' }}
          required
        />
        <button
          type="button"
          onClick={() => setOpen(prev => !prev)}
          style={{
            position: 'absolute',
            right: '0.5rem',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '0.2rem',
            display: 'flex',
            alignItems: 'center',
            color: 'var(--primary-blue)'
          }}
        >
          <ChevronDown
            size={16}
            style={{
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          />
        </button>
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 99,
            maxHeight: '260px',
            overflowY: 'auto',
            background: 'var(--panel-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            boxShadow: '0 12px 30px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.05)',
            padding: '0.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            animation: 'fadeInDown 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          {/* Active schedule time slots section */}
          {activeSlots && activeSlots.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary-blue)', padding: '0.25rem 0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Clock size={12} /> Active Class Slots on {day}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                {activeSlots.map(slot => (
                  <button
                    key={`active-${slot}`}
                    type="button"
                    onClick={() => {
                      onChange(slot);
                      setOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justify: 'space-between',
                      padding: '0.45rem 0.75rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: value === slot ? 'rgba(79,70,229,0.1)' : 'transparent',
                      color: value === slot ? 'var(--primary-blue)' : 'var(--text-main)',
                      fontSize: '0.8rem',
                      fontWeight: value === slot ? 700 : 500,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <span>⚡ {slot}</span>
                    {value === slot && <Check size={13} style={{ color: 'var(--primary-blue)' }} />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Standard Presets Section */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', padding: '0.25rem 0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Standard Presets (Inc. 10.30am Weekday Start)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {DEFAULT_TIME_SLOTS.map(slot => (
                <button
                  key={`preset-${slot}`}
                  type="button"
                  onClick={() => {
                    onChange(slot);
                    setOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justify: 'space-between',
                    padding: '0.45rem 0.75rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: value === slot ? 'rgba(79,70,229,0.1)' : 'transparent',
                    color: value === slot ? 'var(--primary-blue)' : 'var(--text-main)',
                    fontSize: '0.8rem',
                    fontWeight: value === slot ? 700 : 500,
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <span>{slot}</span>
                  {value === slot && <Check size={13} style={{ color: 'var(--primary-blue)' }} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewMeetingsPage() {
  const { enabledBranches, branches } = useSchedule();
  const { showToast } = useToast();

  const [meetings, setMeetings] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [widgetView, setWidgetView] = useState('upcoming');
  const [page, setPage] = useState(1);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(null);
  const [editingMeeting, setEditingMeeting] = useState(null);

  // Form State
  const [form, setForm] = useState({
    title: '',
    meetingDate: new Date().toISOString().slice(0, 10),
    day: getDayFromDate(new Date().toISOString().slice(0, 10)),
    time: '01.00-02.30pm',
    branchName: 'All Branches',
    location: 'Meeting Room 1',
    agenda: '',
    invitedTeachers: [],
    status: 'Scheduled'
  });

  const [conflictPredictions, setConflictPredictions] = useState([]);
  const [predicting, setPredicting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const rawBranchList = [...new Set([...(enabledBranches || []).map(b => b.name), ...(branches || []).map(b => b.name)])].filter(Boolean);
  const branchList = ['All Branches', ...rawBranchList.filter(b => b !== 'All Branches')];
  const defaultBranch = 'All Branches';

  // Load initial data & subscribe to real-time meetings and classes
  useEffect(() => {
    const unsubMeetings = subscribeToInternalMeetings((data) => {
      setMeetings(data || []);
      setLoading(false);
    });

    const unsubClasses = subscribeToInternalClasses((data) => {
      setClasses(data || []);
    });

    getAllInternalInstructors().then((data) => {
      setInstructors(data || []);
    }).catch(err => console.error(err));

    return () => {
      unsubMeetings();
      unsubClasses();
    };
  }, []);

  // Compute active schedule time slots on the selected day (e.g. Thursday)
  const activeSlotsOnDay = useMemo(() => {
    if (!form.day || !Array.isArray(classes)) return [];
    const targetDay = form.day.toLowerCase().trim();
    const dayClasses = classes.filter(c => String(c.day || '').toLowerCase().trim() === targetDay && c.time);
    const uniqueTimes = [...new Set(dayClasses.map(c => String(c.time).trim()))].filter(Boolean);
    return uniqueTimes.sort();
  }, [form.day, classes]);

  // Update conflict prediction when Date, Time, or Branch changes in form
  useEffect(() => {
    if (!showCreateModal) return;

    let isMounted = true;
    setPredicting(true);

    const teacherNames = instructors.map(inst => inst.name);
    predictTeacherConflicts({
      day: form.day,
      meetingDate: form.meetingDate,
      time: form.time,
      branchName: form.branchName,
      teacherNames
    }).then(res => {
      if (isMounted) {
        setConflictPredictions(res.predictions || []);
        setPredicting(false);
      }
    }).catch(err => {
      console.error(err);
      if (isMounted) setPredicting(false);
    });

    return () => { isMounted = false; };
  }, [form.meetingDate, form.day, form.time, form.branchName, instructors, showCreateModal]);

  const handleDateChange = (newDate) => {
    const day = getDayFromDate(newDate);
    setForm(prev => ({ ...prev, meetingDate: newDate, day }));
  };

  const openCreateModal = () => {
    setEditingMeeting(null);
    const initialDate = new Date().toISOString().slice(0, 10);
    const initialDay = getDayFromDate(initialDate);
    setForm({
      title: '',
      meetingDate: initialDate,
      day: initialDay,
      time: '01.00-02.30pm',
      branchName: defaultBranch,
      location: 'Meeting Room 1',
      agenda: '',
      invitedTeachers: [],
      status: 'Scheduled'
    });
    setShowCreateModal(true);
  };

  const openEditModal = (meeting) => {
    setEditingMeeting(meeting);
    setForm({
      title: meeting.title || '',
      meetingDate: meeting.meetingDate || new Date().toISOString().slice(0, 10),
      day: meeting.day || getDayFromDate(meeting.meetingDate),
      time: meeting.time || '01.00-02.30pm',
      branchName: meeting.branchName || defaultBranch,
      location: meeting.location || '',
      agenda: meeting.agenda || '',
      invitedTeachers: Array.isArray(meeting.invitedTeachers) ? meeting.invitedTeachers : [],
      status: meeting.status || 'Scheduled'
    });
    setShowCreateModal(true);
  };

  const toggleTeacherInvite = (teacherName) => {
    setForm(prev => {
      const current = prev.invitedTeachers || [];
      const exists = current.find(t => (typeof t === 'string' ? t : t.name) === teacherName);

      if (exists) {
        return {
          ...prev,
          invitedTeachers: current.filter(t => (typeof t === 'string' ? t : t.name) !== teacherName)
        };
      } else {
        return {
          ...prev,
          invitedTeachers: [...current, { name: teacherName, attendanceStatus: 'Invited' }]
        };
      }
    });
  };

  const handleSelectAllTeachers = () => {
    const allNames = conflictPredictions.map(p => p.name);
    const currentInvited = (form.invitedTeachers || []).map(t => (typeof t === 'string' ? t : t.name));
    const isAllSelected = allNames.length > 0 && allNames.every(n => currentInvited.includes(n));

    if (isAllSelected) {
      setForm(prev => ({ ...prev, invitedTeachers: [] }));
    } else {
      setForm(prev => ({
        ...prev,
        invitedTeachers: allNames.map(name => ({ name, attendanceStatus: 'Invited' }))
      }));
    }
  };

  const handleSelectAvailableTeachersOnly = () => {
    const availableNames = conflictPredictions.filter(p => p.available).map(p => p.name);
    setForm(prev => ({
      ...prev,
      invitedTeachers: availableNames.map(name => ({ name, attendanceStatus: 'Invited' }))
    }));
  };

  const handleSaveMeeting = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.meetingDate || !form.time) {
      showToast({ title: 'Please fill in meeting title, date, and time slot', variant: 'error' });
      return;
    }

    setSubmitting(true);
    try {
      if (editingMeeting) {
        await updateInternalMeeting(editingMeeting.id, form);
        showToast({ title: 'Meeting updated successfully', variant: 'success' });
      } else {
        await createInternalMeeting(form);
        showToast({ title: 'Meeting scheduled successfully', variant: 'success' });
      }
      setShowCreateModal(false);
    } catch (err) {
      console.error(err);
      showToast({ title: 'Failed to save meeting', variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMeeting = async (meetingId, title) => {
    if (!window.confirm(`Are you sure you want to delete meeting "${title}"?`)) return;
    try {
      await deleteInternalMeeting(meetingId);
      showToast({ title: 'Meeting deleted successfully', variant: 'success' });
    } catch (err) {
      console.error(err);
      showToast({ title: 'Failed to delete meeting', variant: 'error' });
    }
  };

  const handleUpdateAttendance = async (meetingId, teacherName, newStatus) => {
    const meeting = meetings.find(m => m.id === meetingId);
    if (!meeting) return;

    const currentInvited = Array.isArray(meeting.invitedTeachers) ? meeting.invitedTeachers : [];
    const updatedInvited = currentInvited.map(t => {
      const name = typeof t === 'string' ? t : t.name;
      if (name.toLowerCase() === teacherName.toLowerCase()) {
        return typeof t === 'string'
          ? { name, attendanceStatus: newStatus }
          : { ...t, attendanceStatus: newStatus };
      }
      return t;
    });

    try {
      await updateInternalMeeting(meetingId, { invitedTeachers: updatedInvited });
      showToast({ title: `Updated ${teacherName}'s attendance to ${newStatus}`, variant: 'success' });
      if (showAttendanceModal?.id === meetingId) {
        setShowAttendanceModal({ ...showAttendanceModal, invitedTeachers: updatedInvited });
      }
    } catch (err) {
      console.error(err);
      showToast({ title: 'Failed to update attendance', variant: 'error' });
    }
  };

  // Filtered Meetings for Main Grid
  const filtered = useMemo(() => {
    return meetings.filter(m => {
      if (filterBranch !== 'all' && m.branchName !== filterBranch) return false;
      if (filterStatus !== 'all' && m.status !== filterStatus) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const titleMatch = m.title?.toLowerCase().includes(q);
        const locMatch = m.location?.toLowerCase().includes(q);
        const agendaMatch = m.agenda?.toLowerCase().includes(q);
        const teacherMatch = (m.invitedTeachers || []).some(t => (typeof t === 'string' ? t : t.name).toLowerCase().includes(q));
        if (!titleMatch && !locMatch && !agendaMatch && !teacherMatch) return false;
      }
      return true;
    });
  }, [meetings, filterBranch, filterStatus, search]);

  // Sidebar Agenda Widget Meetings List (Upcoming / Completed / All)
  const widgetMeetings = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    let list = [...meetings];

    if (widgetView === 'upcoming') {
      list = list.filter(m => (m.meetingDate >= todayStr || m.status === 'Scheduled') && m.status !== 'Cancelled');
      list.sort((a, b) => String(a.meetingDate || '').localeCompare(String(b.meetingDate || '')));
    } else if (widgetView === 'completed') {
      list = list.filter(m => m.status === 'Completed' || m.meetingDate < todayStr);
      list.sort((a, b) => String(b.meetingDate || '').localeCompare(String(a.meetingDate || '')));
    } else {
      list.sort((a, b) => String(b.meetingDate || '').localeCompare(String(a.meetingDate || '')));
    }
    return list.slice(0, 6);
  }, [meetings, widgetView]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / MEETINGS_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedMeetings = filtered.slice((safePage - 1) * MEETINGS_PAGE_SIZE, safePage * MEETINGS_PAGE_SIZE);

  const allNames = conflictPredictions.map(p => p.name);
  const currentInvited = (form.invitedTeachers || []).map(t => (typeof t === 'string' ? t : t.name));
  const isAllSelected = allNames.length > 0 && allNames.every(n => currentInvited.includes(n));

  const widgetDropdownOptions = [
    { value: 'upcoming', label: 'Upcoming' },
    { value: 'completed', label: 'Completed' },
    { value: 'all', label: 'All History' }
  ];

  return (
    <div className="dashboard-container" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header Bar */}
      <div className="panel" style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Video size={24} style={{ color: 'var(--primary-blue, #4f46e5)' }} />
            Meetings & Staff Attendance
          </h1>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Schedule teacher meetings, sync Google Calendar invites, manage attendance, and predict teaching schedule conflicts automatically.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="btn btn-primary"
          style={{ borderRadius: '10px', padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600 }}
        >
          <Plus size={16} /> Schedule New Meeting
        </button>
      </div>

      {/* Main Split Layout: Left 2-Card Grid + Right Upcoming Agenda Widget */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* LEFT COLUMN: Search, Filters, 2-Column Cards Grid, Pagination */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Filter & Search Controls */}
          <div className="panel" style={{ padding: '1rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search title, location, agenda..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="modal-input-field"
                style={{ paddingLeft: '2.4rem' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <select
                value={filterBranch}
                onChange={e => { setFilterBranch(e.target.value); setPage(1); }}
                className="modal-select-field"
                style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
              >
                <option value="all">All Branches</option>
                {branchList.filter(b => b !== 'All Branches').map(b => <option key={b} value={b}>{b}</option>)}
              </select>

              <select
                value={filterStatus}
                onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
                className="modal-select-field"
                style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
              >
                <option value="all">All Status</option>
                <option value="Scheduled">Scheduled</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Meetings Grid (Constrained to max 2 cards per row) */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
              <div className="loading-spinner" style={{ marginBottom: '1rem' }} />
              <p>Loading meetings schedule...</p>
            </div>
          ) : pagedMeetings.length === 0 ? (
            <div className="panel" style={{ textAlign: 'center', padding: '3.5rem 2rem', color: 'var(--text-muted)' }}>
              <Calendar size={40} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
              <h3 style={{ margin: 0, fontWeight: 600 }}>No Meetings Found</h3>
              <p style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
                {meetings.length === 0 ? 'Click "Schedule New Meeting" to organize your first meeting.' : 'No meetings match your filter criteria.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem' }}>
              {pagedMeetings.map(m => {
                const invited = Array.isArray(m.invitedTeachers) ? m.invitedTeachers : [];
                const presentCount = invited.filter(t => (typeof t === 'object' && t.attendanceStatus === 'Present')).length;
                const gCalUrl = buildGoogleCalendarUrl(m, instructors);

                return (
                  <div
                    key={m.id}
                    className="panel"
                    style={{
                      padding: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                      borderRadius: '14px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--panel-bg)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    }}
                  >
                    {/* Status & Branch Tag */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        background: m.status === 'Completed' ? 'rgba(16,185,129,0.1)' : m.status === 'Cancelled' ? 'rgba(239,68,68,0.1)' : 'rgba(79,70,229,0.1)',
                        color: m.status === 'Completed' ? 'var(--success)' : m.status === 'Cancelled' ? 'var(--danger)' : 'var(--primary-blue)'
                      }}>
                        {m.status}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <MapPin size={13} /> {m.branchName}
                      </span>
                    </div>

                    {/* Title */}
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        {m.title}
                      </h3>
                      {m.location && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.15rem' }}>
                          📍 {m.location}
                        </span>
                      )}
                    </div>

                    {/* Date & Time */}
                    <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-color)', padding: '0.55rem 0.75rem', borderRadius: '8px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Calendar size={13} style={{ color: 'var(--primary-blue)' }} />
                        {m.day?.slice(0, 3)}, {m.meetingDate}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Clock size={13} style={{ color: 'var(--primary-blue)' }} />
                        {m.time}
                      </span>
                    </div>

                    {/* Agenda */}
                    {m.agenda && (
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {m.agenda}
                      </p>
                    )}

                    {/* Attendees Summary & Actions */}
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Users size={14} style={{ color: 'var(--primary-blue)' }} />
                          {invited.length} Teacher{invited.length === 1 ? '' : 's'} Invited
                        </span>
                        {m.status === 'Completed' && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--success)', fontWeight: 600 }}>
                            {presentCount} Present
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <a
                          href={gCalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Add to Google Calendar & invite all teachers"
                          style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)', color: '#2563eb', padding: '0.3rem 0.55rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <Calendar size={12} /> Google Calendar
                        </a>
                        <button
                          onClick={() => setShowAttendanceModal(m)}
                          title="Manage Attendance"
                          style={{ background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(79,70,229,0.2)', color: 'var(--primary-blue)', padding: '0.3rem 0.55rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <UserCheck size={12} /> Attendance
                        </button>
                        <button
                          onClick={() => openEditModal(m)}
                          title="Edit Meeting"
                          style={{ background: 'transparent', border: '1px solid var(--border-color)', padding: '0.3rem', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDeleteMeeting(m.id, m.title)}
                          title="Delete Meeting"
                          style={{ background: 'transparent', border: '1px solid var(--border-color)', padding: '0.3rem', borderRadius: '6px', color: 'var(--danger)', cursor: 'pointer', display: 'flex' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}

          {!loading && totalPages > 1 && (
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>

        {/* RIGHT COLUMN: UPCOMING MEETINGS & HISTORY AGENDA WIDGET */}
        <div className="panel" style={{ padding: '1.25rem', borderRadius: '14px', border: '1px solid var(--border-color)', background: 'var(--panel-bg)', display: 'flex', flexDirection: 'column', gap: '1rem', position: 'sticky', top: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-main)' }}>
              <Calendar size={16} style={{ color: 'var(--primary-blue)' }} />
              {widgetView === 'upcoming' ? 'Upcoming Meetings' : widgetView === 'completed' ? 'Completed Meetings' : 'Meeting History'}
            </h3>

            {/* Custom Animated Pill Dropdown */}
            <CustomWidgetDropdown
              value={widgetView}
              onChange={setWidgetView}
              options={widgetDropdownOptions}
            />
          </div>

          {widgetMeetings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              No {widgetView} meetings found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {widgetMeetings.map(m => {
                const invited = Array.isArray(m.invitedTeachers) ? m.invitedTeachers : [];
                const gCalUrl = buildGoogleCalendarUrl(m, instructors);

                return (
                  <div
                    key={m.id}
                    style={{
                      padding: '0.85rem',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main)' }}>{m.title}</span>
                      <span style={{
                        padding: '0.1rem 0.45rem',
                        borderRadius: '4px',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        background: m.status === 'Completed' ? 'rgba(16,185,129,0.1)' : 'rgba(79,70,229,0.1)',
                        color: m.status === 'Completed' ? 'var(--success)' : 'var(--primary-blue)'
                      }}>
                        {m.status}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                      <span>📅 {m.day?.slice(0, 3)}, {m.meetingDate}</span>
                      <span>⏰ {m.time}</span>
                    </div>

                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem', paddingTop: '0.35rem', borderTop: '1px dotted var(--border-color)' }}>
                      <span>👥 {invited.length} Teachers</span>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <a
                          href={gCalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open Google Calendar"
                          style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600, fontSize: '0.72rem' }}
                        >
                          Google Cal
                        </a>
                        <span>·</span>
                        <button
                          onClick={() => setShowAttendanceModal(m)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--primary-blue)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: '0.72rem' }}
                        >
                          Attendance
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* CREATE / EDIT MEETING MODAL WITH CONFLICT PREDICTION */}
      {showCreateModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
          <div style={{ background: 'var(--panel-bg)', width: '100%', maxWidth: '780px', maxHeight: '92vh', borderRadius: '16px', boxShadow: '0 12px 32px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
            
            {/* Modal Header */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Video size={20} style={{ color: 'var(--primary-blue)' }} />
                  {editingMeeting ? 'Edit Meeting' : 'Schedule New Meeting'}
                </h2>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Invite teachers with automatic schedule collision prediction & Google Calendar integration.
                </p>
              </div>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleSaveMeeting} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                
                {/* Title */}
                <div>
                  <label className="modal-form-label">Meeting Title *</label>
                  <input
                    type="text"
                    placeholder="e.g. Weekly Operations & Curriculum Review"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    className="modal-input-field"
                    required
                  />
                </div>

                {/* Date, Time, Branch Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
                  <div>
                    <label className="modal-form-label">Meeting Date *</label>
                    <input
                      type="date"
                      value={form.meetingDate}
                      onChange={e => handleDateChange(e.target.value)}
                      className="modal-input-field"
                      required
                    />
                    <span style={{ fontSize: '0.72rem', color: 'var(--primary-blue)', marginTop: '0.2rem', display: 'block', fontWeight: 600 }}>
                      Day: {form.day}
                    </span>
                  </div>

                  {/* Flexible Time Slot Input with Animated Popup Dropdown */}
                  <div>
                    <label className="modal-form-label">Time Slot *</label>
                    <CustomTimeSlotSelect
                      value={form.time}
                      onChange={val => setForm({ ...form, time: val })}
                      activeSlots={activeSlotsOnDay}
                      day={form.day}
                    />
                  </div>

                  <div>
                    <label className="modal-form-label">Branch *</label>
                    <select
                      value={form.branchName}
                      onChange={e => setForm({ ...form, branchName: e.target.value })}
                      className="modal-select-field"
                    >
                      {branchList.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="modal-form-label">Status</label>
                    <select
                      value={form.status}
                      onChange={e => setForm({ ...form, status: e.target.value })}
                      className="modal-select-field"
                    >
                      <option value="Scheduled">Scheduled</option>
                      <option value="Completed">Completed</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                {/* Location & Agenda */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label className="modal-form-label" style={{ margin: 0 }}>Location / Link</label>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, location: 'https://meet.google.com/new' })}
                        style={{ fontSize: '0.72rem', color: 'var(--primary-blue)', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                      >
                        + Google Meet Link
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. Meeting Room A or https://meet.google.com/..."
                      value={form.location}
                      onChange={e => setForm({ ...form, location: e.target.value })}
                      className="modal-input-field"
                      style={{ marginTop: '0.3rem' }}
                    />
                  </div>
                  <div>
                    <label className="modal-form-label">Agenda / Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Discuss term evaluation & class handovers"
                      value={form.agenda}
                      onChange={e => setForm({ ...form, agenda: e.target.value })}
                      className="modal-input-field"
                    />
                  </div>
                </div>

                {/* TEACHER INVITES WITH PREDICTIVE CONFLICT ANALYSIS & SELECT ALL TRIGGER */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <label className="modal-form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Users size={16} style={{ color: 'var(--primary-blue)' }} />
                      Teacher Invites & Schedule Conflict Prediction
                    </label>

                    {/* SELECT ALL / DESELECT ALL TRIGGER BUTTONS */}
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={handleSelectAllTeachers}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', cursor: 'pointer', fontWeight: 600, color: 'var(--text-main)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                      >
                        {isAllSelected ? <CheckSquare size={13} style={{ color: 'var(--primary-blue)' }} /> : <Square size={13} />}
                        {isAllSelected ? 'Deselect All' : 'Select All'}
                      </button>
                      <button
                        type="button"
                        onClick={handleSelectAvailableTeachersOnly}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.08)', color: 'var(--success)', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                      >
                        <Check size={13} /> Select Available Only
                      </button>
                    </div>
                  </div>

                  <div style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden', maxHeight: '220px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                      <thead style={{ background: 'var(--bg-color)', position: 'sticky', top: 0, zIndex: 1, borderBottom: '1px solid var(--border-color)' }}>
                        <tr>
                          <th style={{ padding: '0.5rem 0.75rem', width: '40px' }}>
                            <input
                              type="checkbox"
                              checked={isAllSelected}
                              onChange={handleSelectAllTeachers}
                              style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                              title="Select / Deselect All Teachers"
                            />
                          </th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>Teacher Name</th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>Predicted Status</th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>Schedule Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conflictPredictions.length === 0 ? (
                          <tr>
                            <td colSpan="4" style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                              Loading teacher availability...
                            </td>
                          </tr>
                        ) : (
                          conflictPredictions.map(pred => {
                            const isInvited = (form.invitedTeachers || []).some(t => (typeof t === 'string' ? t : t.name) === pred.name);

                            return (
                              <tr key={pred.name} style={{ borderBottom: '1px solid var(--border-color)', background: isInvited ? 'rgba(79,70,229,0.03)' : 'transparent' }}>
                                <td style={{ padding: '0.45rem 0.75rem', textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    checked={isInvited}
                                    onChange={() => toggleTeacherInvite(pred.name)}
                                    style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                                  />
                                </td>
                                <td style={{ padding: '0.45rem 0.75rem', fontWeight: 600 }}>
                                  {pred.name}
                                </td>
                                <td style={{ padding: '0.45rem 0.75rem' }}>
                                  <span style={{
                                    padding: '0.15rem 0.5rem',
                                    borderRadius: '6px',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                    background: pred.status === 'available' ? 'rgba(16,185,129,0.1)' : pred.status === 'busy_class' ? 'rgba(239,68,68,0.1)' : pred.status === 'branch_off' ? 'rgba(100,116,139,0.12)' : 'rgba(245,158,11,0.12)',
                                    color: pred.status === 'available' ? 'var(--success)' : pred.status === 'busy_class' ? 'var(--danger)' : pred.status === 'branch_off' ? '#475569' : '#b45309'
                                  }}>
                                    {pred.status === 'available' ? <Check size={11} /> : pred.status === 'busy_class' ? <AlertCircle size={11} /> : <AlertTriangle size={11} />}
                                    {pred.badgeText}
                                  </span>
                                </td>
                                <td style={{ padding: '0.45rem 0.75rem', color: pred.available ? 'var(--text-muted)' : 'var(--danger)', fontSize: '0.74rem' }}>
                                  {pred.details}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

              {/* Modal Footer */}
              <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)', flexWrap: 'wrap', gap: '0.75rem' }}>
                <a
                  href={buildGoogleCalendarUrl(form, instructors)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '0.82rem', fontWeight: 600, color: '#2563eb', background: 'rgba(59,130,246,0.08)', padding: '0.5rem 1rem', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <Calendar size={15} /> Preview in Google Calendar
                </a>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    disabled={submitting}
                    className="btn"
                    style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary"
                    style={{ borderRadius: '10px', padding: '0.5rem 1.5rem', fontSize: '0.85rem' }}
                  >
                    {submitting ? 'Saving...' : editingMeeting ? 'Update Meeting' : 'Schedule Meeting'}
                  </button>
                </div>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* ATTENDANCE TRACKER MODAL */}
      {showAttendanceModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
          <div style={{ background: 'var(--panel-bg)', width: '100%', maxWidth: '640px', maxHeight: '90vh', borderRadius: '16px', boxShadow: '0 12px 32px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
            
            {/* Header */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <UserCheck size={20} style={{ color: 'var(--primary-blue)' }} />
                  Meeting Attendance Tracker
                </h2>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {showAttendanceModal.title} ({showAttendanceModal.meetingDate})
                </p>
              </div>
              <button onClick={() => setShowAttendanceModal(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {/* Attendance List */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {(!showAttendanceModal.invitedTeachers || showAttendanceModal.invitedTeachers.length === 0) ? (
                <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                  No teachers were invited to this meeting.
                </div>
              ) : (
                showAttendanceModal.invitedTeachers.map((t) => {
                  const teacherName = typeof t === 'string' ? t : t.name;
                  const status = (typeof t === 'object' && t.attendanceStatus) ? t.attendanceStatus : 'Invited';

                  return (
                    <div key={teacherName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-color)' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{teacherName}</span>

                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        {['Present', 'Late', 'Absent', 'Excused'].map(st => {
                          const isActive = status === st;
                          return (
                            <button
                              key={st}
                              onClick={() => handleUpdateAttendance(showAttendanceModal.id, teacherName, st)}
                              style={{
                                padding: '0.3rem 0.65rem',
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                border: isActive ? '1px solid transparent' : '1px solid var(--border-color)',
                                background: isActive
                                  ? st === 'Present' ? 'var(--success)' : st === 'Late' ? '#f59e0b' : st === 'Absent' ? 'var(--danger)' : '#64748b'
                                  : 'transparent',
                                color: isActive ? '#fff' : 'var(--text-secondary)'
                              }}
                            >
                              {st}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <a
                href={buildGoogleCalendarUrl(showAttendanceModal, instructors)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '0.8rem', fontWeight: 600, color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <ExternalLink size={14} /> Open in Google Calendar
              </a>

              <button
                onClick={() => setShowAttendanceModal(null)}
                className="btn btn-primary"
                style={{ borderRadius: '10px', padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
              >
                Done
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
