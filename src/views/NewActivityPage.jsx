'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { History, Search, Trash, X } from 'lucide-react';

const HISTORY_KEY = 'newOpsScheduleHistory';

const ACTION_META = {
  add: { color: '#059669', bg: 'rgba(5,150,105,0.12)', label: 'ADD' },
  bulk: { color: '#4f46e5', bg: 'rgba(79,70,229,0.12)', label: 'BULK' },
  edit: { color: '#d97706', bg: 'rgba(217,119,6,0.12)', label: 'EDIT' },
  delete: { color: '#dc2626', bg: 'rgba(220,38,38,0.12)', label: 'DELETE' },
};

export default function NewActivityPage() {
  const [history, setHistory] = useState([]);
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const load = () => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      setHistory(raw ? JSON.parse(raw) : []);
    } catch {
      setHistory([]);
    }
  };

  useEffect(() => {
    load();
    // Refresh if activity is logged in another tab.
    const onStorage = (e) => { if (e.key === HISTORY_KEY) load(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const clearAll = () => {
    if (!window.confirm('Clear all schedule activity history?')) return;
    setHistory([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((h) => {
      if (actionFilter !== 'all' && h.action !== actionFilter) return false;
      if (q && !String(h.summary || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [history, actionFilter, search]);

  // Per-action totals for the quick chips.
  const counts = useMemo(() => {
    const c = { all: history.length, add: 0, bulk: 0, edit: 0, delete: 0 };
    history.forEach((h) => { if (c[h.action] !== undefined) c[h.action] += 1; });
    return c;
  }, [history]);

  return (
    <section className="dashboard-view active">
      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <History size={20} /> Schedule Activity
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Full log of schedule changes (add, bulk import, edit, delete) on this device.
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
        </div>

        {/* List */}
        <div style={{ padding: '1rem 1.5rem' }}>
          {history.length === 0 ? (
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
                const when = new Date(h.at);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '0.64rem', fontWeight: 700, color: meta.color, background: meta.bg, padding: '0.12rem 0.45rem', borderRadius: '5px', flexShrink: 0, minWidth: '52px', textAlign: 'center' }}>{meta.label}</span>
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
    </section>
  );
}
