'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  History, Search, Trash, X, User, AlertTriangle, AlertCircle, Info, Bell, CheckCheck,
} from 'lucide-react';
import { subscribeToActivity, deleteActivity, displayUser } from '../services/newActivityService';
import {
  subscribeToNotifications, readDismissed, dismissNotification, dismissAll, visibleItems,
} from '../services/newNotificationService';
import { useToast } from '../components/ui/Toast';

const ACTION_META = {
  add: { color: '#059669', bg: 'rgba(5,150,105,0.12)', label: 'ADD' },
  bulk: { color: '#4f46e5', bg: 'rgba(79,70,229,0.12)', label: 'BULK' },
  edit: { color: '#d97706', bg: 'rgba(217,119,6,0.12)', label: 'EDIT' },
  delete: { color: '#dc2626', bg: 'rgba(220,38,38,0.12)', label: 'DELETE' },
};

/** Matches the header bell, so the same alert reads the same in both places. */
const SEVERITY = {
  danger: { color: 'var(--danger)', bg: 'rgba(239,68,68,0.1)', Icon: AlertCircle },
  warning: { color: '#b45309', bg: 'rgba(245,158,11,0.12)', Icon: AlertTriangle },
  info: { color: 'var(--primary-blue)', bg: 'rgba(59,130,246,0.1)', Icon: Info },
};

