'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Users, Filter, Trash2, X, CalendarDays, AlertTriangle, Clock,
  GripVertical, ChevronUp, ChevronDown, Plus,
} from 'lucide-react';
import {
  AVAIL, availabilityFor, toMinutes, fromMinutes, clockLabel, slotLabelFor,
  overlaps, instructorsAtBranch, categoriesFor, levelCovers, weekStartISO, dateForDay, leaveOn,
} from '../../lib/instructorAvailability';
import { slotTypeMeta, slotKeyForCategory, durationForCategory } from '../../lib/slotTypes';
import { maxStudentsFor } from '../../lib/programRules';
import { DAY_NAMES } from '../../utils/constants';

const CATEGORIES = ['Kinder', 'Junior', 'Coder'];

/** Timeline granularity. Classes run 90 or 120 minutes, so 30 divides both. */
const STEP = 30;
/** Pixel height of one STEP row — resize maths converts drag distance with it. */
const ROW_H = 34;
/** Shortest class we will let a slot be shrunk to. */
const MIN_DURATION = 30;

const unavailableTint = (code) => {
  if (code === AVAIL.ON_LEAVE) return 'rgba(220,38,38,0.06)';
  if (code === AVAIL.TEACHING_ELSEWHERE) return 'rgba(124,58,237,0.06)';
  if (code === AVAIL.OUTSIDE_HOURS) return 'transparent';
  return 'var(--bg-subtle, rgba(120,120,120,0.05))';
};

const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/** Which category a class belongs to, from its first program code. */
function categoryOfProgram(cls) {
  const p = String(cls.programs?.[0] || '');
  if (/^kf?\d/i.test(p)) return 'Kinder';
  if (/^jf?\d/i.test(p)) return 'Junior';
  if (/coder/i.test(p)) return 'Coder';
  return null;
}

/**
 * How useful a refusal is to show, most useful first. "Not qualified" beats
 * "outside hours" because it says something about the instructor rather than
 * about the clock.
 */
function reasonRank(code) {
  const order = [
    AVAIL.ON_LEAVE, AVAIL.TEACHING_ELSEWHERE, AVAIL.TEACHING, AVAIL.BLOCKED,
    AVAIL.NOT_AT_BRANCH, AVAIL.NO_CAPABILITY, AVAIL.OUTSIDE_HOURS,
  ];
  const i = order.indexOf(code);
  return i === -1 ? order.length : i;
}

/** Compact cell text; the full sentence stays in the tooltip. */
function shortReason(verdict, rowStart) {
  switch (verdict.code) {
    case AVAIL.ON_LEAVE: return 'On leave';
    case AVAIL.TEACHING_ELSEWHERE: return verdict.conflict?.branchName || 'Other branch';
    case AVAIL.TEACHING: return 'Teaching';
    case AVAIL.BLOCKED: {
      // The block starts later than this row, so the real problem is that a
      // full class does not fit in the gap before it.
      const blockStart = toMinutes(verdict.conflict?.start);
      if (blockStart != null && rowStart != null && blockStart > rowStart) return 'Gap too short';
      return verdict.conflict?.label || verdict.conflict?.type || 'Blocked';
    }
    case AVAIL.NO_CAPABILITY: return 'Not qualified';
    case AVAIL.NOT_AT_BRANCH: return 'Other branch';
    case AVAIL.OUTSIDE_HOURS: return '—';
    default: return '—';
  }
}

/**
 * Time-by-instructor planning grid for Class Operation slots.
 *
 * Rows step every 30 minutes so 90-minute Kinder classes land on the grid as
 * cleanly as 120-minute ones. Cards span their real duration with rowSpan,
 * can be dragged to another time or instructor, and can be resized from their
 * bottom edge. Every verdict comes from the shared availability engine.
 */
