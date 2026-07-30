'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { saveOperational, saveOperationals, deleteOperational } from '../services/newOperationalsService';
import { useNewOperationals } from '../hooks/useNewOperationals';
import { useScheduleRules } from '../hooks/useScheduleRules';
import { CATEGORIES, simulateSlot } from '../lib/programRules';
import { DAY_NAMES, getWorkingDaysForBranch } from '../utils/constants';
import { MapPin, Save, Building2, Clock, X, Plus, Trash2, Copy, CalendarClock, AlertTriangle, Wand2, Coffee, ShieldCheck, FlaskConical, CheckCircle2 } from 'lucide-react';

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

/** Can a New Ops instructor level string cover a slot category? */
function levelCovers(level, category) {
  const l = String(level || '').toLowerCase();
  if (!category) return true; // "Any Class" — anyone can take it
  if (category === 'Kinder') return l.includes('kinder');
  if (category === 'Junior') return l.includes('junior');
  if (category === 'Coder') return l.includes('coder');
  return true;
}

/** Instructors assigned to a branch (explicitly, or via "All Branches"). */
function instructorsAtBranch(instructors, branchName) {
  return (instructors || []).filter((i) => {
    const brs = Array.isArray(i.branches) ? i.branches : [];
    return brs.includes(branchName) || brs.includes('All Branches');
  });
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
function findCapacityConflicts(daySlots, instructors) {
  const conflicts = new Map();
  const classSlots = daySlots
    .map((slot, idx) => ({ slot, idx, start: toMin(slot.start), end: toMin(slot.end) }))
    .filter((r) => slotTypeMeta(r.slot.type).bookable && r.start != null && r.end != null && r.end > r.start);

  if (classSlots.length === 0) return conflicts;

  for (const probe of classSlots) {
    // Everything running at this instant.
    const group = classSlots.filter((r) => r.start <= probe.start && r.end > probe.start);
    if (group.length <= 1 && instructors.length >= 1) {
      // A lone slot still needs at least one instructor who can teach it.
      const solo = maxConcurrentAssignable(group.map((g) => g.slot), instructors);
      if (solo < group.length) {
        for (const g of group) {
          const cat = slotTypeMeta(g.slot.type).category;
          conflicts.set(g.idx, `No ${cat || 'available'} instructor at this branch`);
        }
      }
      continue;
    }
    const capacity = maxConcurrentAssignable(group.map((g) => g.slot), instructors);
    if (capacity < group.length) {
      const reason = instructors.length === 0
        ? 'No instructors assigned to this branch'
        : `${group.length} classes overlap but only ${capacity} can be staffed (${instructors.length} instructor${instructors.length === 1 ? '' : 's'} at this branch)`;
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
  const { branches } = useSchedule();
  const { showToast } = useToast();
  const { rules, loading: rulesLoading, error: rulesError, isEmpty } = useNewOperationals();

  // Editable drafts: open days per branch, and operating hours per branch/day.
  const [draft, setDraft] = useState({});            // branchId -> Set(dayName)
  const [draftHours, setDraftHours] = useState({});  // branchId -> { day: { start, end } }
  const [draftOps, setDraftOps] = useState({});      // branchId -> { day: [ {type,start,end,label} ] }
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [instructors, setInstructors] = useState([]);

  // Day setup editor state (operating hours + class operation slots)
  const [editor, setEditor] = useState(null);        // { branchId, day, branchName }
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  // Break within the day's hours, stored as a `break` slot in the plan.
  const [editBreakOn, setEditBreakOn] = useState(false);
  const [editBreakStart, setEditBreakStart] = useState('12:30');
  const [editBreakMins, setEditBreakMins] = useState(60);
  const [editBreakLabel, setEditBreakLabel] = useState('');

  // branch/day keys with unsaved inline slot edits
  const [pendingDays, setPendingDays] = useState(() => new Set());

  // Class Operation table filters
  const [slotBranchFilter, setSlotBranchFilter] = useState('all');
  const [slotDayFilter, setSlotDayFilter] = useState('all');
  const [slotTypeFilter, setSlotTypeFilter] = useState('all');

  // Quick builder — generate a whole day's slots in one go
  const [qbOpen, setQbOpen] = useState(false);
  const [qbBranchId, setQbBranchId] = useState('');
  const [qbDays, setQbDays] = useState(() => new Set());
  const [qbStart, setQbStart] = useState('13:00');
  const [qbType, setQbType] = useState('any');
  const [qbDuration, setQbDuration] = useState(120);
  const [qbGap, setQbGap] = useState(0);
  const [qbGapAsBreak, setQbGapAsBreak] = useState(false);
  const [qbCount, setQbCount] = useState('fill'); // 'fill' | number of slots
  const [qbReplace, setQbReplace] = useState(false);

  // Manual single-slot add
  const [maOpen, setMaOpen] = useState(false);
  const [maBranchId, setMaBranchId] = useState('');
  const [maDay, setMaDay] = useState('Monday');
  const [maType, setMaType] = useState('any');
  const [maStart, setMaStart] = useState('13:00');
  const [maEnd, setMaEnd] = useState('15:00');
  const [maLabel, setMaLabel] = useState('');

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

  // ── Class Operation time slots (separate table) ─────────────────────────
  // Mutate one slot in place, addressed by branchId + day + index.
  /**
   * Inline edits are held locally and saved on demand — persisting on every
   * keystroke of a time field would fire a request per digit. The affected
   * branch/day is tracked so the panel can show a save bar.
   */
  const updateSlot = (branchId, day, idx, patch) => {
    setDirty(true);
    setPendingDays((prev) => new Set(prev).add(`${branchId}||${day}`));
    setDraftOps((prev) => {
      const branchOps = { ...(prev[branchId] || {}) };
      const list = [...(branchOps[day] || [])];
      list[idx] = { ...list[idx], ...patch };
      branchOps[day] = list;
      return { ...prev, [branchId]: branchOps };
    });
  };

  /**
   * Delete every slot currently listed in the table, honouring the active
   * filters. Destructive, so it states the exact scope before doing anything.
   */
  const removeAllShown = async () => {
    if (slotRows.length === 0) return;

    // Which indices to drop, grouped per branch/day.
    const byDay = new Map();
    for (const r of slotRows) {
      const key = `${r.branchId}||${r.day}`;
      if (!byDay.has(key)) byDay.set(key, new Set());
      byDay.get(key).add(r.idx);
    }

    const scope = [
      slotBranchFilter === 'all' ? 'all branches' : (branches.find((b) => b.id === slotBranchFilter)?.name || 'this branch'),
      slotDayFilter === 'all' ? 'all days' : slotDayFilter,
      slotTypeFilter === 'all' ? 'all types' : slotTypeMeta(slotTypeFilter).label,
    ].join(' · ');

    if (!window.confirm(
      `Delete ${slotRows.length} slot${slotRows.length === 1 ? '' : 's'}?\n\nScope: ${scope}\n\n` +
      'Only the rows shown in the table are removed. Daily breaks are kept. This cannot be undone.'
    )) return;

    // Work out what each affected day keeps.
    const remaining = {};
    for (const [key, drop] of byDay) {
      const [branchId, day] = key.split('||');
      const kept = (draftOps[branchId]?.[day] || []).filter((_, i) => !drop.has(i));
      remaining[key] = { branchId, day, kept };
    }

    setSaving(true);
    try {
      for (const { branchId, day, kept } of Object.values(remaining)) {
        await persistDay(branchId, day, kept);
      }
      setDraftOps((prev) => {
        const next = { ...prev };
        for (const { branchId, day, kept } of Object.values(remaining)) {
          const branchOps = { ...(next[branchId] || {}) };
          if (kept.length) branchOps[day] = kept;
          else delete branchOps[day];
          next[branchId] = branchOps;
        }
        return next;
      });
      setPendingDays(new Set());
      showToast({
        title: `Removed ${slotRows.length} slot${slotRows.length === 1 ? '' : 's'}`,
        message: `Scope: ${scope}.`,
        variant: 'success',
      });
    } catch (err) {
      showToast({ title: 'Could not remove the slots', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  /** Persist the branch/days touched by inline editing. */
  const saveSlotEdits = async () => {
    setSaving(true);
    try {
      for (const key of pendingDays) {
        const [branchId, day] = key.split('||');
        await persistDay(branchId, day, draftOps[branchId]?.[day] || []);
      }
      setPendingDays(new Set());
      setDirty(false);
      showToast({ title: 'Slot changes saved', variant: 'success' });
    } catch (err) {
      showToast({ title: 'Could not save changes', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const removeSlot = async (branchId, day, idx) => {
    const list = (draftOps[branchId]?.[day] || []).filter((_, i) => i !== idx);
    setDraftOps((prev) => {
      const branchOps = { ...(prev[branchId] || {}) };
      if (list.length) branchOps[day] = list;
      else delete branchOps[day];
      return { ...prev, [branchId]: branchOps };
    });
    // Deleting persists straight away, same as adding.
    try {
      await persistDay(branchId, day, list);
    } catch (err) {
      showToast({ title: 'Could not remove the slot', message: err.message, variant: 'error' });
    }
  };

  // Copy one day's slot plan to every other open day of the same branch.
  const copyDayPlan = async (branchId, day) => {
    const source = (draftOps[branchId]?.[day] || []).filter((s) => s.type !== 'break');
    if (!source.length) {
      showToast({ title: 'Nothing to copy', message: `${day} has no class slots yet.`, variant: 'warning' });
      return;
    }
    const targets = DAY_NAMES.filter((d) => d !== day && draft[branchId]?.has(d));
    if (!targets.length) {
      showToast({ title: 'No other open days', message: 'Open more days for this branch first.', variant: 'warning' });
      return;
    }

    // Each target keeps its own break; only the class slots are copied over.
    const perDay = {};
    for (const d of targets) {
      const keptBreak = (draftOps[branchId]?.[d] || []).filter((s) => s.type === 'break');
      perDay[d] = [...keptBreak, ...source.map((s) => ({ ...s }))]
        .sort((a, b) => a.start.localeCompare(b.start));
    }

    setSaving(true);
    try {
      for (const [d, slots] of Object.entries(perDay)) {
        await persistDay(branchId, d, slots);
      }
      setDraftOps((prev) => ({ ...prev, [branchId]: { ...(prev[branchId] || {}), ...perDay } }));
      showToast({ title: `Copied ${day} to ${targets.length} other open day${targets.length === 1 ? '' : 's'}`, variant: 'success' });
    } catch (err) {
      showToast({ title: 'Could not copy the plan', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const clearDayPlan = async (branchId, day) => {
    // Keep the break — it belongs to the Hours & Break popover.
    const keptBreak = (draftOps[branchId]?.[day] || []).filter((s) => s.type === 'break');
    setDraftOps((prev) => {
      const branchOps = { ...(prev[branchId] || {}) };
      if (keptBreak.length) branchOps[day] = keptBreak;
      else delete branchOps[day];
      return { ...prev, [branchId]: branchOps };
    });
    try {
      await persistDay(branchId, day, keptBreak);
    } catch (err) {
      showToast({ title: 'Could not clear the day', message: err.message, variant: 'error' });
    }
  };

  // ── Manual single-slot add ──────────────────────────────────────────────
  const openManualAdd = () => {
    const branch = branches.find((b) => b.id === slotBranchFilter) || branches[0];
    if (!branch) return;
    if (instructorsAtBranch(instructors, branch.name).length === 0) {
      showToast({
        title: 'No instructors at this branch',
        message: `Assign at least one instructor to ${branch.name} under Instructors before planning class slots.`,
        variant: 'warning',
        duration: 6000,
      });
      return;
    }
    const openDays = DAY_NAMES.filter((d) => draft[branch.id]?.has(d));
    const day = slotDayFilter !== 'all' ? slotDayFilter : (openDays[0] || 'Monday');
    // Continue after the day's last slot when there is one.
    const list = draftOps[branch.id]?.[day] || [];
    const hrs = draftHours[branch.id]?.[day];
    const openMin = toMin(hrs?.start) ?? 13 * 60;
    const closeMin = toMin(hrs?.end) ?? 18 * 60;
    let startMin = toMin(list[list.length - 1]?.end) ?? openMin;
    if (startMin + 120 > closeMin) startMin = openMin;

    setMaBranchId(branch.id);
    setMaDay(day);
    setMaType('any');
    setMaStart(minToHHMM(startMin));
    setMaEnd(minToHHMM(Math.min(startMin + 120, 23 * 60 + 59)));
    setMaLabel('');
    setMaOpen(true);
  };

  // Keep the end time in step with the type's standard length.
  const changeMaType = (type) => {
    setMaType(type);
    const dur = type === 'kinder' ? 90 : 120;
    const s = toMin(maStart);
    if (s != null && slotTypeMeta(type).bookable) {
      setMaEnd(minToHHMM(Math.min(s + dur, 23 * 60 + 59)));
    }
  };

  const changeMaStart = (value) => {
    setMaStart(value);
    const s = toMin(value);
    const e = toMin(maEnd);
    // Shift the end along, preserving the current length.
    if (s != null && e != null) {
      const prev = toMin(maStart);
      const dur = prev != null && e > prev ? e - prev : (maType === 'kinder' ? 90 : 120);
      setMaEnd(minToHHMM(Math.min(s + dur, 23 * 60 + 59)));
    }
  };

  /**
   * Write one branch/day rule straight to PostgreSQL.
   *
   * Adding a slot persists immediately rather than waiting for Save Changes:
   * the Save button sits in the panel above, so an unsaved row here looked
   * saved and was then overwritten by the next background poll.
   */
  const persistDay = async (branchId, day, slots) => {
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;
    const hrs = draftHours[branchId]?.[day];
    await saveOperational({
      branchName: branch.name,
      day,
      isOpen: !!draft[branchId]?.has(day),
      openTime: hrs?.start || null,
      closeTime: hrs?.end || null,
      slots: (slots || [])
        .filter((s) => s && s.start && s.end && s.end > s.start)
        .map((s) => ({ type: s.type || 'any', start: s.start, end: s.end, label: (s.label || '').trim() }))
        .sort((a, b) => a.start.localeCompare(b.start)),
    });
  };

  const applyManualAdd = async () => {
    if (!maBranchId || !maStart || !maEnd || maEnd <= maStart) return;

    const nextList = [
      ...(draftOps[maBranchId]?.[maDay] || []),
      { type: maType, start: maStart, end: maEnd, label: maLabel.trim() },
    ].sort((a, b) => a.start.localeCompare(b.start));

    setSaving(true);
    try {
      await persistDay(maBranchId, maDay, nextList);
      setDraftOps((prev) => ({
        ...prev,
        [maBranchId]: { ...(prev[maBranchId] || {}), [maDay]: nextList },
      }));
      setMaOpen(false);
      // Show the row that was just created.
      setSlotBranchFilter(maBranchId);
      setSlotDayFilter(maDay);
      setSlotTypeFilter('all');
      showToast({
        title: 'Slot added and saved',
        message: `${slotTypeMeta(maType).label} ${maStart}–${maEnd} on ${maDay}.`,
        variant: 'success',
      });
    } catch (err) {
      showToast({ title: 'Could not save the slot', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // ── Quick builder ───────────────────────────────────────────────────────

  /**
   * Sensible first start time for a day: continue after whatever class slots
   * already exist, so appending doesn't overlap them. Falls back to the
   * branch's opening time.
   */
  const defaultQbStart = (branchId, day) => {
    const opening = draftHours[branchId]?.[day]?.start || '13:00';
    if (!day) return opening;
    const existing = (draftOps[branchId]?.[day] || []).filter((s) => s.type !== 'break');
    if (!existing.length) return opening;
    const lastEnd = existing.reduce((max, s) => (s.end > max ? s.end : max), '00:00');
    const closing = draftHours[branchId]?.[day]?.end;
    // If the day is already booked to closing, fall back to the opening time.
    if (closing && lastEnd >= closing) return opening;
    return lastEnd;
  };

  const openQuickBuild = () => {
    const branch = branches.find((b) => b.id === slotBranchFilter) || branches[0];
    if (!branch) return;
    setQbBranchId(branch.id);
    // Default to the branch's open days (or the filtered day when one is set).
    const openDays = DAY_NAMES.filter((d) => draft[branch.id]?.has(d));
    const days = slotDayFilter !== 'all' ? [slotDayFilter] : openDays;
    setQbDays(new Set(days));
    setQbStart(defaultQbStart(branch.id, days[0]));
    setQbType('any');
    setQbDuration(120);
    setQbGap(0);
    setQbGapAsBreak(false);
    setQbCount('fill');
    // Default to adding alongside what's already there. Replacing is
    // destructive, so it has to be chosen deliberately.
    setQbReplace(false);
    setQbOpen(true);
  };

  // When the builder's branch changes, re-seed the day selection and start time.
  const changeQbBranch = (branchId) => {
    setQbBranchId(branchId);
    const openDays = DAY_NAMES.filter((d) => draft[branchId]?.has(d));
    setQbDays(new Set(openDays));
    setQbStart(defaultQbStart(branchId, openDays[0]));
  };

  // Picking a class type sets the matching duration (Kinder 1.5h, others 2h).
  const changeQbType = (type) => {
    setQbType(type);
    if (type === 'kinder') setQbDuration(90);
    else if (type === 'junior' || type === 'coder' || type === 'any') setQbDuration(120);
  };

  const qbBranch = branches.find((b) => b.id === qbBranchId) || null;

  /** Build the slot list for one day, stopping at the day's closing time. */
  const buildDaySlots = (branchId, day) => {
    const hrs = draftHours[branchId]?.[day];
    const closeMin = toMin(hrs?.end) ?? 18 * 60;
    const firstStart = toMin(qbStart) ?? 13 * 60;
    const dur = Math.max(15, parseInt(qbDuration, 10) || 120);
    const gap = Math.max(0, parseInt(qbGap, 10) || 0);
    const limit = qbCount === 'fill' ? 24 : Math.max(1, parseInt(qbCount, 10) || 1);

    const out = [];
    let cursor = firstStart;
    while (out.filter((s) => s.type !== 'break').length < limit) {
      const end = cursor + dur;
      // Never run past closing when filling; an explicit count stops too.
      if (qbCount === 'fill' && end > closeMin) break;
      if (end > 24 * 60) break;
      out.push({ type: qbType, start: minToHHMM(cursor), end: minToHHMM(end), label: '' });
      cursor = end;
      if (gap > 0) {
        const gapEnd = cursor + gap;
        if (qbGapAsBreak && gapEnd <= 24 * 60 && (qbCount !== 'fill' || gapEnd <= closeMin)) {
          out.push({ type: 'break', start: minToHHMM(cursor), end: minToHHMM(gapEnd), label: 'Break' });
        }
        cursor = gapEnd;
      }
    }
    return out;
  };

  const qbPreview = useMemo(() => {
    if (!qbOpen || !qbBranchId) return [];
    const day = DAY_NAMES.find((d) => qbDays.has(d));
    if (!day) return [];
    return buildDaySlots(qbBranchId, day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbOpen, qbBranchId, qbDays, qbStart, qbType, qbDuration, qbGap, qbGapAsBreak, qbCount, draftHours]);

  const applyQuickBuild = async () => {
    const days = DAY_NAMES.filter((d) => qbDays.has(d));
    if (!qbBranchId || days.length === 0) {
      showToast({ title: 'Pick at least one day', variant: 'warning' });
      return;
    }

    // Work out the new plan per day first, then persist it.
    const perDay = {};
    let added = 0;
    for (const day of days) {
      const generated = buildDaySlots(qbBranchId, day);
      if (!generated.length) continue;
      const existing = draftOps[qbBranchId]?.[day] || [];
      // Replacing keeps any break, which is owned by the hours popover.
      const kept = qbReplace ? existing.filter((s) => s.type === 'break') : existing;
      perDay[day] = [...kept, ...generated].sort((a, b) => a.start.localeCompare(b.start));
      added += generated.length;
    }

    setSaving(true);
    try {
      for (const [day, slots] of Object.entries(perDay)) {
        await persistDay(qbBranchId, day, slots);
      }
      setDraftOps((prev) => ({
        ...prev,
        [qbBranchId]: { ...(prev[qbBranchId] || {}), ...perDay },
      }));
      setQbOpen(false);
      // Focus the table on what was just built.
      setSlotBranchFilter(qbBranchId);
      setSlotDayFilter(days.length === 1 ? days[0] : 'all');
      setSlotTypeFilter('all');
      showToast({
        title: `Built and saved ${added} slot${added === 1 ? '' : 's'}`,
        message: `${Object.keys(perDay).length} day${Object.keys(perDay).length === 1 ? '' : 's'} updated at ${qbBranch?.name || 'branch'}.`,
        variant: added ? 'success' : 'warning',
      });
    } catch (err) {
      showToast({ title: 'Could not save the slots', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
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
        message: `${capacity.totalConflicts} class slot${capacity.totalConflicts === 1 ? '' : 's'} exceed the instructor capacity of their branch. See the highlighted rows in Class Operation Time Slots.`,
        variant: 'error',
        duration: 7000,
      });
      return;
    }
    setSaving(true);
    try {
      // Drop any slot whose end isn't after its start — those can't be used.
      const cleanSlots = (list) => (Array.isArray(list) ? list : [])
        .filter((s) => s && s.start && s.end && s.end > s.start)
        .map((s) => ({ type: s.type || 'any', start: s.start, end: s.end, label: (s.label || '').trim() }))
        .sort((a, b) => a.start.localeCompare(b.start));

      // One row per branch/day. POST upserts on (branchName, day).
      const payload = [];
      for (const b of branches) {
        for (const day of DAY_NAMES) {
          const isOpen = !!draft[b.id]?.has(day);
          const hrs = draftHours[b.id]?.[day];
          const slots = cleanSlots(draftOps[b.id]?.[day]);
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
        const found = findCapacityConflicts(list, staff);
        if (found.size) {
          conflictsByKey.set(`${b.id}||${day}`, found);
          totalConflicts += found.size;
        }
      }
    }
    return { staffByBranch, conflictsByKey, totalConflicts };
  }, [branches, instructors, draftOps]);

  // Flatten every branch/day slot into rows for the Class Operation table,
  // then apply the branch / day / type filters.
  const slotRows = useMemo(() => {
    const rows = [];
    for (const b of branches) {
      if (slotBranchFilter !== 'all' && b.id !== slotBranchFilter) continue;
      const byDay = draftOps[b.id] || {};
      const staffCount = (capacity.staffByBranch.get(b.id) || []).length;
      for (const day of DAY_NAMES) {
        if (slotDayFilter !== 'all' && day !== slotDayFilter) continue;
        const dayConflicts = capacity.conflictsByKey.get(`${b.id}||${day}`);
        (byDay[day] || []).forEach((slot, idx) => {
          const type = slot.type || 'any';
          // Breaks are set per day in the Hours & Break popover, so listing one
          // per day here just floods the table. Only show them when asked for.
          if (type === 'break' && slotTypeFilter !== 'break') return;
          if (slotTypeFilter !== 'all' && type !== slotTypeFilter) return;
          rows.push({
            branchId: b.id, branchName: b.name, day, idx, slot, staffCount,
            conflict: dayConflicts?.get(idx) || null,
          });
        });
      }
    }
    return rows;
  }, [branches, draftOps, slotBranchFilter, slotDayFilter, slotTypeFilter, capacity]);

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
              Set which branches are open on each day, and use the clock icon to set that day&apos;s operating hours. Exact class slots are managed in the Class Operation table below. Stored in PostgreSQL and served by <code>/api/new/operationals</code>.
            </p>
          </div>
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

      {/* ── Class Operation time slots — all branches in one filterable table ── */}
      <div className="panel" style={{ margin: '1.5rem 0 0' }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <CalendarClock size={19} /> Class Operation Time Slots
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Set the exact class slots per branch and day — Kinder / Junior / Coder, plus training and meetings. These drive the time recommendations on the Schedule page. Daily breaks are set with the clock icon above and are hidden here; choose Type &rarr; Break to see them.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              {slotRows.length} slot{slotRows.length === 1 ? '' : 's'} shown
            </span>
            <button
              type="button"
              onClick={openManualAdd}
              disabled={branches.length === 0}
              className="btn"
              title="Add a single slot by hand"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.1rem', fontSize: '0.82rem', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <Plus size={15} /> Add Slot Manually
            </button>
            <button
              type="button"
              onClick={openQuickBuild}
              disabled={branches.length === 0}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.1rem', fontSize: '0.82rem' }}
            >
              <Wand2 size={15} /> Quick Build Slots
            </button>
            {slotRows.length > 0 && (
              <button
                type="button"
                onClick={removeAllShown}
                disabled={saving}
                title="Delete every slot currently listed below"
                className="btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.1rem', fontSize: '0.82rem', border: '1px solid rgba(239,68,68,0.5)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer' }}
              >
                <Trash2 size={15} /> Remove all ({slotRows.length})
              </button>
            )}
          </div>
        </div>

        {pendingDays.size > 0 && (
          <div style={{
            margin: '0.9rem 1.5rem 0', padding: '0.65rem 0.9rem', borderRadius: '10px',
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)',
            display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
          }}>
            <AlertTriangle size={16} style={{ color: '#b45309', flexShrink: 0 }} />
            <span style={{ fontSize: '0.78rem', color: '#92400e', flex: '1 1 240px' }}>
              Unsaved edits on {pendingDays.size} day{pendingDays.size === 1 ? '' : 's'}. Adding and removing slots saves automatically, but edited times and notes need saving.
            </span>
            <button
              type="button"
              onClick={saveSlotEdits}
              disabled={saving}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', borderRadius: '9px', padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
            >
              <Save size={14} /> {saving ? 'Saving…' : 'Save slot changes'}
            </button>
          </div>
        )}

        {capacity.totalConflicts > 0 && (
          <div style={{
            margin: '0 1.5rem', marginTop: '0.9rem', padding: '0.7rem 0.9rem', borderRadius: '10px',
            background: 'var(--danger-bg, rgba(239,68,68,0.1))', border: '1px solid rgba(239,68,68,0.35)',
            display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
          }}>
            <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '0.1rem' }} />
            <span style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>
              {capacity.totalConflicts} slot{capacity.totalConflicts === 1 ? '' : 's'} need more instructors than the branch has.
              A branch can only run as many classes at once as it has instructors able to teach them — with one instructor, a 1pm slot can be Kinder <em>or</em> Junior <em>or</em> Coder, not several. Saving is blocked until this is resolved.
            </span>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', padding: '0.9rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <div>
            <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Branch</label>
            <select
              value={slotBranchFilter}
              className="modal-select-field field-compact"
              onChange={(e) => setSlotBranchFilter(e.target.value)}
              style={{ minWidth: '170px' }}
            >
              <option value="all">All Branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Day</label>
            <select
              value={slotDayFilter}
              className="modal-select-field field-compact"
              onChange={(e) => setSlotDayFilter(e.target.value)}
              style={{ minWidth: '140px' }}
            >
              <option value="all">All Days</option>
              {DAY_NAMES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Type</label>
            <select
              value={slotTypeFilter}
              className="modal-select-field field-compact"
              onChange={(e) => setSlotTypeFilter(e.target.value)}
              style={{ minWidth: '150px' }}
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
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  {addTarget.branchName} · {addTarget.day}:
                </span>
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
                Narrow to one branch and day for copy / clear actions.
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
                  <th style={{ minWidth: '150px' }}>Staffing</th>
                  <th style={{ width: '70px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {slotRows.map((r) => {
                  const meta = slotTypeMeta(r.slot.type);
                  const invalid = r.slot.start && r.slot.end && r.slot.end <= r.slot.start;
                  return (
                    <tr key={`${r.branchId}||${r.day}||${r.idx}`} style={(invalid || r.conflict) ? { background: 'rgba(239,68,68,0.05)' } : undefined}>
                      <td style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <MapPin size={13} style={{ color: 'var(--text-muted)' }} /> {r.branchName}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>{r.day}</td>
                      <td>
                        <select
                          value={r.slot.type || 'any'}
                          className="modal-select-field field-compact"
                          onChange={(e) => updateSlot(r.branchId, r.day, r.idx, { type: e.target.value })}
                          style={{ borderColor: `${meta.color}55`, background: meta.bg, color: meta.color, fontWeight: 600 }}
                        >
                          {SLOT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          type="time"
                          className="modal-input-field field-compact"
                          value={r.slot.start || ''}
                          onChange={(e) => updateSlot(r.branchId, r.day, r.idx, { start: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          className={`modal-input-field field-compact ${invalid ? 'error' : ''}`}
                          value={r.slot.end || ''}
                          onChange={(e) => updateSlot(r.branchId, r.day, r.idx, { end: e.target.value })}
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
                          className="modal-input-field field-compact"
                          value={r.slot.label || ''}
                          onChange={(e) => updateSlot(r.branchId, r.day, r.idx, { label: e.target.value })}
                          placeholder="Optional note"
                        />
                      </td>
                      <td>
                        {!meta.bookable ? (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Blocks the time</span>
                        ) : r.conflict ? (
                          <span style={{ display: 'flex', alignItems: 'flex-start', gap: '0.3rem', fontSize: '0.7rem', color: 'var(--danger)', fontWeight: 600 }}>
                            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                            {r.conflict}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--success, #10b981)', fontWeight: 600 }}>
                            ✓ Staffable · {r.staffCount} instructor{r.staffCount === 1 ? '' : 's'}
                          </span>
                        )}
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

      {/* Add Slot Manually — one slot, full control */}
      {maOpen && (
        <div
          onClick={() => setMaOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel-bg)', width: '100%', maxWidth: '460px', borderRadius: '16px',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)', border: '1px solid var(--border-color)', overflow: 'hidden',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Plus size={16} /> Add Slot Manually
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>One slot, exactly the times you want.</span>
              </div>
              <button onClick={() => setMaOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 170px' }}>
                  <label className="modal-form-label">Branch</label>
                  <select
                    value={maBranchId}
                    onChange={(e) => setMaBranchId(e.target.value)}
                    className="modal-select-field"
                    style={{ width: '100%' }}
                  >
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <label className="modal-form-label">Day</label>
                  <select
                    value={maDay}
                    onChange={(e) => setMaDay(e.target.value)}
                    className="modal-select-field"
                    style={{ width: '100%' }}
                  >
                    {DAY_NAMES.map((d) => (
                      <option key={d} value={d}>
                        {d}{draft[maBranchId]?.has(d) ? '' : ' (closed)'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="modal-form-label">Type</label>
                <select
                  value={maType}
                  onChange={(e) => changeMaType(e.target.value)}
                  className="modal-select-field"
                  style={{ width: '100%' }}
                >
                  {SLOT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '0.85rem' }}>
                <div style={{ flex: 1 }}>
                  <label className="modal-form-label">Start</label>
                  <input type="time" className="modal-input-field" value={maStart} onChange={(e) => changeMaStart(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="modal-form-label">End</label>
                  <input
                    type="time"
                    className={`modal-input-field ${maStart && maEnd && maEnd <= maStart ? 'error' : ''}`}
                    value={maEnd}
                    onChange={(e) => setMaEnd(e.target.value)}
                  />
                </div>
              </div>
              {maStart && maEnd && maEnd <= maStart && (
                <span style={{ fontSize: '0.72rem', color: 'var(--danger)' }}>End time should be after the start time.</span>
              )}

              <div>
                <label className="modal-form-label">Note (optional)</label>
                <input
                  type="text"
                  className="modal-input-field"
                  value={maLabel}
                  onChange={(e) => setMaLabel(e.target.value)}
                  placeholder="e.g. Weekly sync, staff training"
                />
              </div>

              {!draft[maBranchId]?.has(maDay) && (
                <span style={{ fontSize: '0.72rem', color: 'var(--warning, #b45309)' }}>
                  This branch is marked closed on {maDay}. The slot will be saved but won&apos;t be offered until you open the day above.
                </span>
              )}
            </div>

            <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', background: 'var(--bg-color)' }}>
              <button
                type="button"
                onClick={() => setMaOpen(false)}
                className="btn"
                style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: '10px', padding: '0.5rem 1rem', fontSize: '0.82rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyManualAdd}
                disabled={!maStart || !maEnd || maEnd <= maStart}
                className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', borderRadius: '10px', padding: '0.5rem 1.25rem', fontSize: '0.82rem' }}
              >
                <Plus size={15} /> Add Slot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Build Slots — generate a whole day's plan in one pass */}
      {qbOpen && (
        <div
          onClick={() => setQbOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel-bg)', width: '100%', maxWidth: '640px', maxHeight: '92vh', borderRadius: '16px',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)', border: '1px solid var(--border-color)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Wand2 size={16} /> Quick Build Slots
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Set it once, apply to as many days as you like.
                </span>
              </div>
              <button onClick={() => setQbOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.1rem', overflowY: 'auto' }}>
              {/* Branch */}
              <div>
                <label className="modal-form-label">Branch</label>
                <select
                  value={qbBranchId}
                  onChange={(e) => changeQbBranch(e.target.value)}
                  className="modal-select-field"
                  style={{ width: '100%' }}
                >
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              {/* Days */}
              <div>
                {(() => {
                  const openDays = DAY_NAMES.filter((d) => draft[qbBranchId]?.has(d));
                  const allSelected = openDays.length > 0 && openDays.every((d) => qbDays.has(d));
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                      <label className="modal-form-label" style={{ margin: 0 }}>Days</label>
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 700, padding: '0.05rem 0.45rem', borderRadius: '99px',
                        color: qbDays.size > 0 ? 'var(--primary-blue)' : 'var(--text-muted)',
                        background: qbDays.size > 0 ? 'var(--primary-blue-light, rgba(79,70,229,0.12))' : 'var(--bg-color)',
                      }}>
                        {qbDays.size} of {openDays.length} selected
                      </span>
                      <button
                        type="button"
                        onClick={() => setQbDays(allSelected ? new Set() : new Set(openDays))}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--primary-blue)', fontSize: '0.74rem', fontWeight: 600, marginLeft: 'auto' }}
                      >
                        {allSelected ? 'Clear all' : 'Select all open days'}
                      </button>
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {DAY_NAMES.map((d) => {
                    const isOpen = !!draft[qbBranchId]?.has(d);
                    const on = qbDays.has(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={!isOpen}
                        title={isOpen ? d : `${d} — branch is closed`}
                        onClick={() => setQbDays((prev) => {
                          const next = new Set(prev);
                          if (next.has(d)) next.delete(d); else next.add(d);
                          return next;
                        })}
                        style={{
                          padding: '0.35rem 0.7rem', borderRadius: '99px', fontSize: '0.78rem', fontWeight: 600,
                          cursor: isOpen ? 'pointer' : 'not-allowed', opacity: isOpen ? 1 : 0.4,
                          border: on ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                          background: on ? 'var(--primary-blue-light)' : 'transparent',
                          color: on ? 'var(--primary-blue)' : 'var(--text-secondary)',
                          transition: 'all 0.15s',
                        }}
                      >
                        {d.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Type + start + duration */}
              <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 150px' }}>
                  <label className="modal-form-label">Slot type</label>
                  <select
                    value={qbType}
                    onChange={(e) => changeQbType(e.target.value)}
                    className="modal-select-field"
                    style={{ width: '100%' }}
                  >
                    {SLOT_TYPES.filter((t) => t.bookable).map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <label className="modal-form-label">First class starts</label>
                  <input type="time" className="modal-input-field" value={qbStart} onChange={(e) => setQbStart(e.target.value)} />
                </div>
                <div style={{ flex: '1 1 130px' }}>
                  <label className="modal-form-label">Each lasts</label>
                  <div className="field-with-suffix">
                    <input
                      type="number" min="15" step="15"
                      className="modal-input-field"
                      value={qbDuration}
                      onChange={(e) => setQbDuration(e.target.value)}
                    />
                    <span className="field-suffix">min</span>
                  </div>
                </div>
              </div>

              {/* Gap + count */}
              <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 130px' }}>
                  <label className="modal-form-label">Gap between</label>
                  <div className="field-with-suffix">
                    <input
                      type="number" min="0" step="5"
                      className="modal-input-field"
                      value={qbGap}
                      onChange={(e) => setQbGap(e.target.value)}
                    />
                    <span className="field-suffix">min</span>
                  </div>
                  {parseInt(qbGap, 10) > 0 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '0.35rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={qbGapAsBreak} onChange={(e) => setQbGapAsBreak(e.target.checked)} />
                      Add the gap as a Break slot
                    </label>
                  )}
                </div>
                <div style={{ flex: '1 1 190px' }}>
                  <label className="modal-form-label">How many</label>
                  <select
                    value={qbCount}
                    onChange={(e) => setQbCount(e.target.value)}
                    className="modal-select-field"
                    style={{ width: '100%' }}
                  >
                    <option value="fill">Fill until closing time</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={String(n)}>{n} class{n === 1 ? '' : 'es'}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Replace or append */}
              {(() => {
                // How many class slots already exist on the chosen days, so the
                // consequence of replacing is visible before it happens.
                const days = DAY_NAMES.filter((d) => qbDays.has(d));
                const existingCount = days.reduce(
                  (n, d) => n + (draftOps[qbBranchId]?.[d] || []).filter((s) => s.type !== 'break').length,
                  0
                );
                return (
                  <div style={{
                    border: `1px solid ${qbReplace && existingCount > 0 ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'}`,
                    background: qbReplace && existingCount > 0 ? 'var(--danger-bg, rgba(239,68,68,0.07))' : 'var(--bg-color)',
                    borderRadius: '10px', padding: '0.7rem 0.85rem',
                  }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={qbReplace}
                        onChange={(e) => setQbReplace(e.target.checked)}
                        style={{ marginTop: '0.15rem' }}
                      />
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                        Replace existing slots on these days
                        <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                          {existingCount === 0
                            ? 'These days have no class slots yet, so nothing would be replaced.'
                            : qbReplace
                              ? `Deletes the ${existingCount} existing class slot${existingCount === 1 ? '' : 's'} on these days.`
                              : `Keeps the ${existingCount} existing class slot${existingCount === 1 ? '' : 's'} and adds the new ones alongside.`}
                        </span>
                      </span>
                    </label>
                    {qbReplace && existingCount > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem', fontSize: '0.74rem', color: 'var(--danger)', fontWeight: 600 }}>
                        <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                        {existingCount} slot{existingCount === 1 ? '' : 's'} will be removed. Breaks are kept.
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Preview */}
              <div>
                <label className="modal-form-label">
                  Preview {qbPreview.length > 0 && `(${qbPreview.length} slot${qbPreview.length === 1 ? '' : 's'} per day)`}
                </label>
                {qbPreview.length === 0 ? (
                  <div style={{ padding: '0.9rem', border: '1px dashed var(--border-color)', borderRadius: '10px', fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    Nothing fits yet — check the start time against the branch&apos;s closing hours, or pick a day.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', maxHeight: '140px', overflowY: 'auto' }}>
                    {qbPreview.map((s, i) => {
                      const m = slotTypeMeta(s.type);
                      return (
                        <span key={i} style={{
                          fontSize: '0.74rem', fontWeight: 600, padding: '0.3rem 0.6rem', borderRadius: '8px',
                          background: m.bg, color: m.color, border: `1px solid ${m.color}33`, whiteSpace: 'nowrap',
                        }}>
                          {s.start}–{s.end} · {m.label}
                        </span>
                      );
                    })}
                  </div>
                )}
                {qbBranch && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.4rem', display: 'block' }}>
                    {(capacity.staffByBranch.get(qbBranchId) || []).length} instructor
                    {(capacity.staffByBranch.get(qbBranchId) || []).length === 1 ? '' : 's'} at {qbBranch.name} — back-to-back slots never overlap, so they always stay staffable.
                  </span>
                )}
              </div>
            </div>

            <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', background: 'var(--bg-color)' }}>
              <button
                type="button"
                onClick={() => setQbOpen(false)}
                className="btn"
                style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: '10px', padding: '0.5rem 1rem', fontSize: '0.82rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyQuickBuild}
                disabled={qbPreview.length === 0 || qbDays.size === 0}
                className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', borderRadius: '10px', padding: '0.5rem 1.25rem', fontSize: '0.82rem' }}
              >
                <Wand2 size={15} /> Build {qbDays.size > 0 ? `${qbDays.size} day${qbDays.size === 1 ? '' : 's'}` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

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
  Coder: [
    'Coder Foundation 1', 'Coder Foundation 2', 'Coder Foundation 3', 'Coder Foundation 4',
    'Coder Basic 1', 'Coder Basic 2',
    'Coder Intermediate 1', 'Coder Intermediate 2',
    'Coder Advance 1', 'Coder Advance 2', 'Coder Advance 3',
  ],
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