export default function NewActivityPage({ onNavigate }) {
  const { showToast } = useToast();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // The same feed the header bell shows, so this page is the full view of it
  // rather than a second, differently-computed list.
  const [feed, setFeed] = useState(null);
  const [feedError, setFeedError] = useState(null);
  // Initial value rather than an effect, so dismissed items never flash in.
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    const unsub = subscribeToNotifications(
      (data) => { setFeed(data); setFeedError(null); },
      (err) => setFeedError(err.message)
    );
    return () => unsub();
  }, []);

  const alerts = useMemo(() => visibleItems(feed, dismissed), [feed, dismissed]);

  // Read from PostgreSQL so the log is shared and carries the acting user.
  useEffect(() => {
    const unsub = subscribeToActivity(
      (data) => { setHistory(data || []); setLoadError(null); setLoading(false); },
      (err) => { setLoadError(err?.message || 'Unable to load activity.'); setLoading(false); },
      { limit: 500 }
    );
    return () => unsub();
  }, []);

  const clearAll = async () => {
    if (!window.confirm('Clear the entire activity log? This affects everyone, not just this device.')) return;
    try {
      await deleteActivity({ all: true });
      setHistory([]);
      showToast({ title: 'Activity log cleared', variant: 'success' });
    } catch (err) {
      showToast({ title: 'Could not clear the log', message: err.message, variant: 'error' });
    }
  };

  // Everyone who appears in the log, for the user filter.
  const users = useMemo(
    () => [...new Set(history.map((h) => h.userEmail).filter(Boolean))].sort(),
    [history]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((h) => {
      if (actionFilter !== 'all' && h.action !== actionFilter) return false;
      if (userFilter !== 'all' && (h.userEmail || '') !== userFilter) return false;
      if (q) {
        const haystack = `${h.summary || ''} ${h.userEmail || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [history, actionFilter, userFilter, search]);

  // Per-action totals for the quick chips.
  const counts = useMemo(() => {
    const c = { all: history.length, add: 0, bulk: 0, edit: 0, delete: 0 };
    history.forEach((h) => { if (c[h.action] !== undefined) c[h.action] += 1; });
    return c;
  }, [history]);

  return (
    <section className="dashboard-view active">
      {/* Two cards side by side: what needs attention now, and what has already
          happened. Collapses to one column below 1100px. */}
      <div className="activity-two-col">

      <div className="panel" style={{ margin: 0, minWidth: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <History size={20} /> Schedule Activity
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Full log of schedule changes (add, bulk import, edit, delete), with who made each one. Shared across devices.
            </p>
          </div>
          {history.length > 0 && (
            <button
              onClick={clearAll}
              className="btn"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.4rem 0.8rem', color: 'var(--text-secondary)', background: 'transparent' }}
            >
              <Trash size={14} /> Clear all
            </button>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', background: 'var(--bg-color)' }}>
          <div
            style={{
              position: 'relative', display: 'flex', alignItems: 'center', flex: '1 1 260px',
              background: 'var(--panel-bg, #fff)',
              border: `1.5px solid ${searchFocused ? 'var(--primary-blue, #4f46e5)' : 'var(--border-color)'}`,
              borderRadius: '999px',
              boxShadow: searchFocused ? '0 0 0 3px rgba(79,70,229,0.15)' : 'none',
              transition: 'border-color 0.15s ease, box-shadow 0.2s ease',
              padding: '0 0.5rem 0 0.85rem',
              height: '40px',
            }}
          >
            <Search size={16} style={{ color: searchFocused ? 'var(--primary-blue, #4f46e5)' : 'var(--text-muted)', flexShrink: 0, transition: 'color 0.15s ease' }} />
            <input
              type="text"
              placeholder="Search activity…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', padding: '0 0.6rem', fontSize: '0.88rem', color: 'var(--text-main)', height: '100%' }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '999px', border: 'none', cursor: 'pointer', background: 'var(--bg-color)', color: 'var(--text-muted)', flexShrink: 0 }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {['all', 'add', 'bulk', 'edit', 'delete'].map((a) => {
              const active = actionFilter === a;
              const m = ACTION_META[a];
              const color = m ? m.color : 'var(--text-secondary)';
              return (
                <button
                  key={a}
                  onClick={() => setActionFilter(a)}
                  style={{
                    padding: '0.35rem 0.7rem', borderRadius: '999px', fontSize: '0.75rem', cursor: 'pointer',
                    fontWeight: active ? 700 : 500,
                    border: active ? `1.5px solid ${color}` : '1px solid var(--border-color)',
                    background: active ? (m ? m.bg : 'var(--primary-blue-light)') : 'transparent',
                    color: active ? color : 'var(--text-secondary)',
                  }}
                >
                  {a === 'all' ? 'All' : ACTION_META[a].label} ({counts[a] || 0})
                </button>
              );
            })}
          </div>
          {users.length > 0 && (
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="modal-select-field field-compact"
              style={{ minWidth: '160px' }}
            >
              <option value="all">Everyone</option>
              {users.map((u) => <option key={u} value={u}>{displayUser(u)}</option>)}
            </select>
          )}
        </div>

        {/* List */}
        <div style={{ padding: '1rem 1.5rem' }}>
          {loadError && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem',
              padding: '0.7rem 0.9rem', borderRadius: '10px',
              background: 'var(--danger-bg, rgba(239,68,68,0.1))', border: '1px solid rgba(239,68,68,0.35)',
            }}>
              <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '0.1rem' }} />
              <span style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>{loadError}</span>
            </div>
          )}
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '2rem', color: 'var(--text-secondary)' }}>
              <div className="loading-spinner" /> Loading activity…
            </div>
          ) : history.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>
              No activity yet. Adding, editing, importing, or deleting classes on the Schedule page will be logged here.
            </p>
          ) : filtered.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>
              No activity matches the filter.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {filtered.map((h, i) => {
                const meta = ACTION_META[h.action] || { color: 'var(--text-muted)', bg: 'var(--bg-color)', label: (h.action || '').toUpperCase() };
                const when = new Date(h.createdAt || h.at);
                const who = displayUser(h.userEmail);
                return (
                  <div key={h.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '0.64rem', fontWeight: 700, color: meta.color, background: meta.bg, padding: '0.12rem 0.45rem', borderRadius: '5px', flexShrink: 0, minWidth: '52px', textAlign: 'center' }}>{meta.label}</span>
                    <span
                      title={h.userEmail || 'No user recorded'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0,
                        fontSize: '0.7rem', fontWeight: 600, padding: '0.12rem 0.45rem', borderRadius: '99px',
                        color: h.userEmail ? 'var(--primary-blue, #4f46e5)' : 'var(--text-muted)',
                        background: h.userEmail ? 'var(--primary-blue-light, rgba(79,70,229,0.1))' : 'transparent',
                        border: h.userEmail ? 'none' : '1px dashed var(--border-color)',
                        maxWidth: '140px', overflow: 'hidden', whiteSpace: 'nowrap',
                      }}
                    >
                      <User size={10} /> {who}
                    </span>
                    <span style={{ fontSize: '0.86rem', color: 'var(--text-main)', flex: 1 }}>{h.summary}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {isNaN(when.getTime()) ? '' : when.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Notifications: the header bell's feed, in full ────────────────── */}
      <div className="panel" style={{ margin: 0, minWidth: 0, alignSelf: 'start' }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Bell size={20} /> Needs Attention
              {alerts.length > 0 && (
                <span style={{
                  fontSize: '0.72rem', fontWeight: 700, color: 'var(--danger)',
                  background: 'var(--danger-bg, rgba(239,68,68,0.12))',
                  padding: '0.05rem 0.45rem', borderRadius: '99px',
                }}>
                  {alerts.length}
                </span>
              )}
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              The same checks behind the bell in the header. Derived live from New Operations data, refreshed every minute.
            </p>
          </div>
          {alerts.length > 0 && (
            <button
              onClick={() => setDismissed(dismissAll(alerts, feed?.today))}
              className="btn"
              title="Dismiss all for today"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.4rem 0.8rem', color: 'var(--text-secondary)', background: 'transparent' }}
            >
              <CheckCheck size={14} /> Dismiss all
            </button>
          )}
        </div>

        <div style={{ padding: '1rem 1.5rem' }}>
          {feedError ? (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
              padding: '0.7rem 0.9rem', borderRadius: '10px',
              background: 'var(--danger-bg, rgba(239,68,68,0.1))', border: '1px solid rgba(239,68,68,0.35)',
            }}>
              <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '0.1rem' }} />
              <span style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>{feedError}</span>
            </div>
          ) : !feed ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '2rem', color: 'var(--text-secondary)' }}>
              <div className="loading-spinner" /> Checking…
            </div>
          ) : alerts.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>
              Nothing needs attention. Every student is allocated and no class is over capacity.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {alerts.map((item) => {
                const meta = SEVERITY[item.severity] || SEVERITY.info;
                const { Icon } = meta;
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
                      padding: '0.7rem 0.8rem', borderRadius: '10px',
                      background: 'var(--bg-color)', border: '1px solid var(--border-color)',
                    }}
                  >
                    <span aria-hidden="true" style={{
                      flexShrink: 0, width: '28px', height: '28px', borderRadius: '8px',
                      background: meta.bg, color: meta.color,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon size={15} />
                    </span>

                    <button
                      onClick={() => { if (item.page && onNavigate) onNavigate(item.page); }}
                      title={item.page ? `Go to ${item.page}` : undefined}
                      style={{
                        flex: 1, minWidth: 0, textAlign: 'left', background: 'none',
                        border: 'none', padding: 0, cursor: item.page ? 'pointer' : 'default',
                      }}
                    >
                      <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-main)' }}>
                        {item.title}
                      </span>
                      {item.detail && (
                        <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.15rem', lineHeight: 1.4 }}>
                          {item.detail}
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => setDismissed(dismissNotification(item.id, feed?.today))}
                      title="Dismiss for today"
                      aria-label={`Dismiss: ${item.title}`}
                      style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.15rem', lineHeight: 0 }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {feed?.generatedAt && (
            <p style={{ margin: '0.9rem 0 0', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Checked {new Date(feed.generatedAt).toLocaleTimeString()} · {feed.todayName}, {feed.today}
            </p>
          )}
        </div>
      </div>

      </div>
    </section>
  );
}
