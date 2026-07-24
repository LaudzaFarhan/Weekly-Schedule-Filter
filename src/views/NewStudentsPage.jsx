'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { 
  subscribeToInternalStudents, 
  createInternalStudent, 
  updateInternalStudent, 
  deleteInternalStudent 
} from '../services/internalStudentService';
import Pagination from '../components/ui/Pagination';
import { Plus, Pencil, Trash2, Search, X, MapPin, User, GraduationCap, Phone, CheckCircle, HelpCircle, AlertTriangle } from 'lucide-react';

const STUDENT_LEVELS = [
  'Kinder Foundation',
  'Kinder Core',
  'Junior Foundation',
  'Junior Core',
  'Coder Basic 1',
  'Coder Basic 2',
  'Coder Intermediate 1',
  'Coder Intermediate 2',
  'Coder Advance 1',
  'Coder Advance 2',
  'Coder Advance 3'
];

const STUDENTS_PAGE_SIZE = 15;

// Per-student branch assignment history (localStorage). Keyed by student id.
const BRANCH_HISTORY_KEY = 'newOpsStudentBranchHistory';
function readBranchHistoryStore() {
  try { return JSON.parse(localStorage.getItem(BRANCH_HISTORY_KEY) || '{}'); } catch { return {}; }
}
function getStudentBranchHistory(id) {
  if (!id) return [];
  const store = readBranchHistoryStore();
  return Array.isArray(store[id]) ? store[id] : [];
}
function appendStudentBranchHistory(id, branch) {
  if (!id || !branch) return getStudentBranchHistory(id);
  const store = readBranchHistoryStore();
  const list = Array.isArray(store[id]) ? store[id] : [];
  if (list.length && list[list.length - 1].branch === branch) return list; // unchanged
  const next = [...list, { branch, at: new Date().toISOString() }];
  store[id] = next;
  try { localStorage.setItem(BRANCH_HISTORY_KEY, JSON.stringify(store)); } catch { /* ignore */ }
  return next;
}

