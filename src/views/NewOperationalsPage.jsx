'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { DAY_NAMES, getWorkingDaysForBranch } from '../utils/constants';
import { MapPin, Save, Building2, Clock, X, Plus, Trash2, Copy, CalendarClock } from 'lucide-react';

/** Resolve saved per-day operating hours for a branch: { Monday: {start,end}, ... } */
export function resolveBranchHours(branch) {
  return (branch && branch.operatingHours) || {};
}

/**
 * Slot kinds usable in a day's class operation plan. Class kinds are bookable;
 * the rest (break / training / meeting) block the time for everyone.
 */
export const SLOT_TYPES = [
  { key: 'kinder',   label: 'Kinder Class',   category: 'Kinder', bookable: true,  color: '#ea580c', bg: 'rgba(249,115,22,0.1)' },
  { key: 'junior',   label: 'Junior Class',   category: 'Junior', bookable: true,  color: '#0891b2', bg: 'rgba(8,145,178,0.1)' },
  { key: 'coder',    label: 'Coder Class',    category: 'Coder',  bookable: true,  color: '#4f46e5', bg: 'rgba(79,70,229,0.1)' },
  { key: 'any',      label: 'Any Class',      category: null,     bookable: true,  color: '#059669', bg: 'rgba(5,150,105,0.1)' },
  { key: 'break',    label: 'Break',          category: null,     bookable: false, color: '#b45309', bg: 'rgba(245,158,11,0.12)' },
  { key: 'training', label: 'Training',       category: null,     bookable: false, color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
  { key: 'meeting',  label: 'Meeting',        category: null,     bookable: false, color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
];

export const slotTypeMeta = (key) =>
  SLOT_TYPES.find((t) => t.key === key) || SLOT_TYPES[SLOT_TYPES.length - 1];

/**
 * Resolve a branch's manual class operation plan:
 * { Monday: [ { type, start, end, label } ], ... }
 */
export function resolveBranchClassOps(branch) {
  return (branch && branch.classOperations) || {};
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
  const [draftOps, setDraftOps] = useState({});      // branchId -> { day: [ {type,start,end,label} ] }
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Day setup editor state (operating hours + class operation slots)
  const [editor, setEditor] = useState(null);        // { branchId, day, branchName }
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  // Class Operation table filters
  const [slotBranchFilter, setSlotBranchFilter] = useState('all');
  const [slotDayFilter, setSlotDayFilter] = useState('all');
  const [slotTypeFilter, setSlotTypeFilter] = useState('all');

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
    setDraftOps((prev) => {
      const next = {};
      for (const b of branches) {
        next[b.id] = dirty && prev[b.id] ? prev[b.id] : { ...resolveBranchClassOps(b) };
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

  // ── Class Operation time slots (separate table) ─────────────────────────
  // Mutate one slot in place, addressed by branchId + day + index.
  const updateSlot = (branchId, day, idx, patch) => {
    setDirty(true);
    setDraftOps((prev) => {
      const branchOps = { ...(prev[branchId] || {}) };
      const list = [...(branchOps[day] || [])];
      list[idx] = { ...list[idx], ...patch };
      branchOps[day] = list;
      return { ...prev, [branchId]: branchOps };
    });
  };

  const removeSlot = (branchId, day, idx) => {
    setDirty(true);
    setDraftOps((prev) => {
      const branchOps = { ...(prev[branchId] || {}) };
      const list = (branchOps[day] || []).filter((_, i) => i !== idx);
      if (list.length) branchOps[day] = list;
      else delete branchOps[day];
      return { ...prev, [branchId]: branchOps };
    });
  };

  const addSlot = (branchId, day) => {
    setDirty(true);
    setDraftOps((prev) => {
      const branchOps = { ...(prev[branchId] || {}) };
      const list = [...(branchOps[day] || [])];
      // Continue from the last slot's end, else the day's opening time.
      const last = list[list.length - 1];
      const start = last?.end || draftHours[branchId]?.[day]?.start || '13:00';
      const [h, m] = start.split(':').map((n) => parseInt(n, 10) || 0);
      const endMin = Math.min(h * 60 + m + 120, 23 * 60 + 59);
      const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      list.push({ type: 'any', start, end, label: '' });
      branchOps[day] = list;
      return { ...prev, [branchId]: branchOps };
    });
  };

  // Copy one day's slot plan to every other open day of the same branch.
  const copyDayPlan = (branchId, day) => {
    const source = draftOps[branchId]?.[day] || [];
    if (!source.length) {
      showToast({ title: 'Nothing to copy', message: `${day} has no slots yet.`, variant: 'warning' });
      return;
    }
    setDirty(true);
    const targets = DAY_NAMES.filter((d) => d !== day && draft[branchId]?.has(d));
    setDraftOps((prev) => {
      const branchOps = { ...(prev[branchId] || {}) };
      targets.forEach((d) => { branchOps[d] = source.map((s) => ({ ...s })); });
      return { ...prev, [branchId]: branchOps };
    });
    showToast({ title: `Copied ${day} to ${targets.length} other open day${targets.length === 1 ? '' : 's'}`, variant: 'success' });
  };

  const clearDayPlan = (branchId, day) => {
    setDirty(true);
    setDraftOps((prev) => {
      const branchOps = { ...(prev[branchId] || {}) };
      delete branchOps[day];
      return { ...prev, [branchId]: branchOps };
    });
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
      const cleanOps = (obj) => {
        const out = {};
        for (const d of DAY_NAMES) {
          const list = obj?.[d];
          if (Array.isArray(list) && list.length) {
            const rows = list
              .filter((s) => s && s.start && s.end && s.end > s.start)
              .map((s) => ({ type: s.type || 'any', start: s.start, end: s.end, label: (s.label || '').trim() }));
            if (rows.length) out[d] = rows;
          }
        }
        return out;
      };
      const updated = branches.map((b) => ({
        ...b,
        workingDays: DAY_NAMES.filter((d) => draft[b.id]?.has(d)),
        operatingHours: cleanHours(draftHours[b.id]),
        classOperations: cleanOps(draftOps[b.id]),
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

  // Flatten every branch/day slot into rows for the Class Operation table,
  // then apply the branch / day / type filters.
  const slotRows = useMemo(() => {
    const rows = [];
    for (const b of branches) {
      if (slotBranchFilter !== 'all' && b.id !== slotBranchFilter) continue;
      const byDay = draftOps[b.id] || {};
      for (const day of DAY_NAMES) {
        if (slotDayFilter !== 'all' && day !== slotDayFilter) continue;
        (byDay[day] || []).forEach((slot, idx) => {
          if (slotTypeFilter !== 'all' && (slot.type || 'any') !== slotTypeFilter) return;
          rows.push({ branchId: b.id, branchName: b.name, day, idx, slot });
        });
      }
    }
    return rows;
  }, [branches, draftOps, slotBranchFilter, slotDayFilter, slotTypeFilter]);

  // Adding a slot needs an unambiguous branch + day, so only offer it when
  // both filters are narrowed to a single value.
  const addTarget = useMemo(() => {
    if (slotBranchFilter === 'all' || slotDayFilter === 'all') return null;
    const b = branches.find((x) => x.id === slotBranchFilter);
    if (!b) return null;
    return { branchId: b.id, branchName: b.name, day: slotDayFilter };
  }, [branches, slotBranchFilter, slotDayFilter]);

  return (
    <section className="dashboard-view active">
      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Building2 size={20} /> Operationals
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Set which branches are open on each day, and use the clock icon to set that day&apos;s operating hours. Exact class slots are managed in the Class Operation table below.
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
                        const opsCount = (draftOps[b.id]?.[d] || []).length;
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
                                  title={on ? `Day setup for ${b.name} on ${d}: hours + class operation slots` : 'Enable the day first'}
                                  style={{
                                    position: 'relative',
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
                                  {on && opsCount > 0 && (
                                    <span style={{
                                      position: 'absolute', top: '-5px', right: '-5px',
                                      minWidth: '14px', height: '14px', lineHeight: '14px',
                                      borderRadius: '99px', fontSize: '0.55rem', fontWeight: 700,
                                      background: 'var(--primary-blue)', color: 'white', textAlign: 'center',
                                    }}>
                                      {opsCount}
                                    </span>
                                  )}
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

      {/* ── Class Operation time slots — all branches in one filterable table ── */}
      <div className="panel" style={{ margin: '1.5rem 0 0' }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <CalendarClock size={19} /> Class Operation Time Slots
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Set the exact slots per branch and day — Kinder / Junior / Coder classes plus breaks, training and meetings. These drive the time recommendations on the Schedule page.
            </p>
          </div>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
            {slotRows.length} slot{slotRows.length === 1 ? '' : 's'} shown
          </span>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', padding: '0.9rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <div>
            <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Branch</label>
            <select
              value={slotBranchFilter}
              onChange={(e) => setSlotBranchFilter(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', minWidth: '160px' }}
            >
              <option value="all">All Branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Day</label>
            <select
              value={slotDayFilter}
              onChange={(e) => setSlotDayFilter(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', minWidth: '130px' }}
            >
              <option value="all">All Days</option>
              {DAY_NAMES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Type</label>
            <select
              value={slotTypeFilter}
              onChange={(e) => setSlotTypeFilter(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', minWidth: '140px' }}
            >
              <option value="all">All Types</option>
              {SLOT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          {(slotBranchFilter !== 'all' || slotDayFilter !== 'all' || slotTypeFilter !== 'all') && (
            <button
              type="button"
              onClick={() => { setSlotBranchFilter('all'); setSlotDayFilter('all'); setSlotTypeFilter('all'); }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--primary-blue)', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', paddingBottom: '0.4rem' }}
            >
              <X size={13} /> Clear filters
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {addTarget ? (
              <>
                <button
                  type="button"
                  onClick={() => addSlot(addTarget.branchId, addTarget.day)}
                  className="btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', border: '1px solid var(--primary-blue)', color: 'var(--primary-blue)', background: 'transparent', borderRadius: '8px', padding: '0.4rem 0.8rem', cursor: 'pointer' }}
                >
                  <Plus size={14} /> Add slot to {addTarget.branchName} · {addTarget.day}
                </button>
                <button
                  type="button"
                  onClick={() => copyDayPlan(addTarget.branchId, addTarget.day)}
                  className="btn"
                  title={`Copy ${addTarget.day}'s slots to the branch's other open days`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', background: 'transparent', borderRadius: '8px', padding: '0.4rem 0.8rem', cursor: 'pointer' }}
                >
                  <Copy size={14} /> Copy to other days
                </button>
                <button
                  type="button"
                  onClick={() => clearDayPlan(addTarget.branchId, addTarget.day)}
                  className="btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', border: '1px solid var(--border-color)', color: 'var(--danger)', background: 'transparent', borderRadius: '8px', padding: '0.4rem 0.8rem', cursor: 'pointer' }}
                >
                  <Trash2 size={14} /> Clear day
                </button>
              </>
            ) : (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Pick a single branch and day above to add slots.
              </span>
            )}
          </div>
        </div>

        <div className="panel-body table-wrapper">
          {slotRows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No time slots defined for this selection. Days without a plan fall back to hourly suggestions inside the operating hours.
            </div>
          ) : (
            <table id="schedule-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '150px' }}>Branch</th>
                  <th style={{ minWidth: '100px' }}>Day</th>
                  <th style={{ minWidth: '135px' }}>Type</th>
                  <th style={{ minWidth: '110px' }}>Start</th>
                  <th style={{ minWidth: '110px' }}>End</th>
                  <th style={{ minWidth: '150px' }}>Note</th>
                  <th style={{ width: '70px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {slotRows.map((r) => {
                  const meta = slotTypeMeta(r.slot.type);
                  const invalid = r.slot.start && r.slot.end && r.slot.end <= r.slot.start;
                  return (
                    <tr key={`${r.branchId}||${r.day}||${r.idx}`} style={invalid ? { background: 'rgba(239,68,68,0.05)' } : undefined}>
                      <td style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <MapPin size={13} style={{ color: 'var(--text-muted)' }} /> {r.branchName}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>{r.day}</td>
                      <td>
                        <select
                          value={r.slot.type || 'any'}
                          onChange={(e) => updateSlot(r.branchId, r.day, r.idx, { type: e.target.value })}
                          style={{ fontSize: '0.78rem', padding: '0.28rem 0.4rem', borderRadius: '7px', border: `1px solid ${meta.color}55`, background: meta.bg, color: meta.color, fontWeight: 600, width: '100%' }}
                        >
                          {SLOT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          type="time"
                          value={r.slot.start || ''}
                          onChange={(e) => updateSlot(r.branchId, r.day, r.idx, { start: e.target.value })}
                          style={{ fontSize: '0.78rem', padding: '0.26rem 0.4rem', width: '100%' }}
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          value={r.slot.end || ''}
                          onChange={(e) => updateSlot(r.branchId, r.day, r.idx, { end: e.target.value })}
                          style={{ fontSize: '0.78rem', padding: '0.26rem 0.4rem', width: '100%', borderColor: invalid ? 'var(--danger)' : undefined }}
                        />
                        {invalid && (
                          <span style={{ fontSize: '0.62rem', color: 'var(--danger)', display: 'block' }}>
                            Must be after start
                          </span>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.slot.label || ''}
                          onChange={(e) => updateSlot(r.branchId, r.day, r.idx, { label: e.target.value })}
                          placeholder="Optional note"
                          style={{ fontSize: '0.78rem', padding: '0.26rem 0.5rem', width: '100%' }}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => removeSlot(r.branchId, r.day, r.idx)}
                          title="Remove this slot"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', display: 'inline-flex', padding: '0.25rem' }}
                        >
                          <Trash2 size={15} />
                        </button>
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
