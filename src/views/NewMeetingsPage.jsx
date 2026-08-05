'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import {
  Calendar, Clock, MapPin, Users, Plus, Pencil, Trash2, CheckCircle2,
  AlertTriangle, XCircle, Search, Video, UserCheck, Check, AlertCircle, HelpCircle, X
} from 'lucide-react';
import Pagination from '../components/ui/Pagination';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_TIME_SLOTS = [
  '09.30-11.00am',
  '10.00-11.30am',
  '11.00-12.30pm',
  '01.00-02.30pm',
  '02.30-04.00pm',
  '03.00-04.30pm',
  '04.30-06.00pm'
];

function getDayFromDate(dateString) {
  if (!dateString) return 'Monday';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return 'Monday';
  return DAYS_OF_WEEK[d.getDay()];
}

const MEETINGS_PAGE_SIZE = 6;

export default function NewMeetingsPage() {
  const { enabledBranches, branches } = useSchedule();
  const { showToast } = useToast();

  const [meetings, setMeetings] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
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
    branchName: 'Bekasi',
    location: 'Meeting Room 1',
    agenda: '',
    invitedTeachers: [],
    status: 'Scheduled'
  });

  const [conflictPredictions, setConflictPredictions] = useState([]);
  const [predicting, setPredicting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const branchList = [...new Set([...(enabledBranches || []).map(b => b.name), ...(branches || []).map(b => b.name)])].filter(Boolean);
  const defaultBranch = branchList[0] || 'Bekasi';

  // Load initial data & subscribe to real-time meetings
  useEffect(() => {
    const unsub = subscribeToInternalMeetings((data) => {
      setMeetings(data || []);
      setLoading(false);
    });

    getAllInternalInstructors().then((data) => {
      setInstructors(data || []);
    }).catch(err => console.error(err));

    return () => unsub();
  }, []);

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
    setForm({
      title: '',
      meetingDate: new Date().toISOString().slice(0, 10),
      day: getDayFromDate(new Date().toISOString().slice(0, 10)),
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

  // Filtered Meetings
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / MEETINGS_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedMeetings = filtered.slice((safePage - 1) * MEETINGS_PAGE_SIZE, safePage * MEETINGS_PAGE_SIZE);

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
            Schedule teacher meetings, manage attendance, and predict teaching schedule conflicts automatically.
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

      {/* Filter & Search Controls */}
      <div className="panel" style={{ padding: '1rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search meeting title, location, agenda or teacher..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="modal-input-field"
            style={{ paddingLeft: '2.4rem' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <select
              value={filterBranch}
              onChange={e => { setFilterBranch(e.target.value); setPage(1); }}
              className="modal-select-field"
              style={{ padding: '0.5rem 0.8rem', fontSize: '0.82rem' }}
            >
              <option value="all">All Branches</option>
              {branchList.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div>
            <select
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
              className="modal-select-field"
              style={{ padding: '0.5rem 0.8rem', fontSize: '0.82rem' }}
            >
              <option value="all">All Status</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Meetings Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
          <div className="loading-spinner" style={{ marginBottom: '1rem' }} />
          <p>Loading meetings schedule...</p>
        </div>
      ) : pagedMeetings.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)' }}>
          <Calendar size={40} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <h3 style={{ margin: 0, fontWeight: 600 }}>No Meetings Found</h3>
          <p style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
            {meetings.length === 0 ? 'Click "Schedule New Meeting" to organize your first meeting.' : 'No meetings match your filter criteria.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.25rem' }}>
          {pagedMeetings.map(m => {
            const invited = Array.isArray(m.invitedTeachers) ? m.invitedTeachers : [];
            const presentCount = invited.filter(t => (typeof t === 'object' && t.attendanceStatus === 'Present')).length;

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
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', background: 'var(--bg-color)', padding: '0.6rem 0.8rem', borderRadius: '8px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Calendar size={14} style={{ color: 'var(--primary-blue)' }} />
                    {m.day}, {m.meetingDate}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Clock size={14} style={{ color: 'var(--primary-blue)' }} />
                    {m.time}
                  </span>
                </div>

                {/* Agenda */}
                {m.agenda && (
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {m.agenda}
                  </p>
                )}

                {/* Attendees Summary */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
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
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      onClick={() => setShowAttendanceModal(m)}
                      title="Manage Attendance"
                      style={{ background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(79,70,229,0.2)', color: 'var(--primary-blue)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <UserCheck size={13} /> Attendance
                    </button>
                    <button
                      onClick={() => openEditModal(m)}
                      title="Edit Meeting"
                      style={{ background: 'transparent', border: '1px solid var(--border-color)', padding: '0.35rem', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteMeeting(m.id, m.title)}
                      title="Delete Meeting"
                      style={{ background: 'transparent', border: '1px solid var(--border-color)', padding: '0.35rem', borderRadius: '6px', color: 'var(--danger)', cursor: 'pointer', display: 'flex' }}
                    >
                      <Trash2 size={14} />
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
                  Invite teachers with automatic schedule collision prediction.
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

                  <div>
                    <label className="modal-form-label">Time Slot *</label>
                    <select
                      value={form.time}
                      onChange={e => setForm({ ...form, time: e.target.value })}
                      className="modal-select-field"
                    >
                      {DEFAULT_TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
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
                    <label className="modal-form-label">Location / Link</label>
                    <input
                      type="text"
                      placeholder="e.g. Meeting Room A or Google Meet link"
                      value={form.location}
                      onChange={e => setForm({ ...form, location: e.target.value })}
                      className="modal-input-field"
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

                {/* TEACHER INVITES WITH PREDICTIVE CONFLICT ANALYSIS */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label className="modal-form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Users size={16} style={{ color: 'var(--primary-blue)' }} />
                      Teacher Invites & Schedule Conflict Prediction
                    </label>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {predicting ? 'Analyzing schedules...' : `Selected ${(form.invitedTeachers || []).length} / ${conflictPredictions.length}`}
                    </span>
                  </div>

                  <div style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden', maxHeight: '220px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                      <thead style={{ background: 'var(--bg-color)', sticky: 'top', borderBottom: '1px solid var(--border-color)' }}>
                        <tr>
                          <th style={{ padding: '0.5rem 0.75rem', width: '40px' }}>Invite</th>
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
                                    background: pred.status === 'available' ? 'rgba(16,185,129,0.1)' : pred.status === 'busy_class' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.12)',
                                    color: pred.status === 'available' ? 'var(--success)' : pred.status === 'busy_class' ? 'var(--danger)' : '#b45309'
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
              <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', background: 'var(--bg-color)' }}>
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
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-color)' }}>
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
