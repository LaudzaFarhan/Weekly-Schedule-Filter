'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  subscribeToNotifications, readDismissed, dismissNotification, dismissAll, visibleItems,
} from '../../services/newNotificationService';
import {
  RefreshCw, Plus, Trash2, Bell, EyeOff, ChevronLeft, ChevronRight, Search, PanelLeft,
  AlertTriangle, AlertCircle, Info, X, CheckCheck, History, HelpCircle, Compass, Bug, Users,
} from 'lucide-react';
import { useTour } from '../tour/TourProvider';
import AnimationTutorialModal from '../tour/AnimationTutorialModal';
import FeatureTutorialSidebar from '../tour/FeatureTutorialSidebar';
import TeamPresenceDropdown from './TeamPresenceDropdown';
import { subscribeToPresence, startPresenceTracker, getPresenceUsers } from '../../services/presenceService';
import { APP_VERSION } from '../../config/version';

/**
 * How long the notification panel's exit animation runs, matching the
 * `notifDropdownOut` duration in globals.css. The panel unmounts after this.
 */
const NOTIF_CLOSE_MS = 160;

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
  const { startForCurrentPage, hasUnseenPageTour, pageTourTitle } = useTour();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newTrialUrl, setNewTrialUrl] = useState('');
  // Why a refused branch save has to be shown: `updateBranches` writes through
  // to the server and rejects when the Admin gate returns 403 or the shape
  // check returns 400. It rolls its own optimistic update back, so without this
  // the row would just vanish again with nothing said. Same inline style the
  // failed-sync strip below already uses — the header has no toast of its own.
  const [branchError, setBranchError] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAnimationTutorial, setShowAnimationTutorial] = useState(false);
  const [showTutorialSidebar, setShowTutorialSidebar] = useState(false);

  // Auto-open Feature Tutorial Sidebar for first-time visitors
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const seen = localStorage.getItem('lab_animation_tutorial_seen');
        if (!seen) {
          const timer = setTimeout(() => {
            setShowTutorialSidebar(true);
          }, 900);
          return () => clearTimeout(timer);
        }
      }
    } catch (e) {
      // safe fallback
    }
  }, []);

  const handleCloseAnimationTutorial = () => {
    setShowAnimationTutorial(false);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('lab_animation_tutorial_seen', 'true');
      }
    } catch (e) {}
  };
  // The panel stays mounted for the length of its exit animation, so it can
  // collapse back toward the bell instead of vanishing.
  const [notifClosing, setNotifClosing] = useState(false);
  const notifRef = useRef(null);
  const bellRef = useRef(null);
  const notifCloseTimer = useRef(null);

  /**
   * Start the exit animation, then unmount.
   *
   * Driven by a timer rather than `animationend` because reduced-motion removes
   * the animation entirely, and that event would then never fire — leaving the
   * panel stuck open. Kept in step with the CSS duration.
   */
  const closeNotifications = useCallback(({ restoreFocus = false } = {}) => {
    // The live timer is the record of "already closing", so a second Escape or
    // a click landing in the same frame cannot queue a second unmount.
    if (notifCloseTimer.current) return;
    setNotifClosing(true);
    notifCloseTimer.current = setTimeout(() => {
      notifCloseTimer.current = null;
      setShowNotifications(false);
      setNotifClosing(false);
    }, NOTIF_CLOSE_MS);
    // Escape should hand focus back to the control that opened the panel.
    if (restoreFocus) bellRef.current?.focus();
  }, []);

  const toggleNotifications = () => {
    if (showNotifications && !notifClosing) {
      closeNotifications();
      return;
    }
    // Reopening mid-close cancels the pending unmount and drops the exit class,
    // so the panel animates back in rather than disappearing a moment later.
    clearTimeout(notifCloseTimer.current);
    notifCloseTimer.current = null;
    setNotifClosing(false);
    setShowNotifications(true);
  };

  // Escape closes it, and so does a press anywhere outside. `pointerdown` rather
  // than `click` so it starts closing the moment the user reaches elsewhere,
  // and capture phase so a handler that stops propagation cannot trap it open.
  useEffect(() => {
    if (!showNotifications || notifClosing) return undefined;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeNotifications({ restoreFocus: true });
      }
    };
    const onPointerDown = (e) => {
      if (!notifRef.current?.contains(e.target) && !bellRef.current?.contains(e.target)) {
        closeNotifications();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [showNotifications, notifClosing, closeNotifications]);

  // A pending close must not fire after the header has gone.
  useEffect(() => () => clearTimeout(notifCloseTimer.current), []);

  // New Operations notification feed. Old Operations has no equivalent source,
  // so the bell is only offered there.
  const [feed, setFeed] = useState(null);
  const [feedError, setFeedError] = useState(null);
  // Read from storage as the initial value rather than in an effect, so
  // already-dismissed items never flash into view on first paint.
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    if (opsMode !== 'new') return undefined;
    const unsub = subscribeToNotifications(
      (data) => { setFeed(data); setFeedError(null); },
      (err) => setFeedError(err.message)
    );
    return () => unsub();
  }, [opsMode]);

  const alerts = useMemo(() => visibleItems(feed, dismissed), [feed, dismissed]);
  const alertCount = alerts.length;

  // Live Team Presence (Online, Away, Offline)
  const [presenceData, setPresenceData] = useState(null);
  const [showPresence, setShowPresence] = useState(false);
  const [presenceLoading, setPresenceLoading] = useState(false);
  const presenceRef = useRef(null);

  // Initialize presence heartbeat for current session
  useEffect(() => {
    if (!user) return undefined;
    const cleanup = startPresenceTracker(user, () => (opsMode === 'new' ? 'new' : 'old'));
    return cleanup;
  }, [user, opsMode]);

  // Subscribe to live team presence feed
  useEffect(() => {
    const unsub = subscribeToPresence(
      (data) => setPresenceData(data),
      () => {}
    );
    return () => unsub();
  }, []);

  // Click outside to close team presence popover
  useEffect(() => {
    if (!showPresence) return undefined;
    const onPointerDown = (e) => {
      if (!presenceRef.current?.contains(e.target)) {
        setShowPresence(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [showPresence]);

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

  const handleAddBranch = async () => {
    if (!newName || !newUrl || savingBranches) return;
    const newId = newName.toLowerCase().replace(/\s+/g, '-');
    // trialUrl is optional — without it, submitTrialLead falls back to the
    // legacy default URL so existing single-branch deployments keep working.
    const newBranch = { id: newId, name: newName, url: newUrl };

    if (newTrialUrl) {
      newBranch.trialUrl = newTrialUrl;
    }

    const currentBranches = Array.isArray(branches) ? branches : [];
    setBranchError(null);
    setSavingBranches(true);
    try {
      await updateBranches([...currentBranches, newBranch]);
    } catch (err) {
      // The form stays open with what the user typed still in it, so the save
      // can be retried once the reason is dealt with.
      setBranchError(`Could not add "${newName}": ${err?.message || 'the save was refused.'}`);
      return;
    } finally {
      setSavingBranches(false);
    }

    setIsAdding(false);
    setNewName('');
    setNewUrl('');
    setNewTrialUrl('');
  };

  const handleDeleteBranch = async (e, branchId) => {
    e.stopPropagation();
    if (savingBranches) return;
    const ok = window.confirm(`Are you sure you want to delete branch "${branchId}"? This will also disable its configs.`);
    if (!ok) return;

    setBranchError(null);
    setSavingBranches(true);
    try {
      await updateBranches(branches.filter(b => b.id !== branchId));
    } catch (err) {
      // The branch is still there — leave the active selection pointing at it.
      setBranchError(`Could not delete "${branchId}": ${err?.message || 'the save was refused.'}`);
      return;
    } finally {
      setSavingBranches(false);
    }

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
              data-tour="sidebar-toggle-expand"
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.3rem', color: 'var(--text-main)', margin: 0 }}>The Lab Operation System</h1>
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '999px',
                  background: 'rgba(79, 70, 229, 0.1)',
                  color: 'var(--primary-blue, #4f46e5)',
                  border: '1px solid rgba(79, 70, 229, 0.25)',
                  lineHeight: '1.2',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {APP_VERSION}
              </span>
            </div>
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
            <div data-tour="notifications" style={{ position: 'relative' }}>
              <button
                ref={bellRef}
                onClick={toggleNotifications}
                title={alertCount ? `${alertCount} thing${alertCount === 1 ? '' : 's'} need attention` : 'Nothing needs attention'}
                aria-label={`Notifications${alertCount ? `, ${alertCount} needing attention` : ''}`}
                aria-expanded={showNotifications && !notifClosing}
                className={`notif-bell-btn ${showNotifications && !notifClosing ? 'notif-bell-open' : ''}`}
                style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex' }}
              >
                <Bell
                  size={20}
                  className="notif-bell-icon"
                  style={{ color: alertCount ? 'var(--primary-blue)' : 'var(--text-muted)', transition: 'transform 0.12s ease' }}
                />
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
                <div ref={notifRef} className={`notif-dropdown ${notifClosing ? 'notif-closing' : ''}`} style={{
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

                    {alerts.map((item, i) => {
                      const meta = SEVERITY[item.severity] || SEVERITY.info;
                      const IconComponent = item.kind === 'qa_bug' ? Bug : meta.Icon;
                      return (
                        <div
                          key={item.id}
                          className="notif-item"
                          style={{
                            display: 'flex', gap: '0.6rem', padding: '0.7rem 1rem',
                            borderBottom: '1px solid var(--border-color)', alignItems: 'flex-start',
                            // Each row trails the one above, so the list reads
                            // as arriving rather than appearing all at once.
                            animationDelay: `${Math.min(i, 6) * 40}ms`,
                          }}
                        >
                          <span aria-hidden="true" style={{
                            flexShrink: 0, width: '26px', height: '26px', borderRadius: '8px',
                            background: item.kind === 'qa_bug' ? 'rgba(239, 68, 68, 0.15)' : meta.bg,
                            color: item.kind === 'qa_bug' ? '#ef4444' : meta.color,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <IconComponent size={14} />
                          </span>

                          <button
                            onClick={() => {
                              if (item.page && onNavigate) onNavigate(item.page);
                              closeNotifications();
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

                  {/* The full feed, plus the schedule log, live on the
                      Activity page — this dropdown is only the summary. */}
                  <button
                    onClick={() => { if (onNavigate) onNavigate('activity'); closeNotifications(); }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                      width: '100%', padding: '0.6rem 1rem', cursor: 'pointer',
                      borderTop: '1px solid var(--border-color)', border: 'none',
                      background: 'transparent', color: 'var(--primary-blue)',
                      fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                    }}
                  >
                    <History size={13} /> View all logs
                  </button>

                  {feed?.generatedAt && (
                    <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid var(--border-color)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      Checked {new Date(feed.generatedAt).toLocaleTimeString()} · refreshes every minute
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Team Presence Topbar Indicator */}
          <div ref={presenceRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowPresence((v) => !v)}
              title={`Team Presence · ${presenceData?.counts?.online ?? 0} online, ${presenceData?.counts?.away ?? 0} away, ${presenceData?.counts?.offline ?? 0} offline`}
              aria-label="Team Presence (who is online, away, or offline)"
              aria-expanded={showPresence}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.35rem 0.65rem',
                borderRadius: '10px',
                cursor: 'pointer',
                border: showPresence ? '1px solid #10b981' : '1px solid rgba(16, 185, 129, 0.3)',
                background: showPresence ? 'rgba(16, 185, 129, 0.18)' : 'rgba(16, 185, 129, 0.08)',
                color: '#059669',
                fontSize: '0.76rem',
                fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: (presenceData?.counts?.online ?? 0) > 0 ? '#10b981' : '#94a3b8',
                  boxShadow: (presenceData?.counts?.online ?? 0) > 0 ? '0 0 8px rgba(16, 185, 129, 0.8)' : 'none',
                  display: 'inline-block',
                }}
              />
              <span>{presenceData?.counts?.online ?? 0} Online</span>
            </button>

            {showPresence && (
              <TeamPresenceDropdown
                presenceData={presenceData}
                currentUser={user}
                onClose={() => setShowPresence(false)}
                onRefresh={async () => {
                  setPresenceLoading(true);
                  try {
                    const data = await getPresenceUsers();
                    setPresenceData(data);
                  } catch {}
                  setPresenceLoading(false);
                }}
                loading={presenceLoading}
              />
            )}
          </div>

          {/* Runs the tour for whichever page is showing. Nudged while the
              current screen has one nobody on this browser has taken. */}
          <button
            type="button"
            onClick={() => setShowTutorialSidebar(true)}
            title="Open Feature Tutorials Sidebar"
            aria-label="Open Feature Tutorials Sidebar"
            style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.35rem 0.75rem', borderRadius: '10px', cursor: 'pointer',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              background: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(99,102,241,0.12) 100%)',
              color: 'var(--primary-blue)', fontSize: '0.76rem', fontWeight: 600,
              transition: 'all 0.15s ease',
            }}
          >
            <Compass size={15} /> Feature Tutorials
          </button>
          <button
            type="button"
            data-tour="help"
            onClick={() => setShowTutorialSidebar(true)}
            className={hasUnseenPageTour ? 'tour-help-nudge' : undefined}
            title="Feature Tutorials & Help"
            aria-label="Feature Tutorials & Help"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '32px', height: '32px', borderRadius: '10px', cursor: 'pointer',
              border: 'none', background: 'transparent',
              color: 'var(--primary-blue)',
              transition: 'color 0.15s ease',
            }}
          >
            <HelpCircle size={20} />
          </button>
          <div data-tour="user-chip" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
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

      <FeatureTutorialSidebar
        isOpen={showTutorialSidebar}
        onClose={() => setShowTutorialSidebar(false)}
        onNavigate={onNavigate}
        onToggleSidebar={onToggleSidebar}
      />

      <AnimationTutorialModal
        isOpen={showAnimationTutorial}
        onClose={handleCloseAnimationTutorial}
        onToggleSidebar={onToggleSidebar}
        onNavigate={onNavigate}
      />

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
                  <Trash2 size={11} style={{ opacity: 0.4 }} onClick={(e) => handleDeleteBranch(e, branch.id)} />
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
            <button onClick={() => { setBranchError(null); setIsAdding(true); }} style={{ padding: '0.4rem 0.85rem', borderRadius: '20px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <Plus size={13} /> ADD BRANCH
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="text" placeholder="Branch Name" value={newName} onChange={e => setNewName(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', width: '110px', fontSize: '0.75rem' }} />
              <input type="text" placeholder="Schedule Publish URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', width: '180px', fontSize: '0.75rem' }} />
              <input type="text" placeholder="Trial Submit URL (Apps Script)" title="Apps Script Web App URL that appends Trial Leads for this branch's spreadsheet" value={newTrialUrl} onChange={e => setNewTrialUrl(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', width: '180px', fontSize: '0.75rem' }} />
              <button onClick={handleAddBranch} disabled={savingBranches} className="btn btn-primary btn-sm">{savingBranches ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setIsAdding(false); setBranchError(null); }} className="btn btn-sm" style={{ background: 'transparent' }}>✕</button>
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

      {/* A branch save the server refused. Sits directly under the branch tabs
          so it reads as being about the row that just reverted. */}
      {branchError && (
        <div role="alert" style={{ padding: '0.4rem 1.5rem', fontSize: '0.75rem', color: 'var(--danger)', background: 'var(--danger-bg)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <AlertCircle size={13} style={{ flexShrink: 0 }} />
          <span>{branchError}</span>
          <button
            onClick={() => setBranchError(null)}
            aria-label="Dismiss branch error"
            style={{ background: 'none', border: 'none', color: 'var(--primary-blue)', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}
          >
            Dismiss
          </button>
        </div>
      )}

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
