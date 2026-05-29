'use client';

import { useState } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useAuth } from '../../contexts/AuthContext';
import { RefreshCw, Plus, Trash2, Bell, EyeOff } from 'lucide-react';

export default function Header() {
  const {
    branches, updateBranches,
    activeBranchId, changeActiveBranch,
    syncActiveBranch, syncAllBranches,
    isSyncing, syncProgress, lastSyncTime, failedBranches,
    disabledBranches,
  } = useSchedule();
  const { user } = useAuth();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newTrialUrl, setNewTrialUrl] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);

  const handleAddBranch = () => {
    if (!newName || !newUrl) return;
    const newId = newName.toLowerCase().replace(/\s+/g, '-');
    // trialUrl is optional — without it, submitTrialLead falls back to the
    // legacy default URL so existing single-branch deployments keep working.
    const newBranch = { id: newId, name: newName, url: newUrl };
    if (newTrialUrl) newBranch.trialUrl = newTrialUrl;
    updateBranches([...branches, newBranch]);
    setNewName('');
    setNewUrl('');
    setNewTrialUrl('');
    setIsAdding(false);
    changeActiveBranch(newId);
  };

  const handleRemoveBranch = (e, id) => {
    e.stopPropagation();
    if (confirm('Remove this branch?')) {
      const filtered = branches.filter(b => b.id !== id);
      updateBranches(filtered);
      if (activeBranchId === id && filtered.length > 0) {
        changeActiveBranch(filtered[0].id);
      }
    }
  };

  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];

  const getRelativeTime = () => {
    if (!lastSyncTime) return null;
    const mins = Math.round((Date.now() - lastSyncTime.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return lastSyncTime.toLocaleDateString();
  };

  const userName = user?.email?.split('@')[0] || 'User';
  const initials = userName.slice(0, 2).toUpperCase();

  return (
    <>
      {/* Header Bar: Title + Sync Status + User */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', background: 'var(--panel-bg)', borderBottom: '1px solid var(--border-color)' }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.3rem', color: 'var(--text-main)', margin: 0 }}>Pulse</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0 }}>School Operations, Live</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          {lastSyncTime && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <span className={`status-dot ${isSyncing ? 'syncing' : 'synced'}`} />
              Synced {getRelativeTime()}
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowNotifications(!showNotifications)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex' }}>
              <Bell size={20} style={{ color: '#cbd5e1' }} />
            </button>
            {showNotifications && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '0.5rem', width: '260px', background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 100, overflow: 'hidden' }}>
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', fontWeight: 600, fontSize: '0.85rem' }}>Notifications</div>
                <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  No notifications yet
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-main)' }}>{userName}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Administrator</div>
            </div>
            <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--sidebar-bg, #1e1b4b)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 600 }}>
              {initials}
            </div>
          </div>
        </div>
      </header>

      {/* Sub Bar: Branch Tabs (left) + Sync Buttons (right) — outside header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1.5rem' }}>
        {/* Branch tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {branches.map(branch => {
            const isDisabled = disabledBranches?.has(branch.name);
            const isActive = activeBranchId === branch.id;
            return (
              <button
                key={branch.id}
                onClick={() => changeActiveBranch(branch.id)}
                title={isDisabled ? `${branch.name} is disabled — re-enable in Admin Settings` : branch.name}
                style={{
                  padding: '0.4rem 0.85rem',
                  borderRadius: '20px',
                  border: isActive ? '1px solid var(--primary-blue)' : '1px solid var(--border-color)',
                  background: isActive
                    ? 'var(--primary-blue-light)'
                    : isDisabled ? 'var(--bg-color)' : 'transparent',
                  color: isDisabled ? 'var(--text-muted)' : isActive ? 'var(--primary-blue)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  fontSize: '0.8rem',
                  fontWeight: isActive ? 600 : 400,
                  textDecoration: isDisabled ? 'line-through' : 'none',
                  opacity: isDisabled ? 0.65 : 1,
                }}
              >
                {isDisabled && (
                  <EyeOff size={11} style={{ flexShrink: 0 }} aria-label="Branch disabled" />
                )}
                {branch.name}
                {branches.length > 1 && (
                  <Trash2 size={11} style={{ opacity: 0.4 }} onClick={(e) => handleRemoveBranch(e, branch.id)} />
                )}
              </button>
            );
          })}
          {!isAdding ? (
            <button onClick={() => setIsAdding(true)} style={{ padding: '0.4rem 0.85rem', borderRadius: '20px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <Plus size={13} /> ADD BRANCH
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="text" placeholder="Branch Name" value={newName} onChange={e => setNewName(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', width: '110px', fontSize: '0.75rem' }} />
              <input type="text" placeholder="Schedule Publish URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', width: '180px', fontSize: '0.75rem' }} />
              <input type="text" placeholder="Trial Submit URL (Apps Script)" title="Apps Script Web App URL that appends Trial Leads for this branch's spreadsheet" value={newTrialUrl} onChange={e => setNewTrialUrl(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', width: '180px', fontSize: '0.75rem' }} />
              <button onClick={handleAddBranch} className="btn btn-primary btn-sm">Save</button>
              <button onClick={() => setIsAdding(false)} className="btn btn-sm" style={{ background: 'transparent' }}>✕</button>
            </div>
          )}
        </div>

        {/* Sync buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            className="btn btn-sm"
            onClick={syncActiveBranch}
            disabled={isSyncing}
            style={{ background: '#4f46e5', borderColor: '#4f46e5', color: 'white', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem', fontWeight: 500 }}
          >
            <RefreshCw size={14} className={isSyncing && syncProgress === 0 ? 'spin' : ''} />
            Sync {activeBranch?.name || 'Default'}
          </button>
          <button
            className="btn btn-sm"
            onClick={syncAllBranches}
            disabled={isSyncing || branches.length === 0}
            style={{ background: '#0f172a', borderColor: '#0f172a', color: 'white', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem', fontWeight: 500 }}
          >
            <RefreshCw size={14} className={isSyncing && syncProgress > 0 ? 'spin' : ''} />
            Sync All Branches
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {isSyncing && syncProgress > 0 && (
        <div style={{ width: '100%', height: '3px', background: 'var(--border-color)' }}>
          <div style={{ width: `${syncProgress}%`, height: '100%', background: 'var(--primary-blue)', transition: 'width 0.3s' }} />
        </div>
      )}

      {/* Failed branches */}
      {failedBranches && failedBranches.length > 0 && !isSyncing && (
        <div style={{ padding: '0.4rem 1.5rem', fontSize: '0.75rem', color: 'var(--danger)', background: 'var(--danger-bg)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span>Failed: {failedBranches.join(', ')}</span>
          <button onClick={syncAllBranches} style={{ background: 'none', border: 'none', color: 'var(--primary-blue)', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}
    </>
  );
}
