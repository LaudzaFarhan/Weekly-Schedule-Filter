'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  subscribeToNotifications, readDismissed, dismissNotification, dismissAll, visibleItems,
} from '../../services/newNotificationService';
import {
  RefreshCw, Plus, Trash2, Bell, EyeOff, ChevronLeft, ChevronRight, Search, PanelLeft,
  AlertTriangle, AlertCircle, Info, X, CheckCheck,
} from 'lucide-react';

const SEVERITY = {
  danger: { color: 'var(--danger)', bg: 'rgba(239,68,68,0.1)', Icon: AlertCircle },
  warning: { color: '#b45309', bg: 'rgba(245,158,11,0.12)', Icon: AlertTriangle },
  info: { color: 'var(--primary-blue)', bg: 'rgba(59,130,246,0.1)', Icon: Info },
};

export default function Header({ onToggleSearch, opsMode = 'old', onToggleSidebar, sidebarCollapsed, onNavigate }) {
  const {
    branches, updateBranches,
    activeBranchId, changeActiveBranch,
    syncActiveBranch, syncAllBranches,
    isSyncing, syncProgress, lastSyncTime, failedBranches,
    disabledBranches, users,
  } = useSchedule();
  const { user } = useAuth();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newTrialUrl, setNewTrialUrl] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);

  // New Operations notification feed. Old Operations has no equivalent source,
  // so the bell is only offered there.
  const [feed, setFeed] = useState(null);
  const [feedError, setFeedError] = useState(null);
  const [dismissed, setDismissed] = useState({});

  useEffect(() => {
    if (opsMode !== 'new') return undefined;
    setDismissed(readDismissed());
    const unsub = subscribeToNotifications(
      (data) => { setFeed(data); setFeedError(null); },
      (err) => setFeedError(err.message)
    );
    return () => unsub();
  }, [opsMode]);

  const alerts = useMemo(() => visibleItems(feed, dismissed), [feed, dismissed]);
  const alertCount = alerts.length;

  const [branchPage, setBranchPage] = useState(0);
  const branchesPerPage = 3;

  // Auto-jump to the page containing the active branch
  useEffect(() => {
    if (activeBranchId && branches.length > 0) {
      const idx = branches.findIndex(b => b.id === activeBranchId);
      if (idx !== -1) {
        const expectedPage = Math.floor(idx / branchesPerPage);
        if (branchPage !== expectedPage) {
          setBranchPage(expectedPage);
        }
      }
    }
  }, [activeBranchId, branches.length]);

  const handleAddBranch = () => {
    if (!newName || !newUrl) return;
    const newId = newName.toLowerCase().replace(/\s+/g, '-');
    // trialUrl is optional — without it, submitTrialLead falls back to the
    // legacy default URL so existing single-branch deployments keep working.
    const newBranch = { id: newId, name: newName, url: newUrl };

    if (newTrialUrl) {
      newBranch.trialUrl = newTrialUrl;
    }

    const currentBranches = Array.isArray(branches) ? branches : [];
    updateBranches([...currentBranches, newBranch]);
    setIsAdding(false);
    setNewName('');
    setNewUrl('');
    setNewTrialUrl('');
  };

  const handleDeleteBranch = (e, branchId) => {
    e.stopPropagation();
    const ok = window.confirm(`Are you sure you want to delete branch "${branchId}"? This will also disable its configs.`);
    if (!ok) return;

    updateBranches(branches.filter(b => b.id !== branchId));
    if (activeBranchId === branchId) {
      const remaining = branches.filter(b => b.id !== branchId);
      if (remaining.length > 0) {
        changeActiveBranch(remaining[0].id);
      } else {
        changeActiveBranch(null);
      }
    }
  };

  const activeBranch = branches.find(b => b.id === activeBranchId) || branches[0];

  const getRelativeTime = () => {
    if (!lastSyncTime) return '';
    const diff = Math.floor((new Date() - lastSyncTime) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return lastSyncTime.toLocaleDateString();
  };

  const userName = user?.email?.split('@')[0] || 'User';
  const initials = userName.slice(0, 2).toUpperCase();
  const userEmail = user?.email?.toLowerCase() || '';
  const userRole = users?.[userEmail] || 'Instructor';

  return (
    <>
      {/* Header Bar: Title + Sync Status + User */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', background: 'var(--panel-bg)', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
          {/* Only a "show" affordance lives here — hiding is done from the
              button inside the sidebar itself. */}
          {onToggleSidebar && sidebarCollapsed && (
            <button
              onClick={onToggleSidebar}
              title="Show sidebar"
              aria-label="Show sidebar"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '38px', height: '38px', borderRadius: '10px', cursor: 'pointer',
                border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)',
                transition: 'background 0.15s ease, color 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-color)'; e.currentTarget.style.color = 'var(--text-main)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <PanelLeft size={18} />
            </button>
          )}
          <div>
            <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.3rem', color: 'var(--text-main)', margin: 0 }}>The Lab Operation System</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0 }}>
              {opsMode === 'new' ? 'New Operations Portal' : 'School Operations, Live'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          {opsMode === 'old' && lastSyncTime && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <span className={`status-dot ${isSyncing ? 'syncing' : 'synced'}`} />
              Synced {getRelativeTime()}
            </div>
          )}
          {opsMode === 'old' && (
            <button 
              onClick={onToggleSearch} 
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex' }}
              title="Search Students"
            >
              <Search size={20} style={{ color: '#cbd5e1' }} />
            </button>
          )}
          {opsMode === 'new' && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                title={alertCount ? `${alertCount} thing${alertCount === 1 ? '' : 's'} need attention` : 'Nothing needs attention'}
                aria-label={`Notifications${alertCount ? `, ${alertCount} needing attention` : ''}`}
                aria-expanded={showNotifications}
                style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex' }}
              >
                <Bell size={20} style={{ color: alertCount ? 'var(--primary-blue)' : 'var(--text-muted)' }} />
                {alertCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 0, right: 0, minWidth: '16px', height: '16px',
                    borderRadius: '99px', background: 'var(--danger)', color: '#fff',
                    fontSize: '0.6rem', fontWeight: 700, lineHeight: '16px', textAlign: 'center',
                    padding: '0 3px',
                  }}>
                    {alertCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '0.5rem', width: '340px',
                  maxHeight: '70vh', display: 'flex', flexDirection: 'column',
                  background: 'var(--panel-bg)', border: '1px solid var(--border-color)',
                  borderRadius: '12px', boxShadow: '0 12px 32px rgba(0,0,0,0.18)', zIndex: 100, overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
                  }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      Needs attention{alertCount > 0 ? ` (${alertCount})` : ''}
                    </span>
                    {alertCount > 0 && (
                      <button
                        onClick={() => setDismissed(dismissAll(alerts, feed?.today))}
                        title="Dismiss all for today"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-blue)', fontSize: '0.72rem', fontWeight: 600 }}
                      >
                        <CheckCheck size={13} /> Clear
                      </button>
                    )}
                  </div>

                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {feedError && (
                      <div style={{ padding: '1rem', fontSize: '0.78rem', color: 'var(--danger)' }}>
                        Could not load notifications: {feedError}
                      </div>
                    )}
                    {!feedError && !feed && (
                      <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        Checking…
                      </div>
                    )}
                    {!feedError && feed && alertCount === 0 && (
                      <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        Nothing needs attention. All students allocated, no classes over capacity.
                      </div>
                    )}

                    {alerts.map((item) => {
                      const meta = SEVERITY[item.severity] || SEVERITY.info;
                      const { Icon } = meta;
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: 'flex', gap: '0.6rem', padding: '0.7rem 1rem',
                            borderBottom: '1px solid var(--border-color)', alignItems: 'flex-start',
                          }}
                        >
                          <span aria-hidden="true" style={{
                            flexShrink: 0, width: '26px', height: '26px', borderRadius: '8px',
                            background: meta.bg, color: meta.color,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Icon size={14} />
                          </span>

                          <button
                            onClick={() => {
                              if (item.page && onNavigate) onNavigate(item.page);
                              setShowNotifications(false);
                            }}
                            title={item.page ? `Go to ${item.page}` : undefined}
                            style={{
                              flex: 1, minWidth: 0, textAlign: 'left', background: 'none',
                              border: 'none', padding: 0, cursor: item.page ? 'pointer' : 'default',
                            }}
                          >
                            <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                              {item.title}
                            </span>
                            {item.detail && (
                              <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem', lineHeight: 1.35 }}>
                                {item.detail}
                              </span>
                            )}
                          </button>

                          <button
                            onClick={() => setDismissed(dismissNotification(item.id, feed?.today))}
                            title="Dismiss for today"
                            aria-label={`Dismiss: ${item.title}`}
                            style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.1rem', lineHeight: 0 }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {feed?.generatedAt && (
                    <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid var(--border-color)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      Checked {new Date(feed.generatedAt).toLocaleTimeString()} · refreshes every minute
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-main)' }}>{userName}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{userRole}</div>
            </div>
            <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--sidebar-bg, #1e1b4b)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 600 }}>
              {initials}
            </div>
          </div>
        </div>
      </header>

      {/* Sub Bar: Branch Tabs (left) + Sync Buttons (right) — outside header */}
      {opsMode === 'old' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1.5rem' }}>
        {/* Branch tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {(() => {
            const totalPages = Math.ceil(branches.length / branchesPerPage);
            const currentBranchPage = Math.min(branchPage, Math.max(0, totalPages - 1));
            const displayedBranches = branches.slice(currentBranchPage * branchesPerPage, (currentBranchPage + 1) * branchesPerPage);

            return (
              <>
                {branches.length > branchesPerPage && (
                  <button
                    onClick={() => setBranchPage(p => Math.max(0, p - 1))}
                    disabled={currentBranchPage === 0}
                    style={{ padding: '0.3rem', borderRadius: '50%', border: '1px solid var(--border-color)', background: 'var(--bg-color)', cursor: currentBranchPage === 0 ? 'not-allowed' : 'pointer', opacity: currentBranchPage === 0 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                )}
                
                {displayedBranches.map(branch => {
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
          
                {branches.length > branchesPerPage && (
                  <button
                    onClick={() => setBranchPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={currentBranchPage === totalPages - 1}
                    style={{ padding: '0.3rem', borderRadius: '50%', border: '1px solid var(--border-color)', background: 'var(--bg-color)', cursor: currentBranchPage === totalPages - 1 ? 'not-allowed' : 'pointer', opacity: currentBranchPage === totalPages - 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <ChevronRight size={16} />
                  </button>
                )}
              </>
            );
          })()}
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
      )}
    </>
  );
}
