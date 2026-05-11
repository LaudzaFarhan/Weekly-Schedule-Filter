'use client';

import { useState } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { RefreshCw, Plus, Trash2 } from 'lucide-react';

export default function Header() {
  const {
    branches, updateBranches,
    activeBranchId, changeActiveBranch,
    syncActiveBranch, syncAllBranches,
    isSyncing, syncStatus, syncProgress, lastSyncTime,
  } = useSchedule();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const handleAddBranch = () => {
    if (!newName || !newUrl) return;
    const newId = newName.toLowerCase().replace(/\s+/g, '-');
    const newBranch = { id: newId, name: newName, url: newUrl };
    updateBranches([...branches, newBranch]);
    setNewName('');
    setNewUrl('');
    setIsAdding(false);
    changeActiveBranch(newId);
  };

  const handleRemoveBranch = (e, id) => {
    e.stopPropagation(); // prevent clicking tab
    if (confirm('Remove this branch?')) {
      const filtered = branches.filter(b => b.id !== id);
      updateBranches(filtered);
      if (activeBranchId === id && filtered.length > 0) {
        changeActiveBranch(filtered[0].id);
      }
    }
  };

  const activeBranch = branches.find(b => b.id === activeBranchId);

  return (
    <header className="app-header" style={{ paddingBottom: '0.5rem' }}>
      <div className="header-content">
        <h1>Schedule Intelligence</h1>
        <p>Automated Conflict Detection &amp; Instructor Availability</p>
        
        {/* Branch Button Tabs */}
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {branches.map(branch => (
            <button
              key={branch.id}
              onClick={() => changeActiveBranch(branch.id)}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '8px',
                border: activeBranchId === branch.id ? '2px solid var(--primary-blue)' : '1px solid var(--border-color)',
                background: activeBranchId === branch.id ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                fontWeight: activeBranchId === branch.id ? 'bold' : 'normal',
                color: activeBranchId === branch.id ? 'var(--primary-blue)' : 'var(--text-main)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              {branch.name}
              {branches.length > 1 && (
                <Trash2 size={14} style={{ opacity: 0.6 }} onClick={(e) => handleRemoveBranch(e, branch.id)} />
              )}
            </button>
          ))}
          {!isAdding ? (
            <button onClick={() => setIsAdding(true)} style={{ padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px dashed var(--text-muted)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Plus size={14} /> Add Branch
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="text" placeholder="Branch Name" value={newName} onChange={e => setNewName(e.target.value)} style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', width: '120px' }} />
              <input type="text" placeholder="Publish URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', width: '200px' }} />
              <button onClick={handleAddBranch} className="btn btn-primary btn-sm">Save</button>
              <button onClick={() => setIsAdding(false)} className="btn btn-sm" style={{ background: 'transparent' }}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      <div className="header-actions" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
        <div className="sync-controls">
          <div className="sync-status">
            {lastSyncTime ? `Last synced: ${lastSyncTime.toLocaleTimeString()}` : 'Not synced yet'}
          </div>
          <button
            className="btn btn-primary"
            onClick={syncActiveBranch}
            disabled={isSyncing}
            style={{ minWidth: '160px' }}
          >
            <RefreshCw size={18} className={isSyncing && syncProgress === 0 ? 'spin' : ''} />
            {isSyncing && syncProgress === 0 ? `Syncing ${activeBranch?.name}...` : `Sync ${activeBranch?.name}`}
          </button>
          
          <button
            className="btn btn-primary"
            onClick={syncAllBranches}
            disabled={isSyncing || branches.length === 0}
            style={{ background: '#0f172a', borderColor: '#0f172a', minWidth: '160px' }}
          >
            <RefreshCw size={18} className={isSyncing && syncProgress > 0 ? 'spin' : ''} />
            {isSyncing && syncProgress > 0 ? `Syncing All (${syncProgress}%)` : 'Sync All Branches'}
          </button>
        </div>
        
        {isSyncing && syncProgress > 0 && (
          <div style={{ width: '100%', maxWidth: '330px', height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden', alignSelf: 'flex-end', marginTop: '0.2rem' }}>
            <div style={{ width: `${syncProgress}%`, height: '100%', background: 'var(--primary-blue)', transition: 'width 0.3s' }}></div>
          </div>
        )}
        
        <div className="status-indicator">
          <span className={`status-dot ${isSyncing ? 'syncing' : lastSyncTime ? 'synced' : ''}`} />
          <span>{syncStatus}</span>
        </div>
      </div>
    </header>
  );
}
