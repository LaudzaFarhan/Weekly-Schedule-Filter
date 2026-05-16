'use client';

import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { Search, UserPlus, Settings, Users, Shield, Lock, Copy, Mail } from 'lucide-react';
import { createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { auth, secondaryAuth } from '../services/firebase';
import { saveProfile } from '../services/profileService';

const INTERNAL_FEATURES = {
  conflicts: 'Conflict Report',
  availability: 'Slot Availability Checker',
  avail_available: '  ↳ Available Column',
  avail_busy: '  ↳ Busy Column',
  avail_leave: '  ↳ On Leave Column',
  leave: 'Leave Management',
  trial: 'Trial Priority Instructors',
  trial_overview: 'Trial Availability Overview',
};

const SIDEBAR_FEATURES = {
  schedule: 'Master Schedule View',
  finder: 'Free Instructor Finder',
  trial_input: 'Input Trial Leads',
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
    refreshProfiles
  } = useSchedule();

  const [activeTab, setActiveTab] = useState('settings');
  const [instructorSearch, setInstructorSearch] = useState('');

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

  const disabledCount = disabledInstructors.size;
  const totalCount = uniqueBaseTeachers?.size || 0;

  // --- Handlers for Role Permissions Tab ---
  const handleRoleToggle = (role, feature) => {
    const currentRoleConfig = roleToggles[role] || {};
    const newRoleConfig = { ...currentRoleConfig, [feature]: !currentRoleConfig[feature] };
    updateRoleToggles({ ...roleToggles, [role]: newRoleConfig });
  };

  // --- Handlers for User Management Tab ---
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newEmail || !newPassword) return;

    setUserLoading(true);
    setUserStatus('');

    try {
      let formattedEmail = newEmail;
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
      </div>

      {/* --- SETTINGS TAB --- */}
      {activeTab === 'settings' && (
        <>
          <div className="panel animation-fade-in">
            <div className="panel-header">
              <div className="panel-header-left">
                <h2>Internal Feature Toggles</h2>
                <span className="subtext">Toggle features within pages</span>
              </div>
            </div>
            <div className="panel-body">
              <div className="admin-toggles">
                {Object.entries(INTERNAL_FEATURES).map(([key, label]) => (
                  <div key={key} className={`admin-toggle-row ${key.startsWith('avail_') ? 'indent' : ''}`}>
                    <span className="admin-toggle-label">{label}</span>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={featureToggles[key] !== false}
                        onChange={() => handleToggle(key)}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                ))}
              </div>
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
                        onChange={(e) => setInstructorSearch(e.target.value)}
                        style={{ width: '100%', padding: '0.5rem 0.8rem 0.5rem 2rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                      />
                    </div>
                  </div>
                  <div className="admin-toggles" style={{ maxWidth: '100%' }}>
                    {sortedTeachers.map((name) => {
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
                    <th style={{ padding: '0.75rem 0.5rem', width: '200px' }}>Actions</th>
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
                        <button 
                          type="button"
                          onClick={() => handleResetPassword(email)}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'transparent', border: '1px solid var(--border-color)', padding: '0.3rem 0.6rem', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
                          title="Send Password Reset Email (Requires real email address)"
                        >
                          <Mail size={14} /> Reset Pwd
                        </button>
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
              {ROLES.map(role => (
                <div key={role} style={{ flex: '1', minWidth: '250px', background: 'var(--bg-dashboard)', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)', fontWeight: 'bold' }}>
                    {role} Role
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
              ))}
            </div>
          </div>
        </div>
      )}

    </section>
  );
}
