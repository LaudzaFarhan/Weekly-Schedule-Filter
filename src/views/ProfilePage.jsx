'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import { saveProfile, deleteProfile } from '@/services/profileService';
import { User, Save, Trash2, ChevronLeft, RefreshCw, Pencil } from 'lucide-react';
import Badge from '@/components/ui/Badge';

const TRAINING_MODULES = [
  { id: 'kinderFoundation', label: 'Kinder Foundation', max: 2 },
  { id: 'kinderCore', label: 'Kinder Core', max: 4 },
  { id: 'juniorFoundation', label: 'Junior Foundation', max: 2 },
  { id: 'juniorCore', label: 'Junior Core', max: 4 },
  { id: 'coderBasic', label: 'Coder Basic', max: 2 },
  { id: 'coderIntermediate', label: 'Coder Intermediate', max: 2 },
  { id: 'coderAdvance', label: 'Coder Advance', max: 2 },
];

const SPECIALIZATIONS = [
  { value: 'kinder-junior', label: 'Kinder & Junior' },
  { value: 'junior-coder', label: 'Junior & Coder' },
  { value: 'all', label: 'All Modules' },
];

export default function ProfilePage() {
  const { user } = useAuth();
  const { users, instructorProfiles, refreshProfiles, trialPriorityList } = useSchedule();
  
  const [editingProfile, setEditingProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const userRole = users?.[user?.email] || 'Instructor';
  const isSupervisor = userRole === 'Supervisor' || userRole === 'SPA' || userRole === 'Admin';

  useEffect(() => {
    // If not a supervisor, automatically open their own profile
    if (!isSupervisor && instructorProfiles) {
      const myProfile = instructorProfiles.find(p => p.id === user.email);
      if (myProfile) {
        setEditingProfile(myProfile);
      } else {
        // Init empty profile
        setEditingProfile({
          id: user.email,
          fullname: '',
          nickname: '',
          specialization: '',
          phoneNumber: '',
          trainingProgress: {}
        });
      }
    }
  }, [isSupervisor, instructorProfiles, user.email]);

  const handleEdit = (profile) => {
    setEditingProfile({ ...profile });
  };

  const handleCreateNew = () => {
    setEditingProfile({
      id: '',
      fullname: '',
      nickname: '',
      specialization: '',
      phoneNumber: '',
      trainingProgress: {}
    });
  };

  const handleChange = (field, value) => {
    setEditingProfile(prev => ({ ...prev, [field]: value }));
  };

  const handleTrainingChange = (moduleId, value) => {
    setEditingProfile(prev => ({
      ...prev,
      trainingProgress: {
        ...(prev.trainingProgress || {}),
        [moduleId]: parseInt(value, 10)
      }
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const email = editingProfile.id || user.email;
      await saveProfile(email, editingProfile);
      await refreshProfiles();
      alert('Profile saved successfully!');
      
      if (isSupervisor && email !== user.email) {
        setEditingProfile(null);
      }
    } catch (error) {
      console.error(error);
      alert('Failed to save profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (email) => {
    if (!confirm(`Are you sure you want to delete profile for ${email}?`)) return;
    try {
      await deleteProfile(email);
      await refreshProfiles();
    } catch (error) {
      console.error(error);
      alert('Failed to delete profile.');
    }
  };

  /**
   * Sync from Trial Priority → Firestore (parallel writes for speed)
   */
  const handleSyncFromTrialPriority = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);

    try {
      const existingEmails = new Set(instructorProfiles.map(p => p.id));

      // Build list of profiles to create
      const toCreate = trialPriorityList
        .map(entry => ({
          email: `${entry.name.replace(/\s+/g, '')}@schedule.local`,
          name: entry.name,
          type: entry.type || '',
        }))
        .filter(item => !existingEmails.has(item.email));

      // Write all in parallel
      if (toCreate.length > 0) {
        await Promise.all(toCreate.map(item =>
          saveProfile(item.email, {
            fullname: item.name,
            nickname: item.name,
            email: item.email,
            specialization: item.type,
            trainingProgress: {
              kinderFoundation: 0, kinderCore: 0,
              juniorFoundation: 0, juniorCore: 0,
              coderBasic: 0, coderIntermediate: 0, coderAdvance: 0
            }
          })
        ));
      }

      await refreshProfiles();
      setSyncResult({ created: toCreate.length, total: trialPriorityList.length });
    } catch (error) {
      console.error('Sync error:', error);
      alert('Failed to sync profiles: ' + error.message);
    } finally {
      setSyncing(false);
    }
  };

  if (!isSupervisor && !editingProfile) {
    return <div className="loading-screen"><div className="loading-spinner" /></div>;
  }

  return (
    <section className="dashboard-view active">
      {/* Supervisor List View */}
      {isSupervisor && !editingProfile && (
        <div className="panel animation-fade-in">
          <div className="panel-header">
            <div className="panel-header-left">
              <h2>Instructor Profiles</h2>
              <span className="subtext">Manage profiles and training progress</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                className="btn btn-primary"
                onClick={handleSyncFromTrialPriority}
                disabled={syncing || trialPriorityList.length === 0}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <RefreshCw size={16} className={syncing ? 'spin' : ''} />
                {syncing ? 'Syncing...' : 'Sync from Trial Priority'}
              </button>
              <Badge variant="orange">{instructorProfiles.length} Profiles</Badge>
            </div>
          </div>

          {syncResult && (
            <div style={{
              padding: '0.75rem 1.5rem',
              background: syncResult.created > 0 ? 'var(--success-bg)' : 'var(--primary-blue-light)',
              borderBottom: '1px solid var(--border-color)',
              fontSize: '0.85rem',
              display: 'flex', alignItems: 'center', gap: '0.5rem'
            }}>
              {syncResult.created > 0 ? (
                <span style={{ color: 'var(--success)' }}>
                  ✓ Created <strong>{syncResult.created}</strong> new profile(s) from {syncResult.total} trial priority instructor(s).
                </span>
              ) : (
                <span style={{ color: 'var(--primary-blue)' }}>
                  All {syncResult.total} trial priority instructor(s) already have profiles. No new profiles created.
                </span>
              )}
              <button 
                className="btn-icon" 
                onClick={() => setSyncResult(null)}
                style={{ marginLeft: 'auto' }}
              >✕</button>
            </div>
          )}

          <div className="panel-body">
            <div className="trial-table-wrapper">
              <table className="trial-table">
                <thead>
                  <tr>
                    <th>Nickname</th>
                    <th>Specialization</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {instructorProfiles.length === 0 ? (
                    <tr><td colSpan="3" className="empty-state-table">
                      No profiles found. Click <strong>"Sync from Trial Priority"</strong> to create profiles from your trial priority list.
                    </td></tr>
                  ) : (
                    instructorProfiles.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 500 }}>{p.nickname || p.fullname || p.id.split('@')[0]}</td>
                        <td>
                          {p.specialization ? (
                            <span className={`trial-type-badge type-${p.specialization}`}>
                              {SPECIALIZATIONS.find(s => s.value === p.specialization)?.label || p.specialization}
                            </span>
                          ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn-icon" onClick={() => handleEdit(p)} title="Edit" style={{ color: 'var(--primary-blue)' }}>
                            <Pencil size={16} />
                          </button>
                          <button className="btn-icon btn-icon-danger" onClick={() => handleDelete(p.id)} title="Delete">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Profile Edit Form */}
      {editingProfile && (
        <div className="panel animation-fade-in">
          <div className="panel-header">
            <div className="panel-header-left" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {isSupervisor && editingProfile.id !== user.email && (
                <button className="btn-icon" onClick={() => setEditingProfile(null)}>
                  <ChevronLeft size={20} />
                </button>
              )}
              <div>
                <h2>{editingProfile.id ? 'Edit Profile' : 'New Profile'}</h2>
                <span className="subtext">{editingProfile.id || 'Create a new instructor profile'}</span>
              </div>
            </div>
          </div>
          <div className="panel-body" style={{ padding: '2rem' }}>
            <form onSubmit={handleSave} className="form-grid" style={{ maxWidth: '800px', gridTemplateColumns: '1fr 1fr' }}>
              
              {/* Basic Info */}
              <div style={{ gridColumn: '1 / -1' }}>
                <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Basic Information</h3>
              </div>

              <div className="input-group">
                <label>Email (Primary Key)</label>
                <input 
                  type="email" 
                  value={editingProfile.id} 
                  onChange={e => handleChange('id', e.target.value)}
                  disabled={!isSupervisor || (editingProfile.id !== '' && editingProfile.id === user.email)}
                  required 
                />
              </div>

              <div className="input-group">
                <label>Phone Number</label>
                <input 
                  type="text" 
                  value={editingProfile.phoneNumber} 
                  onChange={e => handleChange('phoneNumber', e.target.value)} 
                />
              </div>

              <div className="input-group">
                <label>Fullname</label>
                <input 
                  type="text" 
                  value={editingProfile.fullname} 
                  onChange={e => handleChange('fullname', e.target.value)} 
                  required 
                />
              </div>

              <div className="input-group">
                <label>Nickname</label>
                <input 
                  type="text" 
                  value={editingProfile.nickname} 
                  onChange={e => handleChange('nickname', e.target.value)} 
                />
              </div>

              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label>Specialization</label>
                <select 
                  value={editingProfile.specialization} 
                  onChange={e => handleChange('specialization', e.target.value)}
                >
                  <option value="" disabled>Select specialization...</option>
                  {SPECIALIZATIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              {/* Training Progress */}
              <div style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
                <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Training Progress</h3>
                <p className="subtext" style={{ marginBottom: '1.5rem' }}>Select the highest level completed for each module.</p>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  {TRAINING_MODULES.map(module => {
                    const currentVal = editingProfile.trainingProgress?.[module.id] || 0;
                    return (
                      <div key={module.id} className="input-group" style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px' }}>
                        <label style={{ color: 'var(--primary-blue)', marginBottom: '0.5rem' }}>{module.label}</label>
                        <select 
                          value={currentVal} 
                          onChange={(e) => handleTrainingChange(module.id, e.target.value)}
                          style={{ background: 'white' }}
                        >
                          <option value="0">Not Started</option>
                          {Array.from({ length: module.max }, (_, i) => i + 1).map(level => (
                            <option key={level} value={level}>Level {level}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1', marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  <Save size={18} />
                  {loading ? 'Saving...' : 'Save Profile'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}
    </section>
  );
}
