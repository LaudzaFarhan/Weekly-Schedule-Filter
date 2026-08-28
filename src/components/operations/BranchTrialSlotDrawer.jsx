'use client';

/**
 * Per-branch trial slot configuration.
 *
 * The Operationals page edits slots as one flat table across every branch, which
 * is the right shape for auditing but the wrong one for "set up this branch".
 * This is the per-branch view: one window defined once and applied to whichever
 * days it runs on, plus the opening hours those windows have to fit inside.
 *
 * Writes go through `saveOperational`, the same path the Operationals page and
 * the schedule grid use, so there is still exactly one writer of
 * `internal_operationals`.
 */

import React, { useState, useMemo } from 'react';
import { Clock, Calendar, X, Plus, Trash2, Check, AlertTriangle, Users } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { saveOperational } from '../../services/newOperationalsService';
import {
  SLOT_TYPES, slotTypeMeta, cleanSlotList, slotCapacity,
  MIN_SLOT_CAPACITY, MAX_SLOT_CAPACITY,
} from '../../lib/slotTypes';
import { maxStudentsFor } from '../../lib/programRules';
import { DAY_NAMES } from '../../utils/constants';

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map((n) => parseInt(n, 10));
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
};
const minToHHMM = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const prettyTime = (hhmm) => {
  const mins = toMin(hhmm);
  if (mins == null) return String(hhmm || '');
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}.${String(m).padStart(2, '0')} ${h24 >= 12 ? 'pm' : 'am'}`;
};

/** Standard length of a class of this kind, in minutes. */
const durationFor = (type) => (type === 'kinder' ? 90 : 120);

/**
 * Collapse a branch's per-day slot arrays into one entry per distinct window,
 * carrying the days it runs on. This is the unit an operator thinks in — "Junior
 * 2pm, Monday and Thursday" — rather than seven separate day plans.
 */
function groupRules(byDay) {
  const groups = new Map();
  for (const day of DAY_NAMES) {
    for (const slot of byDay[day] || []) {
      const type = slot.type || 'any';
      const cap = slotCapacity(slot);
      const key = `${type}||${slot.start}||${slot.end}||${cap ?? ''}||${slot.label || ''}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key, type, start: slot.start, end: slot.end,
          capacity: cap, label: slot.label || '', days: [],
        });
      }
      const found = groups.get(key);
      if (!found.days.includes(day)) found.days.push(day);
    }
  }
  return [...groups.values()].sort(
    (a, b) => (toMin(a.start) ?? 0) - (toMin(b.start) ?? 0)
      || (toMin(a.end) ?? 0) - (toMin(b.end) ?? 0)
      || a.type.localeCompare(b.type)
  );
}

/**
 * Read one branch's stored rules into the editable shape.
 *
 * Taken once, when the drawer opens. Re-reading on every change to `rules` would
 * discard in-progress edits each time the five-second poll returned, so the
 * caller remounts the drawer per branch (via `key`) instead.
 */
function seedFrom(rules, branchName) {
  const byDay = {};
  const hours = {};
  const openDays = new Set();
  for (const day of DAY_NAMES) {
    const rule = (rules || []).find((r) => r.branchName === branchName && r.day === day);
    if (!rule) continue;
    if (rule.isOpen) openDays.add(day);
    if (rule.openTime && rule.closeTime) hours[day] = { start: rule.openTime, end: rule.closeTime };
    if (Array.isArray(rule.slots) && rule.slots.length) byDay[day] = rule.slots.map((s) => ({ ...s }));
  }
  return { byDay, hours, openDays };
}

/**
 * @param {string} branchName  the branch being configured. The caller must also
 *   pass this as `key`, so switching branches remounts and reseeds the drafts.
 */
