'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ui/Toast';
import { useSchedule } from '../contexts/ScheduleContext';
import {
  listenToLeads,
  createLead,
  updateLead,
  deleteLead
} from '../services/crmService';
import { logActivity } from '../services/activityService';
import { 
  Plus, Pencil, Trash2, Search, X, MapPin, User, Phone, Calendar, 
  MessageSquare, ChevronLeft, ChevronRight, CheckCircle2, Circle
} from 'lucide-react';

const COLUMNS = [
  { id: 'interest_trial', title: 'Interest Trial', color: 'var(--primary-blue, #3b82f6)', bg: 'rgba(59, 130, 246, 0.05)', border: 'rgba(59, 130, 246, 0.15)' },
  { id: 'no_response', title: 'No Response', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.05)', border: 'rgba(245, 158, 11, 0.15)' },
  { id: 'trial_booked', title: 'Trial Booked', color: '#10b981', bg: 'rgba(16, 185, 129, 0.05)', border: 'rgba(16, 185, 129, 0.15)' },
  { id: 'closed', title: 'Closed', color: '#64748b', bg: 'rgba(100, 116, 139, 0.05)', border: 'rgba(100, 116, 139, 0.15)' }
];

export default function NewCrmPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { enabledBranches, branches } = useSchedule();

  // State
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');

  // Modal / Form States
  const [showModal, setShowModal] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  
  const [form, setForm] = useState({
    name: '',
    phone: '',
    message: '',
    status: 'interest_trial',
    branch: '',
    trialDate: '',
    notes: ''
  });

  const [formErrors, setFormErrors] = useState({});

  // Subscribe to real-time CRM leads
  useEffect(() => {
    const unsubscribe = listenToLeads((data) => {
      setLeads(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const branchList = [...new Set([...(enabledBranches || []).map(b => b.name), ...(branches || []).map(b => b.name)])].filter(Boolean);

  // Filter leads
  const filteredLeads = useMemo(() => {
    const s = search.toLowerCase();
    return leads.filter((lead) => {
      if (filterBranch !== 'all' && lead.branch !== filterBranch) return false;
      if (s) {
        const match =
          (lead.name && lead.name.toLowerCase().includes(s)) ||
          (lead.phone && lead.phone.toLowerCase().includes(s)) ||
          (lead.message && lead.message.toLowerCase().includes(s)) ||
          (lead.notes && lead.notes.toLowerCase().includes(s));
        if (!match) return false;
      }
      return true;
    });
  }, [leads, search, filterBranch]);

  // Group leads by column status
  const columnsData = useMemo(() => {
    const data = {
      interest_trial: [],
      no_response: [],
      trial_booked: [],
      closed: []
    };
    filteredLeads.forEach(lead => {
      const status = lead.status || 'interest_trial';
      if (data[status]) {
        data[status].push(lead);
      } else {
        data.interest_trial.push(lead);
      }
    });
    return data;
  }, [filteredLeads]);

  const openAddModal = () => {
    setEditingLead(null);
    setForm({
      name: '',
      phone: '',
      message: '',
      status: 'interest_trial',
      branch: branchList[0] || '',
      trialDate: '',
      notes: ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  const openEditModal = (lead) => {
    setEditingLead(lead);
    setForm({
      name: lead.name || '',
      phone: lead.phone || '',
      message: lead.message || '',
      status: lead.status || 'interest_trial',
      branch: lead.branch || '',
      trialDate: lead.trialDate || '',
      notes: lead.notes || ''
    });
    setFormErrors({});
    setShowModal(true);
  };

  const validateForm = () => {
    const errors = {};
    if (!form.name.trim()) errors.name = 'Lead Name is required';
    if (!form.phone.trim()) errors.phone = 'Phone number is required';
    if (!form.branch) errors.branch = 'Branch selection is required';
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      if (editingLead) {
        await updateLead(editingLead.id, form);
        logActivity(user?.email, 'updated CRM lead', `Updated lead "${form.name}" details`);
        showToast({ title: 'Lead updated successfully', variant: 'success' });
      } else {
        await createLead(form);
        logActivity(user?.email, 'added CRM lead', `Added lead "${form.name}"`);
        showToast({ title: 'Lead added successfully', variant: 'success' });
      }
      setShowModal(false);
    } catch (err) {
      console.error('Error saving lead:', err);
      showToast({ title: 'Failed to save lead', variant: 'error' });
    }
  };

  const handleDelete = async (leadId, leadName) => {
    if (!window.confirm(`Are you sure you want to delete lead "${leadName}"?`)) return;
    try {
      await deleteLead(leadId);
      logActivity(user?.email, 'deleted CRM lead', `Deleted lead "${leadName}"`);
      showToast({ title: 'Lead deleted successfully', variant: 'success' });
    } catch (err) {
      console.error('Error deleting lead:', err);
      showToast({ title: 'Failed to delete lead', variant: 'error' });
    }
  };

  // Quick move lead status left/right in Kanban board
  const handleMoveStatus = async (lead, direction) => {
    const statusKeys = COLUMNS.map(c => c.id);
    const currentIndex = statusKeys.indexOf(lead.status);
    let nextIndex = currentIndex + direction;
    if (nextIndex >= 0 && nextIndex < statusKeys.length) {
      const nextStatus = statusKeys[nextIndex];
      try {
        await updateLead(lead.id, { status: nextStatus });
        logActivity(user?.email, 'updated CRM lead status', `Moved lead "${lead.name}" to ${nextStatus}`);
        showToast({ title: `Moved to ${COLUMNS[nextIndex].title}`, variant: 'success' });
      } catch (err) {
        console.error('Error updating status:', err);
        showToast({ title: 'Failed to move lead status', variant: 'error' });
      }
    }
  };

  return (
    <section className="dashboard-view active" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 110px)', overflow: 'hidden' }}>
      {/* Panel Header */}
      <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', background: 'var(--panel-bg)' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>CRM Leads Pipeline</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
            Track sales and trial conversions using an interactive pipeline layout.
          </p>
        </div>
        
        <button 
          onClick={openAddModal} 
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
        >
          <Plus size={16} /> Add Lead
        </button>
      </div>

      {/* Filter Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', background: 'var(--bg-color)' }}>
        <div className="input-group" style={{ margin: 0, flex: '1 1 250px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search lead name, phone, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '2rem', width: '100%', background: 'var(--panel-bg)', border: '1px solid var(--border-color)' }}
            />
          </div>
        </div>
        
        <div className="input-group" style={{ margin: 0, width: '180px' }}>
          <select
            value={filterBranch}
            onChange={(e) => setFilterBranch(e.target.value)}
            style={{ width: '100%', background: 'var(--panel-bg)', border: '1px solid var(--border-color)' }}
          >
            <option value="all">All Branches</option>
            {branchList.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      </div>

      {/* Kanban Board Container */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '1rem',
        padding: '1.25rem',
        flex: 1,
        overflowX: 'auto',
        overflowY: 'hidden',
        background: 'var(--bg-color)',
        alignItems: 'stretch'
      }}>
        {COLUMNS.map((col) => {
          const colLeads = columnsData[col.id] || [];
          return (
            <div 
              key={col.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--panel-bg)',
                borderRadius: '14px',
                border: `1px solid ${col.border}`,
                maxHeight: '100%',
                overflow: 'hidden'
              }}
            >
              {/* Column Header */}
              <div style={{
                padding: '0.85rem 1.1rem',
                borderBottom: `2px solid ${col.color}`,
                background: col.bg,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {col.title}
                </span>
                <span style={{
                  background: col.color,
                  color: 'white',
                  borderRadius: '10px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '0.1rem 0.5rem'
                }}>
                  {colLeads.length}
                </span>
              </div>

              {/* Column Cards List */}
              <div style={{
                padding: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                overflowY: 'auto',
                flex: 1,
                alignContent: 'flex-start'
              }}>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    Loading...
                  </div>
                ) : colLeads.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '3rem 1rem',
                    color: 'var(--text-muted)',
                    fontSize: '0.8rem',
                    border: '1px dashed var(--border-color)',
                    borderRadius: '8px'
                  }}>
                    No Leads
                  </div>
                ) : (
                  colLeads.map((lead) => (
                    <div 
                      key={lead.id}
                      style={{
                        background: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '10px',
                        padding: '0.85rem',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
                        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                        cursor: 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                      }}
                    >
                      {/* Title & Actions Row */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <User size={13} style={{ color: 'var(--text-muted)' }} />
                          {lead.name}
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <button 
                            onClick={() => openEditModal(lead)}
                            title="Edit Lead"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', borderRadius: '4px' }}
                          >
                            <Pencil size={12} />
                          </button>
                          <button 
                            onClick={() => handleDelete(lead.id, lead.name)}
                            title="Delete Lead"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.2rem', borderRadius: '4px' }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Contact Info */}
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Phone size={12} style={{ color: 'var(--text-muted)' }} />
                        <a href={`tel:${lead.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                          {lead.phone}
                        </a>
                      </div>

                      {/* Query message if exists */}
                      {lead.message && (
                        <div style={{ 
                          fontSize: '0.75rem', 
                          color: 'var(--text-secondary)', 
                          background: 'var(--panel-bg)',
                          borderLeft: '2.5px solid var(--border-color)',
                          padding: '0.35rem 0.5rem',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.25rem',
                          lineHeight: '1.3'
                        }}>
                          <MessageSquare size={11} style={{ flexShrink: 0, marginTop: '0.1rem', color: 'var(--text-muted)' }} />
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {lead.message}
                          </div>
                        </div>
                      )}

                      {/* Details row badges */}
                      {(lead.branch || lead.trialDate) && (
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                          {lead.branch && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem', background: 'var(--panel-bg)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                              <MapPin size={9} />
                              {lead.branch}
                            </span>
                          )}
                          {lead.trialDate && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem', background: 'var(--primary-blue-light, rgba(59, 130, 246, 0.08))', border: '1px solid rgba(59, 130, 246, 0.15)', color: 'var(--primary-blue, #3b82f6)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                              <Calendar size={9} />
                              {lead.trialDate}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Internal Notes snippet */}
                      {lead.notes && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '0.2rem', borderTop: '1px dashed var(--border-color)', paddingTop: '0.35rem', marginTop: '0.25rem' }}>
                          <span style={{ fontWeight: 600 }}>Notes:</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', flex: 1 }}>{lead.notes}</span>
                        </div>
                      )}

                      {/* Move Status Buttons */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.4rem' }}>
                        <button 
                          disabled={lead.status === 'interest_trial'}
                          onClick={() => handleMoveStatus(lead, -1)}
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: lead.status === 'interest_trial' ? 'transparent' : 'var(--text-muted)',
                            display: 'flex', padding: '0.15rem'
                          }}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>Move Status</span>
                        
                        <button 
                          disabled={lead.status === 'closed'}
                          onClick={() => handleMoveStatus(lead, 1)}
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: lead.status === 'closed' ? 'transparent' : 'var(--text-muted)',
                            display: 'flex', padding: '0.15rem'
                          }}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Lead Modal */}
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
                {editingLead ? 'Edit CRM Lead Profile' : 'Add New CRM Lead'}
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
                
                {/* Lead Name */}
                <div>
                  <label className="modal-form-label">Lead Student Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Michael Smith"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={`modal-input-field ${formErrors.name ? 'error' : ''}`}
                  />
                  {formErrors.name && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.name}</span>}
                </div>

                {/* Contact and Branch Row */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Phone Contact *</label>
                    <input
                      type="text"
                      placeholder="e.g. +62 812-9988-776"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className={`modal-input-field ${formErrors.phone ? 'error' : ''}`}
                    />
                    {formErrors.phone && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.phone}</span>}
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Branch *</label>
                    <select
                      value={form.branch}
                      onChange={(e) => setForm({ ...form, branch: e.target.value })}
                      className={`modal-select-field ${formErrors.branch ? 'error' : ''}`}
                    >
                      <option value="">Select Branch</option>
                      {branchList.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                    {formErrors.branch && <span style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', display: 'block' }}>{formErrors.branch}</span>}
                  </div>
                </div>

                {/* Pipeline Status and Booked Trial Date */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Pipeline Status</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="modal-select-field"
                    >
                      {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <label className="modal-form-label">Booked Trial Date</label>
                    <input
                      type="text"
                      placeholder="e.g. 2026-07-20"
                      value={form.trialDate}
                      onChange={(e) => setForm({ ...form, trialDate: e.target.value })}
                      className="modal-input-field"
                    />
                  </div>
                </div>

                {/* Message */}
                <div>
                  <label className="modal-form-label">Query Message</label>
                  <textarea
                    placeholder="Enter initial whatsapp message or customer query..."
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    className="modal-textarea-field"
                    style={{ height: '60px' }}
                  />
                </div>

                {/* Remarks/Notes */}
                <div>
                  <label className="modal-form-label">Internal Follow-Up Notes</label>
                  <textarea
                    placeholder="Enter details from phone calls, reasons for no response, or custom preferences..."
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="modal-textarea-field"
                    style={{ height: '70px' }}
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
                  Save Lead
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
