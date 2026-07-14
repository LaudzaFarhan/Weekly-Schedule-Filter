'use client';

import React, { useState, useEffect } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { DAY_NAMES, getWorkingDaysForBranch } from '../utils/constants';
import { MapPin, Save, Building2, Clock, X } from 'lucide-react';

/** Resolve saved per-day operating hours for a branch: { Monday: {start,end}, ... } */
export function resolveBranchHours(branch) {
  return (branch && branch.operatingHours) || {};
}

/**
 * Resolve a branch's operational days: prefer the explicit `workingDays`
 * saved on the branch, otherwise fall back to the legacy per-branch default.
 */
export function resolveBranchWorkingDays(branch) {
  if (branch && Array.isArray(branch.workingDays)) return branch.workingDays;
  const name = branch?.name === 'All Branches' ? 'default' : branch?.name;
  return getWorkingDaysForBranch(name);
}

export default function NewOperationalsPage() {
  const { branches, updateBranches } = useSchedule();
  const { showToast } = useToast();

  // Editable drafts: open days per branch, and operating hours per branch/day.
  const [draft, setDraft] = useState({});            // branchId -> Set(dayName)
  const [draftHours, setDraftHours] = useState({});  // branchId -> { day: { start, end } }
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Time editor popover state
  const [editor, setEditor] = useState(null);        // { branchId, day, branchName }
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  // Sync the drafts from context branches. When there are no unsaved edits we
  // fully re-sync (so a cloud-config load after mount is reflected); when the
  // user has pending edits we keep those and only add any new branches.
  useEffect(() => {
    setDraft((prev) => {
      const next = {};
      for (const b of branches) {
        next[b.id] = dirty && prev[b.id] ? prev[b.id] : new Set(resolveBranchWorkingDays(b));
      }
      return next;
    });
    setDraftHours((prev) => {
      const next = {};
      for (const b of branches) {
        next[b.id] = dirty && prev[b.id] ? prev[b.id] : { ...resolveBranchHours(b) };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches]);

  const openHoursEditor = (branch, day) => {
    const h = draftHours[branch.id]?.[day];
    setEditStart(h?.start || '09:00');
    setEditEnd(h?.end || '18:00');
    setEditor({ branchId: branch.id, day, branchName: branch.name });
  };

  const saveHours = () => {
    if (!editor) return;
    setDirty(true);
    setDraftHours((prev) => ({
      ...prev,
      [editor.branchId]: {
        ...(prev[editor.branchId] || {}),
        [editor.day]: { start: editStart, end: editEnd },
      },
    }));
    setEditor(null);
  };

  const clearHours = () => {
    if (!editor) return;
    setDirty(true);
    setDraftHours((prev) => {
      const branchHours = { ...(prev[editor.branchId] || {}) };
      delete branchHours[editor.day];
      return { ...prev, [editor.branchId]: branchHours };
    });
    setEditor(null);
  };

  const toggleDay = (branchId, day) => {
    setDirty(true);
    setDraft((prev) => {
      const set = new Set(prev[branchId] || []);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...prev, [branchId]: set };
    });
  };

  const setAll = (branchId, on) => {
    setDirty(true);
    setDraft((prev) => ({ ...prev, [branchId]: new Set(on ? DAY_NAMES : []) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleanHours = (obj) => {
        const out = {};
        for (const d of DAY_NAMES) {
          const h = obj?.[d];
          if (h && h.start && h.end) out[d] = { start: h.start, end: h.end };
        }
        return out;
      };
      const updated = branches.map((b) => ({
        ...b,
        workingDays: DAY_NAMES.filter((d) => draft[b.id]?.has(d)),
        operatingHours: cleanHours(draftHours[b.id]),
      }));
      // Await the durable (Google Sheets) write before confirming, so a quick
      // refresh can't cancel an in-flight save and lose the change.
      const res = await updateBranches(updated);
      if (res && res.configured === false) {
        showToast({
          title: 'Saved on this device only',
          message: res.error
            ? `Cloud sync failed: ${res.error}`
            : 'Cloud config is not connected, so this will not sync to other devices or the deployment.',
          variant: 'warning',
          duration: 7000,
        });
      } else {
        showToast({ title: 'Operational settings saved', variant: 'success' });
      }
      setDirty(false);
    } catch (err) {
      console.error('Failed to save operationals:', err);
      showToast({ title: 'Failed to save', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="dashboard-view active">
      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Building2 size={20} /> Operationals
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Set which branches are open and can be assigned classes on each day. These days drive the Quick Add branch list on the Schedule page.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
          >
            <Save size={16} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        <div className="panel-body table-wrapper">
          {branches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
              No branches configured. Add branches in Admin Settings first.
            </div>
          ) : (
            <table id="schedule-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '180px' }}>Branch</th>
                  {DAY_NAMES.map((d) => (
                    <th key={d} style={{ textAlign: 'center', width: '70px' }}>{d.slice(0, 3)}</th>
                  ))}
                  <th style={{ textAlign: 'center', width: '120px' }}>Quick set</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => {
                  const set = draft[b.id] || new Set();
                  const openCount = DAY_NAMES.filter((d) => set.has(d)).length;
                  return (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <MapPin size={14} style={{ color: 'var(--text-muted)' }} />
                          <span>
                            {b.name}
                            <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                              {openCount === 0 ? 'Closed all week' : `Open ${openCount} day${openCount === 1 ? '' : 's'}`}
                            </span>
                          </span>
                        </span>
                      </td>
                      {DAY_NAMES.map((d) => {
                        const on = set.has(d);
                        const hrs = draftHours[b.id]?.[d];
                        const hasHours = !!(hrs && hrs.start && hrs.end);
                        return (
                          <td key={d} style={{ textAlign: 'center' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}>
                                <button
                                  type="button"
                                  onClick={() => toggleDay(b.id, d)}
                                  title={`${b.name} — ${d}: ${on ? 'Open' : 'Closed'}`}
                                  style={{
                                    width: '30px',
                                    height: '30px',
                                    borderRadius: '7px',
                                    cursor: 'pointer',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    border: on ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                                    background: on ? 'var(--primary-blue)' : 'transparent',
                                    color: on ? 'white' : 'var(--text-muted)',
                                    transition: 'all 0.15s',
                                  }}
                                >
                                  {on ? '✓' : ''}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openHoursEditor(b, d)}
                                  disabled={!on}
                                  title={on ? `Set operating hours for ${b.name} on ${d}` : 'Enable the day first'}
                                  style={{
                                    width: '26px',
                                    height: '26px',
                                    borderRadius: '6px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: on ? 'pointer' : 'not-allowed',
                                    border: '1px solid var(--border-color)',
                                    background: hasHours ? 'var(--primary-blue-light)' : 'transparent',
                                    color: hasHours ? 'var(--primary-blue)' : 'var(--text-muted)',
                                    opacity: on ? 1 : 0.4,
                                  }}
                                >
                                  <Clock size={13} />
                                </button>
                              </div>
                              {on && hasHours && (
                                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                  {hrs.start}–{hrs.end}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '0.3rem' }}>
                          <button
                            type="button"
                            onClick={() => setAll(b.id, true)}
                            className="btn"
                            style={{ fontSize: '0.68rem', padding: '0.25rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setAll(b.id, false)}
                            className="btn"
                            style={{ fontSize: '0.68rem', padding: '0.25rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                          >
                            None
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Operating hours editor */}
      {editor && (
        <div
          onClick={() => setEditor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel-bg)', width: '100%', maxWidth: '340px', borderRadius: '16px',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)', border: '1px solid var(--border-color)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Clock size={16} /> Operating Hours
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{editor.branchName} · {editor.day}</span>
              </div>
              <button onClick={() => setEditor(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <label className="modal-form-label">Start</label>
                  <input
                    type="time"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="modal-form-label">End</label>
                  <input
                    type="time"
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              {editStart && editEnd && editEnd <= editStart && (
                <span style={{ fontSize: '0.72rem', color: 'var(--danger)' }}>
                  End time should be after the start time.
                </span>
              )}
            </div>

            <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '0.75rem', background: 'var(--bg-color)' }}>
              <button
                type="button"
                onClick={clearHours}
                className="btn"
                style={{ background: 'transparent', border: '1px solid var(--danger-border, var(--border-color))', color: 'var(--danger)', borderRadius: '10px', padding: '0.5rem 1rem', fontSize: '0.82rem' }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={saveHours}
                disabled={!editStart || !editEnd || editEnd <= editStart}
                className="btn btn-primary"
                style={{ borderRadius: '10px', padding: '0.5rem 1.25rem', fontSize: '0.82rem' }}
              >
                Set Hours
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
