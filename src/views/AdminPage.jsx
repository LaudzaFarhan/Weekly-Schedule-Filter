'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useAuth } from '../contexts/AuthContext';
import { Search, UserPlus, Settings, Users, Shield, Lock, Copy, Mail, Bug, Plus, Trash2, Eye, EyeOff, Sparkles, Wrench, X, Calendar as CalendarIcon, UserMinus } from 'lucide-react';
import { createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { auth, secondaryAuth } from '../services/firebase';
import { saveProfile, deleteProfile } from '../services/profileService';
import Pagination from '../components/ui/Pagination';

const INSTRUCTOR_PAGE_SIZE = 8;

const BUG_TYPES = {
  bug: {
    label: 'Bug',
    Icon: Bug,
    bg: 'var(--danger-bg)',
    fg: 'var(--danger)',
    border: 'var(--danger-border)',
  },
  wishlist: {
    label: 'Wishlist',
    Icon: Sparkles,
    bg: 'var(--primary-blue-light)',
    fg: 'var(--primary-blue)',
    border: '#c7d2fe',
  },
  improvement: {
    label: 'Improvement',
    Icon: Wrench,
    bg: 'var(--warning-bg)',
    fg: 'var(--warning)',
    border: 'var(--warning-border)',
  },
};

const BUG_STATUSES = {
  'not-started': { label: 'Not Started', bg: '#fee2e2', fg: '#991b1b' },
  'in-progress': { label: 'In Progress', bg: '#fef3c7', fg: '#92400e' },
  'solved':      { label: 'Done',        bg: '#d1fae5', fg: '#065f46' },
};

const formatDateTime = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
};

const INTERNAL_FEATURES = {
  // ── Page-level features ─────────────────────
  conflicts: 'Conflict Report',
  availability: 'Slot Availability Checker',
  avail_available: '  ↳ Available Column',
  avail_busy: '  ↳ Busy Column',
  avail_leave: '  ↳ On Leave Column',
  leave: 'Leave Management',
  trial: 'Trial Priority Instructors',
  trial_overview: 'Trial Availability Overview',
  student_distribution: '  ↳ Student Distribution Checker',
  workload: 'Instructor Workload',
  finder: 'Free Instructor Finder',
  schedule: 'Master Schedule View',
  trial_input: 'Input Trial Leads',
  tasks: 'To-Do List',
  // ── Navigation / system pages ───────────────
  home: 'Home Page',
  trial_priority: 'Trial Priority Page',
  profiles: 'Instructor Profiles',
  api_docs: 'API Documentation',
  admin: 'Admin Settings',
};

const SIDEBAR_FEATURES = {
  home: 'Home',
  conflicts: 'Conflict Report',
  availability: 'Slot Checker',
  workload: 'Instructor Workload',
  leave: 'Leave Management',
  trial_priority: 'Trial Priority',
  finder: 'Free Instructor Finder',
  schedule: 'Master Schedule View',
  trial_input: 'Input Trial Leads',
  tasks: 'To-Do List',
  profiles: 'Instructor Profiles',
  api_docs: 'API Documentation',
  admin: 'Admin Settings'
};

const ROLES = ['Admin', 'SPA', 'EC', 'Instructor', 'Supervisor'];

