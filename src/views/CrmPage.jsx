'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ui/Toast';
import { useSchedule } from '../contexts/ScheduleContext';
import Pagination from '../components/ui/Pagination';
import {
  listenToLeads,
  createLead,
  updateLead,
  deleteLead
} from '../services/crmService';
import {
  Plus, X, Search, Trash2, ExternalLink, Phone, Save, Clock
} from 'lucide-react';

const COLUMNS = [
  { id: 'interest_trial', title: 'Interest Trial', color: '#4f46e5', badge: 'rgba(79, 70, 229, 0.15)', textColor: '#4f46e5' },
  { id: 'no_response', title: 'No Response', color: '#f59e0b', badge: 'rgba(245, 158, 11, 0.15)', textColor: '#b45309' },
  { id: 'trial_booked', title: 'Trial Booked', color: '#10b981', badge: 'rgba(16, 185, 129, 0.15)', textColor: '#047857' },
  { id: 'closed', title: 'Closed', color: '#64748b', badge: 'rgba(100, 116, 139, 0.15)', textColor: '#475569' }
];

export default function CrmPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { branches, activeBranchName } = useSchedule();

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchFilter, setSelectedBranchFilter] = useState('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState('table'); // Default to table view
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  
  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  
  // Form states
  const [newLead, setNewLead] = useState({
    name: '',
    phone: '',
    message: '',
    status: 'interest_trial',
    notes: '',
    branch: ''
  });

  const [editedLead, setEditedLead] = useState({
    name: '',
    phone: '',
    message: '',
    status: '',
    notes: '',
    branch: ''
  });

  // Sync default filter and new lead branch when active branch loads
  useEffect(() => {
    if (activeBranchName) {
      setSelectedBranchFilter(activeBranchName);
    }
  }, [activeBranchName]);

  useEffect(() => {
    if (isAddOpen) {
      setNewLead(prev => ({
        ...prev,
        branch: activeBranchName || ''
      }));
    }
  }, [isAddOpen, activeBranchName]);

  // Listen for real-time CRM updates
  useEffect(() => {
    setLoading(true);
    const unsubscribe = listenToLeads((data) => {
      setLeads(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Format phone number to WhatsApp link
  const getWhatsAppLink = (phone) => {
    if (!phone) return '#';
    let cleanPhone = phone.replace(/[^\d+]/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }
    return `https://wa.me/${cleanPhone}`;
  };

  // Drag and Drop handlers
  const handleDragStart = (e, leadId) => {
    e.dataTransfer.setData('leadId', leadId);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e, newStatus) => {
    const leadId = e.dataTransfer.getData('leadId');
    if (!leadId) return;

    // Optimistic update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus, updatedAt: new Date() } : l));

    try {
      await updateLead(leadId, { status: newStatus });
      showToast({ title: 'Lead status updated', variant: 'success' });
    } catch (err) {
      console.error(err);
      showToast({ title: 'Failed to update lead status', variant: 'error' });
    }
  };

  const handleAddLead = async (e) => {
    e.preventDefault();
    if (!newLead.name || !newLead.phone) {
      showToast({ title: 'Name and Phone are required', variant: 'error' });
      return;
    }

    try {
      await createLead(newLead);
      setIsAddOpen(false);
      setNewLead({ name: '', phone: '', message: '', status: 'interest_trial', notes: '' });
      showToast({ title: 'Lead added successfully', variant: 'success' });
    } catch (err) {
      console.error(err);
      showToast({ title: 'Failed to add lead', variant: 'error' });
    }
  };

  const handleOpenDetails = (lead) => {
    setSelectedLead(lead);
    setEditedLead({
      name: lead.name,
      phone: lead.phone,
      message: lead.message || '',
      status: lead.status,
      notes: lead.notes || '',
      branch: lead.branch || ''
    });
    setIsDetailOpen(true);
  };

  const handleUpdateDetails = async (e) => {
    e.preventDefault();
    if (!selectedLead) return;

    try {
      await updateLead(selectedLead.id, editedLead);
      setIsDetailOpen(false);
      setSelectedLead(null);
      showToast({ title: 'Lead updated successfully', variant: 'success' });
    } catch (err) {
      console.error(err);
      showToast({ title: 'Failed to update lead', variant: 'error' });
    }
  };

  const handleDeleteLead = async (leadId) => {
    if (!confirm('Are you sure you want to delete this lead?')) return;

    try {
      await deleteLead(leadId);
      setIsDetailOpen(false);
      setSelectedLead(null);
      setSelectedLeadIds(prev => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
      showToast({ title: 'Lead deleted successfully', variant: 'success' });
    } catch (err) {
      console.error(err);
      showToast({ title: 'Failed to delete lead', variant: 'error' });
    }
  };

  // Filter leads by search query, branch filter and status filter
  const filteredLeads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return leads.filter(l => {
      // 1. Branch filter
      if (selectedBranchFilter !== 'all') {
        const leadBranch = l.branch || '';
        if (leadBranch !== selectedBranchFilter) {
          return false;
        }
      }
      
      // 2. Status filter
      if (selectedStatusFilter !== 'all') {
        if (l.status !== selectedStatusFilter) {
          return false;
        }
      }
      
      // 3. Search query filter
      if (!query) return true;
      return (
        l.name.toLowerCase().includes(query) ||
        l.phone.toLowerCase().includes(query) ||
        (l.message && l.message.toLowerCase().includes(query)) ||
        (l.notes && l.notes.toLowerCase().includes(query))
      );
    });
  }, [leads, searchQuery, selectedBranchFilter, selectedStatusFilter]);

  // Bulk deletion handler
  const handleBulkDelete = async () => {
    const count = selectedLeadIds.size;
    if (count === 0) return;
    if (!confirm(`Are you sure you want to delete ${count} selected lead(s)?`)) return;

    try {
      const promises = Array.from(selectedLeadIds).map(id => deleteLead(id));
      await Promise.all(promises);
      setSelectedLeadIds(new Set());
      showToast({ title: `${count} leads deleted successfully`, variant: 'success' });
    } catch (err) {
      console.error(err);
      showToast({ title: 'Failed to delete some leads', variant: 'error' });
    }
  };

  // Checkbox handlers
  const toggleRow = (leadId) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const toggleAllOnPage = (pagedLeads) => {
    const allSelected = pagedLeads.length > 0 && pagedLeads.every(l => selectedLeadIds.has(l.id));
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      pagedLeads.forEach(l => {
        if (allSelected) {
          next.delete(l.id);
        } else {
          next.add(l.id);
        }
      });
      return next;
    });
  };

  // Pagination computed properties
  const totalPages = useMemo(() => {
    return Math.ceil(filteredLeads.length / PAGE_SIZE);
  }, [filteredLeads.length]);

  const pagedLeads = useMemo(() => {
    return filteredLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }, [filteredLeads, page]);

  // Clamp pagination page if bounds change
  useEffect(() => {
    if (page > totalPages && totalPages > 0) {
      setPage(totalPages);
    }
  }, [filteredLeads.length, totalPages, page]);

  // Group filtered leads by status
  const leadsByStatus = useMemo(() => {
    const groups = {
      interest_trial: [],
      no_response: [],
      trial_booked: [],
      closed: []
    };
    filteredLeads.forEach(l => {
      if (groups[l.status]) {
        groups[l.status].push(l);
      } else {
        groups.interest_trial.push(l);
      }
    });
    return groups;
  }, [filteredLeads]);

  // Relative formatter helper
  const formatRelativeTime = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <section className="dashboard-view active">
      {/* Header section */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: '0 0 0.25rem 0' }}>CRM Lead Pipeline</h2>
          <p className="subtext" style={{ margin: 0 }}>Track trial interest and follow-ups from WhatsApp chatbot webhook</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {selectedLeadIds.size > 0 && (
            <button 
              className="btn btn-sm" 
              onClick={handleBulkDelete}
              style={{
                height: '38px',
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                color: '#b91c1c',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                borderRadius: '6px',
                padding: '0 1rem',
                fontSize: '0.85rem',
                fontWeight: 600
              }}
            >
              <Trash2 size={16} /> Delete ({selectedLeadIds.size})
            </button>
          )}

          <div className="search-input-wrapper" style={{ minWidth: '200px' }}>
            <Search className="search-icon" size={16} />
            <input
              type="text"
              placeholder="Search leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="sidebar-search-input"
              style={{ width: '100%', paddingLeft: '2.5rem' }}
            />
          </div>

          <select
            value={selectedBranchFilter}
            onChange={(e) => setSelectedBranchFilter(e.target.value)}
            style={{
              padding: '0.5rem 2.2rem 0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'white',
              fontSize: '0.85rem',
              color: 'var(--text-main)',
              outline: 'none',
              cursor: 'pointer',
              height: '38px',
              lineHeight: '1.2'
            }}
          >
            <option value="all">All Branches</option>
            {branches.map(b => (
              <option key={b.id} value={b.name}>{b.name}</option>
            ))}
          </select>

          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
            style={{
              padding: '0.5rem 2.2rem 0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'white',
              fontSize: '0.85rem',
              color: 'var(--text-main)',
              outline: 'none',
              cursor: 'pointer',
              height: '38px',
              lineHeight: '1.2'
            }}
          >
            <option value="all">All Statuses</option>
            {COLUMNS.map(col => (
              <option key={col.id} value={col.id}>{col.title}</option>
            ))}
          </select>

          {/* View Mode Toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden', height: '38px' }}>
            <button
              onClick={() => setViewMode('table')}
              style={{
                padding: '0 0.8rem',
                fontSize: '0.85rem',
                border: 'none',
                background: viewMode === 'table' ? 'var(--primary, #4f46e5)' : 'white',
                color: viewMode === 'table' ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
                fontWeight: viewMode === 'table' ? 600 : 'normal'
              }}
            >
              Table View
            </button>
            <button
              onClick={() => setViewMode('board')}
              style={{
                padding: '0 0.8rem',
                fontSize: '0.85rem',
                border: 'none',
                background: viewMode === 'board' ? 'var(--primary, #4f46e5)' : 'white',
                color: viewMode === 'board' ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
                fontWeight: viewMode === 'board' ? 600 : 'normal'
              }}
            >
              Board View
            </button>
          </div>

          <button className="btn btn-primary" onClick={() => setIsAddOpen(true)} style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Plus size={18} /> Add Lead
          </button>
        </div>
      </div>

      {/* Kanban Board / Table View Switcher */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
          <div className="loading-spinner" />
          <span style={{ marginLeft: '1rem', color: 'var(--text-secondary)' }}>Loading leads...</span>
        </div>
      ) : viewMode === 'table' ? (
        /* Tabular View */
        <div className="trial-table-wrapper" style={{ background: 'white', padding: '1rem', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <table className="trial-table">
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={pagedLeads.length > 0 && pagedLeads.every(l => selectedLeadIds.has(l.id))}
                    onChange={() => toggleAllOnPage(pagedLeads)}
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                </th>
                <th>Customer Name</th>
                <th>Branch</th>
                <th>Phone Number</th>
                <th>Message</th>
                <th>Status</th>
                <th>Admin Notes</th>
                <th>Updated At</th>
                <th style={{ width: 100, textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan="9" className="empty-state-table" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    No leads match your filter.
                  </td>
                </tr>
              ) : (
                pagedLeads.map((lead) => {
                  const statusCol = COLUMNS.find(c => c.id === lead.status) || COLUMNS[0];
                  return (
                    <tr 
                      key={lead.id} 
                      style={{ 
                        background: selectedLeadIds.has(lead.id) ? 'var(--danger-bg, #fef2f2)' : undefined,
                        cursor: 'pointer'
                      }}
                      onClick={() => handleOpenDetails(lead)}
                    >
                      <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedLeadIds.has(lead.id)}
                          onChange={() => toggleRow(lead.id)}
                          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                        {lead.name}
                      </td>
                      <td>
                        {lead.branch ? (
                          <span className="branch-tag">{lead.branch}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.85rem' }}>{lead.phone}</span>
                          <a
                            href={getWhatsAppLink(lead.phone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              background: '#22c55e',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              textDecoration: 'none'
                            }}
                          >
                            Chat <ExternalLink size={9} />
                          </a>
                        </div>
                      </td>
                      <td>
                        <div style={{
                          maxWidth: '220px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '0.85rem',
                          color: 'var(--text-secondary)'
                        }} title={lead.message}>
                          {lead.message || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No message</span>}
                        </div>
                      </td>
                      <td>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          padding: '3px 8px',
                          borderRadius: '20px',
                          background: statusCol.badge,
                          color: statusCol.textColor,
                          display: 'inline-block'
                        }}>
                          {statusCol.title}
                        </span>
                      </td>
                      <td>
                        <div style={{
                          maxWidth: '180px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '0.85rem',
                          color: 'var(--text-secondary)'
                        }} title={lead.notes}>
                          {lead.notes || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </div>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {formatRelativeTime(lead.updatedAt || lead.createdAt)}
                      </td>
                      <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                          <button 
                            className="btn btn-sm"
                            onClick={() => handleOpenDetails(lead)}
                            style={{ padding: '4px 8px', background: '#f1f5f9', border: '1px solid #cbd5e1', cursor: 'pointer' }}
                            title="Edit Details"
                          >
                            Edit
                          </button>
                          <button 
                            className="btn-icon btn-icon-danger"
                            onClick={() => handleDeleteLead(lead.id)}
                            title="Delete Lead"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          
          <Pagination 
            currentPage={page} 
            totalPages={totalPages} 
            onPageChange={setPage} 
          />
        </div>
      ) : (
        /* Kanban Board View */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', alignItems: 'start', minHeight: '60vh' }}>
          {COLUMNS.map((col) => {
            const columnLeads = leadsByStatus[col.id] || [];
            return (
              <div
                key={col.id}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col.id)}
                style={{
                  background: '#f1f5f9',
                  borderRadius: '12px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  maxHeight: '75vh',
                  minHeight: '400px',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)'
                }}
              >
                {/* Column Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: col.color
                    }} />
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>{col.title}</h3>
                  </div>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    padding: '2px 8px',
                    borderRadius: '20px',
                    background: col.badge,
                    color: col.textColor
                  }}>
                    {columnLeads.length}
                  </span>
                </div>

                {/* Lead Cards List */}
                <div style={{ overflowY: 'auto', flex: 1, paddingRight: '2px' }}>
                  {columnLeads.length === 0 ? (
                    <div style={{ border: '2px dashed #cbd5e1', borderRadius: '8px', padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Drag leads here
                    </div>
                  ) : (
                    columnLeads.map((lead) => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, lead.id)}
                        onClick={() => handleOpenDetails(lead)}
                        style={{
                          background: 'white',
                          borderRadius: '8px',
                          padding: '0.9rem',
                          marginBottom: '0.75rem',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.1)',
                          cursor: 'grab',
                          borderLeft: `4px solid ${col.color}`,
                          transition: 'transform 0.15s, box-shadow 0.15s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.06)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'none';
                          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.1)';
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                          <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>{lead.name}</h4>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <Clock size={10} />
                            {formatRelativeTime(lead.updatedAt || lead.createdAt)}
                          </span>
                        </div>

                        {lead.message && (
                          <p style={{
                            fontSize: '0.78rem',
                            color: 'var(--text-secondary)',
                            margin: '0 0 0.6rem 0',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            lineHeight: '1.3'
                          }}>
                            {lead.message}
                          </p>
                        )}

                        {lead.notes && (
                          <div style={{
                            fontSize: '0.75rem',
                            background: '#f8fafc',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            color: 'var(--text-secondary)',
                            marginBottom: '0.6rem',
                            borderLeft: '2px solid #cbd5e1',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            <strong>Notes:</strong> {lead.notes}
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Phone size={11} /> {lead.phone}
                            </span>
                            {lead.branch && (
                              <span style={{
                                padding: '1px 5px',
                                borderRadius: '4px',
                                background: '#f1f5f9',
                                border: '1px solid #e2e8f0',
                                fontSize: '0.65rem',
                                color: 'var(--text-secondary)'
                              }}>
                                {lead.branch}
                              </span>
                            )}
                          </span>
                          <a
                            href={getWhatsAppLink(lead.phone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              background: '#22c55e',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              textDecoration: 'none'
                            }}
                          >
                            Chat <ExternalLink size={9} />
                          </a>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Add Lead Modal */}
      {isAddOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex',
          justifyContent: 'center', alignItems: 'center'
        }}>
          <div style={{
            background: 'white', padding: '1.75rem', borderRadius: '12px',
            width: '90%', maxWidth: '500px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Add New CRM Lead</h3>
              <button onClick={() => setIsAddOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddLead} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Customer Name</label>
                <input
                  required
                  type="text"
                  value={newLead.name}
                  onChange={e => setNewLead({ ...newLead, name: e.target.value })}
                  placeholder="e.g. Budi Santoso"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                />
              </div>

              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Phone (WhatsApp Number)</label>
                <input
                  required
                  type="text"
                  value={newLead.phone}
                  onChange={e => setNewLead({ ...newLead, phone: e.target.value })}
                  placeholder="e.g. 08123456789 or +628123456789"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                />
              </div>

              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>WhatsApp Message</label>
                <textarea
                  rows="3"
                  value={newLead.message}
                  onChange={e => setNewLead({ ...newLead, message: e.target.value })}
                  placeholder="Paste chat message from customer..."
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Branch</label>
                  <select
                    value={newLead.branch}
                    onChange={e => setNewLead({ ...newLead, branch: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  >
                    <option value="">No Branch / All</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Initial Status</label>
                  <select
                    value={newLead.status}
                    onChange={e => setNewLead({ ...newLead, status: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  >
                    {COLUMNS.map(col => (
                      <option key={col.id} value={col.id}>{col.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Admin Notes</label>
                <textarea
                  rows="2"
                  value={newLead.notes}
                  onChange={e => setNewLead({ ...newLead, notes: e.target.value })}
                  placeholder="Add internal follow-up comments..."
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" className="btn btn-sm" onClick={() => setIsAddOpen(false)} style={{ background: '#f1f5f9', border: '1px solid var(--border-color)', color: 'var(--text-main)', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Plus size={16} /> Add Lead</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lead Details & Edit Modal */}
      {isDetailOpen && selectedLead && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex',
          justifyContent: 'center', alignItems: 'center'
        }}>
          <div style={{
            background: 'white', padding: '1.75rem', borderRadius: '12px',
            width: '90%', maxWidth: '550px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Lead Details</h3>
              <button onClick={() => setIsDetailOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleUpdateDetails} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Name</label>
                  <input
                    required
                    type="text"
                    value={editedLead.name}
                    onChange={e => setEditedLead({ ...editedLead, name: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  />
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Phone</label>
                  <input
                    required
                    type="text"
                    value={editedLead.phone}
                    onChange={e => setEditedLead({ ...editedLead, phone: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', color: '#22c55e' }}><Phone size={16} /></span>
                  <span>WhatsApp link is ready</span>
                </div>
                <a
                  href={getWhatsAppLink(editedLead.phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    background: '#22c55e', color: 'white', border: 'none', borderRadius: '4px',
                    padding: '4px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px'
                  }}
                >
                  Open WhatsApp Chat <ExternalLink size={12} />
                </a>
              </div>

              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Original WhatsApp Message</label>
                <textarea
                  rows="3"
                  value={editedLead.message}
                  onChange={e => setEditedLead({ ...editedLead, message: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Branch</label>
                  <select
                    value={editedLead.branch}
                    onChange={e => setEditedLead({ ...editedLead, branch: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  >
                    <option value="">No Branch / All</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Status</label>
                  <select
                    value={editedLead.status}
                    onChange={e => setEditedLead({ ...editedLead, status: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  >
                    {COLUMNS.map(col => (
                      <option key={col.id} value={col.id}>{col.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Follow-up Notes</label>
                <textarea
                  rows="3"
                  value={editedLead.notes}
                  onChange={e => setEditedLead({ ...editedLead, notes: e.target.value })}
                  placeholder="Write internal comments on what was discussed or next steps..."
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button
                  type="button"
                  onClick={() => handleDeleteLead(selectedLead.id)}
                  style={{
                    background: 'none', border: '1px solid var(--danger-border)',
                    color: 'var(--danger)', borderRadius: '6px', padding: '0.5rem 1rem',
                    fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                  }}
                >
                  <Trash2 size={15} /> Delete Lead
                </button>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn btn-sm" onClick={() => setIsDetailOpen(false)} style={{ background: '#f1f5f9', border: '1px solid var(--border-color)', color: 'var(--text-main)', cursor: 'pointer' }}>Cancel</button>
                  <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Save size={16} /> Save Changes</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
