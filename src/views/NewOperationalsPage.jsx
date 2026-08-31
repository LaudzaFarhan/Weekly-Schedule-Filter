'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { subscribeToInternalClasses } from '../services/internalScheduleService';
import { saveOperational, saveOperationals, deleteOperational } from '../services/newOperationalsService';
import { useNewOperationals } from '../hooks/useNewOperationals';
import { useScheduleRules } from '../hooks/useScheduleRules';
import { CATEGORIES, simulateSlot, CODER_LEVELS } from '../lib/programRules';
import { cleanSlotList } from '../lib/slotTypes';
import { groupClasses, levelCovers, instructorsAtBranch, overlaps } from '../lib/instructorAvailability';
import { DAY_NAMES, getWorkingDaysForBranch, DEFAULT_BRANCH_LIST } from '../utils/constants';
import { MapPin, Save, Building2, Clock, X, Plus, Trash2, AlertTriangle, Coffee, ShieldCheck, FlaskConical, CheckCircle2, RotateCcw } from 'lucide-react';

/** Resolve saved per-day operating hours for a branch: { Monday: {start,end}, ... } */
export function resolveBranchHours(branch) {
  return (branch && branch.operatingHours) || {};
}

// Slot kinds live in src/lib/slotTypes.js. This page no longer re-exports them:
// every consumer now imports from there directly.

/**
 * Resolve a branch's manual class operation plan:
 * { Monday: [ { type, start, end, label } ], ... }
 */
export function resolveBranchClassOps(branch) {
  return (branch && branch.classOperations) || {};
}

/**
 * Maximum number of the given slots that can run at once, given the available
 * instructors. Each instructor teaches at most one slot at a time, and can only
 * take a slot whose category their level covers — a bipartite matching.
 */
function maxConcurrentAssignable(slots, instructors) {
  const options = slots.map((s) =>
    instructors.reduce((acc, inst, idx) => {
      if (levelCovers(inst.level, slotTypeMeta(s.type).category)) acc.push(idx);
      return acc;
    }, [])
  );
  const takenBy = new Array(instructors.length).fill(-1);

  const assign = (slotIdx, seen) => {
    for (const instIdx of options[slotIdx]) {
      if (seen[instIdx]) continue;
      seen[instIdx] = true;
      if (takenBy[instIdx] === -1 || assign(takenBy[instIdx], seen)) {
        takenBy[instIdx] = slotIdx;
        return true;
      }
    }
    return false;
  };

  let matched = 0;
  for (let s = 0; s < slots.length; s += 1) {
    if (assign(s, new Array(instructors.length).fill(false))) matched += 1;
  }
  return matched;
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map((n) => parseInt(n, 10));
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
};

const minToHHMM = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** The break entry in a day's slot list, if one has been set. */
const findBreakSlot = (slots) =>
  (Array.isArray(slots) ? slots : []).find((s) => s.type === 'break') || null;

/**
 * Find slots in a day's plan that exceed the branch's instructor capacity.
 * Walks every slot start time, collects the class slots running at that moment,
 * and checks they can all be staffed at once. Returns Map(index -> reason).
 */
