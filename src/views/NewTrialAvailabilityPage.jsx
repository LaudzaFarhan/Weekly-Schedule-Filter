'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { subscribeToInternalClasses } from '../services/internalScheduleService';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { useNewOperationals } from '../hooks/useNewOperationals';
import { DAY_NAMES } from '../utils/constants';
import { doTimeSlotsOverlap } from '../utils/timeUtils';
import { slotTypeMeta } from '../lib/slotTypes';
import { Star, X, Clock } from 'lucide-react';

/**
 * The window the grid below covers: 1:00 pm to 6:30 pm, in minutes.
 *
 * Kept next to the slot list it describes, so the branch cards can point out
 * when a branch's real hours fall outside what the grid can show.
 */
const GRID_START_MIN = 13 * 60;
const GRID_END_MIN = 18 * 60 + 30;

const FIXED_TRIAL_SLOTS = [
  '1.00 - 2.00 pm',
  '1.30 - 2.30 pm',
  '2.00 - 3.00 pm',
  '2.30 - 3.30 pm',
  '3.00 - 4.00 pm',
  '3.30 - 4.30 pm',
  '4.00 - 5.00 pm',
  '4.30 - 5.30 pm',
  '5.00 - 6.00 pm',
  '5.30 - 6.30 pm',
];

// Capability detection from a New Ops instructor level string
// ("Kinder and Junior" / "Junior and Coder").
const canKinder = (level) => /kinder/i.test(String(level || ''));
const canJunior = (level) => /junior/i.test(String(level || ''));
const canCoder = (level) => /coder/i.test(String(level || ''));

/** "11:00" -> 660. Null for anything unparseable. */
const hhmmToMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map((n) => parseInt(n, 10));
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
};

