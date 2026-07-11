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
} from '../services/newCrmService';
import { logActivity } from '../services/activityService';
import { doTimeSlotsOverlap } from '../utils/timeUtils';
import {
  Plus, X, Search, Trash2, ExternalLink, Phone, Save, Clock, Calendar
} from 'lucide-react';

const COLUMNS = [
  { id: 'interest_trial', title: 'Interest Trial', color: '#4f46e5', badge: 'rgba(79, 70, 229, 0.15)', textColor: '#4f46e5' },
  { id: 'no_response', title: 'No Response', color: '#f59e0b', badge: 'rgba(245, 158, 11, 0.15)', textColor: '#b45309' },
  { id: 'trial_booked', title: 'Trial Booked', color: '#10b981', badge: 'rgba(16, 185, 129, 0.15)', textColor: '#047857' },
  { id: 'closed', title: 'Closed', color: '#64748b', badge: 'rgba(100, 116, 139, 0.15)', textColor: '#475569' }
];

const cleanDay = (day) => {
  if (!day) return '';
  return day.replace(/^\d+\.\s*/, '');
};

const getLevenshteinDistance = (a, b) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

const getScheduledClass = (lead, overallClasses = []) => {
  if (!lead || !lead.name) return null;
  
  // Extract candidate names to match (e.g. child name and/or parent name)
  const namesToMatch = [];
  const parentOfMatch = lead.name.match(/^([^(]+)\s+\(Parent of\s+([^)]+)\)/i) || lead.name.match(/^([^(]+)\s+Parent of\s+(.+)/i);
  if (parentOfMatch) {
    namesToMatch.push(parentOfMatch[2].trim()); // Child name
    namesToMatch.push(parentOfMatch[1].trim()); // Parent name
  } else {
    const parenMatch = lead.name.match(/^([^(]+)\s+\(([^)]+)\)/);
    if (parenMatch) {
      namesToMatch.push(parenMatch[1].trim());
      namesToMatch.push(parenMatch[2].trim());
    } else {
      namesToMatch.push(lead.name.trim());
    }
  }
  
  const cleanStr = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanTargets = namesToMatch
    .map(name => cleanStr(name))
    .filter(name => name.length >= 2);
  
  if (cleanTargets.length === 0) return null;
  
  const isMatch = (classStudent) => {
    if (!classStudent) return false;
    const classStudentClean = cleanStr(classStudent);
    if (!classStudentClean || classStudentClean.length < 2) return false;
    
    return cleanTargets.some(targetClean => {
      // 1. Exact match
      if (classStudentClean === targetClean) return true;
      
      // 2. Substring match for longer strings
      if (targetClean.length >= 4 && classStudentClean.length >= 4) {
        if (classStudentClean.includes(targetClean) || targetClean.includes(classStudentClean)) {
          return true;
        }
      }
      
      // 3. Fuzzy Levenshtein match (distance <= 1) for minor typos/spelling variations
      if (targetClean.length >= 3 && classStudentClean.length >= 3) {
        if (getLevenshteinDistance(targetClean, classStudentClean) <= 1) {
          return true;
        }
      }
      
      return false;
    });
  };

  // 1. Try matching within the same branch first
  let found = overallClasses.find(c => {
    const sameBranch = lead.branch && c.branchName && lead.branch.toLowerCase() === c.branchName.toLowerCase();
    return sameBranch && isMatch(c.student);
  });
  
  // 2. Fallback to any branch ONLY if lead doesn't specify a branch
  if (!found && (!lead.branch || lead.branch.trim() === '')) {
    found = overallClasses.find(c => isMatch(c.student));
  }
  
  return found;
};

const parseLooseCrmDate = (value) => {
  const v = String(value || '').trim();
  if (!v || v === '-') return null;

  // 1. ISO format YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) {
    const d = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // 2. DMY / DM: e.g. 21/12/2025, 21-12, 21.12.25
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/.exec(v);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    let year = dmy[3] ? parseInt(dmy[3], 10) : new Date().getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  // 3. Try standard month string parsing (e.g., "11 Jul", "11 Jul 2026")
  let cleanVal = v;
  const idMonths = {
    mei: 'may', agustus: 'august', des: 'dec', desember: 'december',
    okt: 'oct', oktober: 'october', maret: 'march', juli: 'july'
  };
  for (const [id, en] of Object.entries(idMonths)) {
    cleanVal = cleanVal.replace(new RegExp(`\\b${id}\\b`, 'gi'), en);
  }

  const hasYear = /\b(20\d{2}|\d{2})$/.test(cleanVal.trim());
  if (!hasYear) {
    const currentYear = new Date().getFullYear();
    cleanVal = `${cleanVal} ${currentYear}`;
  }

  const native = new Date(cleanVal);
  if (!isNaN(native.getTime())) {
    native.setHours(0, 0, 0, 0);
    return native;
  }

  return null;
};

const formatDateToISO = (date) => {
  if (!date) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const crmDatesEqual = (d1, d2) => {
  if (!d1 || !d2) return false;
  const clean1 = d1.trim().toLowerCase();
  const clean2 = d2.trim().toLowerCase();
  if (clean1 === clean2) return true;

  const p1 = parseLooseCrmDate(d1);
  const p2 = parseLooseCrmDate(d2);
  if (!p1 || !p2) return clean1 === clean2;
  return p1.getTime() === p2.getTime();
};

export default function CrmPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { branches, activeBranchName, overallClasses = [] } = useSchedule();

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchFilter, setSelectedBranchFilter] = useState('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState('table'); // Default to table view
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const [selectedCrmInstructor, setSelectedCrmInstructor] = useState('');
  const [selectedCrmDay, setSelectedCrmDay] = useState('Saturday');
  const [selectedCrmDate, setSelectedCrmDate] = useState('');

  // Extract unique instructor names in the currently filtered branch
  const activeBranchInstructors = useMemo(() => {
    const insts = new Set();
    overallClasses.forEach(c => {
      if (selectedBranchFilter === 'all' || c.branchName === selectedBranchFilter) {
        if (c.teacher && c.teacher !== '-') {
          insts.add(c.teacher);
        }
      }
    });
    return Array.from(insts).sort();
  }, [overallClasses, selectedBranchFilter]);

  // Extract unique trial dates from schedule
  const availableTrialDates = useMemo(() => {
    const dates = new Set();
    overallClasses.forEach(c => {
      if (c.date) {
        dates.add(c.date.trim());
      }
    });
    return Array.from(dates).sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [overallClasses]);

  // Sync selectedCrmInstructor when the instructor list loads or changes
  useEffect(() => {
    if (activeBranchInstructors.length > 0) {
      if (!selectedCrmInstructor || !activeBranchInstructors.includes(selectedCrmInstructor)) {
        setSelectedCrmInstructor(activeBranchInstructors[0]);
      }
    } else {
      setSelectedCrmInstructor('');
    }
  }, [activeBranchInstructors, selectedCrmInstructor]);

  // Sync selectedCrmDate when trial dates load or change
  useEffect(() => {
    if (availableTrialDates.length > 0) {
      const hasMatch = selectedCrmDate && availableTrialDates.some(d => crmDatesEqual(d, selectedCrmDate));
      if (!selectedCrmDate || !hasMatch) {
        const firstDateObj = parseLooseCrmDate(availableTrialDates[0]);
        if (firstDateObj) {
          setSelectedCrmDate(formatDateToISO(firstDateObj));
        }
      }
    } else {
      setSelectedCrmDate('');
    }
  }, [availableTrialDates, selectedCrmDate]);

  const handleCrmDateChange = (e) => {
    const dateStr = e.target.value; // YYYY-MM-DD
    setSelectedCrmDate(dateStr);
    
    if (dateStr) {
      const parsed = parseLooseCrmDate(dateStr);
      if (parsed) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = days[parsed.getDay()];
        if (dayName !== 'Sunday') {
          setSelectedCrmDay(dayName);
        }
      }
    }
  };

  // Helper for standard slots based on weekday or weekend
  const getStandardSlotsForDay = (day) => {
    if (day === 'Saturday' || day === 'Sunday') {
      return [
        '10.00 am - 11.00 am',
        '11.00 am - 12.00 pm',
        '1.00 pm - 2.00 pm',
        '2.00 pm - 3.00 pm',
        '3.00 pm - 4.00 pm',
        '4.00 pm - 5.00 pm'
      ];
    }
    return [
      '1.00 pm - 2.00 pm',
      '2.00 pm - 3.00 pm',
      '3.00 pm - 4.00 pm',
      '4.00 pm - 5.00 pm',
      '5.00 pm - 6.00 pm'
    ];
  };

  // Calculate slot remaining capacity for the selected instructor on the selected day
  const instructorSlotsData = useMemo(() => {
    if (!selectedCrmInstructor) return [];

    const slots = getStandardSlotsForDay(selectedCrmDay);
    const dayClasses = overallClasses.filter(c => 
      c.teacher.toLowerCase() === selectedCrmInstructor.toLowerCase() && 
      c.day === selectedCrmDay &&
      (selectedBranchFilter === 'all' || c.branchName === selectedBranchFilter)
    );

    // Filter dayClasses by date: include regular classes (no date) + trial classes matching selectedCrmDate
    const filteredDayClasses = dayClasses.filter(c => {
      if (!c.date) return true;
      if (selectedCrmDate) {
        return crmDatesEqual(c.date, selectedCrmDate);
      }
      return true;
    });

    return slots.map(slotStr => {
      // Find all classes in this slot (overlapping check)
      const matchedClasses = filteredDayClasses.filter(c => doTimeSlotsOverlap(c.time, slotStr));
      
      let status = 'Free';
      let bookedStudents = [];
      let remaining = 4; // Max capacity is 4

      if (matchedClasses.length > 0) {
        // If there's at least one regular class (non-trial), the slot is fully booked
        const hasRegularClass = matchedClasses.some(c => 
          !c.program?.toLowerCase().includes('trial') && 
          !c.remarks?.toLowerCase().includes('trial')
        );

        if (hasRegularClass) {
          status = 'Booked';
          remaining = 0;
          bookedStudents = matchedClasses.map(c => c.student);
        } else {
          status = 'Trial';
          const students = [];
          matchedClasses.forEach(c => {
            if (c.student) {
              c.student.split(',').forEach(s => {
                const trimmed = s.trim();
                if (trimmed) students.push(trimmed);
              });
            }
          });
          bookedStudents = students;
          remaining = Math.max(0, 4 - students.length);
        }
      }

      return {
        slot: slotStr,
        status,
        bookedStudents,
        remaining
      };
    });
  }, [selectedCrmInstructor, selectedCrmDay, selectedCrmDate, overallClasses, selectedBranchFilter]);
  
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
    branch: '',
    trialDate: ''
  });

  const [editedLead, setEditedLead] = useState({
    name: '',
    phone: '',
    message: '',
    status: '',
    notes: '',
    branch: '',
    trialDate: ''
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

    const lead = leads.find(l => l.id === leadId);
    const leadName = lead ? lead.name : 'Unknown Lead';

    // Optimistic update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus, updatedAt: new Date() } : l));

    try {
      await updateLead(leadId, { status: newStatus });
      logActivity(user?.email, 'changed lead status', `Changed status of "${leadName}" to "${newStatus}"`);
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
      logActivity(user?.email, 'added CRM lead', `Added lead "${newLead.name}"`);
      setIsAddOpen(false);
      setNewLead({ name: '', phone: '', message: '', status: 'interest_trial', notes: '', branch: '', trialDate: '' });
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
      branch: lead.branch || '',
      trialDate: lead.trialDate || ''
    });
    setIsDetailOpen(true);
  };

  const handleUpdateDetails = async (e) => {
    e.preventDefault();
    if (!selectedLead) return;

    try {
      await updateLead(selectedLead.id, editedLead);

      // Determine what changed to write a nice log
      const changes = [];
      if (selectedLead.status !== editedLead.status) {
        changes.push(`status to "${editedLead.status}"`);
      }
      if (selectedLead.notes !== editedLead.notes) {
        changes.push(`notes`);
      }
      if (selectedLead.name !== editedLead.name) {
        changes.push(`name to "${editedLead.name}"`);
      }
      if (selectedLead.phone !== editedLead.phone) {
        changes.push(`phone`);
      }
      if (selectedLead.branch !== editedLead.branch) {
        changes.push(`branch to "${editedLead.branch}"`);
      }
      if (selectedLead.trialDate !== editedLead.trialDate) {
        changes.push(`trialDate to "${editedLead.trialDate}"`);
      }

      const changeMsg = changes.length > 0 ? `Updated ${changes.join(', ')}` : 'No changes';
      logActivity(user?.email, 'updated CRM lead details', `Lead: "${selectedLead.name}". ${changeMsg}`);

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

    const lead = leads.find(l => l.id === leadId);
    const leadName = lead ? lead.name : 'Unknown Lead';

    try {
      await deleteLead(leadId);
      logActivity(user?.email, 'deleted CRM lead', `Deleted lead "${leadName}"`);
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

      {/* Instructor Slot Availability Panel */}
      {activeBranchInstructors.length > 0 && (
        <div style={{
          background: 'white',
          padding: '1.25rem',
          borderRadius: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          marginBottom: '1.5rem',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>Instructor Slots Remaining</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Check real-time capacity and booked students per instructor</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {/* Instructor Select Dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Instructor:</span>
                <select
                  value={selectedCrmInstructor}
                  onChange={e => setSelectedCrmInstructor(e.target.value)}
                  style={{
                    padding: '0.4rem 0.6rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.82rem',
                    background: 'white',
                    cursor: 'pointer'
                  }}
                >
                  {activeBranchInstructors.map(inst => (
                    <option key={inst} value={inst}>{inst}</option>
                  ))}
                </select>
              </div>

              {/* Day Select Dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Day:</span>
                <select
                  value={selectedCrmDay}
                  onChange={e => setSelectedCrmDay(e.target.value)}
                  style={{
                    padding: '0.4rem 0.6rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.82rem',
                    background: 'white',
                    cursor: 'pointer'
                  }}
                >
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Date Calendar Picker */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Date:</span>
                <input
                  type="date"
                  value={selectedCrmDate}
                  onChange={handleCrmDateChange}
                  style={{
                    padding: '0.4rem 0.6rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.82rem',
                    background: 'white',
                    cursor: 'pointer',
                    outline: 'none',
                    height: '34px',
                    boxSizing: 'border-box'
                  }}
                />
                {selectedCrmDate && (
                  <button
                    onClick={() => setSelectedCrmDate('')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '2px',
                      marginLeft: '2px'
                    }}
                    title="Clear Date"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Slots Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '0.85rem'
          }}>
            {instructorSlotsData.map(data => {
              const isFree = data.status === 'Free';
              const isTrial = data.status === 'Trial';
              const isBooked = data.status === 'Booked';

              let cardBg = '#f8fafc';
              let borderCol = '#e2e8f0';
              let badgeBg = 'rgba(100, 116, 139, 0.1)';
              let badgeColor = '#475569';
              let badgeText = 'Regular Class';

              if (isFree) {
                cardBg = 'rgba(34, 197, 94, 0.02)';
                borderCol = '#bbf7d0';
                badgeBg = 'rgba(34, 197, 94, 0.1)';
                badgeColor = '#166534';
                badgeText = 'Available';
              } else if (isTrial) {
                cardBg = 'rgba(245, 158, 11, 0.02)';
                borderCol = '#fde047';
                badgeBg = 'rgba(245, 158, 11, 0.1)';
                badgeColor = '#854d0e';
                badgeText = 'Trial Session';
              }

              return (
                <div key={data.slot} style={{
                  background: cardBg,
                  border: `1px solid ${borderCol}`,
                  borderRadius: '8px',
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  position: 'relative'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
                      {data.slot.replace(' am', '').replace(' pm', '')}
                    </span>
                    <span style={{
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: '4px',
                      background: badgeBg,
                      color: badgeColor,
                      textTransform: 'uppercase',
                      letterSpacing: '0.02em'
                    }}>
                      {badgeText}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isFree ? '#166534' : isTrial ? '#854d0e' : '#475569' }}>
                      {data.remaining} slot{data.remaining !== 1 ? 's' : ''} left
                    </span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      Capacity: {4 - data.remaining}/4 booked
                    </span>
                  </div>

                  {data.bookedStudents.length > 0 && (
                    <div style={{
                      borderTop: '1px solid rgba(0,0,0,0.04)',
                      paddingTop: '0.4rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      maxHeight: '48px',
                      overflowY: 'auto'
                    }}>
                      {data.bookedStudents.map((st, idx) => (
                        <div key={idx} style={{
                          fontSize: '0.68rem',
                          color: 'var(--text-secondary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }} title={st}>
                          • {st}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                <th>Weekly Schedule</th>
                <th>Trial Date</th>
                <th>Admin Notes</th>
                <th>Updated At</th>
                <th style={{ width: 100, textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan="10" className="empty-state-table" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    No leads match your filter.
                  </td>
                </tr>
              ) : (
                pagedLeads.map((lead) => {
                  const statusCol = COLUMNS.find(c => c.id === lead.status) || COLUMNS[0];
                  const matchedClass = getScheduledClass(lead, overallClasses);
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
                        {matchedClass ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{
                              fontSize: '0.75rem',
                              fontWeight: 'bold',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#047857',
                              alignSelf: 'start',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}>
                              {cleanDay(matchedClass.day)} • {matchedClass.time.split(' - ')[0]}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', paddingLeft: '2px' }}>
                              {matchedClass.teacher} {lead.branch?.toLowerCase() !== matchedClass.branchName?.toLowerCase() ? `(${matchedClass.branchName})` : ''}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td>
                        {lead.trialDate ? (
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 500 }}>
                            {lead.trialDate}
                          </span>
                        ) : matchedClass && matchedClass.date ? (
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }} title="Derived from sheet schedule">
                            {matchedClass.date}*
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>—</span>
                        )}
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
                    columnLeads.map((lead) => {
                      const matchedClass = getScheduledClass(lead, overallClasses);
                      return (
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

                        {matchedClass && (
                          <div style={{
                            fontSize: '0.75rem',
                            background: 'rgba(16, 185, 129, 0.1)',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            color: '#047857',
                            marginBottom: '0.6rem',
                            borderLeft: '2px solid #10b981',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }} title={`Scheduled on ${cleanDay(matchedClass.day)} ${matchedClass.time} with ${matchedClass.teacher}`}>
                            <strong>Weekly:</strong> {cleanDay(matchedClass.day)} • {matchedClass.time.split(' - ')[0]} ({matchedClass.teacher})
                          </div>
                        )}

                        {(lead.trialDate || (matchedClass && matchedClass.date)) && (
                          <div style={{
                            fontSize: '0.75rem',
                            background: 'rgba(59, 130, 246, 0.1)',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            color: 'var(--primary-blue)',
                            marginBottom: '0.6rem',
                            borderLeft: '2px solid var(--primary-blue)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            <strong>Trial Date:</strong> {lead.trialDate || `${matchedClass.date}*`}
                          </div>
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
                      );
                    })
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
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Trial Date</label>
                <input
                  type="text"
                  value={newLead.trialDate}
                  onChange={e => setNewLead({ ...newLead, trialDate: e.target.value })}
                  placeholder="e.g. 11 Jul 2026 or 18 Jul"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                />
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
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Trial Date</label>
                <input
                  type="text"
                  value={editedLead.trialDate}
                  onChange={e => setEditedLead({ ...editedLead, trialDate: e.target.value })}
                  placeholder="e.g. 11 Jul 2026 or 18 Jul"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                />
              </div>

              {(() => {
                const matched = getScheduledClass(selectedLead, overallClasses);
                return matched ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.85rem',
                    background: '#f0fdf4',
                    padding: '0.75rem',
                    borderRadius: '6px',
                    border: '1px solid #bbf7d0',
                    color: '#15803d',
                    marginBottom: '0.2rem'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}><Calendar size={16} /></span>
                    <span>
                      <strong>Weekly Schedule:</strong> Scheduled on <strong>{cleanDay(matched.day)}</strong> at <strong>{matched.time}</strong> with <strong>{matched.teacher}</strong> ({matched.branchName})
                    </span>
                  </div>
                ) : (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.85rem',
                    background: '#f8fafc',
                    padding: '0.75rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    color: 'var(--text-muted)',
                    marginBottom: '0.2rem'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}><Calendar size={16} /></span>
                    <span>Not yet scheduled in the weekly schedule.</span>
                  </div>
                );
              })()}

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