function findCapacityConflicts(daySlots, instructors, context = {}) {
  const { classGroups = [], day = null, branchName = null } = context;
  const conflicts = new Map();
  const classSlots = daySlots
    .map((slot, idx) => ({ slot, idx, start: toMin(slot.start), end: toMin(slot.end) }))
    .filter((r) => slotTypeMeta(r.slot.type).bookable && r.start != null && r.end != null && r.end > r.start);

  if (classSlots.length === 0) return conflicts;

  /**
   * Instructors genuinely available at this instant.
   *
   * A class at ANOTHER branch takes them out — that was the gap that let a
   * plan pass validation with nobody left to teach it. Classes at this branch
   * are left in, because those are the realisation of these very slots.
   */
  const availableAt = (start, end) => {
    if (!day || classGroups.length === 0) return { free: instructors, busy: [] };
    const busy = [];
    const free = instructors.filter((inst) => {
      const clash = classGroups.find((g) =>
        g.teacher === inst.name &&
        g.day === day &&
        g.branchName && g.branchName !== branchName &&
        overlaps(start, end, g.startMin, g.endMin)
      );
      if (clash) { busy.push({ inst, clash }); return false; }
      return true;
    });
    return { free, busy };
  };

  for (const probe of classSlots) {
    // Everything running at this instant.
    const group = classSlots.filter((r) => r.start <= probe.start && r.end > probe.start);
    const groupEnd = Math.max(...group.map((g) => g.end));
    const { free, busy } = availableAt(probe.start, groupEnd);

    const elsewhere = busy.length
      ? ` — ${busy.map((b) => `${b.inst.name} is at ${b.clash.branchName}`).join(', ')}`
      : '';

    if (group.length <= 1 && free.length >= 1) {
      // A lone slot still needs at least one instructor who can teach it.
      const solo = maxConcurrentAssignable(group.map((g) => g.slot), free);
      if (solo < group.length) {
        for (const g of group) {
          const cat = slotTypeMeta(g.slot.type).category;
          conflicts.set(g.idx, `No ${cat || 'available'} instructor free at this branch${elsewhere}`);
        }
      }
      continue;
    }
    const capacity = maxConcurrentAssignable(group.map((g) => g.slot), free);
    if (capacity < group.length) {
      const reason = instructors.length === 0
        ? 'No instructors assigned to this branch'
        : free.length === 0
          ? `No instructor free at this time${elsewhere}`
          : `${group.length} classes overlap but only ${capacity} can be staffed (${free.length} of ${instructors.length} instructor${instructors.length === 1 ? '' : 's'} free)${elsewhere}`;
      for (const g of group) conflicts.set(g.idx, reason);
    }
  }
  return conflicts;
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
  // `branches` supplies the branch names/ids only. All operational values —
  // open days, hours and class slots — come from PostgreSQL, because New
  // Operations does not use the Google Sheets config that Old Operations reads.
  const { branches, updateBranches } = useSchedule();
  const { showToast } = useToast();
  const { rules, loading: rulesLoading, error: rulesError, isEmpty } = useNewOperationals();

  // Editable drafts: open days per branch, and operating hours per branch/day.
  const [draft, setDraft] = useState({});            // branchId -> Set(dayName)
  const [draftHours, setDraftHours] = useState({});  // branchId -> { day: { start, end } }
  const [draftOps, setDraftOps] = useState({});      // branchId -> { day: [ {type,start,end,label} ] }
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [instructors, setInstructors] = useState([]);
  // Real bookings, so the capacity check knows who is already teaching.
  const [classes, setClasses] = useState([]);

  // Day setup editor state (operating hours + class operation slots)
  const [editor, setEditor] = useState(null);        // { branchId, day, branchName }
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  // Break within the day's hours, stored as a `break` slot in the plan.
  const [editBreakOn, setEditBreakOn] = useState(false);
  const [editBreakStart, setEditBreakStart] = useState('12:30');
  const [editBreakMins, setEditBreakMins] = useState(60);
  const [editBreakLabel, setEditBreakLabel] = useState('');

  // Add Branch state
  const [showAddBranchModal, setShowAddBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchUrl, setNewBranchUrl] = useState('');
  const [newBranchTrialUrl, setNewBranchTrialUrl] = useState('');
  const [addBranchError, setAddBranchError] = useState('');

  // Build the editable drafts from the PostgreSQL rules, matched to branches by
  // name. While the user has unsaved edits we leave their drafts alone so a
  // background poll can't wipe work in progress.
  useEffect(() => {
    if (rulesLoading || dirty) return;

    const byBranchDay = new Map(); // "branchName||day" -> rule
    for (const r of rules) byBranchDay.set(`${r.branchName}||${r.day}`, r);

    const nextDays = {};
    const nextHours = {};
    const nextOps = {};

    for (const b of branches) {
      const days = new Set();
      const hours = {};
      const ops = {};
      for (const day of DAY_NAMES) {
        const rule = byBranchDay.get(`${b.name}||${day}`);
        if (!rule) continue;
        if (rule.isOpen) days.add(day);
        if (rule.openTime && rule.closeTime) {
          hours[day] = { start: rule.openTime, end: rule.closeTime };
        }
        if (Array.isArray(rule.slots) && rule.slots.length) {
          ops[day] = rule.slots.map((s) => ({ ...s }));
        }
      }
      nextDays[b.id] = days;
      nextHours[b.id] = hours;
      nextOps[b.id] = ops;
    }

    setDraft(nextDays);
    setDraftHours(nextHours);
    setDraftOps(nextOps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, rulesLoading, branches]);

  /**
   * One-time import of the legacy Google Sheets branch settings into Postgres,
   * so switching the source of truth doesn't lose existing configuration.
   */
  const importFromLegacyConfig = async () => {
    const payload = [];
    for (const b of branches) {
      const legacyDays = resolveBranchWorkingDays(b) || [];
      const legacyHours = resolveBranchHours(b) || {};
      const legacyOps = resolveBranchClassOps(b) || {};
      for (const day of DAY_NAMES) {
        const isOpen = legacyDays.includes(day);
        const h = legacyHours[day];
        const slots = legacyOps[day];
        // Skip days with nothing recorded at all.
        if (!isOpen && !h && !slots) continue;
        payload.push({
          branchName: b.name,
          day,
          isOpen,
          openTime: h?.start || null,
          closeTime: h?.end || null,
          slots: Array.isArray(slots) ? slots : [],
        });
      }
    }

    if (payload.length === 0) {
      showToast({ title: 'Nothing to import', message: 'No legacy branch settings were found.', variant: 'warning' });
      return;
    }

    setSaving(true);
    try {
      await saveOperationals(payload);
      showToast({
        title: `Imported ${payload.length} branch/day rule${payload.length === 1 ? '' : 's'}`,
        message: 'New Operations now reads these from the database.',
        variant: 'success',
      });
      setDirty(false);
    } catch (err) {
      showToast({ title: 'Import failed', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // New Ops instructors drive how many classes a branch can run at once.
  useEffect(() => {
    const unsubscribe = subscribeToInternalInstructors((data) => setInstructors(data || []));
    return () => unsubscribe();
  }, []);

  // Existing classes and leave — an instructor teaching elsewhere or away is
  // not available, however many people the branch has on paper.
  useEffect(() => {
    const unsub = subscribeToInternalClasses(
      (data) => setClasses(data || []),
      () => { /* the grid falls back to plan-only knowledge */ }
    );
    return () => unsub();
  }, []);

  // internal_classes stores one row per enrolled student; collapse them into
  // actual classes so seat occupancy and conflicts are counted correctly.
  const classGroups = useMemo(() => groupClasses(classes), [classes]);

  const openHoursEditor = (branch, day) => {
    const h = draftHours[branch.id]?.[day];
    setEditStart(h?.start || '09:00');
    setEditEnd(h?.end || '18:00');
    // Load any existing break for this day so it can be edited in place.
    const existing = findBreakSlot(draftOps[branch.id]?.[day]);
    setEditBreakOn(!!existing);
    setEditBreakStart(existing?.start || '12:30');
    setEditBreakMins(existing ? (toMin(existing.end) - toMin(existing.start)) : 60);
    setEditBreakLabel(existing?.label || '');

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

    // The break is stored as a `break` slot in the day's plan, so the API and
    // the schedule recommendations already treat it as blocked time.
    setDraftOps((prev) => {
      const branchOps = { ...(prev[editor.branchId] || {}) };
      const list = (branchOps[editor.day] || []).filter((s) => s.type !== 'break');

      if (editBreakOn && editBreakStart) {
        const startMin = toMin(editBreakStart);
        const mins = Math.max(15, parseInt(editBreakMins, 10) || 60);
        const endMin = Math.min(startMin + mins, 23 * 60 + 59);
        list.push({
          type: 'break',
          start: minToHHMM(startMin),
          end: minToHHMM(endMin),
          label: editBreakLabel.trim(),
        });
      }

      if (list.length) branchOps[editor.day] = list.sort((a, b) => a.start.localeCompare(b.start));
      else delete branchOps[editor.day];
      return { ...prev, [editor.branchId]: branchOps };
    });

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
    // Drop the break too, but keep any class slots the user defined.
    setDraftOps((prev) => {
      const branchOps = { ...(prev[editor.branchId] || {}) };
      const list = (branchOps[editor.day] || []).filter((s) => s.type !== 'break');
      if (list.length) branchOps[editor.day] = list;
      else delete branchOps[editor.day];
      return { ...prev, [editor.branchId]: branchOps };
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
    // Refuse to persist a plan that asks for more simultaneous classes than the
    // branch has instructors to staff.
    if (capacity.totalConflicts > 0) {
      showToast({
        title: 'Fix instructor capacity first',
        message: `${capacity.totalConflicts} class slot${capacity.totalConflicts === 1 ? '' : 's'} exceed the instructor capacity of their branch.`,
        variant: 'error',
        duration: 7000,
      });
      return;
    }
    setSaving(true);
    try {
      // One row per branch/day. POST upserts on (branchName, day).
      const payload = [];
      for (const b of branches) {
        for (const day of DAY_NAMES) {
          const isOpen = !!draft[b.id]?.has(day);
          const hrs = draftHours[b.id]?.[day];
          const slots = cleanSlotList(draftOps[b.id]?.[day]);
          // Skip days that are closed and hold nothing — no point storing them.
          if (!isOpen && !hrs && slots.length === 0) continue;
          payload.push({
            branchName: b.name,
            day,
            isOpen,
            openTime: hrs?.start || null,
            closeTime: hrs?.end || null,
            slots,
          });
        }
      }

      await saveOperationals(payload);

      // Remove rows the user has since emptied, so the database matches the UI.
      const wanted = new Set(payload.map((p) => `${p.branchName}||${p.day}`));
      const stale = rules.filter((r) => !wanted.has(`${r.branchName}||${r.day}`));
      for (const r of stale) {
        try {
          await deleteOperational({ id: r.id });
        } catch {
          /* a leftover row is harmless — don't fail the save over it */
        }
      }

      showToast({
        title: 'Operational settings saved',
        message: `${payload.length} branch/day rule${payload.length === 1 ? '' : 's'} stored in the database.`,
        variant: 'success',
      });
      setDirty(false);
    } catch (err) {
      console.error('Failed to save operationals:', err);
      showToast({ title: 'Failed to save', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Instructor headcount per branch, and the capacity conflicts it implies for
  // every branch/day plan. A branch with one instructor can only run one class
  // at a time, so overlapping Kinder + Junior slots at 1pm is invalid.
  const capacity = useMemo(() => {
    const staffByBranch = new Map();
    const conflictsByKey = new Map(); // `${branchId}||${day}` -> Map(idx -> reason)
    let totalConflicts = 0;

    for (const b of branches) {
      const staff = instructorsAtBranch(instructors, b.name);
      staffByBranch.set(b.id, staff);
      const byDay = draftOps[b.id] || {};
      for (const day of DAY_NAMES) {
        const list = byDay[day] || [];
        if (!list.length) continue;
        const found = findCapacityConflicts(list, staff, {
          classGroups, day, branchName: b.name,
        });
        if (found.size) {
          conflictsByKey.set(`${b.id}||${day}`, found);
          totalConflicts += found.size;
        }
      }
    }
    return { staffByBranch, conflictsByKey, totalConflicts };
  }, [branches, instructors, draftOps, classGroups]);

  const handleAddBranchSubmit = async (e) => {
    if (e) e.preventDefault();
    setAddBranchError('');
    const trimmed = newBranchName.trim();
    if (!trimmed) {
      setAddBranchError('Branch name is required.');
      return;
    }
    if (branches.some(b => String(b.name || '').toLowerCase() === trimmed.toLowerCase())) {
      setAddBranchError(`Branch "${trimmed}" already exists.`);
      return;
    }

    const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const newBranch = {
      id,
      name: trimmed,
      url: newBranchUrl.trim(),
      trialUrl: newBranchTrialUrl.trim(),
    };

    const updatedBranches = [...branches, newBranch];
    try {
      await updateBranches(updatedBranches);
      
      // Initialize default open days for the new branch in draft state
      setDraft(prev => ({
        ...prev,
        [id]: new Set(DAY_NAMES)
      }));
      setDirty(true);

      showToast({
        title: `Branch "${trimmed}" added successfully`,
        message: 'Open days enabled for all days by default. Click "Save Changes" to commit rules.',
        variant: 'success',
      });
      setShowAddBranchModal(false);
      setNewBranchName('');
      setNewBranchUrl('');
      setNewBranchTrialUrl('');
    } catch (err) {
      console.error('Failed to add branch:', err);
      setAddBranchError(err?.message || 'Failed to add branch');
    }
  };

  const handleDeleteBranch = async (branchId, branchName) => {
    if (!window.confirm(`Are you sure you want to delete branch "${branchName}"?`)) return;
    try {
      const updated = branches.filter(b => b.id !== branchId);
      await updateBranches(updated);
      showToast({
        title: `Branch "${branchName}" deleted successfully`,
        variant: 'success',
      });
    } catch (err) {
      console.error('Failed to delete branch:', err);
      showToast({
        title: 'Failed to delete branch',
        variant: 'error',
      });
    }
  };

  const handleRestoreDefaultBranches = async () => {
    if (!window.confirm('Restore 7 standard branches (Gading Serpong, Puri Indah, Pondok Indah, Pluit Village, Kelapa Gading, Bekasi, Bintaro)?')) return;
    const defaultBranches = DEFAULT_BRANCH_LIST.map((b) => ({
      id: b.id,
      name: b.name,
      url: '',
    }));
    try {
      await updateBranches(defaultBranches);
      const nextDays = {};
      for (const b of defaultBranches) {
        nextDays[b.id] = new Set(DAY_NAMES);
      }
      setDraft(nextDays);
      setDirty(true);
      showToast({
        title: 'Restored 7 standard branches',
        message: 'Default branches loaded. Click "Save Changes" to commit operational settings.',
        variant: 'success',
      });
    } catch (err) {
      showToast({ title: 'Failed to restore branches', message: err?.message, variant: 'error' });
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
              Set which branches are open on each day, and use the clock icon to set that day&apos;s operating hours. Exact class slots are managed in the Class Operation table below. Stored in PostgreSQL and served by <code>/api/new/operationals</code>.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {branches.length <= 1 && (
              <button
                type="button"
                onClick={handleRestoreDefaultBranches}
                className="btn"
                title="Restore standard 7 branches (Gading Serpong, Puri Indah, Pondok Indah, Pluit Village, Kelapa Gading, Bekasi, Bintaro)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  borderRadius: '10px',
                  padding: '0.5rem 1rem',
                  fontSize: '0.85rem',
                  background: 'rgba(79, 70, 229, 0.08)',
                  color: 'var(--primary-blue, #4f46e5)',
                  border: '1px solid var(--primary-blue, #4f46e5)',
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={15} /> Restore Standard Branches
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAddBranchModal(true)}
              className="btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                borderRadius: '10px',
                padding: '0.5rem 1.2rem',
                fontSize: '0.85rem',
                background: 'transparent',
                border: '1px solid var(--border-color)',
                cursor: 'pointer',
              }}
            >
              <Plus size={16} /> Add Branch
            </button>
            <button
              onClick={handleSave}
              disabled={saving || capacity.totalConflicts > 0}
              title={capacity.totalConflicts > 0 ? 'Resolve the instructor capacity conflicts below first' : 'Save operational settings'}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
            >
              <Save size={16} /> {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

        {rulesError && (
          <div style={{
            margin: '0.9rem 1.5rem 0', padding: '0.7rem 0.9rem', borderRadius: '10px',
            background: 'var(--danger-bg, rgba(239,68,68,0.1))', border: '1px solid rgba(239,68,68,0.35)',
            display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
          }}>
            <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '0.1rem' }} />
            <span style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>{rulesError}</span>
          </div>
        )}

        {isEmpty && (
          <div style={{
            margin: '0.9rem 1.5rem 0', padding: '0.8rem 1rem', borderRadius: '10px',
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)',
            display: 'flex', alignItems: 'flex-start', gap: '0.6rem', flexWrap: 'wrap',
          }}>
            <AlertTriangle size={16} style={{ color: '#b45309', flexShrink: 0, marginTop: '0.1rem' }} />
            <span style={{ fontSize: '0.78rem', color: '#92400e', flex: '1 1 320px' }}>
              No rules in the database yet, so the API and Trial Availability have nothing to work with.
              If you previously configured branches under Old Operations, import those settings once to carry them over.
            </span>
            <button
              type="button"
              onClick={importFromLegacyConfig}
              disabled={saving}
              className="btn"
              style={{ border: '1px solid #b45309', color: '#b45309', background: 'transparent', borderRadius: '9px', padding: '0.45rem 0.9rem', fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {saving ? 'Importing…' : 'Import previous settings'}
            </button>
          </div>
        )}

        <div className="panel-body table-wrapper">
          {rulesLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '2.5rem', color: 'var(--text-secondary)' }}>
              <div className="loading-spinner" /> Loading operational rules…
            </div>
          ) : branches.length === 0 ? (
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
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <MapPin size={14} style={{ color: 'var(--text-muted)' }} />
                            <span>
                              {b.name}
                              <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                                {openCount === 0 ? 'Closed all week' : `Open ${openCount} day${openCount === 1 ? '' : 's'}`}
                              </span>
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteBranch(b.id, b.name)}
                            title={`Delete ${b.name}`}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '0.2rem',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      </td>
                      {DAY_NAMES.map((d) => {
                        const on = set.has(d);
                        const hrs = draftHours[b.id]?.[d];
                        const hasHours = !!(hrs && hrs.start && hrs.end);
                        // Breaks live in the popover, so don't count them here.
                        const opsCount = (draftOps[b.id]?.[d] || []).filter((s) => s.type !== 'break').length;
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

      <ScheduleRulesPanel />

      {/* The availability grid lives on the Schedule page, where allocation
          happens. This page keeps the underlying branch/day rules. */}



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
              maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)', border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Clock size={16} /> Hours &amp; Break
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
                    className="modal-input-field"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="modal-form-label">End</label>
                  <input
                    type="time"
                    className={`modal-input-field ${editStart && editEnd && editEnd <= editStart ? 'error' : ''}`}
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                  />
                </div>
              </div>
              {editStart && editEnd && editEnd <= editStart && (
                <span style={{ fontSize: '0.72rem', color: 'var(--danger)' }}>
                  End time should be after the start time.
                </span>
              )}

              {/* Break inside the operating hours */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.9rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', marginBottom: editBreakOn ? '0.7rem' : 0 }}>
                  <input
                    type="checkbox"
                    checked={editBreakOn}
                    onChange={(e) => setEditBreakOn(e.target.checked)}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Coffee size={14} /> Break during the day
                  </span>
                </label>

                {editBreakOn && (
                  <>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <div style={{ flex: 1 }}>
                        <label className="modal-form-label">Starts at</label>
                        <input
                          type="time"
                          className="modal-input-field"
                          value={editBreakStart}
                          onChange={(e) => setEditBreakStart(e.target.value)}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label className="modal-form-label">Length</label>
                        <div className="field-with-suffix">
                          <input
                            type="number" min="15" step="15"
                            className="modal-input-field"
                            value={editBreakMins}
                            onChange={(e) => setEditBreakMins(e.target.value)}
                          />
                          <span className="field-suffix">min</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: '0.6rem' }}>
                      <label className="modal-form-label">Note (optional)</label>
                      <input
                        type="text"
                        className="modal-input-field"
                        value={editBreakLabel}
                        onChange={(e) => setEditBreakLabel(e.target.value)}
                        placeholder="e.g. Lunch"
                      />
                    </div>

                    {/* Live preview + sanity checks against the day's hours */}
                    {(() => {
                      const bs = toMin(editBreakStart);
                      const mins = Math.max(15, parseInt(editBreakMins, 10) || 60);
                      if (bs == null) return null;
                      const be = bs + mins;
                      const open = toMin(editStart);
                      const close = toMin(editEnd);
                      const outside = open != null && close != null && (bs < open || be > close);
                      return (
                        <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.35rem', alignSelf: 'flex-start',
                            fontSize: '0.75rem', fontWeight: 600, padding: '0.25rem 0.6rem', borderRadius: '99px',
                            color: '#b45309', background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.4)',
                          }}>
                            <Coffee size={12} />
                            {minToHHMM(bs)}–{minToHHMM(be)}
                            {editBreakLabel.trim() ? ` · ${editBreakLabel.trim()}` : ''}
                          </span>
                          {outside && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--danger)' }}>
                              This break falls outside {editStart}–{editEnd}. Widen the hours or move the break.
                            </span>
                          )}
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            No class can be booked in this window, and it is excluded from trial availability.
                          </span>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
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
      {/* Add Branch Modal */}
      {showAddBranchModal && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: 'var(--panel-bg)',
              width: '100%',
              maxWidth: '480px',
              borderRadius: '16px',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              border: '1px solid var(--border-color)',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-color)',
            }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Building2 size={18} style={{ color: 'var(--primary-blue, #4f46e5)' }} /> Add New Branch
              </h2>
              <button
                type="button"
                onClick={() => setShowAddBranchModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddBranchSubmit}>
              <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label className="modal-form-label">Branch Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input
                    type="text"
                    placeholder="e.g. Bekasi, Bintaro, Kemang, Bandung..."
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    className="modal-input-field"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="modal-form-label">Schedule Publish URL (Optional)</label>
                  <input
                    type="text"
                    placeholder="Google Sheets pubhtml link..."
                    value={newBranchUrl}
                    onChange={(e) => setNewBranchUrl(e.target.value)}
                    className="modal-input-field"
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                    Google Sheets HTML publish link for synchronizing schedule data.
                  </span>
                </div>

                <div>
                  <label className="modal-form-label">Trial Submit URL (Optional)</label>
                  <input
                    type="text"
                    placeholder="Apps Script Web App URL..."
                    value={newBranchTrialUrl}
                    onChange={(e) => setNewBranchTrialUrl(e.target.value)}
                    className="modal-input-field"
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                    Apps Script Web App URL for submitting trial lead bookings.
                  </span>
                </div>

                {addBranchError && (
                  <div style={{ padding: '0.6rem 0.8rem', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <AlertTriangle size={15} /> {addBranchError}
                  </div>
                )}
              </div>

              <div style={{
                padding: '1rem 1.5rem',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                background: 'var(--bg-color)',
              }}>
                <button
                  type="button"
                  onClick={() => setShowAddBranchModal(false)}
                  className="btn"
                  style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ borderRadius: '10px', padding: '0.5rem 1.5rem', fontSize: '0.85rem' }}
                >
                  Add Branch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

/* ─── Schedule Rules ─────────────────────────────────────────────────────
   Which programs may share one teaching slot. Kinder is the strict case:
   Kinder Foundation and Kinder Core cannot be combined. Junior may combine
   Foundation with Core, and Coder has no restriction. All of it is editable
   here rather than hardcoded. */

const CATEGORY_META = {
  Kinder: { color: '#ea580c', bg: 'rgba(249,115,22,0.1)', families: 'Kinder Foundation (KF1–KF2) · Kinder Core (K1–K4)' },
  Junior: { color: '#0891b2', bg: 'rgba(8,145,178,0.1)', families: 'Junior Foundation (JF1–JF2) · Junior Core (J1–J4)' },
  Coder:  { color: '#4f46e5', bg: 'rgba(79,70,229,0.1)', families: 'All Coder levels count as one family' },
};

function ScheduleRulesPanel() {
  const { showToast } = useToast();
  const { rules, configured, loading, save, reset } = useScheduleRules();

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  // Seed the editable copy once the stored rules arrive.
  useEffect(() => {
    if (!loading) setDraft(JSON.parse(JSON.stringify(rules)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, configured]);

  const current = draft || rules;
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(rules);

  const setCat = (cat, patch) =>
    setDraft((prev) => ({ ...(prev || rules), [cat]: { ...(prev || rules)[cat], ...patch } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await save(current);
      showToast({ title: 'Schedule rules saved', variant: 'success' });
    } catch (err) {
      showToast({ title: 'Could not save rules', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset schedule rules to the defaults?')) return;
    setSaving(true);
    try {
      const data = await reset();
      setDraft(JSON.parse(JSON.stringify(data.rules)));
      showToast({ title: 'Rules reset to defaults', variant: 'success' });
    } catch (err) {
      showToast({ title: 'Could not reset rules', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel" style={{ margin: '1.5rem 0 0' }}>
      <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <ShieldCheck size={19} /> Schedule Rules
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
            Which programs one instructor may teach together in the same slot. Applied when adding or editing a class, and when recommending times.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {!configured && (
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>Using defaults</span>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={saving || loading}
            className="btn"
            style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: '10px', padding: '0.5rem 1rem', fontSize: '0.82rem' }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || !dirty}
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
          >
            <Save size={16} /> {saving ? 'Saving…' : 'Save Rules'}
          </button>
        </div>
      </div>

      <div className="panel-body">
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '2rem', color: 'var(--text-secondary)' }}>
            <div className="loading-spinner" /> Loading rules…
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              {CATEGORIES.map((cat) => {
                const meta = CATEGORY_META[cat];
                const c = current[cat];
                return (
                  <div key={cat} style={{ border: `1px solid ${meta.color}33`, background: meta.bg, borderRadius: '12px', padding: '0.9rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <strong style={{ fontSize: '0.92rem', color: meta.color }}>{cat}</strong>
                      <select
                        value={c.enforcement}
                        onChange={(e) => setCat(cat, { enforcement: e.target.value })}
                        className="modal-select-field field-compact"
                        style={{ width: 'auto', minWidth: '96px' }}
                      >
                        <option value="block">Block</option>
                        <option value="warn">Warn only</option>
                      </select>
                    </div>

                    <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: '0 0 0.7rem' }}>
                      {meta.families}
                    </p>

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', cursor: 'pointer', marginBottom: '0.7rem' }}>
                      <input
                        type="checkbox"
                        checked={c.allowMixFamilies}
                        onChange={(e) => setCat(cat, { allowMixFamilies: e.target.checked })}
                        style={{ marginTop: '0.15rem' }}
                      />
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-main)' }}>
                        Allow combining different programs
                        <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {c.allowMixFamilies
                            ? 'Foundation and Core can share one slot.'
                            : 'Foundation and Core must be in separate slots.'}
                        </span>
                      </span>
                    </label>

                    <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Max students per class</label>
                    <div className="field-with-suffix">
                      <input
                        type="number" min="1" max="20"
                        className="modal-input-field field-compact"
                        value={c.maxStudents}
                        onChange={(e) => setCat(cat, { maxStudents: e.target.value })}
                      />
                      <span className="field-suffix">seats</span>
                    </div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', margin: '0.25rem 0 0.7rem' }}>
                      A slot is full at {c.maxStudents} {cat} student{Number(c.maxStudents) === 1 ? '' : 's'}.
                    </span>

                    <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Max different lessons per slot</label>
                    <div className="field-with-suffix">
                      <input
                        type="number" min="0" max="10"
                        className="modal-input-field field-compact"
                        value={c.maxDistinctLessons}
                        onChange={(e) => setCat(cat, { maxDistinctLessons: e.target.value })}
                      />
                      <span className="field-suffix">{Number(c.maxDistinctLessons) > 0 ? 'lessons' : 'any'}</span>
                    </div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.25rem' }}>
                      {Number(c.maxDistinctLessons) > 0
                        ? `e.g. KF1.1 + KF1.2 counts as 2.`
                        : 'No limit on how many lessons run together.'}
                    </span>
                  </div>
                );
              })}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', marginTop: '1rem' }}>
              <input
                type="checkbox"
                checked={current.allowMixCategories}
                onChange={() => setDraft((prev) => ({ ...(prev || rules), allowMixCategories: !current.allowMixCategories }))}
              />
              <span style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                Allow mixing categories in one slot
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}> — e.g. a Kinder and a Junior student with the same instructor at the same time</span>
              </span>
            </label>

            {dirty && (
              <div style={{ marginTop: '0.85rem', fontSize: '0.75rem', color: '#b45309', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '9px', padding: '0.5rem 0.75rem' }}>
                Unsaved rule changes.
              </div>
            )}

            <ClassSimulator rules={current} />
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Class Simulator ────────────────────────────────────────────────────
   Try a combination of programs against the current rules without touching
   real data. Useful for checking a rule change before saving it, and for
   settling "can these two share a slot?" questions. */

/** Program codes offered per category in the simulator. */
const SIM_CODES = {
  Kinder: ['KF1', 'KF2', 'K1', 'K2', 'K3', 'K4'],
  Junior: ['JF1', 'JF2', 'J1', 'J2', 'J3', 'J4'],
  Coder: CODER_LEVELS,
};

const LESSONS = Array.from({ length: 10 }, (_, i) => String(i + 1));

/** Combine a code and lesson into a stored program value. Coder has no lesson. */
const buildSimProgram = (category, code, lesson) =>
  category === 'Coder' ? code : `${code}.${lesson}`;

function ClassSimulator({ rules }) {
  const [category, setCategory] = useState('Kinder');
  // One row per student: { code, lesson }
  const [students, setStudents] = useState([
    { code: 'KF1', lesson: '1' },
    { code: 'K2', lesson: '3' },
  ]);

  const codes = SIM_CODES[category];

  const changeCategory = (next) => {
    setCategory(next);
    // Reset to two sensible defaults for the new category.
    const list = SIM_CODES[next];
    setStudents([
      { code: list[0], lesson: '1' },
      { code: list[2] || list[1] || list[0], lesson: '1' },
    ]);
  };

  const setStudent = (idx, patch) =>
    setStudents((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const addStudent = () =>
    setStudents((prev) => [...prev, { code: codes[0], lesson: '1' }]);

  const removeStudent = (idx) =>
    setStudents((prev) => prev.filter((_, i) => i !== idx));

  const programs = useMemo(
    () => students.map((s) => buildSimProgram(category, s.code, s.lesson)),
    [students, category]
  );

  const result = useMemo(() => simulateSlot(programs, rules), [programs, rules]);
  const doable = result.steps.length > 0 && result.steps.every((s) => s.admitted);
  // The first thing that fails is the useful explanation.
  const blocker = result.steps.find((s) => !s.admitted);

  return (
    <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.1rem' }}>
      <div style={{ marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-main)' }}>
          <FlaskConical size={15} /> Can this class run?
        </h3>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
          Pick the programs one instructor would teach together and check it against the rules above. Nothing is saved.
        </span>
      </div>

      {/* Category picker */}
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
        {CATEGORIES.map((cat) => {
          const active = category === cat;
          const meta = CATEGORY_META[cat];
          return (
            <button
              key={cat}
              type="button"
              onClick={() => changeCategory(cat)}
              style={{
                fontSize: '0.78rem', fontWeight: 600, padding: '0.35rem 0.9rem', borderRadius: '99px', cursor: 'pointer',
                border: active ? `1.5px solid ${meta.color}` : '1px solid var(--border-color)',
                background: active ? meta.bg : 'transparent',
                color: active ? meta.color : 'var(--text-secondary)',
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Student rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {students.map((s, i) => {
          const step = result.steps[i];
          const bad = step && !step.admitted;
          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
                padding: '0.45rem 0.6rem', borderRadius: '9px',
                border: `1px solid ${bad ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'}`,
                background: bad ? 'var(--danger-bg, rgba(239,68,68,0.06))' : 'var(--bg-color)',
              }}
            >
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', minWidth: '58px' }}>
                Student {i + 1}
              </span>

              <select
                value={s.code}
                onChange={(e) => setStudent(i, { code: e.target.value })}
                className="modal-select-field field-compact"
                style={{ minWidth: category === 'Coder' ? '190px' : '90px' }}
              >
                {codes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>

              {category !== 'Coder' && (
                <select
                  value={s.lesson}
                  onChange={(e) => setStudent(i, { lesson: e.target.value })}
                  className="modal-select-field field-compact"
                  style={{ minWidth: '96px' }}
                >
                  {LESSONS.map((l) => <option key={l} value={l}>Lesson {l}</option>)}
                </select>
              )}

              {step && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flex: 1, minWidth: '160px',
                  fontSize: '0.74rem',
                  color: step.admitted ? 'var(--success, #059669)' : 'var(--danger)',
                }}>
                  {step.admitted ? <CheckCircle2 size={13} /> : <X size={13} />}
                  {step.admitted ? 'OK' : step.reason}
                </span>
              )}

              {students.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStudent(i)}
                  title="Remove student"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', display: 'flex', padding: '0.2rem' }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addStudent}
        style={{
          marginTop: '0.55rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          fontSize: '0.76rem', padding: '0.35rem 0.75rem', borderRadius: '8px', cursor: 'pointer',
          border: '1px dashed var(--border-color)', background: 'transparent', color: 'var(--primary-blue)',
        }}
      >
        <Plus size={13} /> Add student
      </button>

      {/* Verdict */}
      {result.steps.length > 0 && (
        <div style={{
          marginTop: '0.85rem', padding: '0.7rem 0.9rem', borderRadius: '10px',
          display: 'flex', alignItems: 'flex-start', gap: '0.55rem',
          background: doable ? 'rgba(16,185,129,0.1)' : 'var(--danger-bg, rgba(239,68,68,0.08))',
          border: `1px solid ${doable ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.35)'}`,
        }}>
          {doable
            ? <CheckCircle2 size={17} style={{ color: 'var(--success, #059669)', flexShrink: 0, marginTop: '0.05rem' }} />
            : <X size={17} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '0.05rem' }} />}
          <div>
            <strong style={{ fontSize: '0.88rem', color: doable ? 'var(--success, #059669)' : 'var(--danger)' }}>
              {doable ? 'Doable' : 'Not doable'}
            </strong>
            <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              {doable
                ? `${result.accepted.length} student${result.accepted.length === 1 ? '' : 's'} in one ${category} slot${result.capacity ? ` — ${result.accepted.length}/${result.capacity} seats used` : ''}.`
                : blocker?.reason}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