/** 660 -> "11.00 am", matching how times read elsewhere in New Ops. */
const prettyMin = (mins) => {
  if (mins == null) return '';
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}.${String(m).padStart(2, '0')} ${ampm}`;
};

/** "11:00" -> "11.00 am". Falls back to the raw value when unparseable. */
const prettyTime = (hhmm) => {
  const mins = hhmmToMin(hhmm);
  return mins == null ? String(hhmm || '') : prettyMin(mins);
};

/** Mon, Tue, … for a compact card. */
const shortDay = (day) => String(day || '').slice(0, 3);

/**
 * Collapse consecutive days that share the same opening hours into one line, so
 * a branch open the same hours Tuesday to Friday reads as one row instead of
 * four. Days are walked in `DAY_NAMES` order, so a run is always contiguous.
 */
function summariseWeek(days) {
  const runs = [];
  for (const entry of days) {
    const key = entry.isOpen && entry.hours
      ? `${entry.hours.start}-${entry.hours.end}`
      : (entry.configured ? 'closed' : 'unset');
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.days.push(entry.day);
    else runs.push({ key, days: [entry.day], hours: entry.hours, isOpen: entry.isOpen, configured: entry.configured });
  }
  return runs;
}

/**
 * The typed slots and non-class blocks a branch has configured, collapsed to one
 * entry per kind-and-window with the days it runs on.
 *
 * A day is only listed once even when the branch has several identical rows for
 * it — real data has days carrying two copies of the same junior window, which
 * would otherwise read as "Mon Wed Wed Thu".
 */
function summariseSlots(days) {
  const seen = new Map();
  for (const entry of days) {
    for (const slot of entry.slots) {
      const type = String(slot?.type || 'any').toLowerCase();
      const key = `${type}||${slot?.start}||${slot?.end}`;
      if (!seen.has(key)) {
        seen.set(key, { type, start: slot?.start, end: slot?.end, days: [] });
      }
      const found = seen.get(key);
      if (!found.days.includes(entry.day)) found.days.push(entry.day);
    }
  }
  // Start, then end, then kind — so the order does not depend on which day the
  // window happened to be seen on first.
  return [...seen.values()].sort((a, b) =>
    (hhmmToMin(a.start) ?? 0) - (hhmmToMin(b.start) ?? 0)
    || (hhmmToMin(a.end) ?? 0) - (hhmmToMin(b.end) ?? 0)
    || a.type.localeCompare(b.type));
}

/** "Tue" for a single day, "Tue–Fri" for a run. */
const runLabel = (days) =>
  days.length === 1 ? shortDay(days[0]) : `${shortDay(days[0])}–${shortDay(days[days.length - 1])}`;

export default function NewTrialAvailabilityPage() {
  const { branches } = useSchedule();

  const [classes, setClasses] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [overviewBranch, setOverviewBranch] = useState('all');
  const [slotDetail, setSlotDetail] = useState(null); // { day, time, available, unavailable }

  // Branch open days come from PostgreSQL, not the Sheets config.
  const {
    openDaysFor, ruleFor, branchNames, loading: rulesLoading, isEmpty: noRules,
  } = useNewOperationals();

  useEffect(() => {
    const unsub = subscribeToInternalClasses(
      (data) => { setClasses(data); setLoading(false); },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToInternalInstructors((data) => setInstructors(data));
    return () => unsub();
  }, []);

  // Union of the configured branches and the ones that have rules in
  // PostgreSQL. A branch with operating hours but no Sheets entry still needs a
  // card and a filter option, otherwise its slots are unreachable from here.
  const branchList = useMemo(
    () => [...new Set([...(branches || []).map((b) => b.name), ...branchNames])].filter(Boolean).sort(),
    [branches, branchNames]
  );

  // Working days per instructor, from the branch rules in PostgreSQL. With no
  // rules configured, treat every day as workable rather than hiding everyone.
  const workingDaysFor = (inst) => {
    const brs = inst?.branches || [];
    const days = new Set();
    const sources = brs.length ? brs : branchList;
    sources.forEach((bn) => openDaysFor(bn).forEach((d) => days.add(d)));
    if (days.size === 0) DAY_NAMES.forEach((d) => days.add(d));
    return days;
  };

  /**
   * One card per branch: the week's opening hours collapsed into runs, plus the
   * slot plan configured for it.
   *
   * The grid below only draws 1:00 pm to 6:30 pm, so each card also reports when
   * a branch's real hours reach outside that window — several open at 8:00 or
   * 10:00 am, and those hours are simply not on screen.
   */
  const branchCards = useMemo(() => branchList.map((name) => {
    const days = DAY_NAMES.map((day) => {
      const rule = ruleFor(name, day);
      return {
        day,
        configured: Boolean(rule),
        isOpen: Boolean(rule?.isOpen),
        hours: rule?.openTime && rule?.closeTime ? { start: rule.openTime, end: rule.closeTime } : null,
        slots: Array.isArray(rule?.slots) ? rule.slots : [],
      };
    });

    const openDays = days.filter((d) => d.isOpen && d.hours);
    const opens = openDays.map((d) => hhmmToMin(d.hours.start)).filter((n) => n != null);
    const closes = openDays.map((d) => hhmmToMin(d.hours.end)).filter((n) => n != null);
    const earliestOpen = opens.length ? Math.min(...opens) : null;
    const latestClose = closes.length ? Math.max(...closes) : null;

    return {
      name,
      openCount: days.filter((d) => d.isOpen).length,
      configured: days.some((d) => d.configured),
      week: summariseWeek(days),
      slots: summariseSlots(days),
      earliestOpen,
      latestClose,
      hiddenBefore: earliestOpen != null && earliestOpen < GRID_START_MIN,
      hiddenAfter: latestClose != null && latestClose > GRID_END_MIN,
    };
  }), [branchList, ruleFor]);

  const overview = useMemo(() => {
    const activeInstructors = instructors.filter((i) => (i.status || 'Active') === 'Active');

    return FIXED_TRIAL_SLOTS.map((timeSlot) => {
      const row = { time: timeSlot };
      DAY_NAMES.forEach((day) => {
        const available = [];
        const unavailable = [];

        activeInstructors.forEach((inst) => {
          // Branch scope
          if (overviewBranch !== 'all' && !(inst.branches || []).includes(overviewBranch)) return;

          let reason = '';
          let isAvailable = true;
          const wd = workingDaysFor(inst);

          if (!wd.has(day)) {
            isAvailable = false;
            reason = 'Branch closed / not available';
          } else {
            const busy = classes.find(
              (c) => c.teacher === inst.name && c.day === day && doTimeSlotsOverlap(c.time, timeSlot)
            );
            if (busy) {
              isAvailable = false;
              const badge = busy.branchName ? `[${busy.branchName}] ` : '';
              reason = `Teaching ${badge}${busy.program || 'class'} (${busy.time})`;
            }
          }

          if (isAvailable) available.push(inst);
          else unavailable.push({ ...inst, reason });
        });

        // When nothing is free, say why rather than showing a blank cell.
        let reason = null;
        if (available.length === 0) {
          if (unavailable.length === 0) {
            reason = overviewBranch === 'all'
              ? 'No instructors'
              : `No instructor assigned to ${overviewBranch}`;
          } else {
            const closed = unavailable.filter((u) => u.reason.startsWith('Branch closed')).length;
            if (closed === unavailable.length) reason = 'Branch closed';
            else if (closed === 0) reason = `All ${unavailable.length} teaching`;
            else reason = `${unavailable.length - closed} teaching, ${closed} closed`;
          }
        }

        row[day] = { available, unavailable, reason };
      });
      return row;
    });
  }, [instructors, classes, overviewBranch, branches]);

  const hasData = instructors.length > 0;

  return (
    <section className="dashboard-view active">
      <div data-tour="availability-checker" className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Star size={20} /> Trial Availability Overview
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Weekly overview of available trial slots — from New Operations instructors &amp; schedule.
            </p>
          </div>
          <select
            value={overviewBranch}
            onChange={(e) => setOverviewBranch(e.target.value)}
            style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'white', fontSize: '0.85rem', cursor: 'pointer' }}
          >
            <option value="all">All Branches</option>
            {branchList.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="panel-body">
          {/* Opening hours per branch. Click one to scope the grid to it. */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
              <Clock size={15} style={{ color: 'var(--text-muted)' }} />
              <h3 style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)' }}>
                Branch Opening Hours
              </h3>
              {overviewBranch !== 'all' && (
                <button
                  type="button"
                  onClick={() => setOverviewBranch('all')}
                  style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--primary, #4f46e5)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                >
                  Show all branches
                </button>
              )}
            </div>

            {rulesLoading ? (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading branch hours…</p>
            ) : noRules ? (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                No operating hours configured yet — set them per branch under the Operationals tab.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: '0.7rem' }}>
                {branchCards.map((card) => (
                  <BranchHoursCard
                    key={card.name}
                    card={card}
                    selected={overviewBranch === card.name}
                    onSelect={() => setOverviewBranch(overviewBranch === card.name ? 'all' : card.name)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            <span style={chipStyle('#4f46e5', 'rgba(79,70,229,0.12)')}>K</span> Kinder
            <span style={chipStyle('#0891b2', 'rgba(8,145,178,0.12)')}>J</span> Junior
            <span style={chipStyle('#ea580c', 'rgba(249,115,22,0.12)')}>C</span> Coder
          </div>

          <div data-tour="availability-slots" style={{ overflowX: 'auto' }}>
            <table className="trial-overview-table" style={{ width: '100%', textAlign: 'center', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                  <th style={{ padding: 10, textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)' }}>Time</th>
                  {DAY_NAMES.map((d) => (
                    <th key={d} style={{ padding: 10, fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{d.slice(0, 3)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={DAY_NAMES.length + 1} style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading…</td></tr>
                ) : !hasData ? (
                  <tr><td colSpan={DAY_NAMES.length + 1} style={{ padding: '2rem', color: 'var(--text-muted)' }}>Add instructors under the Instructors tab to see availability.</td></tr>
                ) : (
                  overview.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: 10, textAlign: 'left', fontWeight: 500, whiteSpace: 'nowrap' }}>{row.time}</td>
                      {DAY_NAMES.map((day) => {
                        const avail = row[day].available;
                        if (avail.length === 0) {
                          // Show explicit zeros plus the reason, so an empty
                          // cell is never ambiguous.
                          const cell = row[day];
                          return (
                            <td key={day} style={{ padding: 8 }}>
                              <div
                                onClick={cell.unavailable.length ? () => setSlotDetail({ day, time: row.time, ...cell }) : undefined}
                                title={cell.unavailable.length ? 'Click to see who is unavailable and why' : cell.reason}
                                style={{
                                  display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem',
                                  cursor: cell.unavailable.length ? 'pointer' : 'default',
                                }}
                              >
                                <span style={{ display: 'inline-flex', gap: '0.25rem', opacity: 0.45 }}>
                                  <span style={chipStyle('#64748b', 'rgba(100,116,139,0.12)')}>0</span>
                                  <span style={chipStyle('#64748b', 'rgba(100,116,139,0.12)')}>0</span>
                                  <span style={chipStyle('#64748b', 'rgba(100,116,139,0.12)')}>0</span>
                                </span>
                                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                                  {cell.reason}
                                </span>
                              </div>
                            </td>
                          );
                        }
                        const kinder = avail.filter((p) => canKinder(p.level)).length;
                        const junior = avail.filter((p) => canJunior(p.level)).length;
                        const coder = avail.filter((p) => canCoder(p.level)).length;
                        return (
                          <td key={day} style={{ padding: 8 }}>
                            <div
                              onClick={() => setSlotDetail({ day, time: row.time, ...row[day] })}
                              style={{ display: 'inline-flex', gap: '0.25rem', cursor: 'pointer' }}
                              title="Click for instructor details"
                            >
                              <span style={chipStyle('#4f46e5', 'rgba(79,70,229,0.12)')}>{kinder}</span>
                              <span style={chipStyle('#0891b2', 'rgba(8,145,178,0.12)')}>{junior}</span>
                              <span style={chipStyle('#ea580c', 'rgba(249,115,22,0.12)')}>{coder}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Slot detail modal */}
      {slotDetail && (
        <div
          onClick={() => setSlotDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--panel-bg, white)', borderRadius: '12px', maxWidth: '520px', width: '100%', maxHeight: '82vh', overflow: 'auto', border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{slotDetail.day} · {slotDetail.time}</h3>
              <button onClick={() => setSlotDetail(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={18} /></button>
            </div>
            <div style={{ padding: '1rem 1.5rem' }}>
              <h4 style={{ color: '#059669', margin: '0 0 0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>Available ({slotDetail.available.length})</h4>
              {slotDetail.available.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.5rem' }}>
                  {slotDetail.available.map((p, i) => (
                    <li key={i} style={{ padding: '0.5rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.level}</span>
                    </li>
                  ))}
                </ul>
              ) : <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '1.5rem' }}>No instructors available.</p>}

              <h4 style={{ color: '#dc2626', margin: '0 0 0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>Unavailable ({slotDetail.unavailable.length})</h4>
              {slotDetail.unavailable.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {slotDetail.unavailable.map((p, i) => (
                    <li key={i} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 500 }}>{p.name}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.level}</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--danger, #dc2626)' }}>{p.reason}</div>
                    </li>
                  ))}
                </ul>
              ) : <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>Everyone is available.</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One branch's week of opening hours plus its slot plan.
 *
 * A button rather than a div so the click-to-filter works from the keyboard, and
 * `aria-pressed` reports which branch the grid is currently scoped to.
 */
function BranchHoursCard({ card, selected, onSelect }) {
  const accent = selected ? 'var(--primary, #4f46e5)' : 'var(--border-color)';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={selected ? `Showing ${card.name} only — click to show all branches` : `Show only ${card.name}`}
      style={{
        textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%',
        background: selected ? 'rgba(79,70,229,0.06)' : 'var(--panel-bg, white)',
        border: `1px solid ${accent}`,
        boxShadow: selected ? '0 0 0 1px var(--primary, #4f46e5)' : 'none',
        borderRadius: '10px', padding: '0.7rem 0.8rem',
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
        transition: 'border-color 120ms ease, box-shadow 120ms ease, background 120ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.4rem' }}>
        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{card.name}</span>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {card.openCount === 0 ? 'Closed all week' : `${card.openCount} day${card.openCount === 1 ? '' : 's'} open`}
        </span>
      </div>

      {/* Opening hours, consecutive same-hours days collapsed into one row. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem' }}>
        {card.week.map((run) => {
          const open = run.isOpen && run.hours;
          return (
            <div key={run.days.join('')} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.74rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontWeight: open ? 600 : 400, opacity: open ? 1 : 0.6 }}>
                {runLabel(run.days)}
              </span>
              <span style={{ whiteSpace: 'nowrap', color: open ? 'var(--text-primary, inherit)' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {open
                  ? `${prettyTime(run.hours.start)} – ${prettyTime(run.hours.end)}`
                  : (run.configured ? 'Closed' : 'Not set')}
              </span>
            </div>
          );
        })}
      </div>

      {/* The day's planned slots: classes by level, plus breaks and meetings. */}
      {card.slots.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.45rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Slot plan
          </span>
          {card.slots.map((slot) => {
            const meta = slotTypeMeta(slot.type);
            return (
              <div key={`${slot.type}-${slot.start}-${slot.end}`} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.71rem' }}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: meta.color, flexShrink: 0 }} />
                <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {prettyTime(slot.start)} – {prettyTime(slot.end)}
                </span>
                <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.64rem', whiteSpace: 'nowrap' }}>
                  {slot.days.length >= DAY_NAMES.length ? 'Daily' : slot.days.map(shortDay).join(' ')}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* The grid below starts at 1.00 pm, so flag hours it cannot show. */}
      {(card.hiddenBefore || card.hiddenAfter) && (
        <span style={{ fontSize: '0.64rem', color: '#b45309', lineHeight: 1.35 }}>
          {card.hiddenBefore && `Opens ${prettyMin(card.earliestOpen)}`}
          {card.hiddenBefore && card.hiddenAfter && ' · '}
          {card.hiddenAfter && `Closes ${prettyMin(card.latestClose)}`}
          {' — outside the 1.00 pm–6.30 pm trial grid below.'}
        </span>
      )}
    </button>
  );
}

function chipStyle(color, bg) {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '22px', height: '22px', borderRadius: '6px', fontSize: '0.72rem',
    fontWeight: 700, color, background: bg, padding: '0 0.35rem',
  };
}
