'use client';

import { useState, useMemo } from 'react';
import { Search, X, RefreshCw, UserCheck, Clock, Moon, Check } from 'lucide-react';
import { sendHeartbeat } from '@/services/presenceService';

const ROLE_COLORS = {
  Admin: { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
  Supervisor: { bg: 'rgba(168, 85, 247, 0.12)', text: '#a855f7', border: 'rgba(168, 85, 247, 0.3)' },
  SPA: { bg: 'rgba(245, 158, 11, 0.12)', text: '#d97706', border: 'rgba(245, 158, 11, 0.3)' },
  EC: { bg: 'rgba(59, 130, 246, 0.12)', text: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' },
  Instructor: { bg: 'rgba(16, 185, 129, 0.12)', text: '#10b981', border: 'rgba(16, 185, 129, 0.3)' },
};

function formatTimeAgo(isoString) {
  if (!isoString) return 'Offline';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays}d ago`;
}

function formatPageName(pageId) {
  if (!pageId) return '';
  const map = {
    schedule: 'Master Schedule',
    home: 'Dashboard',
    dashboard: 'Dashboard',
    students: 'Students Database',
    'student-subscriptions': 'Subscriptions',
    'report-cards': 'Report Cards',
    'report-cards-list': 'Report List',
    'report-cards-rubric': 'Rubrics',
    instructors: 'Instructors',
    crm: 'CRM Pipeline',
    meetings: 'Meetings',
    activity: 'Activity Log',
    'progress-kinder': 'Kinder Progress',
    'progress-junior': 'Junior Progress',
    'progress-coder': 'Coder Progress',
    users: 'Users Management',
    api: 'API Docs',
    'qa-tracker': 'QA Tracker',
  };
  return map[pageId] || pageId.charAt(0).toUpperCase() + pageId.slice(1);
}

export default function TeamPresenceDropdown({
  presenceData,
  currentUser,
  onClose,
  onRefresh,
  loading = false,
}) {
  const [filter, setFilter] = useState('all'); // 'all' | 'online' | 'away' | 'offline'
  const [search, setSearch] = useState('');
  const [myStatus, setMyStatus] = useState('online');

  const users = presenceData?.users || [];
  const counts = presenceData?.counts || {
    total: users.length,
    online: users.filter((u) => u.status === 'online').length,
    away: users.filter((u) => u.status === 'away').length,
    offline: users.filter((u) => u.status === 'offline').length,
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (filter !== 'all' && u.status !== filter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = u.fullname?.toLowerCase().includes(q);
        const matchUser = u.username?.toLowerCase().includes(q);
        const matchEmail = u.email?.toLowerCase().includes(q);
        const matchRole = u.role?.toLowerCase().includes(q);
        return matchName || matchUser || matchEmail || matchRole;
      }
      return true;
    });
  }, [users, filter, search]);

  const handleSetStatus = async (status) => {
    setMyStatus(status);
    if (currentUser?.email) {
      await sendHeartbeat({
        email: currentUser.email,
        username: currentUser.username || currentUser.email.split('@')[0],
        status,
      });
      if (onRefresh) onRefresh();
    }
  };

  return (
    <div
      className="presence-dropdown"
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: '0.5rem',
        width: '360px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--panel-bg, #ffffff)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: '14px',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.22)',
        zIndex: 9999,
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          padding: '0.85rem 1rem',
          borderBottom: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.8) 0%, rgba(241, 245, 249, 0.4) 100%)',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main, #0f172a)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)',
                display: 'inline-block',
              }}
            />
            Team Presence
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #64748b)' }}>
            Live status across instructors & staff
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <button
            onClick={onRefresh}
            title="Refresh presence"
            aria-label="Refresh presence"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted, #64748b)',
              padding: '4px',
              borderRadius: '6px',
              display: 'inline-flex',
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close presence menu"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted, #64748b)',
              padding: '4px',
              borderRadius: '6px',
              display: 'inline-flex',
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ padding: '0.6rem 0.85rem 0.4rem', display: 'flex', gap: '0.35rem', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
        <button
          onClick={() => setFilter('all')}
          style={{
            flex: 1,
            padding: '0.3rem 0.4rem',
            borderRadius: '8px',
            fontSize: '0.73rem',
            fontWeight: 600,
            border: filter === 'all' ? '1px solid var(--primary-blue, #4f46e5)' : '1px solid transparent',
            background: filter === 'all' ? 'rgba(79, 70, 229, 0.1)' : 'transparent',
            color: filter === 'all' ? 'var(--primary-blue, #4f46e5)' : 'var(--text-secondary, #475569)',
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          All ({counts.total})
        </button>

        <button
          onClick={() => setFilter('online')}
          style={{
            flex: 1,
            padding: '0.3rem 0.4rem',
            borderRadius: '8px',
            fontSize: '0.73rem',
            fontWeight: 600,
            border: filter === 'online' ? '1px solid #10b981' : '1px solid transparent',
            background: filter === 'online' ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
            color: filter === 'online' ? '#059669' : 'var(--text-secondary, #475569)',
            cursor: 'pointer',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.3rem',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
          Online ({counts.online})
        </button>

        <button
          onClick={() => setFilter('away')}
          style={{
            flex: 1,
            padding: '0.3rem 0.4rem',
            borderRadius: '8px',
            fontSize: '0.73rem',
            fontWeight: 600,
            border: filter === 'away' ? '1px solid #f59e0b' : '1px solid transparent',
            background: filter === 'away' ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
            color: filter === 'away' ? '#d97706' : 'var(--text-secondary, #475569)',
            cursor: 'pointer',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.3rem',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b' }} />
          Away ({counts.away})
        </button>

        <button
          onClick={() => setFilter('offline')}
          style={{
            flex: 1,
            padding: '0.3rem 0.4rem',
            borderRadius: '8px',
            fontSize: '0.73rem',
            fontWeight: 600,
            border: filter === 'offline' ? '1px solid #94a3b8' : '1px solid transparent',
            background: filter === 'offline' ? 'rgba(148, 163, 184, 0.15)' : 'transparent',
            color: filter === 'offline' ? '#64748b' : 'var(--text-secondary, #475569)',
            cursor: 'pointer',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.3rem',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#94a3b8' }} />
          Offline ({counts.offline})
        </button>
      </div>

      {/* Search Input */}
      <div style={{ padding: '0.45rem 0.85rem', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: 'var(--bg-color, #f8fafc)',
            padding: '0.25rem 0.6rem',
            borderRadius: '8px',
            border: '1px solid var(--border-color, #e2e8f0)',
          }}
        >
          <Search size={14} style={{ color: 'var(--text-muted, #94a3b8)' }} />
          <input
            type="text"
            placeholder="Search member or role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: '0.78rem',
              width: '100%',
              color: 'var(--text-main, #0f172a)',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#94a3b8' }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* User List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          maxHeight: '340px',
          padding: '0.35rem 0',
        }}
      >
        {filteredUsers.length === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted, #94a3b8)', fontSize: '0.8rem' }}>
            No users match current filter.
          </div>
        ) : (
          filteredUsers.map((user) => {
            const roleStyle = ROLE_COLORS[user.role] || ROLE_COLORS.Instructor;
            const isOnline = user.status === 'online';
            const isAway = user.status === 'away';
            const isOffline = user.status === 'offline';

            const statusDotColor = isOnline ? '#10b981' : isAway ? '#f59e0b' : '#94a3b8';
            const initials = (user.fullname || user.username || 'U')
              .split(' ')
              .map((n) => n[0])
              .slice(0, 2)
              .join('')
              .toUpperCase();

            const isCurrent = currentUser?.email && user.email?.toLowerCase() === currentUser.email.toLowerCase();

            return (
              <div
                key={user.id || user.email}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  padding: '0.5rem 0.85rem',
                  borderBottom: '1px solid rgba(226, 232, 240, 0.6)',
                  background: isCurrent ? 'rgba(79, 70, 229, 0.04)' : 'transparent',
                  transition: 'background 0.15s ease',
                }}
              >
                {/* Avatar with live status dot */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      background: 'var(--sidebar-bg, #1e1b4b)',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      boxShadow: isOnline
                        ? '0 0 0 2px #10b981'
                        : isAway
                        ? '0 0 0 2px #f59e0b'
                        : '0 0 0 1px #cbd5e1',
                    }}
                  >
                    {initials}
                  </div>
                  <span
                    style={{
                      position: 'absolute',
                      bottom: '-1px',
                      right: '-1px',
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: statusDotColor,
                      border: '2px solid #ffffff',
                      boxShadow: isOnline ? '0 0 6px rgba(16, 185, 129, 0.6)' : 'none',
                    }}
                  />
                </div>

                {/* User Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: '0.82rem',
                          color: 'var(--text-main, #0f172a)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {user.fullname}
                      </span>
                      {isCurrent && (
                        <span
                          style={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            color: '#4f46e5',
                            background: 'rgba(79, 70, 229, 0.1)',
                            padding: '0.05rem 0.3rem',
                            borderRadius: '4px',
                          }}
                        >
                          You
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        padding: '0.1rem 0.4rem',
                        borderRadius: '6px',
                        background: roleStyle.bg,
                        color: roleStyle.text,
                        border: `1px solid ${roleStyle.border}`,
                        flexShrink: 0,
                      }}
                    >
                      {user.role}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.15rem', fontSize: '0.7rem' }}>
                    {isOnline && (
                      <span style={{ color: '#059669', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981' }} />
                        Active now
                        {user.currentPage && (
                          <span style={{ color: 'var(--text-muted, #64748b)', fontWeight: 400 }}>
                            · on {formatPageName(user.currentPage)}
                          </span>
                        )}
                      </span>
                    )}

                    {isAway && (
                      <span style={{ color: '#d97706', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                        <Clock size={11} />
                        Away ({formatTimeAgo(user.lastSeenAt)})
                      </span>
                    )}

                    {isOffline && (
                      <span style={{ color: 'var(--text-muted, #94a3b8)' }}>
                        {user.lastSeenAt ? `Last seen ${formatTimeAgo(user.lastSeenAt)}` : (user.lastLoginAt ? `Last login ${formatTimeAgo(user.lastLoginAt)}` : 'Offline')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer / Self status toggler */}
      <div
        style={{
          padding: '0.65rem 0.85rem',
          borderTop: '1px solid var(--border-color, #e2e8f0)',
          background: 'var(--bg-color, #f8fafc)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #64748b)' }}>
          My status:
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <button
            onClick={() => handleSetStatus('online')}
            style={{
              padding: '0.25rem 0.55rem',
              borderRadius: '6px',
              fontSize: '0.7rem',
              fontWeight: 600,
              border: myStatus === 'online' ? '1px solid #10b981' : '1px solid var(--border-color, #cbd5e1)',
              background: myStatus === 'online' ? '#10b981' : '#ffffff',
              color: myStatus === 'online' ? '#ffffff' : 'var(--text-secondary, #475569)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: myStatus === 'online' ? '#ffffff' : '#10b981' }} />
            Online
          </button>
          <button
            onClick={() => handleSetStatus('away')}
            style={{
              padding: '0.25rem 0.55rem',
              borderRadius: '6px',
              fontSize: '0.7rem',
              fontWeight: 600,
              border: myStatus === 'away' ? '1px solid #f59e0b' : '1px solid var(--border-color, #cbd5e1)',
              background: myStatus === 'away' ? '#f59e0b' : '#ffffff',
              color: myStatus === 'away' ? '#ffffff' : 'var(--text-secondary, #475569)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            <Moon size={11} />
            Away
          </button>
        </div>
      </div>
    </div>
  );
}
