'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { 
  Plus, 
  Search, 
  Filter, 
  LayoutList, 
  Kanban, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Sparkles, 
  Download, 
  Copy, 
  RefreshCw, 
  Image as ImageIcon, 
  MessageSquare, 
  Check, 
  MoreVertical, 
  ExternalLink,
  ShieldCheck,
  Bug,
  Zap,
  Palette,
  Database
} from 'lucide-react';
import { 
  ISSUE_STATUSES, 
  ISSUE_TYPES, 
  ISSUE_PRIORITIES, 
  ISSUE_MODULES, 
  STATUS_COLORS, 
  PRIORITY_COLORS, 
  getIssues, 
  updateIssue, 
  deleteIssue, 
  subscribeToIssues 
} from '@/services/qaTrackerService';
import QaIssueFormModal from '@/components/qa/QaIssueFormModal';
import QaIssueDetailModal from '@/components/qa/QaIssueDetailModal';

export default function NewQaTrackerPage() {
  const { user } = useAuth();

  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'kanban'

  // Filter states
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState(null);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Initial load & subscription
  useEffect(() => {
    fetchIssues();
    const unsub = subscribeToIssues(
      (data) => {
        setIssues(data);
        setLoading(false);
      },
      (err) => console.error('Subscription error:', err),
      {},
      12000
    );
    return () => unsub();
  }, []);

  const fetchIssues = async () => {
    try {
      setRefreshing(true);
      const data = await getIssues();
      setIssues(data);
    } catch (err) {
      console.error('Error fetching QA issues:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Filtered issues
  const filteredIssues = useMemo(() => {
    return issues.filter(issue => {
      if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
      if (typeFilter !== 'all' && issue.type !== typeFilter) return false;
      if (priorityFilter !== 'all' && issue.priority !== priorityFilter) return false;
      if (moduleFilter !== 'all' && issue.module !== moduleFilter) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTitle = (issue.title || '').toLowerCase().includes(q);
        const matchDesc = (issue.description || '').toLowerCase().includes(q);
        const matchReporter = (issue.reporterName || '').toLowerCase().includes(q);
        const matchAssignee = (issue.assigneeName || '').toLowerCase().includes(q);
        const matchId = String(issue.id).includes(q);
        if (!matchTitle && !matchDesc && !matchReporter && !matchAssignee && !matchId) {
          return false;
        }
      }

      return true;
    });
  }, [issues, statusFilter, typeFilter, priorityFilter, moduleFilter, search]);

  // KPI Metrics Calculation
  const stats = useMemo(() => {
    const total = issues.length;
    const openCount = issues.filter(i => i.status === 'Open').length;
    const inProgressCount = issues.filter(i => i.status === 'In Progress').length;
    const readyForQaCount = issues.filter(i => i.status === 'Ready for QA').length;
    const resolvedCount = issues.filter(i => i.status === 'Resolved' || i.status === 'Closed').length;
    const criticalCount = issues.filter(i => i.priority === 'Critical' && i.status !== 'Closed' && i.status !== 'Resolved').length;

    return { total, openCount, inProgressCount, readyForQaCount, resolvedCount, criticalCount };
  }, [issues]);

  // Quick Status change from table or Kanban
  const handleQuickStatusChange = async (issueId, newStatus) => {
    try {
      setIssues(prev => prev.map(i => i.id === issueId ? { ...i, status: newStatus } : i));
      await updateIssue(issueId, { status: newStatus });
      if (selectedIssue && selectedIssue.id === issueId) {
        setSelectedIssue(prev => ({ ...prev, status: newStatus }));
      }
    } catch (err) {
      console.error('Error updating status:', err);
      fetchIssues();
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (!issues.length) return;
    const headers = ['ID', 'Title', 'Type', 'Status', 'Priority', 'Module', 'Reporter', 'Assignee', 'Created At', 'Attachments Count'];
    const rows = filteredIssues.map(i => [
      i.id,
      `"${(i.title || '').replace(/"/g, '""')}"`,
      i.type,
      i.status,
      i.priority,
      i.module,
      `"${i.reporterName || ''}"`,
      `"${i.assigneeName || ''}"`,
      `"${new Date(i.createdAt).toISOString()}"`,
      i.attachments?.length || 0
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `qa_issues_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy Markdown Summary for Team Sync
  const handleCopyMarkdownSummary = () => {
    const openBugs = filteredIssues.filter(i => i.status === 'Open' || i.status === 'In Progress' || i.status === 'Ready for QA');
    let md = `### 📋 QA Bug & Update Report (${new Date().toLocaleDateString()})\n\n`;
    md += `**Total Active Issues:** ${openBugs.length} | **Critical:** ${stats.criticalCount}\n\n`;
    md += `| ID | Priority | Module | Topic | Status | Reporter |\n`;
    md += `|---|---|---|---|---|---|\n`;
    openBugs.forEach(i => {
      md += `| #${i.id} | ${i.priority} | ${i.module} | ${i.title} | ${i.status} | ${i.reporterName || 'QA'} |\n`;
    });

    navigator.clipboard.writeText(md);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 3000);
  };

  const getPriorityBadge = (priority) => {
    const style = PRIORITY_COLORS[priority] || { bg: '#64748b', text: '#fff' };
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '6px',
          fontSize: '0.72rem',
          fontWeight: 700,
          backgroundColor: style.bg,
          color: style.text
        }}
      >
        {priority === 'Critical' && <AlertCircle size={11} />}
        {priority}
      </span>
    );
  };

  return (
    <div className="new-qa-tracker-page" style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
      
      {/* Page Header */}
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              QA & Bug Tracker
            </h1>
            <span style={{ background: '#e0e7ff', color: '#4338ca', fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: '99px' }}>
              QA Live Hub
            </span>
          </div>
          <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>
            Track issues, log bugs, highlight screenshots, and manage testing workflow.
          </p>
        </div>

        {/* Header Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={fetchIssues}
            disabled={refreshing}
            style={{
              padding: '0.55rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#475569',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}
            title="Refresh Issues"
          >
            <RefreshCw size={15} className={refreshing ? 'loading-spinner' : ''} /> Refresh
          </button>

          <button
            type="button"
            onClick={handleCopyMarkdownSummary}
            style={{
              padding: '0.55rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: copiedSummary ? '#10b981' : '#475569',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}
            title="Copy formatted markdown report for Slack or team sync"
          >
            {copiedSummary ? <Check size={15} /> : <Copy size={15} />}
            {copiedSummary ? 'Copied Summary!' : 'Copy Summary'}
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            style={{
              padding: '0.55rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#475569',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}
            title="Export tickets to CSV"
          >
            <Download size={15} /> Export CSV
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingIssue(null);
              setIsFormOpen(true);
            }}
            style={{
              padding: '0.55rem 1.25rem',
              borderRadius: '8px',
              border: 'none',
              background: '#4f46e5',
              color: '#fff',
              fontSize: '0.88rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              boxShadow: '0 2px 8px rgba(79, 70, 229, 0.4)'
            }}
          >
            <Plus size={18} /> Report Issue / Bug
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div 
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}
      >
        <div style={{ background: '#fff', padding: '1rem 1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Total Issues</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f172a', marginTop: '0.2rem' }}>{stats.total}</div>
        </div>

        <div style={{ background: '#fff', padding: '1rem 1.25rem', borderRadius: '12px', border: '1px solid #fecaca', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#dc2626', textTransform: 'uppercase' }}>Open (New)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#b91c1c', marginTop: '0.2rem' }}>{stats.openCount}</div>
        </div>

        <div style={{ background: '#fff', padding: '1rem 1.25rem', borderRadius: '12px', border: '1px solid #c7d2fe', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#4338ca', textTransform: 'uppercase' }}>In Progress</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#3730a3', marginTop: '0.2rem' }}>{stats.inProgressCount}</div>
        </div>

        <div style={{ background: '#fff', padding: '1rem 1.25rem', borderRadius: '12px', border: '1px solid #fde68a', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#d97706', textTransform: 'uppercase' }}>Ready for QA</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#92400e', marginTop: '0.2rem' }}>{stats.readyForQaCount}</div>
        </div>

        <div style={{ background: '#fff', padding: '1rem 1.25rem', borderRadius: '12px', border: '1px solid #bbf7d0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#16a34a', textTransform: 'uppercase' }}>Resolved / Closed</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#15803d', marginTop: '0.2rem' }}>{stats.resolvedCount}</div>
        </div>

        {stats.criticalCount > 0 && (
          <div style={{ background: '#fef2f2', padding: '1rem 1.25rem', borderRadius: '12px', border: '1px solid #ef4444', boxShadow: '0 1px 3px rgba(239, 68, 68, 0.15)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertCircle size={14} /> Critical P0 Alert
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#dc2626', marginTop: '0.2rem' }}>{stats.criticalCount}</div>
          </div>
        )}
      </div>

      {/* Filter & View Switcher Bar */}
      <div 
        style={{
          background: '#fff',
          padding: '1rem',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          marginBottom: '1.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.85rem'
        }}
      >
        {/* Search Input */}
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
          <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search topic, description, reporter..."
            style={{
              width: '100%',
              padding: '0.55rem 0.75rem 0.55rem 2.1rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.88rem',
              outline: 'none'
            }}
          />
        </div>

        {/* Dropdown Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem', background: '#fff' }}
          >
            <option value="all">All Statuses</option>
            {ISSUE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem', background: '#fff' }}
          >
            <option value="all">All Priorities</option>
            {ISSUE_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem', background: '#fff' }}
          >
            <option value="all">All Categories</option>
            {ISSUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem', background: '#fff' }}
          >
            <option value="all">All Modules</option>
            {ISSUE_MODULES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* View Mode Toggle: List vs Kanban */}
        <div style={{ display: 'flex', alignItems: 'center', background: '#f1f5f9', borderRadius: '8px', padding: '3px', border: '1px solid #e2e8f0' }}>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            style={{
              padding: '0.35rem 0.65rem',
              borderRadius: '6px',
              border: 'none',
              background: viewMode === 'list' ? '#fff' : 'transparent',
              color: viewMode === 'list' ? '#0f172a' : '#64748b',
              fontWeight: viewMode === 'list' ? 700 : 500,
              fontSize: '0.82rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            <LayoutList size={15} /> List
          </button>

          <button
            type="button"
            onClick={() => setViewMode('kanban')}
            style={{
              padding: '0.35rem 0.65rem',
              borderRadius: '6px',
              border: 'none',
              background: viewMode === 'kanban' ? '#fff' : 'transparent',
              color: viewMode === 'kanban' ? '#0f172a' : '#64748b',
              fontWeight: viewMode === 'kanban' ? 700 : 500,
              fontSize: '0.82rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              boxShadow: viewMode === 'kanban' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            <Kanban size={15} /> Kanban
          </button>
        </div>
      </div>

      {/* Main Content: List View OR Kanban Board */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 1rem auto' }} />
          Loading QA tickets...
        </div>
      ) : filteredIssues.length === 0 ? (
        <div style={{ background: '#fff', padding: '3.5rem 1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
          <Bug size={36} color="#94a3b8" style={{ margin: '0 auto 0.75rem auto' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>No QA issues found</h3>
          <p style={{ fontSize: '0.88rem', color: '#64748b', marginTop: '0.3rem' }}>
            {search || statusFilter !== 'all' ? 'Try adjusting your search filters' : 'Great job! No unresolved bugs logged yet.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingIssue(null);
              setIsFormOpen(true);
            }}
            style={{
              marginTop: '1rem',
              padding: '0.55rem 1.25rem',
              borderRadius: '8px',
              border: 'none',
              background: '#4f46e5',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.88rem',
              cursor: 'pointer'
            }}
          >
            + Report First Bug
          </button>
        </div>
      ) : viewMode === 'list' ? (
        /* LIST / TABLE VIEW */
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '0.85rem 1rem' }}>ID</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Topic / Issue</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Category</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Priority</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Module</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Status</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Reporter / Assignee</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Media</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.map((issue) => {
                  const statusStyle = STATUS_COLORS[issue.status] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
                  const hasHighlighted = issue.attachments?.some(a => a.annotated);

                  return (
                    <tr
                      key={issue.id}
                      onClick={() => setSelectedIssue(issue)}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        cursor: 'pointer',
                        transition: 'background 0.12s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      {/* ID */}
                      <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#64748b', fontSize: '0.82rem' }}>
                        #{issue.id}
                      </td>

                      {/* Topic & Description snippet */}
                      <td style={{ padding: '0.85rem 1rem', maxWidth: '320px' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.15rem' }}>
                          {issue.title}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {issue.description}
                        </div>
                      </td>

                      {/* Category */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#4f46e5', background: '#eef2ff', padding: '2px 8px', borderRadius: '6px' }}>
                          {issue.type || 'Bug'}
                        </span>
                      </td>

                      {/* Priority */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        {getPriorityBadge(issue.priority)}
                      </td>

                      {/* Module */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span style={{ fontSize: '0.78rem', color: '#334155', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: '6px' }}>
                          {issue.module || 'General'}
                        </span>
                      </td>

                      {/* Status Dropdown */}
                      <td style={{ padding: '0.85rem 1rem' }} onClick={(e) => e.stopPropagation()}>
                        <select
                          value={issue.status}
                          onChange={(e) => handleQuickStatusChange(issue.id, e.target.value)}
                          style={{
                            padding: '0.25rem 0.6rem',
                            borderRadius: '6px',
                            border: `1px solid ${statusStyle.border}`,
                            background: statusStyle.bg,
                            color: statusStyle.text,
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            outline: 'none'
                          }}
                        >
                          {ISSUE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>

                      {/* Reporter / Assignee */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b' }}>
                          {issue.reporterName || 'QA'}
                        </div>
                        {issue.assigneeName && (
                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            assigned: <strong>{issue.assigneeName}</strong>
                          </div>
                        )}
                      </td>

                      {/* Media / Attachments & Comments */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {issue.attachments?.length > 0 && (
                            <span 
                              style={{ 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '3px', 
                                fontSize: '0.75rem', 
                                background: hasHighlighted ? '#e0f2fe' : '#f1f5f9', 
                                color: hasHighlighted ? '#0369a1' : '#475569', 
                                padding: '2px 6px', 
                                borderRadius: '4px',
                                fontWeight: 600
                              }}
                              title={hasHighlighted ? 'Has highlighted markup screenshots' : 'Attachments'}
                            >
                              <ImageIcon size={13} /> {issue.attachments.length}
                              {hasHighlighted && <Sparkles size={11} />}
                            </span>
                          )}
                          {issue.commentCount > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.75rem', background: '#f1f5f9', color: '#475569', padding: '2px 6px', borderRadius: '4px' }}>
                              <MessageSquare size={12} /> {issue.commentCount}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedIssue(issue)}
                            style={{
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              background: '#fff',
                              color: '#334155',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* KANBAN BOARD VIEW */
        <div 
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
            alignItems: 'start'
          }}
        >
          {ISSUE_STATUSES.map(columnStatus => {
            const columnIssues = filteredIssues.filter(i => i.status === columnStatus);
            const colStyle = STATUS_COLORS[columnStatus] || { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };

            return (
              <div 
                key={columnStatus}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  minHeight: '400px'
                }}
              >
                {/* Column Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '2px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: colStyle.text }} />
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>
                      {columnStatus}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: colStyle.text, background: colStyle.bg, padding: '2px 8px', borderRadius: '99px' }}>
                    {columnIssues.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {columnIssues.length === 0 ? (
                    <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem', fontStyle: 'italic' }}>
                      No tickets
                    </div>
                  ) : (
                    columnIssues.map(issue => {
                      const firstImg = issue.attachments?.[0];
                      const hasHighlighted = issue.attachments?.some(a => a.annotated);

                      return (
                        <div
                          key={issue.id}
                          onClick={() => setSelectedIssue(issue)}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '10px',
                            padding: '0.85rem',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                            cursor: 'pointer',
                            transition: 'transform 0.15s, box-shadow 0.15s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.08)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                          }}
                        >
                          {/* Card Top Meta */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>
                              #{issue.id}
                            </span>
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#4f46e5', background: '#eef2ff', padding: '1px 6px', borderRadius: '4px' }}>
                                {issue.type}
                              </span>
                              {getPriorityBadge(issue.priority)}
                            </div>
                          </div>

                          {/* Card Title */}
                          <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.35rem 0', lineHeight: 1.3 }}>
                            {issue.title}
                          </h4>

                          {/* Card Image Preview if available */}
                          {firstImg && (
                            <div style={{ height: '90px', borderRadius: '6px', overflow: 'hidden', margin: '0.4rem 0', background: '#0f172a', position: 'relative' }}>
                              <img src={firstImg.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              {hasHighlighted && (
                                <div style={{ position: 'absolute', top: '4px', left: '4px', background: '#0284c7', color: '#fff', fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: '3px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <Sparkles size={9} /> Highlighted
                                </div>
                              )}
                            </div>
                          )}

                          {/* Card Module & Reporter Footer */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid #f1f5f9', fontSize: '0.72rem', color: '#64748b' }}>
                            <span style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '4px' }}>
                              {issue.module || 'General'}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              {issue.commentCount > 0 && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <MessageSquare size={11} /> {issue.commentCount}
                                </span>
                              )}
                              <span>{issue.reporterName || 'QA'}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Form Modal */}
      {isFormOpen && (
        <QaIssueFormModal
          isOpen={isFormOpen}
          issue={editingIssue}
          currentUser={user}
          onClose={() => {
            setIsFormOpen(false);
            setEditingIssue(null);
          }}
          onSuccess={() => {
            fetchIssues();
          }}
        />
      )}

      {/* Issue Detail Modal */}
      {selectedIssue && (
        <QaIssueDetailModal
          isOpen={Boolean(selectedIssue)}
          issue={selectedIssue}
          currentUser={user}
          onClose={() => setSelectedIssue(null)}
          onEdit={(iss) => {
            setSelectedIssue(null);
            setEditingIssue(iss);
            setIsFormOpen(true);
          }}
          onUpdated={(updated) => {
            setSelectedIssue(updated);
            setIssues(prev => prev.map(i => i.id === updated.id ? updated : i));
          }}
          onDeleted={(deletedId) => {
            setSelectedIssue(null);
            setIssues(prev => prev.filter(i => i.id !== deletedId));
          }}
        />
      )}
    </div>
  );
}
