'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { 
  subscribeToInternalInstructors, 
  createInternalInstructor, 
  updateInternalInstructor, 
  deleteInternalInstructor 
} from '../services/internalInstructorService';
import Pagination from '../components/ui/Pagination';
import { Plus, Pencil, Trash2, Search, X, MapPin, User, ShieldAlert, CheckCircle, Phone, Award, HelpCircle } from 'lucide-react';

const INSTRUCTOR_LEVELS = [
  'Kinder and Junior',
  'Junior and Coder'
];

const INSTRUCTORS_PAGE_SIZE = 15;

export default function NewInstructorsPage() {
  const { enabledBranches, branches } = useSchedule();
  const { showToast } = useToast();

  // State
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);

  // Modal/Form State
  const [showModal, setShowModal] = useState(false);
  const [editingInstructor, setEditingInstructor] = useState(null);
  
  const [form, setForm] = useState({
    name: '',
    level: INSTRUCTOR_LEVELS[0],
    branches: [], // Array of branch names
    contact: '',
    status: 'Active',
    remarks: ''
  });

  const [formErrors, setFormErrors] = useState({});

  // Subscribe to real-time updates from Firestore
  useEffect(() => {
    const unsubscribe = subscribeToInternalInstructors((data) => {
      setInstructors(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const branchList = [...new Set([...(enabledBranches || []).map(b => b.name), ...(branches || []).map(b => b.name)])].filter(Boolean);

  // Filters & Search
  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return instructors.filter((inst) => {
      if (filterLevel !== 'all' && inst.level !== filterLevel) return false;
      if (filterBranch !== 'all' && !(inst.branches || []).includes(filterBranch)) return false;
      if (filterStatus !== 'all' && inst.status !== filterStatus) return false;
      if (s) {
        const match =
          (inst.name && inst.name.toLowerCase().includes(s)) ||
          (inst.contact && inst.contact.toLowerCase().includes(s)) ||
          (inst.remarks && inst.remarks.toLowerCase().includes(s));
        if (!match) return false;
      }
      return true;
    });
  }, [instructors, search, filterLevel, filterBranch, filterStatus]);

  const sortedFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [filtered]);

  const totalPages = Math.ceil(sortedFiltered.length / INSTRUCTORS_PAGE_SIZE);
  const paged = sortedFiltered.slice((page - 1) * INSTRUCTORS_PAGE_SIZE, page * INSTRUCTORS_PAGE_SIZE);

  const openAddModal = () => {
    setEditingInstructor(null);
    setForm({
      name: '',
      level: INSTRUCTOR_LEVELS[0],
      branches: branchList.length > 0 ? [branchList[0]] : [],
      contact: '',
      status: 'Active',
      remarks: ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  const openEditModal = (inst) => {
    setEditingInstructor(inst);
    setForm({
      name: inst.name || '',
      level: inst.level || INSTRUCTOR_LEVELS[0],
      branches: Array.isArray(inst.branches) ? inst.branches : [],
      contact: inst.contact || '',
      status: inst.status || 'Active',
      remarks: inst.remarks || ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  const handleBranchCheckboxChange = (branchName) => {
    const current = [...form.branches];
    const index = current.indexOf(branchName);
    if (index > -1) {
      current.splice(index, 1);
    } else {
      current.push(branchName);
    }
    setForm({ ...form, branches: current });
  };

  const validateForm = () => {
    const errors = {};
    if (!form.name.trim()) errors.name = 'Instructor Name is required';
    if (!form.level) errors.level = 'Teaching Level selection is required';
    if (!form.branches || form.branches.length === 0) errors.branches = 'Select at least one branch';
    if (!form.contact.trim()) errors.contact = 'Contact details are required';
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (editingInstructor) {
        await updateInternalInstructor(editingInstructor.id, form);
        showToast({ title: 'Instructor updated successfully', variant: 'success' });
      } else {
        await createInternalInstructor(form);
        showToast({ title: 'Instructor added successfully', variant: 'success' });
      }
      setShowModal(false);
    } catch (err) {
      console.error('Error saving instructor:', err);
      showToast({ title: 'Failed to save instructor', variant: 'error' });
    }
  };

  const handleDelete = async (instructorId, instructorName) => {
    if (!window.confirm(`Are you sure you want to delete instructor "${instructorName}"?`)) return;
    try {
      await deleteInternalInstructor(instructorId);
      showToast({ title: 'Instructor deleted successfully', variant: 'success' });
      if (paged.length === 1 && page > 1) {
        setPage(page - 1);
      }
    } catch (err) {
      console.error('Error deleting instructor:', err);
      showToast({ title: 'Failed to delete instructor', variant: 'error' });
    }
  };

  // Helper to color-code level pill
  const getLevelBadgeStyles = (level = '') => {
    if (level === 'Kinder and Junior') {
      return {
        background: 'rgba(249, 115, 22, 0.08)',
        border: '1px solid rgba(249, 115, 22, 0.25)',
        color: '#ea580c'
      };
    }
    if (level === 'Junior and Coder') {
      return {
        background: 'rgba(59, 130, 246, 0.08)',
        border: '1px solid rgba(59, 130, 246, 0.25)',
        color: '#2563eb'
      };
    }
    return {
      background: '#f1f5f9',
      border: '1px solid #e2e8f0',
      color: 'var(--text-secondary)'
    };
  };

  return (
    <section className="dashboard-view active">
      <div className="panel full-schedule-panel">
        {/* Panel Header */}
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Instructors Registry</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Manage instructor profiles, teaching capabilities, and branch allocations.
            </p>
          </div>
          
          <button 
            onClick={openAddModal} 
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
          >
            <Plus size={16} /> Add Instructor
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
                placeholder="Search name, contact, notes..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ paddingLeft: '2rem', width: '100%' }}
              />
            </div>
          </div>
          
          <div className="input-group" style={{ margin: 0, width: '180px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Teaching Level</label>
            <select
              value={filterLevel}
              onChange={(e) => { setFilterLevel(e.target.value); setPage(1); }}
              style={{ width: '100%' }}
            >
              <option value="all">All Levels</option>
              {INSTRUCTOR_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '150px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Branch Location</label>
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

        {/* Table Body */}
        <div className="panel-body table-wrapper" style={{ position: 'relative' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
              <div className="loading-spinner" style={{ marginBottom: '1rem' }} />
              <p>Fetching instructors registry from Firestore...</p>
            </div>
          ) : (
            <table id="schedule-table">
              <thead>
                <tr>
                  <th>Instructor Name</th>
                  <th style={{ width: '200px' }}>Teaching Level</th>
                  <th style={{ width: '280px' }}>Teaching Branches</th>
                  <th style={{ width: '180px' }}>Contact Info</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Status</th>
                  <th>Remarks</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {instructors.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <ShieldAlert size={32} style={{ color: 'var(--warning)', marginBottom: '0.5rem' }} />
                      <div style={{ fontWeight: 600 }}>No Instructors Registered</div>
                      <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>Click "Add Instructor" to register instructor profiles.</div>
                    </td>
                  </tr>
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <div style={{ fontWeight: 600 }}>No instructors match your filters.</div>
                    </td>
                  </tr>
                ) : (
                  paged.map((inst) => {
                    const levelStyle = getLevelBadgeStyles(inst.level);
                    return (
                      <tr key={inst.id}>
                        <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <User size={14} style={{ color: 'var(--text-muted)' }} />
                            {inst.name}
                          </span>
                        </td>
                        <td>
                          <span style={{ 
                            background: levelStyle.background,
                            border: levelStyle.border,
                            color: levelStyle.color,
                            padding: '0.2rem 0.6rem',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem'
                          }}>
                            <Award size={12} />
                            {inst.level}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            {(inst.branches || []).map((branch) => (
                              <span 
                                key={branch}
                                style={{
                                  background: 'var(--bg-color)',
                                  border: '1px solid var(--border-color)',
                                  color: 'var(--text-secondary)',
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '4px',
                                  fontSize: '0.72rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.2rem'
                                }}
                              >
                                <MapPin size={10} style={{ color: 'var(--text-muted)' }} />
                                {branch}
                              </span>
                            ))}
                            {(!inst.branches || inst.branches.length === 0) && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No branches allocated</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            <Phone size={11} style={{ color: 'var(--text-muted)' }} />
                            {inst.contact || '—'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            background: inst.status === 'Active' ? 'var(--success-bg, rgba(16, 185, 129, 0.1))' : '#f1f5f9',
                            color: inst.status === 'Active' ? 'var(--success, #10b981)' : 'var(--text-muted)',
                            padding: '0.15rem 0.5rem',
                            borderRadius: '999px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}>
                            {inst.status === 'Active' ? <CheckCircle size={10} /> : <HelpCircle size={10} />}
                            {inst.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{inst.remarks || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                            <button 
                              onClick={() => openEditModal(inst)}
                              title="Edit Instructor"
                              style={{
                                background: 'transparent', border: '1px solid var(--border-color)', cursor: 'pointer',
                                padding: '0.3rem', borderRadius: '6px', color: 'var(--text-secondary)', display: 'flex'
                              }}
                            >
                              <Pencil size={14} />
                            </button>
                            <button 
                              onClick={() => handleDelete(inst.id, inst.name)}
                              title="Delete Instructor"
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

      {/* Add / Edit Instructor Modal */}
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
                {editingInstructor ? 'Edit Instructor Details' : 'Add Instructor Profile'}
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
                
                {/* Instructor Name */}
                <div>
                  <label className="modal-form-label">Instructor Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Kak Fadhil"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={`modal-input-field ${formErrors.name ? 'error' : ''}`}
                  />
                  {formErrors.name && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.name}</span>}
                </div>

                {/* Level selection */}
                <div>
                  <label className="modal-form-label">Teaching Levels Capability *</label>
                  <select
                    value={form.level}
                    onChange={(e) => setForm({ ...form, level: e.target.value })}
                    className="modal-select-field"
                  >
                    {INSTRUCTOR_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
                  </select>
                </div>

                {/* Branches Multi Selection using check boxes */}
                <div>
                  <label className="modal-form-label" style={{ marginBottom: '0.5rem' }}>Allocated Branch Locations *</label>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 1fr', 
                    gap: '0.5rem 1rem', 
                    padding: '0.75rem 1rem', 
                    background: 'var(--bg-color)', 
                    borderRadius: '10px',
                    border: formErrors.branches ? '1.5px solid var(--danger)' : '1px solid var(--border-color)' 
                  }}>
                    {branchList.map((branch) => {
                      const isChecked = form.branches.includes(branch);
                      return (
                        <label 
                          key={branch} 
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.5rem', 
                            fontSize: '0.85rem', 
                            cursor: 'pointer',
                            color: 'var(--text-main)'
                          }}
                        >
                          <input 
                            type="checkbox" 
                            checked={isChecked}
                            onChange={() => handleBranchCheckboxChange(branch)}
                            style={{ width: '15px', height: '15px', cursor: 'pointer' }}
                          />
                          {branch}
                        </label>
                      );
                    })}
                  </div>
                  {formErrors.branches && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.branches}</span>}
                </div>

                {/* Contact and Status Row */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Contact details *</label>
                    <input
                      type="text"
                      placeholder="e.g. +62 813-9876-543"
                      value={form.contact}
                      onChange={(e) => setForm({ ...form, contact: e.target.value })}
                      className={`modal-input-field ${formErrors.contact ? 'error' : ''}`}
                    />
                    {formErrors.contact && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.contact}</span>}
                  </div>
                  
                  <div style={{ flex: 1 }}>
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
                </div>

                {/* Remarks */}
                <div>
                  <label className="modal-form-label">Remarks / Notes</label>
                  <textarea
                    placeholder="Enter teaching schedules, notes, or availability preferences..."
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
                  Save Instructor
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