export default function BranchTrialSlotDrawer({
  branchName, rules, scheduleRules, applyLocal, onClose,
}) {
  const { showToast } = useToast();
  const [tab, setTab] = useState('slots');
  const [saving, setSaving] = useState(false);

  // One draft object, seeded once on mount, so nothing is written until Apply.
  const [draft, setDraft] = useState(() => seedFrom(rules, branchName));
  const [dirty, setDirty] = useState(false);
  const { byDay, hours, openDays } = draft;

  // New-slot form.
  const [formType, setFormType] = useState('junior');
  const [formStart, setFormStart] = useState('14:00');
  const [formEnd, setFormEnd] = useState('16:00');
  const [formCapacity, setFormCapacity] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formDays, setFormDays] = useState(() => new Set(draft.openDays));

  const groups = useMemo(() => groupRules(byDay), [byDay]);

  // Keep the end time a sensible distance from the start as the form is edited.
  const changeType = (type) => {
    setFormType(type);
    const s = toMin(formStart);
    if (s != null && slotTypeMeta(type).bookable) {
      setFormEnd(minToHHMM(Math.min(s + durationFor(type), 23 * 60 + 59)));
    }
  };
  const changeStart = (value) => {
    setFormStart(value);
    const s = toMin(value);
    const e = toMin(formEnd);
    const prev = toMin(formStart);
    if (s == null) return;
    const span = prev != null && e != null && e > prev ? e - prev : durationFor(formType);
    setFormEnd(minToHHMM(Math.min(s + span, 23 * 60 + 59)));
  };

  const bookable = slotTypeMeta(formType).bookable;

  /** Days the window would sit outside the branch's hours. */
  const outsideHours = useMemo(() => {
    const s = toMin(formStart);
    const e = toMin(formEnd);
    if (s == null || e == null) return [];
    return [...formDays].filter((d) => {
      const h = hours[d];
      if (!h) return false;
      return s < toMin(h.start) || e > toMin(h.end);
    }).sort((a, b) => DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b));
  }, [formDays, formStart, formEnd, hours]);

  const formError = (() => {
    const s = toMin(formStart);
    const e = toMin(formEnd);
    if (s == null || e == null) return 'Start and end times are required.';
    if (e <= s) return 'The end time must be after the start.';
    if (formDays.size === 0) return 'Pick at least one day.';
    if (bookable && formCapacity !== '') {
      const n = Number(formCapacity);
      if (!Number.isInteger(n) || n < MIN_SLOT_CAPACITY || n > MAX_SLOT_CAPACITY) {
        return `Capacity must be a whole number from ${MIN_SLOT_CAPACITY} to ${MAX_SLOT_CAPACITY}.`;
      }
    }
    return null;
  })();

  const addRule = () => {
    if (formError) return;
    const slot = {
      type: formType,
      start: formStart,
      end: formEnd,
      label: formLabel.trim(),
      ...(bookable && formCapacity !== '' ? { capacity: Number(formCapacity) } : {}),
    };
    setDraft((prev) => {
      const next = { ...prev.byDay };
      for (const day of formDays) {
        const list = [...(next[day] || [])];
        // Adding the identical window twice on one day means two parallel
        // classes, which is legitimate but almost never what a click intends.
        const already = list.some((s) =>
          (s.type || 'any') === slot.type && s.start === slot.start && s.end === slot.end
        );
        if (!already) list.push({ ...slot });
        next[day] = list.sort((a, b) => a.start.localeCompare(b.start));
      }
      return { ...prev, byDay: next };
    });
    setDirty(true);
    setFormLabel('');
    showToast({
      title: `${slotTypeMeta(formType).label} added to the plan`,
      message: `${prettyTime(formStart)} – ${prettyTime(formEnd)} on ${[...formDays].length} day${formDays.size === 1 ? '' : 's'}. Apply to save.`,
      variant: 'success',
    });
  };

  const removeGroup = (group) => {
    setDraft((prev) => {
      const next = { ...prev.byDay };
      for (const day of group.days) {
        next[day] = (next[day] || []).filter((s) =>
          !((s.type || 'any') === group.type && s.start === group.start && s.end === group.end
            && (slotCapacity(s) ?? '') === (group.capacity ?? ''))
        );
      }
      return { ...prev, byDay: next };
    });
    setDirty(true);
  };

  const setGroupCapacity = (group, value) => {
    const raw = String(value).trim();
    const n = raw === '' ? null : Number(raw);
    if (raw !== '' && (!Number.isInteger(n) || n < MIN_SLOT_CAPACITY || n > MAX_SLOT_CAPACITY)) return;
    setDraft((prev) => {
      const next = { ...prev.byDay };
      for (const day of group.days) {
        next[day] = (next[day] || []).map((s) => {
          const match = (s.type || 'any') === group.type && s.start === group.start && s.end === group.end;
          if (!match) return s;
          const copy = { ...s };
          if (n == null) delete copy.capacity;
          else copy.capacity = n;
          return copy;
        });
      }
      return { ...prev, byDay: next };
    });
    setDirty(true);
  };

  const setDayHours = (day, patch) => {
    setDraft((prev) => ({
      ...prev,
      hours: {
        ...prev.hours,
        [day]: { start: '11:00', end: '18:30', ...(prev.hours[day] || {}), ...patch },
      },
    }));
    setDirty(true);
  };

  const toggleOpen = (day) => {
    setDraft((prev) => {
      const next = new Set(prev.openDays);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return { ...prev, openDays: next };
    });
    setDirty(true);
  };

  /**
   * Write every day of the week for this branch.
   *
   * All seven go out rather than only the touched ones: a day can change from
   * having slots to having none, and the API replaces a day's array wholesale, so
   * skipping an emptied day would leave its old slots in place.
   */
  const apply = async () => {
    setSaving(true);
    try {
      for (const day of DAY_NAMES) {
        const slots = cleanSlotList(byDay[day]);
        const h = hours[day];
        const isOpen = openDays.has(day);
        // Nothing recorded and never open — no row worth writing.
        if (!isOpen && !h && slots.length === 0) continue;
        const payload = {
          branchName,
          day,
          isOpen,
          openTime: h?.start || null,
          closeTime: h?.end || null,
          slots,
        };
        await saveOperational(payload);
        applyLocal?.(payload);
      }
      showToast({
        title: `${branchName} updated`,
        message: `${groups.length} slot rule${groups.length === 1 ? '' : 's'} saved.`,
        variant: 'success',
      });
      setDirty(false);
      onClose();
    } catch (err) {
      showToast({ title: 'Could not save the plan', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const dayChip = (day, on, onToggle, disabled, title) => (
    <button
      key={day}
      type="button"
      disabled={disabled}
      title={title || day}
      aria-pressed={on}
      onClick={onToggle}
      style={{
        padding: '0.3rem 0.65rem', borderRadius: '99px', fontSize: '0.76rem', fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        border: on ? '1.5px solid var(--primary-blue, #4f46e5)' : '1px solid var(--border-color)',
        background: on ? 'var(--primary-blue-light, rgba(79,70,229,0.12))' : 'transparent',
        color: on ? 'var(--primary-blue, #4f46e5)' : 'var(--text-secondary)',
        transition: 'all 0.15s',
      }}
    >
      {day.slice(0, 3)}
    </button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 1200,
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Configure trial availability for ${branchName}`}
        style={{
          width: '100%', maxWidth: '620px', background: 'var(--panel-bg, white)',
          display: 'flex', flexDirection: 'column', height: '100%',
          borderLeft: '1px solid var(--border-color)', boxShadow: '-8px 0 32px rgba(0,0,0,0.18)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              Configure Trial Availability
              <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.1rem 0.5rem', borderRadius: '99px', background: 'var(--primary-blue-light, rgba(79,70,229,0.12))', color: 'var(--primary-blue, #4f46e5)' }}>
                {branchName}
              </span>
            </h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
              The windows this branch opens for trials, and the hours they sit inside.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 1.25rem', gap: '0.25rem' }}>
          {[
            { key: 'slots', label: 'Time Slot Plan', Icon: Clock },
            { key: 'hours', label: 'Opening Hours', Icon: Calendar },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key}
              style={{
                padding: '0.7rem 0.8rem', background: 'transparent', cursor: 'pointer',
                border: 'none', borderBottom: `2px solid ${tab === key ? 'var(--primary-blue, #4f46e5)' : 'transparent'}`,
                color: tab === key ? 'var(--primary-blue, #4f46e5)' : 'var(--text-secondary)',
                fontWeight: tab === key ? 700 : 500, fontSize: '0.8rem',
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              }}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
          {tab === 'slots' ? (
            <>
              {/* Add a window */}
              <div style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.9rem', marginBottom: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Plus size={14} /> Add a slot rule
                </h3>

                <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
                  <div style={{ flex: '1 1 170px' }}>
                    <label className="modal-form-label" htmlFor="tsd-type">Slot type</label>
                    <select id="tsd-type" className="modal-select-field" style={{ width: '100%' }} value={formType} onChange={(e) => changeType(e.target.value)}>
                      {SLOT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: '1 1 110px' }}>
                    <label className="modal-form-label" htmlFor="tsd-start">Starts</label>
                    <input id="tsd-start" type="time" className="modal-input-field" style={{ width: '100%' }} value={formStart} onChange={(e) => changeStart(e.target.value)} />
                  </div>
                  <div style={{ flex: '1 1 110px' }}>
                    <label className="modal-form-label" htmlFor="tsd-end">Ends</label>
                    <input id="tsd-end" type="time" className="modal-input-field" style={{ width: '100%' }} value={formEnd} onChange={(e) => setFormEnd(e.target.value)} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
                  <div style={{ flex: '1 1 150px' }}>
                    <label className="modal-form-label" htmlFor="tsd-cap">Seats in this slot</label>
                    <input
                      id="tsd-cap"
                      type="number"
                      min={MIN_SLOT_CAPACITY}
                      max={MAX_SLOT_CAPACITY}
                      className="modal-input-field"
                      style={{ width: '100%' }}
                      disabled={!bookable}
                      value={bookable ? formCapacity : ''}
                      placeholder={bookable ? `Default ${maxStudentsFor(formType, scheduleRules)}` : 'Blocks the time'}
                      onChange={(e) => setFormCapacity(e.target.value)}
                    />
                    <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.2rem' }}>
                      {bookable
                        ? 'Leave blank to follow the category rule.'
                        : `A ${slotTypeMeta(formType).label.toLowerCase()} holds nobody.`}
                    </span>
                  </div>
                  <div style={{ flex: '1 1 190px' }}>
                    <label className="modal-form-label" htmlFor="tsd-label">Note</label>
                    <input id="tsd-label" type="text" className="modal-input-field" style={{ width: '100%' }} value={formLabel} placeholder="Optional" onChange={(e) => setFormLabel(e.target.value)} />
                  </div>
                </div>

                <div style={{ marginBottom: '0.7rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                    <label className="modal-form-label" style={{ margin: 0 }}>Runs on</label>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                      {formDays.size} of {openDays.size} open day{openDays.size === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFormDays(formDays.size === openDays.size ? new Set() : new Set(openDays))}
                      style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--primary-blue, #4f46e5)', fontSize: '0.73rem', fontWeight: 600 }}
                    >
                      {formDays.size === openDays.size ? 'Clear all' : 'Select all open days'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {DAY_NAMES.map((d) => dayChip(
                      d,
                      formDays.has(d),
                      () => setFormDays((prev) => {
                        const next = new Set(prev);
                        if (next.has(d)) next.delete(d);
                        else next.add(d);
                        return next;
                      }),
                      !openDays.has(d),
                      openDays.has(d) ? d : `${d} — branch is closed. Open it under Opening Hours.`
                    ))}
                  </div>
                </div>

                {outsideHours.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', fontSize: '0.71rem', color: '#b45309', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '0.45rem 0.6rem', marginBottom: '0.6rem' }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                    <span>
                      Outside opening hours on {outsideHours.map((d) => d.slice(0, 3)).join(', ')}. It will still be saved, but no trial can run then.
                    </span>
                  </div>
                )}

                {formError && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--danger, #dc2626)', marginBottom: '0.5rem' }}>{formError}</div>
                )}

                <button
                  type="button"
                  onClick={addRule}
                  disabled={Boolean(formError)}
                  style={{
                    width: '100%', padding: '0.55rem', borderRadius: '9px', border: 'none',
                    cursor: formError ? 'not-allowed' : 'pointer', opacity: formError ? 0.5 : 1,
                    background: 'var(--text-main, #0f172a)', color: 'white', fontWeight: 700, fontSize: '0.8rem',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                  }}
                >
                  <Plus size={14} /> Add to plan
                </button>
              </div>

              {/* Existing windows */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.55rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)' }}>
                  Slot rules
                </h3>
                <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                  {groups.length} configured
                </span>
              </div>

              {groups.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                  Nothing configured yet. Without a slot rule this branch falls back to hourly
                  windows inside its opening hours.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {groups.map((g) => {
                    const meta = slotTypeMeta(g.type);
                    const fallback = maxStudentsFor(g.type, scheduleRules);
                    return (
                      <div key={g.key} style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.6rem 0.7rem', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                        <span aria-hidden="true" style={{ width: 4, alignSelf: 'stretch', borderRadius: 99, background: meta.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: '0.83rem', fontVariantNumeric: 'tabular-nums' }}>
                              {prettyTime(g.start)} – {prettyTime(g.end)}
                            </strong>
                            <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '0.06rem 0.4rem', borderRadius: 5, color: meta.color, background: meta.bg === '#0f172a' ? 'rgba(30,58,138,0.15)' : meta.bg }}>
                              {meta.label}
                            </span>
                            {g.label && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{g.label}</span>}
                          </div>
                          <div style={{ fontSize: '0.71rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                            {g.days.length === DAY_NAMES.length ? 'Every day' : g.days.map((d) => d.slice(0, 3)).join(', ')}
                          </div>
                          {meta.bookable && (
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.4rem', fontSize: '0.71rem', color: 'var(--text-secondary)' }}>
                              <Users size={12} />
                              Seats
                              <input
                                type="number"
                                min={MIN_SLOT_CAPACITY}
                                max={MAX_SLOT_CAPACITY}
                                value={g.capacity ?? ''}
                                placeholder={String(fallback)}
                                onChange={(e) => setGroupCapacity(g, e.target.value)}
                                style={{ width: '62px', padding: '0.15rem 0.35rem', borderRadius: 6, border: '1px solid var(--border-color)', fontSize: '0.72rem', background: 'var(--panel-bg, white)', color: 'inherit' }}
                              />
                              {g.capacity == null && (
                                <span style={{ color: 'var(--text-muted)' }}>rule default</span>
                              )}
                            </label>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeGroup(g)}
                          title="Remove this rule from every day it runs on"
                          aria-label={`Remove ${meta.label} ${g.start} to ${g.end}`}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger, #dc2626)', display: 'flex', padding: '0.2rem' }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '9px', padding: '0.55rem 0.7rem', marginBottom: '0.9rem' }}>
                A slot rule can sit outside these hours, but no trial will be offered in it.
                Closing a day keeps its slot rules — it just stops them running.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {DAY_NAMES.map((day) => {
                  const on = openDays.has(day);
                  const h = hours[day];
                  return (
                    <div key={day} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem 0.7rem', background: on ? 'transparent' : 'var(--bg-color)' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.79rem', width: '86px', opacity: on ? 1 : 0.6 }}>{day}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input
                          type="time"
                          aria-label={`${day} opening time`}
                          disabled={!on}
                          value={h?.start || ''}
                          onChange={(e) => setDayHours(day, { start: e.target.value })}
                          style={{ padding: '0.2rem 0.35rem', borderRadius: 6, border: '1px solid var(--border-color)', fontSize: '0.75rem', background: 'var(--panel-bg, white)', color: 'inherit' }}
                        />
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>to</span>
                        <input
                          type="time"
                          aria-label={`${day} closing time`}
                          disabled={!on}
                          value={h?.end || ''}
                          onChange={(e) => setDayHours(day, { end: e.target.value })}
                          style={{ padding: '0.2rem 0.35rem', borderRadius: 6, border: '1px solid var(--border-color)', fontSize: '0.75rem', background: 'var(--panel-bg, white)', color: 'inherit' }}
                        />
                      </div>
                      {h && h.start && h.end && h.end <= h.start && (
                        <span style={{ fontSize: '0.68rem', color: 'var(--danger, #dc2626)' }}>
                          Closing must be after opening
                        </span>
                      )}
                      <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, color: on ? 'var(--success, #059669)' : 'var(--text-muted)' }}>
                        <input type="checkbox" checked={on} onChange={() => toggleOpen(day)} />
                        {on ? 'Open' : 'Closed'}
                      </label>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', background: 'var(--bg-color)' }}>
          <span style={{ fontSize: '0.73rem', color: dirty ? '#b45309' : 'var(--text-muted)' }}>
            {dirty ? 'Unsaved changes' : 'No changes'}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '0.45rem 0.9rem', borderRadius: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={saving || !dirty}
              style={{
                padding: '0.45rem 1rem', borderRadius: 8, border: 'none',
                background: 'var(--primary-blue, #4f46e5)', color: 'white',
                cursor: saving || !dirty ? 'not-allowed' : 'pointer', opacity: saving || !dirty ? 0.55 : 1,
                fontSize: '0.78rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              }}
            >
              <Check size={14} /> {saving ? 'Saving…' : 'Apply changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
