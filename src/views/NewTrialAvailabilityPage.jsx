'use client';

/**
 * Trial availability: which windows a branch opens, and whether they can still
 * take a student.
 *
 * The answer comes from `/api/new/trial-availability` rather than being
 * recomputed here. It used to be worked out in the browser from
 * `internal_classes`, matching instructor names with `===`, which missed most
 * class rows and so reported windows as free while somebody was teaching in
 * them. The endpoint joins the branch rules, instructors, classes, the seat
 * rules and Live Progress in one place, so the page and the API agree.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useNewOperationals } from '../hooks/useNewOperationals';
import { useScheduleRules } from '../hooks/useScheduleRules';
import { subscribeToTrialAvailability } from '../services/newTrialAvailabilityService';
import BranchTrialSlotDrawer from '../components/operations/BranchTrialSlotDrawer';
import { DAY_NAMES } from '../utils/constants';
import { slotTypeMeta } from '../lib/slotTypes';
import { CATEGORIES } from '../lib/programRules';
import {
  Star, X, Clock, SlidersHorizontal, Users, TriangleAlert, CalendarClock,
} from 'lucide-react';

/** Slot kinds that block the time rather than taking a student. */
const NON_CLASS_TYPES = ['break', 'training', 'meeting'];

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

/** "Tue" for a single day, "Tue–Fri" for a run. */
const runLabel = (days) =>
  days.length === 1 ? shortDay(days[0]) : `${shortDay(days[0])}–${shortDay(days[days.length - 1])}`;

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
        seen.set(key, { type, start: slot?.start, end: slot?.end, capacity: slot?.capacity ?? null, days: [] });
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