export default function AdminPage() {
  const {
    featureToggles, updateFeatureToggles,
    roleToggles, updateRoleToggles,
    users, updateUsers,
    uniqueBaseTeachers,
    disabledInstructors, updateDisabledInstructors,
    branches, disabledBranches, toggleBranchEnabled,
    updateBranches,
    refreshProfiles
  } = useSchedule();
  const { user: currentUser } = useAuth();

  const [activeTab, setActiveTab] = useState('settings');
  const [instructorSearch, setInstructorSearch] = useState('');
  const [instructorPage, setInstructorPage] = useState(1);
  // Hide toggle states by default so screen-shares / demos don't reveal
  // current configuration. Click the eye to reveal.
  const [revealToggles, setRevealToggles] = useState(false);

  // User creation state
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('Instructor');
  const [userStatus, setUserStatus] = useState('');
  const [userLoading, setUserLoading] = useState(false);
  const [createdUser, setCreatedUser] = useState(null);
  const [resetStatus, setResetStatus] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userPage, setUserPage] = useState(1);
  const USER_PAGE_SIZE = 5;

  // Bug tracker state — load from localStorage (synced from API on app mount)
  const [bugList, setBugList] = useState(() => {
    try {
      const saved = localStorage.getItem('bugTracker');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [newBugTitle, setNewBugTitle] = useState('');
  const [newBugFeature, setNewBugFeature] = useState('');
  const [newBugDescription, setNewBugDescription] = useState('');
  const [newBugType, setNewBugType] = useState('bug'); // 'bug' | 'wishlist' | 'improvement'
  const [bugTypeFilter, setBugTypeFilter] = useState('all');
  const [bugStatusFilter, setBugStatusFilter] = useState('all');
  const [openBugId, setOpenBugId] = useState(null); // currently-shown detail modal

  const saveBugs = (list) => {
    setBugList(list);
    try { localStorage.setItem('bugTracker', JSON.stringify(list)); } catch {}
    // Sync to Google Sheets config API
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'bugTracker', value: list }),
    }).catch(() => {});
  };

  const handleAddBug = () => {
    if (!newBugTitle) return;
    const bug = {
      id: Date.now(),
      title: newBugTitle,
      feature: newBugFeature || 'General',
      description: newBugDescription,
      type: newBugType,
      status: 'not-started',
      createdAt: new Date().toISOString(),
      startedAt: null,
      solvedAt: null,
    };
    saveBugs([bug, ...bugList]);
    setNewBugTitle('');
    setNewBugFeature('');
    setNewBugDescription('');
    setNewBugType('bug');
  };

  const handleBugStatusChange = (id, newStatus) => {
    saveBugs(bugList.map(b => {
      if (b.id !== id) return b;
      const updated = { ...b, status: newStatus };
      if (newStatus === 'in-progress' && !b.startedAt) updated.startedAt = new Date().toISOString();
      if (newStatus === 'solved' && !b.solvedAt) updated.solvedAt = new Date().toISOString();
      if (newStatus === 'not-started') { updated.startedAt = null; updated.solvedAt = null; }
      return updated;
    }));
  };

  const handleEditBug = (id, field, value) => {
    saveBugs(bugList.map(b => b.id === id ? { ...b, [field]: value } : b));
  };

  const [editingBugId, setEditingBugId] = useState(null);

  const handleRemoveBug = (id) => {
    saveBugs(bugList.filter(b => b.id !== id));
  };

  // Filtered and paginated users
  const filteredUsers = useMemo(() => {
    return Object.entries(users).filter(([email, role]) => {
      if (userRoleFilter !== 'all' && role !== userRoleFilter) return false;
      if (userSearch && !email.toLowerCase().includes(userSearch.toLowerCase())) return false;
      return true;
    });
  }, [users, userRoleFilter, userSearch]);

  const totalUserPages = Math.ceil(filteredUsers.length / USER_PAGE_SIZE);
  const pagedUsers = filteredUsers.slice((userPage - 1) * USER_PAGE_SIZE, userPage * USER_PAGE_SIZE);

  // --- Handlers for Settings Tab ---
  const handleToggle = (key) => {
    updateFeatureToggles({ ...featureToggles, [key]: !featureToggles[key] });
  };

  const handleInstructorToggle = (name) => {
    const newSet = new Set(disabledInstructors);
    if (newSet.has(name)) newSet.delete(name);
    else newSet.add(name);
    updateDisabledInstructors(newSet);
  };

  const sortedTeachers = useMemo(() => {
    const arr = [...(uniqueBaseTeachers || [])].sort();
    if (!instructorSearch) return arr;
    const s = instructorSearch.toLowerCase();
    return arr.filter((t) => t.toLowerCase().includes(s));
  }, [uniqueBaseTeachers, instructorSearch]);

  const instructorTotalPages = Math.max(1, Math.ceil(sortedTeachers.length / INSTRUCTOR_PAGE_SIZE));
  const safeInstructorPage = Math.min(instructorPage, instructorTotalPages);
  const pagedTeachers = sortedTeachers.slice(
    (safeInstructorPage - 1) * INSTRUCTOR_PAGE_SIZE,
    safeInstructorPage * INSTRUCTOR_PAGE_SIZE
  );

  const disabledCount = disabledInstructors.size;
  const totalCount = uniqueBaseTeachers?.size || 0;

  // --- Handlers for Role Permissions Tab ---
  const handleRoleToggle = (role, feature) => {
    const currentRoleConfig = roleToggles[role] || {};
    const newRoleConfig = { ...currentRoleConfig, [feature]: !currentRoleConfig[feature] };
    updateRoleToggles({ ...roleToggles, [role]: newRoleConfig });
  };

  const handleRoleBulk = (role, value) => {
    const newRoleConfig = {};
    Object.keys(SIDEBAR_FEATURES).forEach((k) => { newRoleConfig[k] = value; });
    updateRoleToggles({ ...roleToggles, [role]: { ...(roleToggles[role] || {}), ...newRoleConfig } });
  };

  // --- Handlers for User Management Tab ---
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newEmail || !newPassword) return;

    setUserLoading(true);
    setUserStatus('');

    try {
      let formattedEmail = newEmail.trim().toLowerCase();
      if (!formattedEmail.includes('@')) formattedEmail = `${formattedEmail}@schedule.local`;
      
      let alreadyExists = false;
      
      try {
        // 1. Create user in Firebase securely without logging out admin
        await createUserWithEmailAndPassword(secondaryAuth, formattedEmail, newPassword);
        await signOut(secondaryAuth); // Clear the secondary auth state immediately
      } catch (authError) {
        if (authError.code === 'auth/email-already-in-use') {
           alreadyExists = true;
           // We continue so we can sync the role and profile
        } else {
           throw authError;
        }
      }

      // 2. Add role mapping
      const newUsersList = { ...users, [formattedEmail]: newRole };
      updateUsers(newUsersList);
      
      // 3. Create/Sync Instructor Profile if they are an instructor
      if (newRole === 'Instructor') {
        try {
          const namePart = formattedEmail.split('@')[0];
          await saveProfile(formattedEmail, {
            fullname: namePart,
            nickname: namePart,
            email: formattedEmail,
            specialization: 'all', // default
            trainingProgress: {
               kinderFoundation: 0, kinderCore: 0,
               juniorFoundation: 0, juniorCore: 0,
               coderBasic: 0, coderIntermediate: 0, coderAdvance: 0
            }
          });
          if (refreshProfiles) refreshProfiles();
        } catch (profileError) {
          alert(`Warning: Account created, but failed to sync profile: ${profileError.message}`);
        }
      }

      if (alreadyExists) {
        setUserStatus('User already exists! Synced role and profile.');
      } else {
        setUserStatus('User created and synced successfully!');
      }
      setCreatedUser({ email: formattedEmail, password: newPassword, role: newRole });
      setNewEmail('');
      setNewPassword('');
    } catch (error) {
      setUserStatus(`Error: ${error.message}`);
      setCreatedUser(null);
    } finally {
      setUserLoading(false);
    }
  };

  const handleUserRoleChange = (email, newRole) => {
    updateUsers({ ...users, [email]: newRole });
  };

  const handleCopyCredentials = () => {
    if (!createdUser) return;
    const text = `Here are your login credentials for the Schedule Dashboard:\n\nEmail: ${createdUser.email}\nPassword: ${createdUser.password}\nRole: ${createdUser.role}\n\nLogin at: ${window.location.origin}`;
    navigator.clipboard.writeText(text);
    alert('Credentials copied to clipboard!');
  };

  const handleResetPassword = async (email) => {
    if (email.includes('@schedule.local')) {
      alert("Cannot send reset email to @schedule.local fake addresses. You must delete the account from Firebase Console and recreate it.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setResetStatus(`Password reset email sent to ${email}`);
      setTimeout(() => setResetStatus(''), 5000);
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  /**
   * Remove a user from the role mapping and delete their Firestore profile.
   * NOTE: this does not delete the Firebase Auth account itself — that
   * requires the Admin SDK on the server. Until then, we surface a clear
   * note in the confirm so the operator knows to also remove the auth
   * record from the Firebase console if they want a true purge.
   */
  const handleRemoveUser = async (email, role) => {
    if (!email) return;
    if (email === 'admin@schedule.local') {
      alert('The seed admin account cannot be removed.');
      return;
    }
    if (currentUser?.email === email) {
      alert('You cannot remove yourself while logged in.');
      return;
    }

    const ok = window.confirm(
      `Remove ${email}?\n\n` +
      `This will:\n` +
      `• Remove their role assignment from Pulse\n` +
      (role === 'Instructor' ? `• Delete their instructor profile from Firestore\n` : '') +
      `\nNote: the Firebase Auth account itself stays — delete it from the Firebase console for a full purge.`
    );
    if (!ok) return;

    try {
      const newUsers = { ...users };
      delete newUsers[email];
      updateUsers(newUsers);

      // Best-effort: delete instructor profile if there is one
      try {
        await deleteProfile(email);
        if (refreshProfiles) refreshProfiles();
      } catch (profileErr) {
        // Profile may not exist for SPA / EC / Admin accounts — that's fine
        console.warn('Profile delete skipped:', profileErr.message);
      }

      setResetStatus(`Removed ${email}`);
      setTimeout(() => setResetStatus(''), 5000);

      // Clamp pagination if we just deleted the last row on the page
      const remaining = Object.keys(newUsers).length;
      const newTotalPages = Math.max(1, Math.ceil(remaining / USER_PAGE_SIZE));
      if (userPage > newTotalPages) setUserPage(newTotalPages);
    } catch (err) {
      alert(`Failed to remove user: ${err.message}`);
    }
  };

  return (
    <section className="dashboard-view active" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Tabs Navigation */}
      <div className="tabs-container" style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button 
          className={`btn btn-sm ${activeTab === 'settings' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('settings')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: activeTab === 'settings' ? '' : 'transparent', color: activeTab === 'settings' ? '' : 'var(--text-muted)' }}
        >
          <Settings size={16} /> Global Settings
        </button>
        <button 
          className={`btn btn-sm ${activeTab === 'users' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('users')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: activeTab === 'users' ? '' : 'transparent', color: activeTab === 'users' ? '' : 'var(--text-muted)' }}
        >
          <Users size={16} /> Users
        </button>
        <button 
          className={`btn btn-sm ${activeTab === 'roles' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('roles')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: activeTab === 'roles' ? '' : 'transparent', color: activeTab === 'roles' ? '' : 'var(--text-muted)' }}
        >
          <Shield size={16} /> Role Permissions
        </button>
        <button 
          className={`btn btn-sm ${activeTab === 'bugs' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('bugs')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: activeTab === 'bugs' ? '' : 'transparent', color: activeTab === 'bugs' ? '' : 'var(--text-muted)' }}
        >
          <Bug size={16} /> Backlog
          {bugList.filter(b => b.status !== 'solved').length > 0 && (
            <span style={{ background: 'var(--danger)', color: 'white', borderRadius: '50%', width: '18px', height: '18px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {bugList.filter(b => b.status !== 'solved').length}
            </span>
          )}
        </button>
      </div>

      {/* --- SETTINGS TAB --- */}
      {activeTab === 'settings' && (
        <>
          <div className="panel animation-fade-in">
            <div className="panel-header">
              <div
                className="panel-header-left"
                style={{
                  filter: revealToggles ? 'none' : 'blur(6px)',
                  transition: 'filter 0.2s ease',
                  userSelect: revealToggles ? 'auto' : 'none',
                }}
                aria-hidden={!revealToggles}
              >
                <h2>Internal Feature Toggles</h2>
                <span className="subtext">Toggle features within pages</span>
              </div>
              <button
                type="button"
                onClick={() => setRevealToggles(v => !v)}
                title={revealToggles ? 'Hide toggle states' : 'Reveal toggle states'}
                aria-label={revealToggles ? 'Hide toggle states' : 'Reveal toggle states'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.35rem 0.6rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  background: revealToggles ? 'var(--primary-blue-light)' : 'transparent',
                  color: revealToggles ? 'var(--primary-blue)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                }}
              >
                {revealToggles ? <Eye size={14} /> : <EyeOff size={14} />}
                {revealToggles ? 'Visible' : 'Hidden'}
              </button>
            </div>
            <div className="panel-body">
              <div
                className="admin-toggles"
                style={{
                  filter: revealToggles ? 'none' : 'blur(6px)',
                  transition: 'filter 0.2s ease',
                  userSelect: revealToggles ? 'auto' : 'none',
                }}
                aria-hidden={!revealToggles}
              >
                {Object.entries(INTERNAL_FEATURES).map(([key, label], idx, arr) => {
                  const isSubItem = key.startsWith('avail_') || key === 'student_distribution';
                  // Insert divider before the "Navigation / system pages" section
                  const prevKey = idx > 0 ? arr[idx - 1][0] : null;
                  const showDivider = key === 'home' && prevKey !== null;
                  return (
                    <div key={key}>
                      {showDivider && (
                        <div style={{ borderTop: '1px solid var(--border-color)', margin: '0.75rem 0', paddingTop: '0.5rem' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Navigation &amp; System Pages</span>
                        </div>
                      )}
                      <div className={`admin-toggle-row ${isSubItem ? 'indent' : ''}`}>
                        <span className="admin-toggle-label">{label}</span>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={featureToggles[key] !== false}
                            onChange={() => handleToggle(key)}
                            disabled={!revealToggles || key === 'admin'}
                            tabIndex={revealToggles ? 0 : -1}
                            title={key === 'admin' ? 'Cannot disable Admin — you would lose access to this panel' : ''}
                          />
                          <span className="toggle-slider" />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="panel animation-fade-in">
            <div className="panel-header">
              <div className="panel-header-left">
                <h2>Branch Management</h2>
                <span className="subtext">
                  Disable branches to hide their data across the dashboard. Sync skips disabled branches.
                  Instructors that also exist in an enabled branch stay visible.
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {disabledBranches?.size > 0 && (
                  <span className="badge badge-danger">{disabledBranches.size} Disabled</span>
                )}
                <span className="badge badge-success">
                  {(branches?.length || 0) - (disabledBranches?.size || 0)} Active
                </span>
              </div>
            </div>
            <div className="panel-body">
              {(!branches || branches.length === 0) ? (
                <div className="empty-state"><p>No branches configured yet.</p></div>
              ) : (
                <div className="admin-toggles" style={{ maxWidth: '100%' }}>
                  {branches.map((b) => {
                    const isDisabled = disabledBranches?.has(b.name);
                    return (
                      <div
                        key={b.id}
                        className="admin-toggle-row"
                        style={{
                          opacity: isDisabled ? 0.6 : 1,
                          background: isDisabled ? 'var(--danger-bg)' : undefined,
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          gap: '0.5rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1, minWidth: 0 }}>
                            <span className="admin-toggle-label">
                              {b.name}
                              {isDisabled && (
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--danger)', fontWeight: 600 }}>
                                  DISABLED
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                              {b.url ? b.url.slice(0, 80) + (b.url.length > 80 ? '…' : '') : 'No URL'}
                            </span>
                          </div>
                          <label className="toggle-switch" title={isDisabled ? 'Enable branch' : 'Disable branch'}>
                            <input
                              type="checkbox"
                              checked={!isDisabled}
                              onChange={() => toggleBranchEnabled(b.name)}
                            />
                            <span className="toggle-slider" />
                          </label>
                        </div>
                        {/* Trial submit URL editor — empty value falls back to the legacy default,
                            so existing branches still work without configuration. */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            Trial Submit URL
                          </span>
                          <input
                            type="text"
                            placeholder="Apps Script Web App URL for this branch's spreadsheet"
                            defaultValue={b.trialUrl || ''}
                            onBlur={(e) => {
                              const next = e.target.value.trim();
                              if ((b.trialUrl || '') === next) return;
                              const updated = branches.map((br) =>
                                br.id === b.id ? { ...br, trialUrl: next || undefined } : br
                              );
                              updateBranches(updated);
                            }}
                            style={{
                              flex: 1,
                              padding: '0.35rem 0.55rem',
                              fontSize: '0.75rem',
                              border: '1px solid var(--border-color)',
                              borderRadius: '6px',
                              background: 'white',
                            }}
                            title="POST endpoint that appends a row to this branch's Trial Leads tab. Apps Script Web App URLs end in /exec."
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="panel animation-fade-in">
            <div className="panel-header">
              <div className="panel-header-left">
                <h2>Instructor Management</h2>
                <span className="subtext">Disable instructors to exclude them from trial schedule & class assignment</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {disabledCount > 0 && <span className="badge badge-danger">{disabledCount} Disabled</span>}
                <span className="badge badge-success">{totalCount - disabledCount} Active</span>
              </div>
            </div>
            <div className="panel-body">
              {totalCount === 0 ? (
                <div className="empty-state"><p>Sync the schedule first to see instructors.</p></div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: '1', minWidth: '200px', maxWidth: '320px' }}>
                      <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input
                        type="text"
                        placeholder="Search instructors..."
                        value={instructorSearch}
                        onChange={(e) => { setInstructorSearch(e.target.value); setInstructorPage(1); }}
                        style={{ width: '100%', padding: '0.5rem 0.8rem 0.5rem 2rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                      />
                    </div>
                    {sortedTeachers.length > 0 && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Showing {(safeInstructorPage - 1) * INSTRUCTOR_PAGE_SIZE + 1}–
                        {Math.min(safeInstructorPage * INSTRUCTOR_PAGE_SIZE, sortedTeachers.length)} of {sortedTeachers.length}
                      </span>
                    )}
                  </div>
                  <div className="admin-toggles" style={{ maxWidth: '100%' }}>
                    {pagedTeachers.length === 0 ? (
                      <div className="empty-state" style={{ padding: '1.5rem' }}>
                        <p>No instructors match your search.</p>
                      </div>
                    ) : pagedTeachers.map((name) => {
                      const isDisabled = disabledInstructors.has(name);
                      return (
                        <div key={name} className="admin-toggle-row" style={{ opacity: isDisabled ? 0.55 : 1, background: isDisabled ? 'var(--danger-bg)' : undefined }}>
                          <span className="admin-toggle-label">{name}</span>
                          <label className="toggle-switch">
                            <input type="checkbox" checked={!isDisabled} onChange={() => handleInstructorToggle(name)} />
                            <span className="toggle-slider" />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  {instructorTotalPages > 1 && (
                    <Pagination
                      currentPage={safeInstructorPage}
                      totalPages={instructorTotalPages}
                      onPageChange={setInstructorPage}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* --- USERS TAB --- */}
      {activeTab === 'users' && (
        <>
          <div className="panel animation-fade-in" style={{ borderColor: 'var(--primary-blue)' }}>
            <div className="panel-header" style={{ background: 'rgba(37, 99, 235, 0.05)' }}>
              <div className="panel-header-left">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><UserPlus size={18} /> Create New Account</h2>
                <span className="subtext">Register a new user account in Firebase securely</span>
              </div>
            </div>
            <div className="panel-body">
              <form onSubmit={handleCreateUser} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
                <div style={{ flex: '1', minWidth: '200px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Email / Username</label>
                  <input type="text" value={newEmail} onChange={e => setNewEmail(e.target.value)} required placeholder="e.g. EC_Sarah" style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                </div>
                <div style={{ flex: '1', minWidth: '200px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Password</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="Minimum 6 chars" style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                </div>
                <div style={{ width: '150px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Role</label>
                  <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" disabled={userLoading} style={{ height: '42px' }}>
                  {userLoading ? 'Creating...' : 'Create Account'}
                </button>
              </form>
              {userStatus && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '6px', background: userStatus.includes('Error') ? '#fee2e2' : '#d1fae5', color: userStatus.includes('Error') ? '#991b1b' : '#065f46', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{userStatus}</span>
                  {createdUser && !userStatus.includes('Error') && (
                    <button 
                      type="button"
                      onClick={handleCopyCredentials}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#059669', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                    >
                      <Copy size={14} /> Copy Login Credentials
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="panel animation-fade-in">
            <div className="panel-header">
              <h2>Registered Users</h2>
            </div>
            <div className="panel-body">
              {/* Filters */}
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1', minWidth: '200px', maxWidth: '300px' }}>
                  <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search by email..."
                    value={userSearch}
                    onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }}
                    style={{ width: '100%', padding: '0.5rem 0.8rem 0.5rem 2rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {['all', ...ROLES].map(role => (
                    <button
                      key={role}
                      onClick={() => { setUserRoleFilter(role); setUserPage(1); }}
                      style={{
                        padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
                        border: userRoleFilter === role ? '1.5px solid var(--primary, #3b82f6)' : '1px solid var(--border-color)',
                        background: userRoleFilter === role ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                        fontWeight: userRoleFilter === role ? 600 : 400,
                        color: userRoleFilter === role ? 'var(--primary, #3b82f6)' : 'var(--text-secondary)'
                      }}
                    >
                      {role === 'all' ? 'All Roles' : role}
                    </button>
                  ))}
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Account Email</th>
                    <th style={{ padding: '0.75rem 0.5rem', width: '200px' }}>Assigned Role</th>
                    <th style={{ padding: '0.75rem 0.5rem', width: '260px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedUsers.length > 0 ? pagedUsers.map(([email, role]) => (
                    <tr key={email} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: '500' }}>{email}</td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <select 
                          value={role} 
                          onChange={(e) => handleUserRoleChange(email, e.target.value)}
                          style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                        >
                          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => handleResetPassword(email)}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'transparent', border: '1px solid var(--border-color)', padding: '0.3rem 0.6rem', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
                            title="Send Password Reset Email (Requires real email address)"
                          >
                            <Mail size={14} /> Reset Pwd
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveUser(email, role)}
                            disabled={email === 'admin@schedule.local' || currentUser?.email === email}
                            title={
                              email === 'admin@schedule.local'
                                ? 'Seed admin cannot be removed'
                                : currentUser?.email === email
                                  ? 'You cannot remove yourself'
                                  : 'Remove user from Pulse (and delete profile if instructor)'
                            }
                            style={{
                              display: 'flex', alignItems: 'center', gap: '0.3rem',
                              background: 'transparent',
                              border: '1px solid var(--danger-border)',
                              padding: '0.3rem 0.6rem',
                              borderRadius: '4px',
                              color: 'var(--danger)',
                              cursor: (email === 'admin@schedule.local' || currentUser?.email === email) ? 'not-allowed' : 'pointer',
                              fontSize: '0.8rem',
                              opacity: (email === 'admin@schedule.local' || currentUser?.email === email) ? 0.4 : 1,
                            }}
                          >
                            <UserMinus size={14} /> Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="3" style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>No users match your filter.</td></tr>
                  )}
                </tbody>
              </table>

              {/* Pagination */}
              {totalUserPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginTop: '1rem', fontSize: '0.85rem' }}>
                  <button
                    onClick={() => setUserPage(p => Math.max(1, p - 1))}
                    disabled={userPage <= 1}
                    style={{ background: 'none', border: 'none', cursor: userPage <= 1 ? 'default' : 'pointer', color: userPage <= 1 ? 'var(--text-muted)' : 'var(--primary, #3b82f6)' }}
                  >
                    ← Prev
                  </button>
                  <span style={{ color: 'var(--text-secondary)' }}>Page {userPage} of {totalUserPages}</span>
                  <button
                    onClick={() => setUserPage(p => Math.min(totalUserPages, p + 1))}
                    disabled={userPage >= totalUserPages}
                    style={{ background: 'none', border: 'none', cursor: userPage >= totalUserPages ? 'default' : 'pointer', color: userPage >= totalUserPages ? 'var(--text-muted)' : 'var(--primary, #3b82f6)' }}
                  >
                    Next →
                  </button>
                </div>
              )}

              {resetStatus && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '6px', background: '#dbeafe', color: '#1e40af', fontSize: '0.85rem' }}>
                  {resetStatus}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* --- ROLE PERMISSIONS TAB --- */}
      {activeTab === 'roles' && (
        <div className="panel animation-fade-in">
          <div className="panel-header">
            <div className="panel-header-left">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Lock size={18} /> Sidebar Role Permissions</h2>
              <span className="subtext">Enable or disable sidebar menus for each specific role</span>
            </div>
          </div>
          <div className="panel-body">
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              {ROLES.map(role => {
                const enabledCount = Object.keys(SIDEBAR_FEATURES).filter(
                  (k) => roleToggles[role]?.[k] !== false
                ).length;
                const totalCount = Object.keys(SIDEBAR_FEATURES).length;
                return (
                  <div key={role} style={{ flex: '1', minWidth: '250px', background: 'var(--bg-dashboard)', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        <span style={{ fontWeight: 'bold' }}>{role} Role</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{enabledCount}/{totalCount} enabled</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button
                          type="button"
                          onClick={() => handleRoleBulk(role, true)}
                          title="Enable all"
                          style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.15rem 0.4rem', fontSize: '0.7rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRoleBulk(role, false)}
                          title="Disable all"
                          style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.15rem 0.4rem', fontSize: '0.7rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div style={{ padding: '1rem' }}>
                      {Object.entries(SIDEBAR_FEATURES).map(([featureKey, featureLabel]) => {
                        // By default, if the key is missing in roleToggles, assume it's TRUE (enabled),
                        // except for EC/Instructor which we defaulted in ScheduleContext.
                        const isEnabled = roleToggles[role]?.[featureKey] !== false;

                        return (
                          <div key={featureKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                            <span style={{ fontSize: '0.85rem', color: isEnabled ? 'var(--text-main)' : 'var(--text-muted)' }}>
                              {featureLabel}
                            </span>
                            <label className="toggle-switch" style={{ transform: 'scale(0.8)', transformOrigin: 'right center' }}>
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={() => handleRoleToggle(role, featureKey)}
                              />
                              <span className="toggle-slider" />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* --- BUG TRACKER TAB --- */}
      {activeTab === 'bugs' && (
        <BacklogTab
          bugList={bugList}
          newBugTitle={newBugTitle}
          newBugFeature={newBugFeature}
          newBugDescription={newBugDescription}
          newBugType={newBugType}
          setNewBugTitle={setNewBugTitle}
          setNewBugFeature={setNewBugFeature}
          setNewBugDescription={setNewBugDescription}
          setNewBugType={setNewBugType}
          bugTypeFilter={bugTypeFilter}
          setBugTypeFilter={setBugTypeFilter}
          bugStatusFilter={bugStatusFilter}
          setBugStatusFilter={setBugStatusFilter}
          openBugId={openBugId}
          setOpenBugId={setOpenBugId}
          editingBugId={editingBugId}
          setEditingBugId={setEditingBugId}
          handleAddBug={handleAddBug}
          handleBugStatusChange={handleBugStatusChange}
          handleEditBug={handleEditBug}
          handleRemoveBug={handleRemoveBug}
        />
      )}

    </section>
  );
}


/* ─── Backlog Tab ──────────────────────────────────────────────── */

function BacklogTab({
  bugList,
  newBugTitle, newBugFeature, newBugDescription, newBugType,
  setNewBugTitle, setNewBugFeature, setNewBugDescription, setNewBugType,
  bugTypeFilter, setBugTypeFilter,
  bugStatusFilter, setBugStatusFilter,
  openBugId, setOpenBugId,
  editingBugId, setEditingBugId,
  handleAddBug, handleBugStatusChange, handleEditBug, handleRemoveBug,
}) {
  // Status counters across all items (not filtered)
  const counts = useMemo(() => ({
    notStarted: bugList.filter(b => b.status === 'not-started').length,
    inProgress: bugList.filter(b => b.status === 'in-progress').length,
    solved: bugList.filter(b => b.status === 'solved').length,
    bug: bugList.filter(b => (b.type || 'bug') === 'bug').length,
    wishlist: bugList.filter(b => b.type === 'wishlist').length,
    improvement: bugList.filter(b => b.type === 'improvement').length,
  }), [bugList]);

  const filtered = useMemo(() => {
    return bugList.filter(b => {
      const t = b.type || 'bug';
      if (bugTypeFilter !== 'all' && t !== bugTypeFilter) return false;
      if (bugStatusFilter !== 'all' && b.status !== bugStatusFilter) return false;
      return true;
    });
  }, [bugList, bugTypeFilter, bugStatusFilter]);

  const openBug = openBugId ? bugList.find(b => b.id === openBugId) : null;

  return (
    <div className="panel animation-fade-in">
      <div className="panel-header">
        <div className="panel-header-left">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Bug size={18} /> Backlog
          </h2>
          <span className="subtext">Bugs, wishlist features, and improvements — click any item for full details</span>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', fontSize: '0.78rem', flexWrap: 'wrap' }}>
          <span style={{ padding: '0.22rem 0.55rem', borderRadius: '4px', background: BUG_STATUSES['not-started'].bg, color: BUG_STATUSES['not-started'].fg, fontWeight: 600 }}>
            {counts.notStarted} Not Started
          </span>
          <span style={{ padding: '0.22rem 0.55rem', borderRadius: '4px', background: BUG_STATUSES['in-progress'].bg, color: BUG_STATUSES['in-progress'].fg, fontWeight: 600 }}>
            {counts.inProgress} In Progress
          </span>
          <span style={{ padding: '0.22rem 0.55rem', borderRadius: '4px', background: BUG_STATUSES.solved.bg, color: BUG_STATUSES.solved.fg, fontWeight: 600 }}>
            {counts.solved} Done
          </span>
        </div>
      </div>

      <div className="panel-body">
        {/* Add form */}
        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ width: '140px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 500 }}>Type</label>
            <select
              value={newBugType}
              onChange={e => setNewBugType(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              {Object.entries(BUG_TYPES).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '2', minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 500 }}>Title</label>
            <input
              type="text"
              value={newBugTitle}
              onChange={e => setNewBugTitle(e.target.value)}
              placeholder={newBugType === 'wishlist' ? 'What feature do you want?' : newBugType === 'improvement' ? 'What should change?' : 'Describe the bug...'}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
            />
          </div>
          <div style={{ flex: '1', minWidth: '150px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 500 }}>Feature / Page</label>
            <input
              type="text"
              value={newBugFeature}
              onChange={e => setNewBugFeature(e.target.value)}
              placeholder="e.g. Trial Priority"
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
            />
          </div>
          <div style={{ flex: '2', minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 500 }}>Description (optional)</label>
            <input
              type="text"
              value={newBugDescription}
              onChange={e => setNewBugDescription(e.target.value)}
              placeholder="Steps, context, or details..."
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleAddBug}
            disabled={!newBugTitle}
            style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
          >
            <Plus size={16} /> Add
          </button>
        </div>

        {/* Filters */}
        {bugList.length > 0 && (
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: `All Types (${bugList.length})` },
                { id: 'bug', label: `Bug (${counts.bug})` },
                { id: 'wishlist', label: `Wishlist (${counts.wishlist})` },
                { id: 'improvement', label: `Improvement (${counts.improvement})` },
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBugTypeFilter(opt.id)}
                  style={{
                    padding: '0.3rem 0.65rem', fontSize: '0.78rem', cursor: 'pointer',
                    borderRadius: '6px',
                    border: bugTypeFilter === opt.id ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                    background: bugTypeFilter === opt.id ? 'var(--primary-blue-light)' : 'transparent',
                    fontWeight: bugTypeFilter === opt.id ? 600 : 400,
                    color: bugTypeFilter === opt.id ? 'var(--primary-blue)' : 'var(--text-secondary)',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
              {[
                { id: 'all', label: 'Any Status' },
                { id: 'not-started', label: 'Not Started' },
                { id: 'in-progress', label: 'In Progress' },
                { id: 'solved', label: 'Done' },
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBugStatusFilter(opt.id)}
                  style={{
                    padding: '0.3rem 0.65rem', fontSize: '0.78rem', cursor: 'pointer',
                    borderRadius: '6px',
                    border: bugStatusFilter === opt.id ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                    background: bugStatusFilter === opt.id ? 'var(--primary-blue-light)' : 'transparent',
                    fontWeight: bugStatusFilter === opt.id ? 600 : 400,
                    color: bugStatusFilter === opt.id ? 'var(--primary-blue)' : 'var(--text-secondary)',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* List */}
        {bugList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            No items tracked yet. Add a bug, wishlist feature, or improvement above.
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
            No items match the current filter.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {filtered.map(bug => (
              <BacklogCard
                key={bug.id}
                bug={bug}
                onOpen={() => setOpenBugId(bug.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {openBug && (
        <BacklogDetailModal
          bug={openBug}
          isEditing={editingBugId === openBug.id}
          onClose={() => { setOpenBugId(null); setEditingBugId(null); }}
          onStartEdit={() => setEditingBugId(openBug.id)}
          onStopEdit={() => setEditingBugId(null)}
          onStatusChange={(s) => handleBugStatusChange(openBug.id, s)}
          onEdit={(field, value) => handleEditBug(openBug.id, field, value)}
          onDelete={() => {
            if (confirm(`Delete "${openBug.title}"?`)) {
              handleRemoveBug(openBug.id);
              setOpenBugId(null);
              setEditingBugId(null);
            }
          }}
        />
      )}
    </div>
  );
}

/** A single clickable card in the backlog list. */
function BacklogCard({ bug, onOpen }) {
  const type = BUG_TYPES[bug.type || 'bug'];
  const status = BUG_STATUSES[bug.status] || BUG_STATUSES['not-started'];
  const TypeIcon = type.Icon;
  const isDone = bug.status === 'solved';

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        textAlign: 'left',
        width: '100%',
        padding: '0.85rem 1rem',
        borderRadius: '10px',
        border: `1px solid ${type.border}`,
        borderLeft: `4px solid ${type.fg}`,
        background: 'white',
        cursor: 'pointer',
        transition: 'transform 0.15s, box-shadow 0.15s',
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'flex-start',
        opacity: isDone ? 0.7 : 1,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateX(2px)';
        e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.05)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Type icon badge */}
      <div
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: type.bg, color: type.fg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <TypeIcon size={16} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '0.12rem 0.45rem', borderRadius: '99px', background: type.bg, color: type.fg, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {type.label}
          </span>
          <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '0.12rem 0.45rem', borderRadius: '99px', background: status.bg, color: status.fg, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {status.label}
          </span>
          {bug.feature && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>· {bug.feature}</span>
          )}
        </div>
        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)', textDecoration: isDone ? 'line-through' : 'none', marginBottom: '0.15rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {bug.title}
        </div>
        {bug.description && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {bug.description}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.85rem', marginTop: '0.4rem', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
            <CalendarIcon size={10} /> {new Date(bug.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      <div style={{ color: 'var(--text-muted)', alignSelf: 'center', fontSize: '1rem' }}>›</div>
    </button>
  );
}

/** Full-detail modal for a single backlog item. */
function BacklogDetailModal({ bug, isEditing, onClose, onStartEdit, onStopEdit, onStatusChange, onEdit, onDelete }) {
  const type = BUG_TYPES[bug.type || 'bug'];
  const status = BUG_STATUSES[bug.status] || BUG_STATUSES['not-started'];
  const TypeIcon = type.Icon;

  // Close on Esc
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(2px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--panel-bg)',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '640px',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: type.bg, color: type.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <TypeIcon size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '99px', background: type.bg, color: type.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {type.label}
              </span>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '99px', background: status.bg, color: status.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {status.label}
              </span>
            </div>
            {isEditing ? (
              <input
                type="text"
                value={bug.title}
                onChange={e => onEdit('title', e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.55rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '1.1rem', fontWeight: 600, fontFamily: 'inherit' }}
              />
            ) : (
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontFamily: "'Outfit', sans-serif", color: 'var(--text-main)', lineHeight: 1.3 }}>
                {bug.title}
              </h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.3rem', borderRadius: '6px', display: 'flex' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-color)'; e.currentTarget.style.color = 'var(--text-main)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Quick edit fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem', fontWeight: 600 }}>Type</label>
              <select
                value={bug.type || 'bug'}
                onChange={e => onEdit('type', e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                {Object.entries(BUG_TYPES).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem', fontWeight: 600 }}>Status</label>
              <select
                value={bug.status}
                onChange={e => onStatusChange(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                {Object.entries(BUG_STATUSES).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem', fontWeight: 600 }}>Feature / Page</label>
            <input
              type="text"
              value={bug.feature || ''}
              onChange={e => onEdit('feature', e.target.value)}
              placeholder="e.g. Trial Priority"
              style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem', fontWeight: 600 }}>Description</label>
            <textarea
              value={bug.description || ''}
              onChange={e => onEdit('description', e.target.value)}
              placeholder="Steps to reproduce, context, acceptance criteria, links..."
              rows={6}
              style={{ width: '100%', padding: '0.55rem 0.7rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.88rem', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          {/* Timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.85rem 1rem', background: 'var(--bg-color)', borderRadius: '10px' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Timeline</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <span>Created</span>
              <strong style={{ color: 'var(--text-main)', fontWeight: 500 }}>{formatDateTime(bug.createdAt)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <span>Started</span>
              <strong style={{ color: bug.startedAt ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: 500 }}>
                {bug.startedAt ? formatDateTime(bug.startedAt) : '—'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <span>Completed</span>
              <strong style={{ color: bug.solvedAt ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: 500 }}>
                {bug.solvedAt ? formatDateTime(bug.solvedAt) : '—'}
              </strong>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-color)', borderRadius: '0 0 14px 14px' }}>
          <button
            type="button"
            onClick={onDelete}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.45rem 0.85rem',
              border: '1px solid var(--danger-border)',
              background: 'white',
              color: 'var(--danger)',
              borderRadius: '8px',
              fontSize: '0.82rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-primary btn-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