export default function ScheduleGrid({
  branches = [],
  instructors = [],
  classGroups = [],
  leaves = [],
  draft = {},
  draftOps = {},
  draftHours = {},
  rules,
  saving = false,
  onAddSlot,
  onRemoveSlot,
  onMoveSlot,
  onMoveClass,
}) {
  const selectable = useMemo(
    () => branches.filter((b) => b.name !== 'Default Branch'),
    [branches]
  );

  const [branchChoice, setBranchChoice] = useState('');
  const [dayChoice, setDayChoice] = useState('');
  const [teacher, setTeacher] = useState('all');
  const [week, setWeek] = useState(() => weekStartISO());
  const [picker, setPicker] = useState(null);   // { instructor, startMin }
  const [moving, setMoving] = useState(null);   // card in hand (drag or click)
  const [resizing, setResizing] = useState(null); // { ..., previewEnd }

  const branchId = useMemo(() => {
    if (branchChoice === 'all') return 'all';
    if (branchChoice && selectable.some((b) => b.id === branchChoice)) return branchChoice;
    return selectable[0]?.id || '';
  }, [branchChoice, selectable]);

  const branch = selectable.find((b) => b.id === branchId) || null;
  const allBranches = branchId === 'all';

  const openDays = useMemo(() => {
    if (allBranches) {
      const set = new Set();
      for (const b of selectable) for (const d of DAY_NAMES) if (draft[b.id]?.has(d)) set.add(d);
      return DAY_NAMES.filter((d) => set.has(d));
    }
    if (!branch) return [];
    return DAY_NAMES.filter((d) => draft[branch.id]?.has(d));
  }, [allBranches, selectable, branch, draft]);

  const day = openDays.includes(dayChoice) ? dayChoice : (openDays[0] || '');

  const hours = useMemo(() => {
    if (allBranches) {
      let open = null; let close = null;
      for (const b of selectable) {
        const h = draftHours[b.id]?.[day];
        const o = toMinutes(h?.start); const c = toMinutes(h?.end);
        if (o != null && (open == null || o < open)) open = o;
        if (c != null && (close == null || c > close)) close = c;
      }
      return open != null && close != null ? { start: fromMinutes(open), end: fromMinutes(close) } : null;
    }
    return branch ? (draftHours[branch.id]?.[day] || null) : null;
  }, [allBranches, selectable, branch, draftHours, day]);

  const openMin = toMinutes(hours?.start) ?? 9 * 60;
  const closeMin = toMinutes(hours?.end) ?? 18 * 60;

  const daySlots = useMemo(() => {
    if (allBranches) {
      return selectable.flatMap((b) =>
        (draftOps[b.id]?.[day] || []).map((s, idx) => ({ ...s, idx, day, branchId: b.id, branchName: b.name }))
      );
    }
    if (!branch) return [];
    return (draftOps[branch.id]?.[day] || []).map((s, idx) => ({ ...s, idx, day, branchId: branch.id, branchName: branch.name }));
  }, [allBranches, selectable, branch, draftOps, day]);

  const blocks = useMemo(
    () => daySlots.filter((s) => !slotTypeMeta(s.type).bookable),
    [daySlots]
  );

  const columns = useMemo(() => {
    const pool = allBranches ? instructors : instructorsAtBranch(instructors, branch?.name);
    const sorted = [...pool].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return teacher === 'all' ? sorted : sorted.filter((i) => i.name === teacher);
  }, [allBranches, instructors, branch, teacher]);

  const teacherOptions = useMemo(() => {
    const pool = allBranches ? instructors : instructorsAtBranch(instructors, branch?.name);
    return [...pool].map((i) => i.name).sort((a, b) => String(a).localeCompare(String(b)));
  }, [allBranches, instructors, branch]);

  const date = useMemo(() => dateForDay(day, week), [day, week]);

  /**
   * Row start times: every 30 minutes through the operating hours, plus the
   * exact start of anything already planned or running so nothing lands
   * off-grid.
   */
  const rowStarts = useMemo(() => {
    const set = new Set();
    for (let t = openMin; t < closeMin; t += STEP) set.add(t);
    for (const s of daySlots) {
      const m = toMinutes(s.start);
      if (m != null && m >= openMin - STEP && m < closeMin + STEP) set.add(m);
    }
    for (const g of classGroups) {
      if (g.day !== day || g.startMin == null) continue;
      if (!columns.some((i) => i.name === g.teacher)) continue;
      set.add(g.startMin);
    }
    return [...set].sort((a, b) => a - b);
  }, [openMin, closeMin, daySlots, classGroups, day, columns]);

  /** End of the timeline, used to size the last row's span. */
  const timelineEnd = Math.max(closeMin, (rowStarts[rowStarts.length - 1] ?? openMin) + STEP);

  /** How many rows a window covers, so a card can span its real duration. */
  const spanFor = useCallback((startIdx, endMin) => {
    let span = 1;
    for (let j = startIdx + 1; j < rowStarts.length; j += 1) {
      if (rowStarts[j] >= endMin) break;
      span += 1;
    }
    return span;
  }, [rowStarts]);

  /**
   * One availability question, asked the same way everywhere: can this
   * instructor hold [startMin, endMin)? The item being moved or resized is
   * excluded so it never blocks itself.
   */
  const canOccupy = useCallback((inst, startMin, endMin, opts = {}) => {
    const { category = null, excludeClassKey = null, excludeSlot = null } = opts;
    const groups = excludeClassKey
      ? classGroups.filter((g) => g.key !== excludeClassKey)
      : classGroups;
    const mine = daySlots.filter((s) =>
      s.instructor === inst.name &&
      slotTypeMeta(s.type).bookable &&
      !(excludeSlot && s.branchId === excludeSlot.branchId && s.idx === excludeSlot.idx)
    );
    return availabilityFor(inst, {
      branchName: allBranches ? '' : branch?.name,
      day,
      startMin,
      endMin,
      category,
      classGroups: groups,
      leaves,
      date,
      blocks,
      hours,
      plannedSlots: mine,
      requireBranch: !allBranches,
    });
  }, [classGroups, daySlots, allBranches, branch, day, leaves, date, blocks, hours]);

  /**
   * Lay the whole grid out column by column. Occupied windows claim a rowSpan
   * and the rows they cover are skipped, so a 90-minute class is one card three
   * rows tall rather than a card plus filler.
   */
  const layout = useMemo(() => {
    const out = new Map(); // instructorName -> array aligned to rowStarts

    for (const inst of columns) {
      const cells = new Array(rowStarts.length).fill(null);
      const mine = daySlots.filter((s) => s.instructor === inst.name && slotTypeMeta(s.type).bookable);
      const teaching = classGroups.filter((g) => g.teacher === inst.name && g.day === day);

      let i = 0;
      while (i < rowStarts.length) {
        const start = rowStarts[i];
        const rowEnd = i + 1 < rowStarts.length ? rowStarts[i + 1] : timelineEnd;

        // Branch-wide blocked time wins, so a break reads as a break rather
        // than being masked by a class later in the same window.
        const block = blocks.find((s) => overlaps(start, rowEnd, toMinutes(s.start), toMinutes(s.end)));
        if (block) {
          const end = toMinutes(block.end);
          const span = spanFor(i, end);
          cells[i] = { kind: 'blocked', slot: block, span };
          i += span;
          continue;
        }

        const cls = teaching.find((g) => overlaps(start, rowEnd, g.startMin, g.endMin));
        if (cls) {
          const span = spanFor(i, cls.endMin);
          cells[i] = { kind: 'class', cls, span, category: categoryOfProgram(cls) };
          i += span;
          continue;
        }

        const slot = mine.find((s) => overlaps(start, rowEnd, toMinutes(s.start), toMinutes(s.end)));
        if (slot) {
          const span = spanFor(i, toMinutes(slot.end));
          cells[i] = { kind: 'planned', slot, span };
          i += span;
          continue;
        }

        // Free? Ask once per category this instructor can teach, each at its
        // real length — one fixed probe length made cells look blocked when a
        // shorter class would have fitted.
        const cats = allBranches ? [null] : categoriesFor(inst);
        const tried = cats.map((category) => ({
          category,
          v: canOccupy(inst, start, start + (category ? durationForCategory(category) : STEP), { category }),
        }));
        const openable = tried.filter((x) => x.v.free);
        if (openable.length) {
          cells[i] = { kind: 'free', span: 1, openable: openable.map((x) => x.category) };
        } else {
          const ranked = [...tried].sort((a, b) => reasonRank(a.v.code) - reasonRank(b.v.code));
          cells[i] = {
            kind: 'unavailable', span: 1,
            verdict: ranked[0]?.v || { code: AVAIL.OUTSIDE_HOURS, reason: 'Unavailable' },
          };
        }
        i += 1;
      }
      out.set(inst.name, cells);
    }
    return out;
  }, [columns, rowStarts, daySlots, classGroups, blocks, day, allBranches, canOccupy, spanFor, timelineEnd]);

  /** Per-instructor load for the selected day. */
  const load = useMemo(() => {
    const out = new Map();
    for (const inst of columns) {
      const teaching = classGroups.filter((g) => g.teacher === inst.name && g.day === day);
      const planned = daySlots.filter((s) => s.instructor === inst.name && slotTypeMeta(s.type).bookable);
      const minutes = teaching.reduce(
        (sum, g) => sum + (g.endMin != null && g.startMin != null ? g.endMin - g.startMin : 0), 0
      );
      const cells = layout.get(inst.name) || [];
      out.set(inst.name, {
        committed: teaching.length + planned.length,
        free: cells.filter((c) => c?.kind === 'free').length,
        hours: minutes / 60,
        onLeave: leaveOn(leaves, inst.name, date),
      });
    }
    return out;
  }, [columns, classGroups, daySlots, layout, day, leaves, date]);

  // ── moving a card ──────────────────────────────────────────────────────────

  const beginMoveClass = (cls) => setMoving({
    kind: 'class',
    cls,
    category: categoryOfProgram(cls),
    duration: (cls.endMin ?? 0) - (cls.startMin ?? 0),
    label: [...new Set(cls.programs)].join(', ') || 'Class',
    from: `${cls.teacher} · ${cls.time}`,
  });

  const beginMoveSlot = (slot) => setMoving({
    kind: 'slot',
    slot,
    category: slotTypeMeta(slot.type).category,
    duration: (toMinutes(slot.end) ?? 0) - (toMinutes(slot.start) ?? 0),
    label: slotTypeMeta(slot.type).label,
    from: `${slot.instructor || 'Unassigned'} · ${slot.start}–${slot.end}`,
  });

  /** Where the card in hand can legally land. */
  const moveTargets = useMemo(() => {
    const set = new Set();
    if (!moving || allBranches || !moving.duration) return set;
    for (const inst of columns) {
      if (moving.category && !levelCovers(inst.level, moving.category)) continue;
      for (const start of rowStarts) {
        const v = canOccupy(inst, start, start + moving.duration, {
          category: moving.category,
          excludeClassKey: moving.kind === 'class' ? moving.cls.key : null,
          excludeSlot: moving.kind === 'slot' ? moving.slot : null,
        });
        if (v.free) set.add(`${inst.name}||${start}`);
      }
    }
    return set;
  }, [moving, allBranches, columns, rowStarts, canOccupy]);

  const applyMove = async (inst, start) => {
    if (!moving) return;
    const end = start + moving.duration;
    try {
      if (moving.kind === 'slot') {
        await onMoveSlot?.(moving.slot.branchId, day, moving.slot.idx, {
          start: fromMinutes(start), end: fromMinutes(end), instructor: inst.name,
        });
      } else {
        await onMoveClass?.(moving.cls, { time: slotLabelFor(start, end), teacher: inst.name });
      }
    } finally {
      setMoving(null);
    }
  };

  // ── resizing a card ────────────────────────────────────────────────────────

  // The window-level pointer handlers need the live resize state without being
  // re-bound on every mouse move, so it is mirrored into a ref. Kept in an
  // effect declared before the listener effect, so the ref is current by the
  // time the listeners attach.
  const resizeRef = useRef(null);
  useEffect(() => { resizeRef.current = resizing; }, [resizing]);

  /** Longest end time this card could have, given what follows it. */
  const resizeLimit = useCallback((item) => {
    const inst = columns.find((i) => i.name === item.instructorName);
    if (!inst) return item.startMin + item.duration;
    let best = item.startMin + MIN_DURATION;
    for (let end = item.startMin + MIN_DURATION; end <= timelineEnd; end += STEP) {
      const v = canOccupy(inst, item.startMin, end, {
        category: item.category,
        excludeClassKey: item.kind === 'class' ? item.cls.key : null,
        excludeSlot: item.kind === 'slot' ? item.slot : null,
      });
      if (!v.free) break;
      best = end;
    }
    return best;
  }, [columns, canOccupy, timelineEnd]);

  const commitResize = useCallback(async (item, newEnd) => {
    if (item.kind === 'slot') {
      await onMoveSlot?.(item.slot.branchId, day, item.slot.idx, {
        start: fromMinutes(item.startMin),
        end: fromMinutes(newEnd),
        instructor: item.slot.instructor,
      });
    } else {
      await onMoveClass?.(item.cls, {
        time: slotLabelFor(item.startMin, newEnd),
        teacher: item.cls.teacher,
      });
    }
  }, [onMoveSlot, onMoveClass, day]);

  const beginResize = (item, clientY) => {
    const limit = resizeLimit(item);
    setResizing({ ...item, startY: clientY, previewEnd: item.startMin + item.duration, limit });
  };

  const isResizing = !!resizing;

  // Track the pointer while a card is being resized. Bound to the window so
  // the drag survives leaving the cell.
  useEffect(() => {
    if (!isResizing) return undefined;

    const onMove = (e) => {
      const cur = resizeRef.current;
      if (!cur) return;
      const deltaRows = Math.round((e.clientY - cur.startY) / ROW_H);
      const raw = cur.startMin + cur.duration + deltaRows * STEP;
      const clamped = Math.max(cur.startMin + MIN_DURATION, Math.min(cur.limit, raw));
      if (clamped !== cur.previewEnd) setResizing({ ...cur, previewEnd: clamped });
    };

    const onUp = () => {
      const cur = resizeRef.current;
      setResizing(null);
      if (!cur || cur.previewEnd === cur.startMin + cur.duration) return;
      commitResize(cur, cur.previewEnd);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isResizing, commitResize]);

  /** Nudge a card's length by one step, for keyboard and precise changes. */
  const nudge = async (item, deltaMin) => {
    const current = item.startMin + item.duration;
    const next = current + deltaMin;
    if (next < item.startMin + MIN_DURATION) return;
    if (deltaMin > 0 && next > resizeLimit(item)) return;
    await commitResize(item, next);
  };

  // ── slot creation ──────────────────────────────────────────────────────────

  const pickerOptions = useMemo(() => {
    if (!picker) return [];
    const { instructor, startMin } = picker;
    return categoriesFor(instructor).map((category) => {
      const duration = durationForCategory(category);
      const v = canOccupy(instructor, startMin, startMin + duration, { category });
      return {
        category,
        duration,
        end: fromMinutes(startMin + duration),
        seats: maxStudentsFor(category === 'Coder' ? 'Coder' : `${category === 'Kinder' ? 'K' : 'J'}1`, rules),
        ...v,
      };
    });
  }, [picker, canOccupy, rules]);

  const confirmAdd = async (option) => {
    if (!picker || !branch || !option.free) return;
    await onAddSlot?.(branch.id, day, {
      type: slotKeyForCategory(option.category),
      start: fromMinutes(picker.startMin),
      end: option.end,
      label: '',
      instructor: picker.instructor.name,
    });
    setPicker(null);
  };

  // ── render ─────────────────────────────────────────────────────────────────

  const timeColWidth = 88;
  const colWidth = 172;

  /** Only label the hour rows, so the half-hours read as subdivisions. */
  const isHour = (mins) => mins % 60 === 0;

  return (
    <div>
      {/* Filters */}
      <div style={{
        display: 'flex', gap: '0.9rem', flexWrap: 'wrap', alignItems: 'center',
        padding: '0.9rem 1.5rem', borderBottom: '1px solid var(--border-color)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
          <Filter size={13} /> Day
        </span>
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }} role="group" aria-label="Day filter">
          {openDays.length === 0 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              No open days for this branch yet.
            </span>
          )}
          {openDays.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDayChoice(d)}
              aria-pressed={d === day}
              style={{
                borderRadius: '8px', padding: '0.35rem 0.85rem', fontSize: '0.78rem', fontWeight: 600,
                cursor: 'pointer', border: '1px solid',
                borderColor: d === day ? 'var(--primary-blue)' : 'var(--border-color)',
                background: d === day ? 'var(--primary-blue)' : 'transparent',
                color: d === day ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {d.slice(0, 3)}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.9rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            <CalendarDays size={13} /> Week of
            <input
              type="date"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              className="modal-input-field field-compact"
              title="Leave is date-specific, so the grid needs to know which week it is planning"
              style={{ width: '150px' }}
            />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            Branch
            <select
              value={branchId}
              onChange={(e) => { setBranchChoice(e.target.value); setTeacher('all'); }}
              className="modal-select-field field-compact"
              style={{ minWidth: '160px' }}
            >
              {selectable.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value="all">All Branches (view only)</option>
            </select>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            Teacher
            <select
              value={teacher}
              onChange={(e) => setTeacher(e.target.value)}
              className="modal-select-field field-compact"
              style={{ minWidth: '175px' }}
            >
              <option value="all">All Teachers ({teacherOptions.length})</option>
              {teacherOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>

      {allBranches && (
        <div style={{
          margin: '0.9rem 1.5rem 0', padding: '0.6rem 0.85rem', borderRadius: '10px',
          background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)',
          fontSize: '0.78rem', color: 'var(--text-secondary)',
        }}>
          Showing every instructor across branches. Pick a single branch to create, move or resize slots — a slot belongs to one branch.
        </div>
      )}

      {moving && (
        <div style={{
          margin: '0.9rem 1.5rem 0', padding: '0.65rem 0.9rem', borderRadius: '10px',
          background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.4)',
          display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
        }}>
          <GripVertical size={16} style={{ color: 'var(--primary-blue)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', flex: '1 1 260px' }}>
            Moving <strong>{moving.label}</strong> ({moving.duration}m) from {moving.from}. Drop it on a highlighted cell — {moveTargets.size} available.
            {moveTargets.size === 0 && ' Nothing else fits today: every other window is busy, blocked, or outside hours.'}
          </span>
          <button
            type="button"
            onClick={() => setMoving(null)}
            className="btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '8px', padding: '0.35rem 0.8rem', cursor: 'pointer' }}
          >
            <X size={13} /> Cancel
          </button>
        </div>
      )}

      {resizing && (
        <div style={{
          margin: '0.9rem 1.5rem 0', padding: '0.65rem 0.9rem', borderRadius: '10px',
          background: 'rgba(5,150,105,0.1)', border: '1px solid rgba(5,150,105,0.4)',
          fontSize: '0.78rem', color: 'var(--text-secondary)',
        }}>
          Resizing <strong>{resizing.label}</strong> — {clockLabel(resizing.startMin)} to {clockLabel(resizing.previewEnd)}
          {' '}({resizing.previewEnd - resizing.startMin}m). Release to save.
          {resizing.previewEnd === resizing.limit && ' Longest that fits here.'}
        </div>
      )}

      {/* Grid */}
      <div className="panel-body" style={{ padding: 0 }}>
        {columns.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {branch
              ? `No instructors assigned to ${branch.name}. Assign them under Instructors before planning slots.`
              : 'No instructors found.'}
          </div>
        ) : !day ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {branch ? `${branch.name} has no open days yet. Enable days above.` : 'Select a branch.'}
          </div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: '640px' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{
                    position: 'sticky', left: 0, top: 0, zIndex: 3, width: timeColWidth, minWidth: timeColWidth,
                    background: 'var(--bg-secondary, var(--card-bg))', borderBottom: '1px solid var(--border-color)',
                    borderRight: '1px solid var(--border-color)', padding: '0.7rem 0.8rem',
                    fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', textAlign: 'left',
                  }}>
                    TIME
                  </th>
                  {columns.map((inst) => {
                    const stat = load.get(inst.name);
                    return (
                      <th key={inst.name} style={{
                        position: 'sticky', top: 0, zIndex: 2, width: colWidth, minWidth: colWidth,
                        background: 'var(--bg-secondary, var(--card-bg))', borderBottom: '1px solid var(--border-color)',
                        borderRight: '1px solid var(--border-color)', padding: '0.6rem 0.7rem', textAlign: 'left', verticalAlign: 'top',
                      }}>
                        <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start' }}>
                          <span aria-hidden="true" style={{
                            flexShrink: 0, width: '22px', height: '22px', borderRadius: '6px',
                            background: 'var(--primary-blue)', color: '#fff', fontSize: '0.62rem', fontWeight: 700,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {initials(inst.name)}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', lineHeight: 1.2 }}>
                              {inst.name}
                            </span>
                            <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                              {inst.level || 'Level not set'}
                            </span>
                          </span>
                        </div>
                        {stat && (
                          <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            {stat.onLeave ? (
                              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--danger)', background: 'rgba(239,68,68,0.12)', borderRadius: '5px', padding: '0.12rem 0.35rem' }}>
                                ON LEAVE
                              </span>
                            ) : (
                              <>
                                <span title="Classes and planned slots on this day" style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-subtle, rgba(120,120,120,0.1))', borderRadius: '5px', padding: '0.12rem 0.35rem' }}>
                                  {stat.committed} booked
                                </span>
                                <span title="30-minute starting points still open to this instructor today" style={{
                                  fontSize: '0.62rem', fontWeight: 700,
                                  color: stat.free === 0 ? 'var(--danger)' : '#059669',
                                  background: stat.free === 0 ? 'rgba(239,68,68,0.12)' : 'rgba(5,150,105,0.12)',
                                  borderRadius: '5px', padding: '0.12rem 0.35rem',
                                }}>
                                  {stat.free === 0 ? 'full' : `${stat.free} open`}
                                </span>
                                {stat.hours > 0 && (
                                  <span title="Teaching hours committed on this day" style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                                    <Clock size={9} /> {stat.hours % 1 === 0 ? stat.hours : stat.hours.toFixed(1)}h
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rowStarts.map((start, rowIdx) => (
                  <tr key={start}>
                    <th scope="row" style={{
                      position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-secondary, var(--card-bg))',
                      borderBottom: `1px solid ${isHour(start) ? 'var(--border-color)' : 'transparent'}`,
                      borderRight: '1px solid var(--border-color)',
                      padding: '0 0.8rem', height: ROW_H,
                      fontSize: isHour(start) ? '0.7rem' : '0.62rem',
                      fontWeight: isHour(start) ? 700 : 500,
                      color: isHour(start) ? 'var(--text-secondary)' : 'var(--text-muted)',
                      textAlign: 'left', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {clockLabel(start)}
                    </th>
                    {columns.map((inst) => {
                      const cell = (layout.get(inst.name) || [])[rowIdx];
                      // Covered by a card spanning from an earlier row.
                      if (!cell) return null;

                      const key = `${inst.name}||${start}`;
                      const isTarget = !!moving && moveTargets.has(key);
                      const resizingThis = resizing &&
                        resizing.instructorName === inst.name && resizing.startMin === start;

                      return (
                        <td
                          key={inst.name}
                          rowSpan={cell.span}
                          onDragOver={(e) => { if (isTarget) e.preventDefault(); }}
                          onDrop={(e) => { if (isTarget) { e.preventDefault(); applyMove(inst, start); } }}
                          style={{
                            borderBottom: `1px solid ${isHour(rowStarts[rowIdx + cell.span - 1] ?? start) || cell.span > 1 ? 'var(--border-color)' : 'rgba(120,120,120,0.12)'}`,
                            borderRight: '1px solid var(--border-color)',
                            padding: '0.2rem 0.3rem', verticalAlign: 'top', height: ROW_H * cell.span,
                            background: isTarget
                              ? 'rgba(59,130,246,0.1)'
                              : cell.kind === 'unavailable' ? unavailableTint(cell.verdict.code) : 'transparent',
                          }}
                        >
                          <Cell
                            cell={cell}
                            inst={inst}
                            start={start}
                            height={ROW_H * cell.span}
                            allBranches={allBranches}
                            rules={rules}
                            saving={saving}
                            moving={moving}
                            isTarget={isTarget}
                            resizing={resizingThis ? resizing : null}
                            setPicker={setPicker}
                            onRemoveSlot={onRemoveSlot}
                            beginMoveClass={beginMoveClass}
                            beginMoveSlot={beginMoveSlot}
                            setMoving={setMoving}
                            applyMove={applyMove}
                            beginResize={beginResize}
                            nudge={nudge}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Legend */}
      {columns.length > 0 && day && (
        <div style={{
          display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center',
          padding: '0.7rem 1.5rem', borderTop: '1px solid var(--border-color)',
          fontSize: '0.72rem', color: 'var(--text-muted)',
        }}>
          {CATEGORIES.map((c) => {
            const meta = slotTypeMeta(slotKeyForCategory(c));
            return (
              <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '3px', background: meta.color }} />
                {c} · {durationForCategory(c)}m
              </span>
            );
          })}
          <span>Rows every {STEP} min</span>
          <span>Drag a card to move it · drag its bottom edge to change length</span>
          {hours && <span>Hours {hours.start}–{hours.end}</span>}
          {date && <span>Leave checked against {date}</span>}
        </div>
      )}

      {/* Category picker for the clicked cell */}
      {picker && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Open a class"
          onClick={(e) => { if (e.target === e.currentTarget) setPicker(null); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '14px',
            width: 'min(440px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 18px 45px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', padding: '1.1rem 1.2rem 0.6rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  Open a class at {clockLabel(picker.startMin)}
                </h3>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {picker.instructor.name} · {branch?.name} · {day}
                  <br />
                  {picker.instructor.level || 'Level not set'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPicker(null)}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '0.4rem 1.2rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {pickerOptions.length === 0 && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                  {picker.instructor.name} has no teachable category for this branch. Check their level under Instructors.
                </p>
              )}
              {pickerOptions.map((opt) => {
                const meta = slotTypeMeta(slotKeyForCategory(opt.category));
                return (
                  <button
                    key={opt.category}
                    type="button"
                    disabled={!opt.free || saving}
                    onClick={() => confirmAdd(opt)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.7rem', textAlign: 'left',
                      padding: '0.7rem 0.85rem', borderRadius: '10px', cursor: opt.free ? 'pointer' : 'not-allowed',
                      border: `1px solid ${opt.free ? meta.color : 'var(--border-color)'}`,
                      background: opt.free ? meta.bg : 'transparent',
                      opacity: opt.free ? 1 : 0.6,
                    }}
                  >
                    <span aria-hidden="true" style={{ width: '10px', height: '34px', borderRadius: '4px', background: opt.free ? meta.color : 'var(--border-color)', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {opt.category} · {clockLabel(picker.startMin)} – {clockLabel(picker.startMin + opt.duration)}
                      </span>
                      <span style={{ display: 'block', fontSize: '0.73rem', color: opt.free ? 'var(--text-secondary)' : 'var(--danger)' }}>
                        {opt.free ? `${opt.duration} min · up to ${opt.seats} students` : opt.reason}
                      </span>
                    </span>
                  </button>
                );
              })}

              {pickerOptions.filter((o) => o.free).length > 1 && (
                <p style={{ display: 'flex', gap: '0.4rem', margin: '0.2rem 0 0', fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                  <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                  {picker.instructor.name} can teach several of these, but only one at a time. Picking one closes the others for this window.
                </p>
              )}
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Length can be adjusted afterwards by dragging the card&apos;s bottom edge.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A resize grip pinned to the bottom edge of a card. */
function ResizeGrip({ color, onStart, onNudge, label, disabled }) {
  return (
    <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Shorten ${label} by 30 minutes`}
        onClick={() => onNudge(-30)}
        style={{ background: 'transparent', border: 'none', padding: 0, lineHeight: 0, cursor: 'pointer', color }}
      >
        <ChevronUp size={10} />
      </button>
      <span
        role="separator"
        aria-label={`Drag to resize ${label}`}
        title="Drag to change the length"
        onPointerDown={(e) => { if (!disabled) { e.preventDefault(); onStart(e.clientY); } }}
        style={{
          width: '26px', height: '4px', borderRadius: '2px', background: color, opacity: 0.55,
          cursor: disabled ? 'default' : 'ns-resize',
        }}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={`Lengthen ${label} by 30 minutes`}
        onClick={() => onNudge(30)}
        style={{ background: 'transparent', border: 'none', padding: 0, lineHeight: 0, cursor: 'pointer', color }}
      >
        <ChevronDown size={10} />
      </button>
    </span>
  );
}

/** One cell's content. */
function Cell({
  cell, inst, start, height, allBranches, rules, saving,
  moving, isTarget, resizing, setPicker, onRemoveSlot,
  beginMoveClass, beginMoveSlot, setMoving, applyMove, beginResize, nudge,
}) {
  // A legal landing spot takes over the cell while a card is in hand.
  if (isTarget) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => applyMove(inst, start)}
        title={`Move ${moving.label} here — ${clockLabel(start)}`}
        style={{
          width: '100%', height: Math.max(height - 6, 24), borderRadius: '8px', cursor: 'pointer',
          border: '1px dashed var(--primary-blue)', background: 'rgba(59,130,246,0.14)',
          color: 'var(--primary-blue)', fontSize: '0.68rem', fontWeight: 600,
        }}
      >
        Drop here
      </button>
    );
  }

  if (cell.kind === 'blocked') {
    const meta = slotTypeMeta(cell.slot.type);
    return (
      <div style={{
        height: Math.max(height - 6, 22), borderRadius: '8px',
        border: `1px solid ${meta.color}44`, background: meta.bg,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.1rem',
      }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: meta.color }}>
          {cell.slot.label || meta.label}
        </span>
        <span style={{ fontSize: '0.61rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {cell.slot.start}–{cell.slot.end}
        </span>
      </div>
    );
  }

  if (cell.kind === 'class') {
    const cls = cell.cls;
    const meta = slotTypeMeta(slotKeyForCategory(cell.category));
    const seats = maxStudentsFor(cls.programs[0] || cell.category, rules);
    const duration = (cls.endMin ?? 0) - (cls.startMin ?? 0);
    const item = {
      kind: 'class', cls, instructorName: inst.name, startMin: cls.startMin,
      duration, category: cell.category, label: [...new Set(cls.programs)].join(', ') || 'Class',
    };
    const shownEnd = resizing ? resizing.previewEnd : cls.endMin;

    return (
      <div
        draggable={!allBranches && !saving}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', cls.key);
          beginMoveClass(cls);
        }}
        onDragEnd={() => setMoving(null)}
        style={{
          position: 'relative', height: Math.max(height - 6, 30), borderRadius: '8px',
          border: `1px solid ${meta.color}`, background: meta.bg,
          padding: '0.3rem 0.4rem 0.7rem', overflow: 'hidden',
          cursor: allBranches ? 'default' : 'grab',
          outline: resizing ? `2px solid ${meta.color}` : 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          {!allBranches && <GripVertical size={11} style={{ color: meta.color, flexShrink: 0 }} aria-hidden="true" />}
          <span style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[...new Set(cls.programs)].join(', ') || 'Class'}
          </span>
        </span>
        <span style={{ display: 'block', fontSize: '0.61rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {clockLabel(cls.startMin)}–{clockLabel(shownEnd)} · {shownEnd - cls.startMin}m
        </span>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.63rem', color: 'var(--text-secondary)' }}>
            <Users size={9} /> {cls.classType}
          </span>
          <span style={{
            fontSize: '0.63rem', fontWeight: 700, color: meta.color,
            background: 'var(--card-bg)', borderRadius: '5px', padding: '0.05rem 0.28rem',
          }}>
            {cls.ids.length}/{seats} Pax
          </span>
        </span>
        {allBranches && cls.branchName && (
          <span style={{ display: 'block', fontSize: '0.6rem', color: 'var(--text-muted)' }}>{cls.branchName}</span>
        )}
        {!allBranches && (
          <ResizeGrip
            color={meta.color}
            label={item.label}
            disabled={saving || !!moving}
            onStart={(y) => beginResize(item, y)}
            onNudge={(d) => nudge(item, d)}
          />
        )}
      </div>
    );
  }

  if (cell.kind === 'planned') {
    const slot = cell.slot;
    const meta = slotTypeMeta(slot.type);
    const startMin = toMinutes(slot.start);
    const endMin = toMinutes(slot.end);
    const item = {
      kind: 'slot', slot, instructorName: inst.name, startMin,
      duration: endMin - startMin, category: meta.category, label: meta.label,
    };
    const shownEnd = resizing ? resizing.previewEnd : endMin;

    return (
      <div
        draggable={!allBranches && !saving}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `${slot.branchId}:${slot.idx}`);
          beginMoveSlot(slot);
        }}
        onDragEnd={() => setMoving(null)}
        style={{
          position: 'relative', height: Math.max(height - 6, 30), borderRadius: '8px',
          border: `1px dashed ${meta.color}`, background: 'transparent',
          padding: '0.3rem 0.4rem 0.7rem', overflow: 'hidden',
          cursor: allBranches ? 'default' : 'grab',
          outline: resizing ? `2px solid ${meta.color}` : 'none',
        }}
      >
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', minWidth: 0 }}>
            {!allBranches && <GripVertical size={11} style={{ color: meta.color, flexShrink: 0 }} aria-hidden="true" />}
            <span style={{ fontSize: '0.71rem', fontWeight: 700, color: meta.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meta.label}
            </span>
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={() => onRemoveSlot?.(slot.branchId, slot.day, slot.idx, slot)}
            title="Remove this planned slot"
            aria-label={`Remove ${meta.label} at ${slot.start}`}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 0, lineHeight: 1, flexShrink: 0 }}
          >
            <Trash2 size={11} />
          </button>
        </span>
        <span style={{ display: 'block', fontSize: '0.61rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {slot.start}–{fromMinutes(shownEnd)} · {shownEnd - startMin}m · open
        </span>
        {!allBranches && (
          <ResizeGrip
            color={meta.color}
            label={meta.label}
            disabled={saving || !!moving}
            onStart={(y) => beginResize(item, y)}
            onNudge={(d) => nudge(item, d)}
          />
        )}
      </div>
    );
  }

  if (cell.kind === 'free') {
    if (allBranches) {
      return <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', textAlign: 'center' }}>·</span>;
    }
    return (
      <button
        type="button"
        disabled={!!moving}
        onClick={() => setPicker({ instructor: inst, startMin: start })}
        title={moving
          ? `${moving.label} does not fit here`
          : `Open a class for ${inst.name} at ${clockLabel(start)} — ${cell.openable.join(' or ')}`}
        aria-label={`Open a class for ${inst.name} at ${clockLabel(start)}`}
        style={{
          width: '100%', height: Math.max(height - 6, 22), borderRadius: '7px',
          cursor: moving ? 'not-allowed' : 'pointer',
          border: '1px dashed var(--border-color)', background: 'transparent',
          color: 'var(--text-muted)', fontSize: '0.66rem',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem',
          opacity: moving ? 0.4 : 1,
        }}
      >
        <Plus size={10} /> {cell.openable.length === 1 ? cell.openable[0] : 'Add'}
      </button>
    );
  }

  // Unavailable.
  return (
    <span
      title={cell.verdict.reason}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: Math.max(height - 6, 22), fontSize: '0.63rem', lineHeight: 1.2, textAlign: 'center',
        color: cell.verdict.code === AVAIL.ON_LEAVE ? 'var(--danger)' : 'var(--text-muted)',
      }}
    >
      {shortReason(cell.verdict, start)}
    </span>
  );
}