export default function NewStudentsPage() {
  const { enabledBranches, branches } = useSchedule();
  const { showToast } = useToast();

  // State
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);

  // Modal/Form State
  const [showModal, setShowModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [branchHistory, setBranchHistory] = useState([]);
  
  const [form, setForm] = useState({
    name: '',
    level: STUDENT_LEVELS[0],
    branchName: '',
    parentName: '',
    contact: '',
    status: 'Active',
    remarks: ''
  });

  const [formErrors, setFormErrors] = useState({});

  // Subscribe to real-time updates from Firestore
  useEffect(() => {
    const unsubscribe = subscribeToInternalStudents((data) => {
      setStudents(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const branchList = [...new Set([...(enabledBranches || []).map(b => b.name), ...(branches || []).map(b => b.name)])].filter(Boolean);

  // Filters & Search
  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return students.filter((st) => {
      if (filterLevel !== 'all' && st.level !== filterLevel) return false;
      if (filterBranch !== 'all' && st.branchName !== filterBranch) return false;
      if (filterStatus !== 'all' && st.status !== filterStatus) return false;
      if (s) {
        const match =
          (st.name && st.name.toLowerCase().includes(s)) ||
          (st.parentName && st.parentName.toLowerCase().includes(s)) ||
          (st.contact && st.contact.toLowerCase().includes(s)) ||
          (st.remarks && st.remarks.toLowerCase().includes(s));
        if (!match) return false;
      }
      return true;
    });
  }, [students, search, filterLevel, filterBranch, filterStatus]);

  const sortedFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [filtered]);

  const totalPages = Math.ceil(sortedFiltered.length / STUDENTS_PAGE_SIZE);
  const paged = sortedFiltered.slice((page - 1) * STUDENTS_PAGE_SIZE, page * STUDENTS_PAGE_SIZE);

  const openAddModal = () => {
    setEditingStudent(null);
    setBranchHistory([]);
    setForm({
      name: '',
      level: STUDENT_LEVELS[0],
      branchName: branchList[0] || '',
      parentName: '',
      contact: '',
      status: 'Active',
      remarks: ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  const openEditModal = (st) => {
    setEditingStudent(st);
    // Load branch history; seed with the current branch if none recorded yet.
    let hist = getStudentBranchHistory(st.id);
    if (hist.length === 0 && st.branchName) {
      hist = appendStudentBranchHistory(st.id, st.branchName);
    }
    setBranchHistory(hist);
    setForm({
      name: st.name || '',
      level: st.level || STUDENT_LEVELS[0],
      branchName: st.branchName || '',
      parentName: st.parentName || '',
      contact: st.contact || '',
      status: st.status || 'Active',
      remarks: st.remarks || ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  const validateForm = () => {
    const errors = {};
    if (!form.name.trim()) errors.name = 'Student Name is required';
    if (!form.level) errors.level = 'Student Level is required';
    if (!form.branchName) errors.branchName = 'Branch selection is required';
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (editingStudent) {
        await updateInternalStudent(editingStudent.id, form);
        // Record a branch-history entry when the branch changes.
        if (form.branchName && form.branchName !== editingStudent.branchName) {
          setBranchHistory(appendStudentBranchHistory(editingStudent.id, form.branchName));
        }
        showToast({ title: 'Student updated successfully', variant: 'success' });
      } else {
        const created = await createInternalStudent(form);
        if (created?.id && form.branchName) {
          appendStudentBranchHistory(created.id, form.branchName);
        }
        showToast({ title: 'Student added successfully', variant: 'success' });
      }
      setShowModal(false);
    } catch (err) {
      console.error('Error saving student:', err);
      showToast({ title: 'Failed to save student', variant: 'error' });
    }
  };

  const handleDelete = async (studentId, studentName) => {
    if (!window.confirm(`Are you sure you want to delete student "${studentName}"?`)) return;
    try {
      await deleteInternalStudent(studentId);
      showToast({ title: 'Student deleted successfully', variant: 'success' });
      if (paged.length === 1 && page > 1) {
        setPage(page - 1);
      }
    } catch (err) {
      console.error('Error deleting student:', err);
      showToast({ title: 'Failed to delete student', variant: 'error' });
    }
  };

  // Helper function to get level badge styles
  const getLevelBadgeStyles = (level = '') => {
    const isKinder = level.toLowerCase().includes('kinder');
    const isJunior = level.toLowerCase().includes('junior');
    const isCoder = level.toLowerCase().includes('coder');

    if (isKinder) {
      return {
        background: 'var(--primary-orange-light, rgba(249, 115, 22, 0.12))',
        color: 'var(--primary-orange, #f97316)'
      };
    }
    if (isJunior) {
      return {
        background: 'var(--primary-blue-light, rgba(59, 130, 246, 0.12))',
        color: 'var(--primary-blue, #3b82f6)'
      };
    }
    if (isCoder) {
      return {
        background: 'rgba(16, 185, 129, 0.12)',
        color: '#10b981'
      };
    }
    return {
      background: 'var(--border-color)',
      color: 'var(--text-secondary)'
    };
  };

  return (
    <section className="dashboard-view active">
      <div className="panel full-schedule-panel">
        {/* Panel Header */}
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Student Database</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Add, update, and sort student records for all academic levels.
            </p>
          </div>
          
          <button 
            onClick={openAddModal} 
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
          >
            <Plus size={16} /> Add Student
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
                placeholder="Search name, contact, parent name..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ paddingLeft: '2rem', width: '100%' }}
              />
            </div>
          </div>
          
          <div className="input-group" style={{ margin: 0, width: '180px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Level / Program</label>
            <select
              value={filterLevel}
              onChange={(e) => { setFilterLevel(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Levels</option>
              {STUDENT_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
            </select>
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

          <div className="input-group" style={{ margin: 0, width: '130px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Status</label>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>

        {/* Main Student List Table */}
        <div className="panel-body table-wrapper" style={{ position: 'relative' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
              <div className="loading-spinner" style={{ marginBottom: '1rem' }} />
              <p>Fetching student profiles from Firestore...</p>
            </div>
          ) : (
            <table id="schedule-table">
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th style={{ width: '220px' }}>Level / Program</th>
                  <th style={{ width: '150px' }}>Branch</th>
                  <th style={{ width: '220px' }}>Parent Contact</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Status</th>
                  <th>Remarks</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <AlertTriangle size={32} style={{ color: 'var(--warning)', marginBottom: '0.5rem' }} />
                      <div style={{ fontWeight: 600 }}>No Students Registered</div>
                      <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>Click "Add Student" to create your first student record.</div>
                    </td>
                  </tr>
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <div style={{ fontWeight: 600 }}>No students match your filter settings.</div>
                    </td>
                  </tr>
                ) : (
                  paged.map((st) => {
                    const badgeStyle = getLevelBadgeStyles(st.level);
                    return (
                      <tr key={st.id}>
                        <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <User size={14} style={{ color: 'var(--text-muted)' }} />
                            {st.name}
                          </span>
                        </td>
                        <td>
                          <span style={{ 
                            background: badgeStyle.background,
                            color: badgeStyle.color,
                            padding: '0.2rem 0.6rem',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem'
                          }}>
                            <GraduationCap size={12} />
                            {st.level}
                          </span>
                        </td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                            <MapPin size={13} style={{ color: 'var(--text-muted)' }} />
                            {st.branchName}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.85rem' }}>
                            <div style={{ fontWeight: 500 }}>{st.parentName || '—'}</div>
                            <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.1rem' }}>
                              <Phone size={11} />
                              {st.contact}
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            background: st.status === 'Active' ? 'var(--success-bg, rgba(16, 185, 129, 0.1))' : '#f1f5f9',
                            color: st.status === 'Active' ? 'var(--success, #10b981)' : 'var(--text-muted)',
                            padding: '0.15rem 0.5rem',
                            borderRadius: '999px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}>
                            {st.status === 'Active' ? <CheckCircle size={10} /> : <HelpCircle size={10} />}
                            {st.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{st.remarks || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                            <button 
                              onClick={() => openEditModal(st)}
                              title="Edit Student"
                              style={{
                                background: 'transparent', border: '1px solid var(--border-color)', cursor: 'pointer',
                                padding: '0.3rem', borderRadius: '6px', color: 'var(--text-secondary)', display: 'flex'
                              }}
                            >
                              <Pencil size={14} />
                            </button>
                            <button 
                              onClick={() => handleDelete(st.id, st.name)}
                              title="Delete Student"
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
                    );
                  })
                )}
              </tbody>
            </table>
          )}
          {!loading && totalPages > 1 && (
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      </div>

      {/* Add / Edit Student Modal */}
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
            maxWidth: editingStudent ? '780px' : '500px',
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
                {editingStudent ? 'Edit Student Details' : 'Add Student Record'}
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
              <div style={{ display: 'flex', overflow: 'hidden' }}>
              <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                
                {/* Student Name */}
                <div>
                  <label className="modal-form-label">Student Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. John Doe"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={`modal-input-field ${formErrors.name ? 'error' : ''}`}
                  />
                  {formErrors.name && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.name}</span>}
                </div>

                {/* Level and Branch Row */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Level / Program *</label>
                    <select
                      value={form.level}
                      onChange={(e) => setForm({ ...form, level: e.target.value })}
                      className="modal-select-field"
                    >
                      {STUDENT_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </div>
                  
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
                </div>

                {/* Parent Contact Details */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Parent Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Jane Doe"
                      value={form.parentName}
                      onChange={(e) => setForm({ ...form, parentName: e.target.value })}
                      className="modal-input-field"
                    />
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Phone Contact</label>
                    <input
                      type="text"
                      placeholder="e.g. +62 812-3456-789"
                      value={form.contact}
                      onChange={(e) => setForm({ ...form, contact: e.target.value })}
                      className={`modal-input-field ${formErrors.contact ? 'error' : ''}`}
                    />
                    {formErrors.contact && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.contact}</span>}
                  </div>
                </div>

                {/* Status */}
                <div>
                  <label className="modal-form-label">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="modal-select-field"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                {/* Remarks */}
                <div>
                  <label className="modal-form-label">Remarks / Notes</label>
                  <textarea
                    placeholder="Enter any notes (e.g. preferences, attendance)..."
                    value={form.remarks}
                    onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                    className="modal-textarea-field"
                  />
                </div>
              </div>

              {/* Branch history (edit mode only) */}
              {editingStudent && (
                <div style={{ width: '260px', flexShrink: 0, borderLeft: '1px solid var(--border-color)', background: 'var(--bg-color)', padding: '1.5rem 1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <MapPin size={15} /> Branch History
                    </h3>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Branches this student was assigned to.</span>
                  </div>
                  {branchHistory.length === 0 ? (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>No branch history yet.</p>
                  ) : (
                    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      {[...branchHistory].reverse().map((h, i, arr) => {
                        const isCurrent = i === 0;
                        const when = new Date(h.at);
                        return (
                          <div key={i} style={{ display: 'flex', gap: '0.6rem', paddingBottom: i === arr.length - 1 ? 0 : '0.7rem', position: 'relative' }}>
                            {/* timeline dot + line */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '99px', background: isCurrent ? 'var(--primary-blue, #4f46e5)' : 'var(--border-color)', marginTop: '4px' }} />
                              {i !== arr.length - 1 && <span style={{ width: '2px', flex: 1, background: 'var(--border-color)', marginTop: '2px' }} />}
                            </div>
                            <div style={{ paddingBottom: '0.2rem' }}>
                              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: isCurrent ? 'var(--primary-blue, #4f46e5)' : 'var(--text-main)' }}>
                                {h.branch}{isCurrent && <span style={{ fontSize: '0.62rem', fontWeight: 700, marginLeft: '0.35rem', color: 'var(--primary-blue, #4f46e5)' }}>CURRENT</span>}
                              </div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                {isNaN(when.getTime()) ? '' : when.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
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
                  Save Student
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