export default function NewTrialAvailabilityPage() {
  const { branches } = useSchedule();
  const { rules: scheduleRules } = useScheduleRules();

  const [branchFilter, setBranchFilter] = useState('all');
  const [dayFilter, setDayFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [cellDetail, setCellDetail] = useState(null); // { day, label, rows }
  const [configuring, setConfiguring] = useState(null); // branch name

  /**
   * The last answer, tagged with the filters it was computed for.
   *
   * Storing the key alongside the data means "still loading" is derived rather
   * than tracked, and — more importantly — an answer for the previous filters
   * can never be rendered as though it described the current ones.
   */
  const [answer, setAnswer] = useState(null);
  const filterKey = `${branchFilter}||${dayFilter}||${categoryFilter}`;

  // Branch open days and slot plans come from PostgreSQL, not the Sheets config.
  const {
    ruleFor, branchNames, rules: opRules, applyLocal,
    loading: rulesLoading, isEmpty: noRules,
  } = useNewOperationals();

  // Re-subscribes when a filter changes, so a new answer arrives immediately
  // rather than on the next poll.
  useEffect(() => {
    const unsub = subscribeToTrialAvailability(
      { branch: branchFilter, day: dayFilter, category: categoryFilter },
      (data) => setAnswer({ key: filterKey, data }),
      (err) => setAnswer({ key: filterKey, error: err.message })
    );
    return () => unsub();
  }, [filterKey, branchFilter, dayFilter, categoryFilter]);

  const fresh = answer?.key === filterKey ? answer : null;
  const availability = fresh?.data || null;
  const loadError = fresh?.error || null;
  const loading = !fresh;

  // Union of the configured branches and the ones that have rules in
  // PostgreSQL. A branch with operating hours but no Sheets entry still needs a
  // card and a filter option, otherwise its slots are unreachable from here.
  const branchList = useMemo(
    () => [...new Set([...(branches || []).map((b) => b.name), ...branchNames])].filter(Boolean).sort(),
    [branches, branchNames]
  );

  /**
   * One card per branch: the week's opening hours collapsed into runs, plus the
   * slot plan configured for it.
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

    return {
      name,
      openCount: days.filter((d) => d.isOpen).length,
      configured: days.some((d) => d.configured),
      week: summariseWeek(days),
      slots: summariseSlots(days),
      // Days whose plan holds no class slot fall back to hourly windows, which
      // is worth saying on the card because it is not something anyone set.
      derivedDays: days.filter((d) =>
        d.isOpen && !d.slots.some((s) => !NON_CLASS_TYPES.includes(String(s.type || 'any')))
      ).length,
    };
  }), [branchList, ruleFor]);

  /**
   * The availability matrix: one row per distinct window, one column per day.
   *
   * Rows are the windows that actually exist for the current filters rather than
   * a fixed 1pm-6:30pm list, so a branch opening at 8am is visible instead of
   * being silently off the bottom of the table.
   */
  const matrix = useMemo(() => {
    const rows = new Map();
    for (const r of availability?.data || []) {
      const key = `${r.start}-${r.end}`;
      if (!rows.has(key)) rows.set(key, { key, start: r.start, end: r.end, byDay: new Map() });
      const row = rows.get(key);
      if (!row.byDay.has(r.day)) row.byDay.set(r.day, []);
      row.byDay.get(r.day).push(r);
    }
    return [...rows.values()].sort(
      (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)
    );
  }, [availability]);

  const visibleDays = useMemo(
    () => DAY_NAMES.filter((d) => dayFilter === 'all' || d === dayFilter),
    [dayFilter]
  );

  const openDrawer = (name) => setConfiguring(name);

  return (
    <section className="dashboard-view active">
      <div data-tour="availability-checker" className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Star size={20} /> Trial Availability Overview
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Windows each branch opens for trials, checked against the live schedule and Live Progress.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select
              aria-label="Branch"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              style={selectStyle}
            >
              <option value="all">All Branches</option>
              {branchList.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select aria-label="Day" value={dayFilter} onChange={(e) => setDayFilter(e.target.value)} style={selectStyle}>
              <option value="all">All Days</option>
              {DAY_NAMES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select aria-label="Programme" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={selectStyle}>
              <option value="all">Any Programme</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="panel-body">
          {/* Opening hours per branch. Click one to scope the matrix to it. */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
              <Clock size={15} style={{ color: 'var(--text-muted)' }} />
              <h3 style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)' }}>
                Branch Opening Hours &amp; Slot Plan
              </h3>
              {branchFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setBranchFilter('all')}
                  style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--primary-blue, #4f46e5)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                >
                  Show all branches
                </button>
              )}
            </div>

            {rulesLoading ? (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading branch hours…</p>
            ) : noRules ? (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                No operating hours configured yet — open a branch below to set them.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))', gap: '0.7rem' }}>
                {branchCards.map((card) => (
                  <BranchHoursCard
                    key={card.name}
                    card={card}
                    selected={branchFilter === card.name}
                    onSelect={() => setBranchFilter(branchFilter === card.name ? 'all' : card.name)}
                    onConfigure={() => openDrawer(card.name)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Matrix */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
            <CalendarClock size={15} style={{ color: 'var(--text-muted)' }} />
            <h3 style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)' }}>
              Weekly Slot Matrix
            </h3>
            {availability && (
              <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                {availability.availableCount} of {availability.total} windows open
                {availability.openingSoonCount > 0 && ` · ${availability.openingSoonCount} with a seat finishing`}
              </span>
            )}
          </div>

          {loadError ? (
            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start', fontSize: '0.8rem', color: 'var(--danger, #dc2626)', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: '9px', padding: '0.6rem 0.75rem' }}>
              <TriangleAlert size={15} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
              <span>Could not load availability: {loadError}</span>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.6rem', alignItems: 'center' }}>
                {['kinder', 'junior', 'coder', 'any'].map((t) => {
                  const meta = slotTypeMeta(t);
                  return (
                    <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: meta.color }} />
                      {meta.label}
                    </span>
                  );
                })}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Users size={12} /> seats left of capacity
                </span>
              </div>

              <div data-tour="availability-slots" style={{ overflowX: 'auto' }}>
                <table className="trial-overview-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: `${180 + visibleDays.length * 110}px` }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                      <th style={{ padding: 10, textAlign: 'left', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Time window</th>
                      {visibleDays.map((d) => (
                        <th key={d} style={{ padding: 10, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'center' }}>{shortDay(d)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={visibleDays.length + 1} style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading availability…</td></tr>
                    ) : matrix.length === 0 ? (
                      <tr>
                        <td colSpan={visibleDays.length + 1} style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                          No windows for these filters. Open a branch above to add a slot rule.
                        </td>
                      </tr>
                    ) : (
                      matrix.map((row) => (
                        <tr key={row.key} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: 10, fontWeight: 600, whiteSpace: 'nowrap', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
                            {prettyTime(row.start)} – {prettyTime(row.end)}
                          </td>
                          {visibleDays.map((day) => (
                            <MatrixCell
                              key={day}
                              cells={row.byDay.get(day) || []}
                              multiBranch={branchFilter === 'all'}
                              onOpen={(rows) => setCellDetail({
                                day,
                                label: `${prettyTime(row.start)} – ${prettyTime(row.end)}`,
                                rows,
                              })}
                            />
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {cellDetail && (
        <SlotDetailModal detail={cellDetail} onClose={() => setCellDetail(null)} />
      )}

      {configuring && (
        <BranchTrialSlotDrawer
          key={configuring}
          branchName={configuring}
          rules={opRules}
          scheduleRules={scheduleRules}
          applyLocal={applyLocal}
          onClose={() => setConfiguring(null)}
        />
      )}
    </section>
  );
}

const selectStyle = {
  padding: '0.45rem 0.7rem', borderRadius: '6px', border: '1px solid var(--border-color)',
  background: 'var(--panel-bg, white)', color: 'inherit', fontSize: '0.82rem', cursor: 'pointer',
};

/**
 * One day's worth of one window.
 *
 * With every branch shown, a cell can hold several windows at once, so it
 * reports how many of them are open rather than pretending to be one.
 */
function MatrixCell({ cells, multiBranch, onOpen }) {
  if (cells.length === 0) {
    return (
      <td style={{ padding: 8, textAlign: 'center' }}>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', opacity: 0.55 }}>—</span>
      </td>
    );
  }

  const blocks = cells.filter((c) => NON_CLASS_TYPES.includes(c.slotType));
  const classes = cells.filter((c) => !NON_CLASS_TYPES.includes(c.slotType));
  const open = classes.filter((c) => c.available);

  // Nothing bookable here, only a break or a meeting.
  if (classes.length === 0) {
    const meta = slotTypeMeta(blocks[0].slotType);
    return (
      <td style={{ padding: 8, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => onOpen(cells)}
          title={blocks.map((b) => b.reason).join('\n')}
          style={{
            ...cellButtonStyle,
            color: meta.color,
            background: meta.bg === '#0f172a' ? 'rgba(30,58,138,0.15)' : meta.bg,
            borderColor: `${meta.color}55`,
          }}
        >
          {meta.label}
        </button>
      </td>
    );
  }

  const seatsLeft = open.reduce((n, c) => n + (c.seats?.leftStrict || 0), 0);
  const seatsMax = open.reduce((n, c) => n + (c.seats?.max || 0), 0);
  const finishing = classes.reduce((n, c) => n + (c.openingSoonClasses?.length || 0), 0);
  const anyOpen = open.length > 0;
  const meta = slotTypeMeta(open[0]?.slotType || classes[0].slotType);

  return (
    <td style={{ padding: 8, textAlign: 'center' }}>
      <button
        type="button"
        onClick={() => onOpen(cells)}
        title={cells.map((c) => `${c.branchName}: ${c.reason}`).join('\n')}
        style={{
          ...cellButtonStyle,
          opacity: anyOpen ? 1 : 0.55,
          color: anyOpen ? meta.color : 'var(--text-muted)',
          background: anyOpen
            ? (meta.bg === '#0f172a' ? 'rgba(30,58,138,0.15)' : meta.bg)
            : 'var(--bg-color)',
          borderColor: anyOpen ? `${meta.color}55` : 'var(--border-color)',
          display: 'inline-flex', flexDirection: 'column', gap: '0.1rem', alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 700 }}>
          {multiBranch
            ? `${open.length}/${classes.length} branch${classes.length === 1 ? '' : 'es'}`
            : (anyOpen ? meta.label : 'Full')}
        </span>
        {anyOpen && seatsMax > 0 && (
          <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.85 }}>
            {seatsLeft}/{seatsMax} seats
          </span>
        )}
        {finishing > 0 && (
          <span style={{ fontSize: '0.6rem', color: '#b45309', fontWeight: 700 }}>
            +{finishing} finishing
          </span>
        )}
      </button>
    </td>
  );
}

const cellButtonStyle = {
  font: 'inherit', cursor: 'pointer', padding: '0.28rem 0.5rem', borderRadius: '7px',
  border: '1px solid', fontSize: '0.7rem', lineHeight: 1.25, minWidth: '76px',
};

/** Everything the endpoint knows about the windows behind one cell. */
function SlotDetailModal({ detail, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${detail.day} ${detail.label}`}
        style={{ background: 'var(--panel-bg, white)', borderRadius: '12px', maxWidth: '620px', width: '100%', maxHeight: '82vh', overflow: 'auto', border: '1px solid var(--border-color)' }}
      >
        <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{detail.day} · {detail.label}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {detail.rows.map((r, i) => {
            const meta = slotTypeMeta(r.slotType);
            return (
              <div key={`${r.branchName}-${i}`} style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.75rem 0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                  <strong style={{ fontSize: '0.88rem' }}>{r.branchName}</strong>
                  <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '0.06rem 0.4rem', borderRadius: 5, color: meta.color, background: meta.bg === '#0f172a' ? 'rgba(30,58,138,0.15)' : meta.bg }}>
                    {meta.label}
                  </span>
                  {r.parallel > 1 && (
                    <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>×{r.parallel} in parallel</span>
                  )}
                  <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    from {r.source}
                    {r.slotCapacity != null && ` · ${r.slotCapacity} seats set`}
                  </span>
                </div>

                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: r.available ? 'var(--success, #059669)' : 'var(--danger, #dc2626)', marginBottom: '0.5rem' }}>
                  {r.available ? 'Open' : 'Not available'} — {r.reason}
                </div>

                {r.freeInstructors.length > 0 && (
                  <Section title={`Free instructors (${r.freeInstructors.length})`}>
                    {r.freeInstructors.map((p) => (
                      <li key={p.name} style={rowStyle}>
                        <span style={{ fontWeight: 500 }}>{p.name}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{p.level}</span>
                      </li>
                    ))}
                  </Section>
                )}

                {r.joinableClasses.length > 0 && (
                  <Section title={`Classes with a free seat (${r.joinableClasses.length})`}>
                    {r.joinableClasses.map((c, j) => (
                      <li key={`j-${j}`} style={rowStyle}>
                        <span>{c.teacher} · {c.program} <span style={{ color: 'var(--text-muted)' }}>{c.time}</span></span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--success, #059669)' }}>
                          {c.seatsLeftStrict}/{c.maxStudents} free
                        </span>
                      </li>
                    ))}
                  </Section>
                )}

                {r.openingSoonClasses.length > 0 && (
                  <Section title={`Seats finishing (${r.openingSoonClasses.length})`}>
                    {r.openingSoonClasses.map((c, j) => (
                      <li key={`o-${j}`} style={{ ...rowStyle, display: 'block' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                          <span>{c.teacher} · {c.program}</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#b45309' }}>
                            {c.releasing} finishing
                          </span>
                        </div>
                        {c.releasingStudents.map((s) => (
                          <div key={s.name} style={{ fontSize: '0.7rem', color: '#b45309' }}>
                            {s.name} — {s.reason}
                          </div>
                        ))}
                      </li>
                    ))}
                  </Section>
                )}

                {r.existingSlots.length > 0 && (
                  <Section title={`Already running (${r.existingSlots.length})`}>
                    {r.existingSlots.map((c, j) => (
                      <li key={`e-${j}`} style={rowStyle}>
                        <span>{c.teacher} · {c.program} <span style={{ color: 'var(--text-muted)' }}>{c.time}</span></span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {c.studentCount}/{c.maxStudents} seats
                          {c.capacitySource === 'slot' && ' (set)'}
                        </span>
                      </li>
                    ))}
                  </Section>
                )}

                {r.freeInstructors.length === 0 && r.existingSlots.length === 0 && (
                  <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Nothing scheduled in this window.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const rowStyle = {
  padding: '0.35rem 0', display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-color)',
  fontSize: '0.78rem',
};

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <h4 style={{ margin: '0 0 0.15rem', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-muted)' }}>
        {title}
      </h4>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{children}</ul>
    </div>
  );
}

/**
 * One branch's week of opening hours plus its slot plan.
 *
 * The card body is a button so click-to-filter works from the keyboard;
 * Configure is a separate button beside it rather than nested inside.
 */
function BranchHoursCard({ card, selected, onSelect, onConfigure }) {
  return (
    <div
      style={{
        background: selected ? 'rgba(79,70,229,0.06)' : 'var(--panel-bg, white)',
        border: `1px solid ${selected ? 'var(--primary-blue, #4f46e5)' : 'var(--border-color)'}`,
        boxShadow: selected ? '0 0 0 1px var(--primary-blue, #4f46e5)' : 'none',
        borderRadius: '10px', display: 'flex', flexDirection: 'column',
        transition: 'border-color 120ms ease, box-shadow 120ms ease, background 120ms ease',
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        title={selected ? `Showing ${card.name} only — click to show all branches` : `Show only ${card.name}`}
        style={{
          textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%',
          background: 'transparent', border: 'none', color: 'inherit',
          padding: '0.7rem 0.8rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem',
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
                <span style={{ whiteSpace: 'nowrap', color: open ? 'inherit' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
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
                  {meta.bookable && slot.capacity != null && (
                    <span style={{ fontSize: '0.63rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      {slot.capacity} seats
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.64rem', whiteSpace: 'nowrap' }}>
                    {slot.days.length >= DAY_NAMES.length ? 'Daily' : slot.days.map(shortDay).join(' ')}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Days with no class slot planned still offer trials, derived from hours. */}
        {card.derivedDays > 0 && (
          <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
            {card.derivedDays} open day{card.derivedDays === 1 ? '' : 's'} have no class slot planned — trial
            windows there follow the opening hours.
          </span>
        )}
      </button>

      <div style={{ borderTop: '1px solid var(--border-color)', padding: '0.4rem 0.55rem 0.45rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onConfigure}
          className="trial-configure-btn"
          title={`Configure ${card.name} slot rules and hours`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.3rem', font: 'inherit',
            fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
            padding: '0.25rem 0.6rem', borderRadius: '6px',
            border: '1px solid var(--border-color)', background: 'transparent',
            color: 'var(--primary-blue, #4f46e5)',
          }}
        >
          <SlidersHorizontal size={12} /> Configure
        </button>
      </div>
    </div>
  );
}
