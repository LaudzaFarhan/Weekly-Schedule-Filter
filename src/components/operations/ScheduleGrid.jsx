'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Users, Filter, Trash2, X, CalendarDays, AlertTriangle, Clock,
  GripVertical, ChevronUp, ChevronDown, Plus, Pencil, Building2, UserPlus, Repeat,
} from 'lucide-react';
import {
  AVAIL, ATTENDANCE, availabilityFor, toMinutes, fromMinutes, clockLabel, slotLabelFor,
  overlaps, instructorsAtBranch, categoriesFor, levelCovers, weekStartISO, dateForDay, leaveOn,
  occupancyForWeek, attendsInWeek,
} from '../../lib/instructorAvailability';
import {
  SLOT_TYPES, SESSION_TYPES, slotTypeMeta, slotKeyForCategory,
  durationForCategory, isInstructorScoped,
} from '../../lib/slotTypes';
import { maxStudentsFor } from '../../lib/programRules';
import { DAY_NAMES } from '../../utils/constants';

const CATEGORIES = ['Kinder', 'Junior', 'Coder'];

/** Timeline granularity. Classes run 90 or 120 minutes, so 30 divides both. */
const STEP = 30;
/** Pixel height of one STEP row — resize maths converts drag distance with it. */
const ROW_H = 34;
/** Shortest session we will let anything be. */
const MIN_DURATION = 30;

const unavailableTint = (code) => {
  if (code === AVAIL.ON_LEAVE) return 'rgba(220,38,38,0.06)';
  if (code === AVAIL.TEACHING_ELSEWHERE) return 'rgba(124,58,237,0.06)';
  return 'transparent';
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

/** Compact cell text for a hard refusal; the full sentence is in the tooltip. */
function shortReason(code, conflict) {
  switch (code) {
    case AVAIL.ON_LEAVE: return 'On leave';
    case AVAIL.TEACHING_ELSEWHERE: return conflict?.branchName || 'Other branch';
    case AVAIL.TEACHING: return 'Teaching';
    case AVAIL.BLOCKED: return conflict?.label || slotTypeMeta(conflict?.type).label;
    case AVAIL.NO_CAPABILITY: return 'Not qualified';
    case AVAIL.NOT_AT_BRANCH: return 'Other branch';
    case AVAIL.OUTSIDE_HOURS: return 'Closed';
    default: return '—';
  }
}

/**
 * Time-by-instructor planning grid for Class Operation slots.
 *
 * Rows step every 30 minutes so 90-minute Kinder classes land as cleanly as
 * 120-minute ones. Cards span their real duration, can be dragged to another
 * time or instructor, and resized from their bottom edge. Windows too short for
 * a class stay usable for a meeting, training or break. Every verdict comes
 * from the shared availability engine.
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
  onEditSlot,
  onAddStudent,
  onRemoveStudent,
  onUpdateStudent,
}) {
  const selectable = useMemo(
    () => branches.filter((b) => b.name !== 'Default Branch'),
    [branches]
  );

  const [branchChoice, setBranchChoice] = useState('');
  const [dayChoice, setDayChoice] = useState('');
  const [teacher, setTeacher] = useState('all');
  const [week, setWeek] = useState(() => weekStartISO());
  const [picker, setPicker] = useState(null);    // { instructor, startMin, window, fits }
  const [editor, setEditor] = useState(null);    // { slot, type, start, end, label, scope }
  const [moving, setMoving] = useState(null);
  const [resizing, setResizing] = useState(null);
  // Roster is held by key, not by value, so it stays in step with the 3s poll
  // and closes itself if the last student is removed.
  const [rosterKey, setRosterKey] = useState(null);

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

  /** Sessions that block the whole branch — no instructor named. */
  const branchBlocks = useMemo(
    () => daySlots.filter((s) => !slotTypeMeta(s.type).bookable && !s.instructor),
    [daySlots]
  );

  /** Sessions belonging to one instructor: training and meetings. */
  const personalBlocks = useCallback(
    (name) => daySlots.filter((s) => !slotTypeMeta(s.type).bookable && s.instructor === name),
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

  const timelineEnd = Math.max(closeMin, (rowStarts[rowStarts.length - 1] ?? openMin) + STEP);

  const spanFor = useCallback((startIdx, endMin) => {
    let span = 1;
    for (let j = startIdx + 1; j < rowStarts.length; j += 1) {
      if (rowStarts[j] >= endMin) break;
      span += 1;
    }
    return span;
  }, [rowStarts]);

  /**
   * One availability question, asked the same way everywhere. Blocked time is
   * the branch's own plus anything personal to this instructor.
   */
  const canOccupy = useCallback((inst, startMin, endMin, opts = {}) => {
    const { category = null, excludeClassKey = null, excludeSlot = null } = opts;
    const sameSlot = (s) => excludeSlot && s.branchId === excludeSlot.branchId && s.idx === excludeSlot.idx;
    const groups = excludeClassKey
      ? classGroups.filter((g) => g.key !== excludeClassKey)
      : classGroups;
    const mine = daySlots.filter((s) =>
      s.instructor === inst.name && slotTypeMeta(s.type).bookable && !sameSlot(s)
    );
    const blocking = [
      ...branchBlocks.filter((s) => !sameSlot(s)),
      ...personalBlocks(inst.name).filter((s) => !sameSlot(s)),
    ];
    return availabilityFor(inst, {
      branchName: allBranches ? '' : branch?.name,
      day,
      startMin,
      endMin,
      category,
      classGroups: groups,
      leaves,
      date,
      blocks: blocking,
      hours,
      plannedSlots: mine,
      requireBranch: !allBranches,
    });
  }, [classGroups, daySlots, branchBlocks, personalBlocks, allBranches, branch, day, leaves, date, hours]);

  /**
   * When does this instructor's next commitment start after `from`?
   *
   * Used to describe a gap honestly. Reporting "Teaching" for a window whose
   * only obstacle is a class two hours later was misleading — the window is
   * free, just too short for a full class.
   */
  const nextObstacleAfter = useCallback((inst, from) => {
    let soonest = closeMin;
    const consider = (mins) => {
      if (mins != null && mins > from && mins < soonest) soonest = mins;
    };
    for (const s of branchBlocks) consider(toMinutes(s.start));
    for (const s of personalBlocks(inst.name)) consider(toMinutes(s.start));
    for (const s of daySlots) {
      if (s.instructor === inst.name && slotTypeMeta(s.type).bookable) consider(toMinutes(s.start));
    }
    for (const g of classGroups) {
      if (g.teacher === inst.name && g.day === day) consider(g.startMin);
    }
    return soonest;
  }, [closeMin, branchBlocks, personalBlocks, daySlots, classGroups, day]);

  /** Lay out each column, cards claiming a rowSpan for their real duration. */
  const layout = useMemo(() => {
    const out = new Map();

    for (const inst of columns) {
      const cells = new Array(rowStarts.length).fill(null);
      const mineClasses = daySlots.filter((s) => s.instructor === inst.name && slotTypeMeta(s.type).bookable);
      const mineBlocks = personalBlocks(inst.name);
      const teaching = classGroups.filter((g) => g.teacher === inst.name && g.day === day);

      let i = 0;
      while (i < rowStarts.length) {
        const start = rowStarts[i];
        const rowEnd = i + 1 < rowStarts.length ? rowStarts[i + 1] : timelineEnd;

        // Sessions win, so a break reads as a break rather than being masked
        // by a class later in the same window.
        const block = [...mineBlocks, ...branchBlocks]
          .find((s) => overlaps(start, rowEnd, toMinutes(s.start), toMinutes(s.end)));
        if (block) {
          const span = spanFor(i, toMinutes(block.end));
          cells[i] = { kind: 'session', slot: block, span, branchWide: !block.instructor };
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

        const slot = mineClasses.find((s) => overlaps(start, rowEnd, toMinutes(s.start), toMinutes(s.end)));
        if (slot) {
          const span = spanFor(i, toMinutes(slot.end));
          cells[i] = { kind: 'planned', slot, span };
          i += span;
          continue;
        }

        // Gatekeepers first, at the shortest possible session. This separates
        // "cannot be here at all" from "here, but not for long enough".
        const gate = canOccupy(inst, start, start + MIN_DURATION);
        if (!gate.free) {
          cells[i] = { kind: 'unavailable', span: 1, verdict: gate };
          i += 1;
          continue;
        }

        const window = nextObstacleAfter(inst, start) - start;
        const fits = allBranches ? [] : categoriesFor(inst)
          .filter((c) => durationForCategory(c) <= window)
          .filter((c) => canOccupy(inst, start, start + durationForCategory(c), { category: c }).free);

        cells[i] = fits.length
          ? { kind: 'free', span: 1, openable: fits, window }
          : { kind: 'short', span: 1, window };
        i += 1;
      }
      out.set(inst.name, cells);
    }
    return out;
  }, [columns, rowStarts, daySlots, classGroups, branchBlocks, personalBlocks, day, allBranches,
    canOccupy, nextObstacleAfter, spanFor, timelineEnd]);

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

  // ── moving ─────────────────────────────────────────────────────────────────

  const beginMoveClass = (cls) => setMoving({
    kind: 'class', cls, category: categoryOfProgram(cls),
    duration: (cls.endMin ?? 0) - (cls.startMin ?? 0),
    label: [...new Set(cls.programs)].join(', ') || 'Class',
    from: `${cls.teacher} · ${cls.time}`,
  });

  const beginMoveSlot = (slot) => setMoving({
    kind: 'slot', slot, category: slotTypeMeta(slot.type).category,
    duration: (toMinutes(slot.end) ?? 0) - (toMinutes(slot.start) ?? 0),
    label: slotTypeMeta(slot.type).label,
    from: `${slot.instructor || 'Whole branch'} · ${slot.start}–${slot.end}`,
  });

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

  // ── resizing ───────────────────────────────────────────────────────────────

  const resizeRef = useRef(null);
  useEffect(() => { resizeRef.current = resizing; }, [resizing]);

  const commitResize = useCallback(async (item, newEnd) => {
    if (item.kind === 'slot') {
      await onMoveSlot?.(item.slot.branchId, day, item.slot.idx, {
        start: fromMinutes(item.startMin),
        end: fromMinutes(newEnd),
        instructor: item.slot.instructor,
      });
    } else {
      await onMoveClass?.(item.cls, {
        time: slotLabelFor(item.startMin, newEnd), teacher: item.cls.teacher,
      });
    }
  }, [onMoveSlot, onMoveClass, day]);

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

  const beginResize = (item, clientY) => {
    setResizing({
      ...item, startY: clientY,
      previewEnd: item.startMin + item.duration,
      limit: resizeLimit(item),
    });
  };

  const isResizing = !!resizing;

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

  const nudge = async (item, deltaMin) => {
    const next = item.startMin + item.duration + deltaMin;
    if (next < item.startMin + MIN_DURATION) return;
    if (deltaMin > 0 && next > resizeLimit(item)) return;
    await commitResize(item, next);
  };

  // ── creating ───────────────────────────────────────────────────────────────

  const [sessionType, setSessionType] = useState('meeting');
  const [sessionMins, setSessionMins] = useState(60);
  const [sessionLabel, setSessionLabel] = useState('');

  /**
   * @param {number|null} drawnMin length drawn on the grid, or null to offer
   *   the whole gap as before.
   */
  const openPicker = useCallback((inst, startMin, cell, drawnMin = null) => {
    const gap = cell?.window || MIN_DURATION;
    // Never offer more than the gap actually allows, however far the drag went.
    const window = drawnMin ? Math.min(drawnMin, gap) : gap;
    setPicker({
      instructor: inst, startMin, window, gap, fits: cell?.openable || [],
      drawn: drawnMin ? window : null,
    });
    // Seed the session form: default to the drawn length when one was drawn,
    // otherwise the whole gap when short, or an hour when there is room.
    setSessionMins(drawnMin ? window : (window <= 60 ? window : 60));
    setSessionLabel('');
  }, []);

  // ── drag to draw a duration ────────────────────────────────────────────────
  // Press on a free cell and drag down: the length is drawn on the grid rather
  // than chosen from a list afterwards.
  const [draw, setDraw] = useState(null); // { instructorName, startIdx, endIdx }
  const drawRef = useRef(null);
  useEffect(() => { drawRef.current = draw; }, [draw]);

  /** The cells a column offers for drawing: free, or free-but-short. */
  const drawableAt = useCallback((instName, idx) => {
    const kind = (layout.get(instName) || [])[idx]?.kind;
    return kind === 'free' || kind === 'short';
  }, [layout]);

  const beginDraw = (inst, rowIdx, event) => {
    if (allBranches || moving) return;
    // Touch pointers are implicitly captured by the pressed element, which would
    // stop the cells below from ever seeing pointerenter. Releasing the capture
    // is what makes the drag work with a finger as well as a mouse.
    if (event?.pointerId != null && event.currentTarget?.releasePointerCapture) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
    }
    setDraw({ instructorName: inst.name, startIdx: rowIdx, endIdx: rowIdx });
  };

  /**
   * Extend the drawn range to `rowIdx`, but never across a row that is not
   * drawable — you cannot draw through a break or an existing class.
   */
  const extendDraw = (inst, rowIdx) => {
    const cur = drawRef.current;
    if (!cur || cur.instructorName !== inst.name) return;
    const from = cur.startIdx;
    const to = Math.max(from, rowIdx);
    for (let i = from; i <= to; i += 1) {
      if (!drawableAt(inst.name, i)) return; // clamp: stop at the obstacle
    }
    if (to !== cur.endIdx) setDraw({ ...cur, endIdx: to });
  };

  /** Minutes covered by the current drawn range. */
  const drawnDuration = useMemo(() => {
    if (!draw) return 0;
    const startMin = rowStarts[draw.startIdx];
    const lastStart = rowStarts[draw.endIdx];
    if (startMin == null || lastStart == null) return 0;
    const endMin = draw.endIdx + 1 < rowStarts.length ? rowStarts[draw.endIdx + 1] : timelineEnd;
    return Math.max(STEP, endMin - startMin);
  }, [draw, rowStarts, timelineEnd]);

  const isDrawing = !!draw;

  // Commit on release anywhere — a drag that ends off the grid should still
  // count, rather than leaving the selection stuck on screen.
  useEffect(() => {
    if (!isDrawing) return undefined;
    const onUp = () => {
      const cur = drawRef.current;
      setDraw(null);
      if (!cur) return;
      const inst = columns.find((i) => i.name === cur.instructorName);
      if (!inst) return;
      const startMin = rowStarts[cur.startIdx];
      if (startMin == null) return;
      const endMin = cur.endIdx + 1 < rowStarts.length ? rowStarts[cur.endIdx + 1] : timelineEnd;
      const drawn = Math.max(STEP, endMin - startMin);
      const cell = (layout.get(inst.name) || [])[cur.startIdx];
      // A press without a drag keeps the old behaviour: offer the whole gap.
      const drewMoreThanOneRow = cur.endIdx > cur.startIdx;
      openPicker(inst, startMin, cell, drewMoreThanOneRow ? drawn : null);
    };
    // A cancelled gesture is an abandoned one — clear it without opening
    // anything, so an interrupted drag never plants a session.
    const onCancel = () => setDraw(null);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawing, columns, rowStarts, timelineEnd, layout]);



  /** Class options, each re-checked at its real length. */
  const classOptions = useMemo(() => {
    if (!picker) return [];
    const { instructor, startMin } = picker;
    return categoriesFor(instructor).map((category) => {
      const duration = durationForCategory(category);
      const v = canOccupy(instructor, startMin, startMin + duration, { category });
      return {
        category, duration,
        end: fromMinutes(startMin + duration),
        seats: maxStudentsFor(category === 'Coder' ? 'Coder' : `${category === 'Kinder' ? 'K' : 'J'}1`, rules),
        ...v,
      };
    });
  }, [picker, canOccupy, rules]);

  /** Lengths a session could take in this gap, in 30-minute steps. */
  const sessionLengths = useMemo(() => {
    if (!picker) return [];
    // A drawn length still lists the alternatives, so the drag is a starting
    // point rather than a commitment.
    const gap = Math.max(MIN_DURATION, picker.gap || picker.window || MIN_DURATION);
    const out = [];
    for (let m = MIN_DURATION; m <= Math.min(gap, 300); m += STEP) out.push(m);
    return out;
  }, [picker]);

  const confirmAddClass = async (option) => {
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

  const confirmAddSession = async () => {
    if (!picker || !branch) return;
    const mins = Math.min(sessionMins, picker.window || sessionMins);
    await onAddSlot?.(branch.id, day, {
      type: sessionType,
      start: fromMinutes(picker.startMin),
      end: fromMinutes(picker.startMin + mins),
      label: sessionLabel.trim(),
      // A break blocks everyone, so it is stored without an instructor.
      instructor: isInstructorScoped(sessionType) ? picker.instructor.name : '',
    });
    setPicker(null);
  };

  // ── roster ─────────────────────────────────────────────────────────────────

  const roster = useMemo(
    () => classGroups.find((g) => g.key === rosterKey) || null,
    [classGroups, rosterKey]
  );

  const [newStudent, setNewStudent] = useState('');
  const [newProgram, setNewProgram] = useState('');
  const [newKind, setNewKind] = useState(ATTENDANCE.REGULAR);
  const [newDates, setNewDates] = useState([]);
  const [dateDraft, setDateDraft] = useState('');

  const openRoster = (group) => {
    setRosterKey(group.key);
    setNewStudent('');
    setNewProgram(group.programs[0] || '');
    setNewKind(ATTENDANCE.REGULAR);
    setNewDates([]);
    // A replacement usually lands in the week being planned.
    setDateDraft(dateForDay(group.day, week) || '');
  };

  const rosterSeats = roster ? maxStudentsFor(roster.programs[0] || '', rules) : 0;
  const rosterOccupancy = roster ? occupancyForWeek(roster, week) : null;

  const addDate = () => {
    if (!dateDraft || newDates.includes(dateDraft)) return;
    setNewDates([...newDates, dateDraft].sort());
  };

  const submitStudent = async () => {
    if (!roster || !newStudent.trim()) return;
    await onAddStudent?.(roster, {
      student: newStudent.trim(),
      program: (newProgram || roster.programs[0] || '').trim(),
      classType: newKind,
      sessionDates: newKind === ATTENDANCE.REGULAR ? [] : newDates,
    });
    setNewStudent('');
    setNewDates([]);
  };

  // ── editing a session ──────────────────────────────────────────────────────

  const openEditor = (slot) => setEditor({
    slot,
    type: slot.type,
    start: slot.start,
    end: slot.end,
    label: slot.label || '',
    scope: slot.instructor ? 'instructor' : 'branch',
    instructor: slot.instructor || '',
  });

  const saveEditor = async () => {
    if (!editor) return;
    if (editor.end <= editor.start) return;
    const scoped = isInstructorScoped(editor.type) && editor.scope === 'instructor';
    await onEditSlot?.(editor.slot.branchId, day, editor.slot.idx, {
      type: editor.type,
      start: editor.start,
      end: editor.end,
      label: editor.label.trim(),
      instructor: scoped ? (editor.instructor || '') : '',
    });
    setEditor(null);
  };

  // ── render ─────────────────────────────────────────────────────────────────

  const timeColWidth = 88;
  const colWidth = 172;
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
          Showing every instructor across branches. Pick a single branch to create, move or resize anything — a slot belongs to one branch.
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

      {draw && drawnDuration > 0 && (
        <div style={{
          margin: '0.9rem 1.5rem 0', padding: '0.65rem 0.9rem', borderRadius: '10px',
          background: 'rgba(5,150,105,0.1)', border: '1px solid rgba(5,150,105,0.4)',
          fontSize: '0.78rem', color: 'var(--text-secondary)',
        }}>
          Drawing <strong>{drawnDuration} min</strong> for {draw.instructorName} from{' '}
          {clockLabel(rowStarts[draw.startIdx])}. Release to choose what goes in it.
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
                  <th className="schedule-grid-sticky-col" style={{
                    position: 'sticky', left: 0, top: 0, zIndex: 3, width: timeColWidth, minWidth: timeColWidth,
                    background: 'var(--panel-bg)', borderBottom: '1px solid var(--border-color)',
                    borderRight: '1px solid var(--border-color)', padding: '0.7rem 0.8rem',
                    fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', textAlign: 'left',
                  }}>
                    TIME
                  </th>
                  {columns.map((inst) => {
                    const stat = load.get(inst.name);
                    return (
                      <th key={inst.name} className="schedule-grid-sticky-head" style={{
                        position: 'sticky', top: 0, zIndex: 2, width: colWidth, minWidth: colWidth,
                        background: 'var(--panel-bg)', borderBottom: '1px solid var(--border-color)',
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
                            <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', textTransform: 'uppercase', lineHeight: 1.2 }}>
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
                                <span title="30-minute starting points where a full class still fits" style={{
                                  fontSize: '0.62rem', fontWeight: 700,
                                  color: stat.free === 0 ? 'var(--danger)' : '#059669',
                                  background: stat.free === 0 ? 'rgba(239,68,68,0.12)' : 'rgba(5,150,105,0.12)',
                                  borderRadius: '5px', padding: '0.12rem 0.35rem',
                                }}>
                                  {stat.free === 0 ? 'no class fits' : `${stat.free} open`}
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
                    <th scope="row" className="schedule-grid-sticky-col" style={{
                      position: 'sticky', left: 0, zIndex: 1, background: 'var(--panel-bg)',
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
                      if (!cell) return null;

                      const key = `${inst.name}||${start}`;
                      const isTarget = !!moving && moveTargets.has(key);
                      const resizingThis = resizing &&
                        resizing.instructorName === inst.name && resizing.startMin === start;
                      const inDraw = !!draw && draw.instructorName === inst.name &&
                        rowIdx >= draw.startIdx && rowIdx <= draw.endIdx;
                      const drawAnchor = inDraw && rowIdx === draw.startIdx;

                      return (
                        <td
                          key={inst.name}
                          rowSpan={cell.span}
                          onDragOver={(e) => { if (isTarget) e.preventDefault(); }}
                          onDrop={(e) => { if (isTarget) { e.preventDefault(); applyMove(inst, start); } }}
                          // Extending on pointer-enter rather than tracking
                          // coordinates keeps the drag aligned to real rows.
                          onPointerEnter={() => { if (draw) extendDraw(inst, rowIdx); }}
                          style={{
                            borderBottom: `1px solid ${isHour(rowStarts[rowIdx + cell.span - 1] ?? start) || cell.span > 1 ? 'var(--border-color)' : 'rgba(120,120,120,0.12)'}`,
                            borderRight: '1px solid var(--border-color)',
                            padding: '0.2rem 0.3rem', verticalAlign: 'top', height: ROW_H * cell.span,
                            background: inDraw
                              ? 'rgba(5,150,105,0.16)'
                              : isTarget
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
                            openPicker={openPicker}
                            rowIdx={rowIdx}
                            beginDraw={beginDraw}
                            inDraw={inDraw}
                            drawAnchor={drawAnchor}
                            drawnDuration={drawnDuration}
                            openEditor={openEditor}
                            openRoster={openRoster}
                            week={week}
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
          {SESSION_TYPES.map((t) => (
            <span key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '3px', background: t.color }} />
              {t.label}
            </span>
          ))}
          <span>Rows every {STEP} min</span>
          {hours && <span>Hours {hours.start}–{hours.end}</span>}
          {date && <span>Leave checked against {date}</span>}
        </div>
      )}

      {/* Create: class or other session */}
      {picker && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Plan this time"
          onClick={(e) => { if (e.target === e.currentTarget) setPicker(null); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '16px',
              width: '100%', maxWidth: '470px', maxHeight: '92vh', overflowY: 'auto',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem',
              padding: '1.1rem 1.3rem', borderBottom: '1px solid var(--border-color)',
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>
                  Plan {clockLabel(picker.startMin)}
                </h3>
                <p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text-main)' }}>{picker.instructor.name}</strong> · {picker.instructor.level || 'Level not set'}
                  <br />
                  {branch?.name} · {day} · free for {picker.gap ?? picker.window} min
                  {picker.drawn && (
                    <>
                      {' · '}
                      <strong style={{ color: '#047857' }}>you drew {picker.drawn} min</strong>
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPicker(null)}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', lineHeight: 0, flexShrink: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1rem 1.3rem 1.3rem' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                CLASS
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {classOptions.length === 0 && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                    {picker.instructor.name} has no teachable category here. Check their level under Instructors.
                  </p>
                )}
                {classOptions.map((opt) => {
                  const meta = slotTypeMeta(slotKeyForCategory(opt.category));
                  return (
                    <button
                      key={opt.category}
                      type="button"
                      disabled={!opt.free || saving}
                      onClick={() => confirmAddClass(opt)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.7rem', textAlign: 'left',
                        padding: '0.65rem 0.8rem', borderRadius: '10px', cursor: opt.free ? 'pointer' : 'not-allowed',
                        border: `1px solid ${opt.free ? meta.color : 'var(--border-color)'}`,
                        background: opt.free ? meta.bg : 'transparent',
                        opacity: opt.free ? 1 : 0.55,
                      }}
                    >
                      <span aria-hidden="true" style={{ width: '9px', height: '32px', borderRadius: '4px', background: opt.free ? meta.color : 'var(--border-color)', flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)' }}>
                          {opt.category} · {clockLabel(picker.startMin)} – {clockLabel(picker.startMin + opt.duration)}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.73rem', color: opt.free ? 'var(--text-secondary)' : 'var(--danger)' }}>
                          {opt.free ? `${opt.duration} min · up to ${opt.seats} students` : opt.reason}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <p style={{ margin: '1.1rem 0 0.5rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                OTHER SESSION
              </p>
              <p style={{ margin: '0 0 0.6rem', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                Blocks the time instead of taking students. Useful for the gaps a full class cannot fill.
              </p>

              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                {SESSION_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSessionType(t.key)}
                    aria-pressed={sessionType === t.key}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      padding: '0.4rem 0.7rem', borderRadius: '8px', cursor: 'pointer',
                      fontSize: '0.78rem', fontWeight: 600,
                      border: `1px solid ${sessionType === t.key ? t.color : 'var(--border-color)'}`,
                      background: sessionType === t.key ? t.bg : 'transparent',
                      color: sessionType === t.key ? t.color : 'var(--text-secondary)',
                    }}
                  >
                    <span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '2px', background: t.color }} />
                    {t.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Length</label>
                  <select
                    value={sessionMins}
                    onChange={(e) => setSessionMins(parseInt(e.target.value, 10))}
                    className="modal-select-field field-compact"
                    style={{ minWidth: '120px' }}
                  >
                    {sessionLengths.map((m) => (
                      <option key={m} value={m}>{m} min{m === picker.window ? ' (whole gap)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '1 1 160px' }}>
                  <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Note (optional)</label>
                  <input
                    type="text"
                    value={sessionLabel}
                    onChange={(e) => setSessionLabel(e.target.value)}
                    placeholder={sessionType === 'meeting' ? 'e.g. Weekly sync' : 'e.g. New curriculum'}
                    className="modal-input-field field-compact"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <p style={{ margin: '0.6rem 0 0', fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                {isInstructorScoped(sessionType)
                  ? `Blocks ${picker.instructor.name} only — other instructors stay bookable.`
                  : 'A break blocks every instructor at this branch.'}
              </p>

              <button
                type="button"
                disabled={saving}
                onClick={confirmAddSession}
                className="btn btn-primary"
                style={{
                  marginTop: '0.8rem', width: '100%', borderRadius: '10px',
                  padding: '0.6rem 1rem', fontSize: '0.85rem',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                }}
              >
                <Plus size={15} /> Add {slotTypeMeta(sessionType).label} · {clockLabel(picker.startMin)}–{clockLabel(picker.startMin + Math.min(sessionMins, picker.window || sessionMins))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Class roster */}
      {roster && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Class roster"
          onClick={(e) => { if (e.target === e.currentTarget) setRosterKey(null); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '16px',
              width: '100%', maxWidth: '540px', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem',
              padding: '1.1rem 1.3rem', borderBottom: '1px solid var(--border-color)',
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>
                  {[...new Set(roster.programs)].join(', ') || 'Class'} · {roster.time}
                </h3>
                <p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text-main)' }}>{roster.teacher}</strong> · {roster.branchName} · {roster.day}
                  <br />
                  {rosterOccupancy.total}/{rosterSeats} seats for the week of {week}
                  {rosterOccupancy.guests > 0 && ` · ${rosterOccupancy.regular} regular + ${rosterOccupancy.guests} this week`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRosterKey(null)}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', lineHeight: 0, flexShrink: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1rem 1.3rem', overflowY: 'auto', flex: 1 }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                STUDENTS ({roster.members.length})
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {roster.members.map((m) => {
                  const replacement = m.classType === ATTENDANCE.REPLACEMENT;
                  const trial = m.classType === ATTENDANCE.TRIAL;
                  const tint = replacement ? '#7c3aed' : trial ? '#0891b2' : '#059669';
                  const thisWeek = attendsInWeek(m, week);
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
                        padding: '0.6rem 0.7rem', borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        background: thisWeek ? 'transparent' : 'var(--bg-color)',
                        opacity: thisWeek ? 1 : 0.65,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-main)' }}>
                            {m.student || 'Unnamed'}
                          </span>
                          <span style={{
                            fontSize: '0.63rem', fontWeight: 700, letterSpacing: '0.02em',
                            color: tint, background: `${tint}1a`,
                            borderRadius: '5px', padding: '0.1rem 0.35rem',
                            display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                          }}>
                            {replacement && <Repeat size={9} />}
                            {m.classType.toUpperCase()}
                          </span>
                          {m.program && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.program}</span>
                          )}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                          {m.classType === ATTENDANCE.REGULAR
                            ? 'Every week at this time'
                            : m.sessionDates.length
                              ? `${m.sessionDates.length} session${m.sessionDates.length === 1 ? '' : 's'}: ${m.sessionDates.join(', ')}`
                              : 'No dates recorded yet'}
                          {!thisWeek && ' · not this week'}
                        </span>
                      </span>

                      <span style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => onUpdateStudent?.(m, {
                            classType: m.classType === ATTENDANCE.REGULAR
                              ? ATTENDANCE.REPLACEMENT
                              : ATTENDANCE.REGULAR,
                            // Moving to replacement seeds the week being planned;
                            // moving back to regular clears the dates.
                            sessionDates: m.classType === ATTENDANCE.REGULAR
                              ? [dateForDay(roster.day, week)].filter(Boolean)
                              : [],
                          })}
                          title={m.classType === ATTENDANCE.REGULAR
                            ? 'Make this a one-off replacement instead'
                            : 'Make this a fixed weekly place'}
                          className="btn"
                          style={{ border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '8px', padding: '0.3rem 0.55rem', fontSize: '0.72rem', cursor: 'pointer' }}
                        >
                          {m.classType === ATTENDANCE.REGULAR ? 'To replacement' : 'To regular'}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => onRemoveStudent?.(m, roster)}
                          title={`Remove ${m.student} from this class`}
                          aria-label={`Remove ${m.student}`}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.3rem', lineHeight: 0 }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>

              <p style={{ margin: '1.1rem 0 0.5rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                ADD A STUDENT
              </p>

              {rosterOccupancy.total >= rosterSeats && (
                <p style={{ display: 'flex', gap: '0.4rem', margin: '0 0 0.5rem', fontSize: '0.75rem', color: 'var(--danger)' }}>
                  <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                  This class is at capacity for the week of {week} ({rosterOccupancy.total}/{rosterSeats}).
                </p>
              )}

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Student name</label>
                  <input
                    type="text"
                    value={newStudent}
                    onChange={(e) => setNewStudent(e.target.value)}
                    placeholder="Full name"
                    className="modal-input-field field-compact"
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ flex: '0 1 130px' }}>
                  <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Program</label>
                  <input
                    type="text"
                    value={newProgram}
                    onChange={(e) => setNewProgram(e.target.value)}
                    placeholder="e.g. K1.1"
                    className="modal-input-field field-compact"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                {[ATTENDANCE.REGULAR, ATTENDANCE.REPLACEMENT, ATTENDANCE.TRIAL].map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setNewKind(kind)}
                    aria-pressed={newKind === kind}
                    style={{
                      padding: '0.4rem 0.75rem', borderRadius: '8px', cursor: 'pointer',
                      fontSize: '0.78rem', fontWeight: 600,
                      border: `1px solid ${newKind === kind ? 'var(--primary-blue)' : 'var(--border-color)'}`,
                      background: newKind === kind ? 'rgba(59,130,246,0.1)' : 'transparent',
                      color: newKind === kind ? 'var(--primary-blue)' : 'var(--text-secondary)',
                    }}
                  >
                    {kind}
                  </button>
                ))}
              </div>

              <p style={{ margin: '0.5rem 0 0', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                {newKind === ATTENDANCE.REGULAR
                  ? 'A regular keeps this place every week — no dates needed.'
                  : `A ${newKind.toLowerCase()} attends only the dates you pick below. Add more than one for a run of sessions.`}
              </p>

              {newKind !== ATTENDANCE.REGULAR && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div>
                      <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Session date</label>
                      <input
                        type="date"
                        value={dateDraft}
                        onChange={(e) => setDateDraft(e.target.value)}
                        className="modal-input-field field-compact"
                        style={{ width: '160px' }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addDate}
                      className="btn"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '8px', padding: '0.42rem 0.8rem', fontSize: '0.78rem', cursor: 'pointer' }}
                    >
                      <Plus size={13} /> Add date
                    </button>
                  </div>

                  {newDates.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                      {newDates.map((d) => (
                        <span
                          key={d}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                            fontSize: '0.72rem', fontWeight: 600, color: '#6d28d9',
                            background: 'rgba(124,58,237,0.1)', borderRadius: '6px', padding: '0.2rem 0.45rem',
                          }}
                        >
                          {d}
                          <button
                            type="button"
                            onClick={() => setNewDates(newDates.filter((x) => x !== d))}
                            aria-label={`Remove ${d}`}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6d28d9', padding: 0, lineHeight: 0 }}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {newDates.length === 0 && (
                    <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      No dates yet — pick at least one so the class knows when they come.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: '0.6rem',
              padding: '1rem 1.3rem', borderTop: '1px solid var(--border-color)',
            }}>
              <button
                type="button"
                onClick={() => setRosterKey(null)}
                className="btn"
                style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem 1rem', fontSize: '0.82rem', cursor: 'pointer' }}
              >
                Close
              </button>
              <button
                type="button"
                disabled={saving || !newStudent.trim() ||
                  (newKind !== ATTENDANCE.REGULAR && newDates.length === 0)}
                onClick={submitStudent}
                className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.82rem' }}
              >
                <UserPlus size={14} /> Add {newKind.toLowerCase()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit an existing session */}
      {editor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit session"
          onClick={(e) => { if (e.target === e.currentTarget) setEditor(null); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '16px',
              width: '100%', maxWidth: '400px', boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem',
              padding: '1.1rem 1.3rem', borderBottom: '1px solid var(--border-color)',
            }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>
                Edit {slotTypeMeta(editor.slot.type).label}
              </h3>
              <button
                type="button"
                onClick={() => setEditor(null)}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', lineHeight: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1rem 1.3rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <div>
                <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Type</label>
                <select
                  value={editor.type}
                  onChange={(e) => setEditor({ ...editor, type: e.target.value })}
                  className="modal-select-field field-compact"
                  style={{ width: '100%' }}
                >
                  {SLOT_TYPES.filter((t) => !t.bookable).map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <div style={{ flex: 1 }}>
                  <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Start</label>
                  <input
                    type="time"
                    value={editor.start}
                    onChange={(e) => setEditor({ ...editor, start: e.target.value })}
                    className="modal-input-field field-compact"
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>End</label>
                  <input
                    type="time"
                    value={editor.end}
                    onChange={(e) => setEditor({ ...editor, end: e.target.value })}
                    className={`modal-input-field field-compact ${editor.end <= editor.start ? 'error' : ''}`}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              {editor.end <= editor.start && (
                <span style={{ fontSize: '0.72rem', color: 'var(--danger)' }}>End must be after start.</span>
              )}

              <div>
                <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Note</label>
                <input
                  type="text"
                  value={editor.label}
                  onChange={(e) => setEditor({ ...editor, label: e.target.value })}
                  placeholder="Optional"
                  className="modal-input-field field-compact"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label className="modal-form-label" style={{ fontSize: '0.72rem' }}>Applies to</label>
                {isInstructorScoped(editor.type) ? (
                  <select
                    value={editor.scope}
                    onChange={(e) => setEditor({ ...editor, scope: e.target.value })}
                    className="modal-select-field field-compact"
                    style={{ width: '100%' }}
                  >
                    <option value="instructor">
                      {editor.instructor || 'This instructor'} only
                    </option>
                    <option value="branch">Every instructor at {branch?.name}</option>
                  </select>
                ) : (
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Building2 size={13} /> A break always applies to the whole branch.
                  </p>
                )}
              </div>
            </div>

            <div style={{
              display: 'flex', justifyContent: 'space-between', gap: '0.6rem',
              padding: '1rem 1.3rem', borderTop: '1px solid var(--border-color)',
            }}>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  await onRemoveSlot?.(editor.slot.branchId, day, editor.slot.idx, editor.slot);
                  setEditor(null);
                }}
                className="btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', border: '1px solid rgba(239,68,68,0.5)', background: 'transparent', color: 'var(--danger)', borderRadius: '10px', padding: '0.5rem 1rem', fontSize: '0.82rem', cursor: 'pointer' }}
              >
                <Trash2 size={14} /> Delete
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="btn"
                  style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.5rem 1rem', fontSize: '0.82rem', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || editor.end <= editor.start}
                  onClick={saveEditor}
                  className="btn btn-primary"
                  style={{ borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.82rem' }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A resize grip pinned to the bottom edge of a card. */
function ResizeGrip({ color, onStart, onNudge, label, disabled }) {
  // The card itself is clickable now, so every control here has to stop the
  // click from bubbling or resizing would also open the roster.
  const stop = (e) => e.stopPropagation();
  return (
    <span
      onClick={stop}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={`Shorten ${label} by 30 minutes`}
        onClick={(e) => { stop(e); onNudge(-30); }}
        style={{ background: 'transparent', border: 'none', padding: 0, lineHeight: 0, cursor: 'pointer', color }}
      >
        <ChevronUp size={10} />
      </button>
      <span
        role="separator"
        aria-label={`Drag to resize ${label}`}
        title="Drag to change the length"
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.stopPropagation();
          onStart(e.clientY);
        }}
        style={{
          width: '26px', height: '4px', borderRadius: '2px', background: color, opacity: 0.55,
          cursor: disabled ? 'default' : 'ns-resize',
        }}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={`Lengthen ${label} by 30 minutes`}
        onClick={(e) => { stop(e); onNudge(30); }}
        style={{ background: 'transparent', border: 'none', padding: 0, lineHeight: 0, cursor: 'pointer', color }}
      >
        <ChevronDown size={10} />
      </button>
    </span>
  );
}

/** One cell's content. */
function Cell({
  cell, inst, start, height, allBranches, rules, saving, week,
  moving, isTarget, resizing, openPicker, openEditor, openRoster, onRemoveSlot,
  beginMoveClass, beginMoveSlot, setMoving, applyMove, beginResize, nudge,
  rowIdx, beginDraw, inDraw, drawAnchor, drawnDuration,
}) {
  const boxH = Math.max(height - 6, 22);

  if (isTarget) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => applyMove(inst, start)}
        title={`Move ${moving.label} here — ${clockLabel(start)}`}
        style={{
          width: '100%', height: boxH, borderRadius: '8px', cursor: 'pointer',
          border: '1px dashed var(--primary-blue)', background: 'rgba(59,130,246,0.14)',
          color: 'var(--primary-blue)', fontSize: '0.68rem', fontWeight: 600,
        }}
      >
        Drop here
      </button>
    );
  }

  // Break / training / meeting.
  if (cell.kind === 'session') {
    const slot = cell.slot;
    const meta = slotTypeMeta(slot.type);
    const startMin = toMinutes(slot.start);
    const endMin = toMinutes(slot.end);
    const personal = !cell.branchWide;
    const item = {
      kind: 'slot', slot, instructorName: inst.name, startMin,
      duration: endMin - startMin, category: null, label: meta.label,
    };
    const shownEnd = resizing ? resizing.previewEnd : endMin;

    return (
      <div
        // Only a personal session can be dragged: a branch-wide break appears
        // in every column, so dragging it from one would be misleading.
        draggable={!allBranches && personal && !saving}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `${slot.branchId}:${slot.idx}`);
          beginMoveSlot(slot);
        }}
        onDragEnd={() => setMoving(null)}
        style={{
          position: 'relative', height: boxH, borderRadius: '8px',
          border: `1px solid ${meta.color}55`, background: meta.bg,
          padding: '0.25rem 0.4rem 0.7rem', overflow: 'hidden',
          cursor: allBranches ? 'default' : (personal ? 'grab' : 'default'),
          outline: resizing ? `2px solid ${meta.color}` : 'none',
        }}
      >
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.2rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem', minWidth: 0 }}>
            {!allBranches && personal && <GripVertical size={10} style={{ color: meta.color, flexShrink: 0 }} aria-hidden="true" />}
            <span style={{ fontSize: '0.71rem', fontWeight: 700, color: meta.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {slot.label || meta.label}
            </span>
          </span>
          {!allBranches && (
            <button
              type="button"
              disabled={saving || !!moving}
              onClick={() => openEditor(slot)}
              title={cell.branchWide
                ? 'Edit this break — it applies to the whole branch'
                : `Edit this ${meta.label.toLowerCase()}`}
              aria-label={`Edit ${meta.label} at ${slot.start}`}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: meta.color, padding: 0, lineHeight: 1, flexShrink: 0 }}
            >
              <Pencil size={11} />
            </button>
          )}
        </span>
        <span style={{ display: 'block', fontSize: '0.61rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {slot.start}–{fromMinutes(shownEnd)} · {shownEnd - startMin}m
        </span>
        {cell.branchWide && boxH > 46 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem', fontSize: '0.58rem', color: 'var(--text-muted)' }}>
            <Building2 size={8} /> whole branch
          </span>
        )}
        {!allBranches && personal && (
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

  if (cell.kind === 'class') {
    const cls = cell.cls;
    const meta = slotTypeMeta(slotKeyForCategory(cell.category));
    const seats = maxStudentsFor(cls.programs[0] || cell.category, rules);
    const occ = occupancyForWeek(cls, week);
    const item = {
      kind: 'class', cls, instructorName: inst.name, startMin: cls.startMin,
      duration: (cls.endMin ?? 0) - (cls.startMin ?? 0),
      category: cell.category, label: [...new Set(cls.programs)].join(', ') || 'Class',
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
        onClick={() => { if (!allBranches) openRoster(cls); }}
        role={allBranches ? undefined : 'button'}
        tabIndex={allBranches ? undefined : 0}
        onKeyDown={(e) => {
          if (allBranches) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRoster(cls); }
        }}
        title={allBranches ? undefined : 'Open the roster — add or remove students'}
        style={{
          position: 'relative', height: boxH, borderRadius: '8px',
          border: `1px solid ${meta.color}`, background: meta.bg,
          padding: '0.3rem 0.4rem 0.7rem', overflow: 'hidden',
          cursor: allBranches ? 'default' : 'pointer',
          outline: resizing ? `2px solid ${meta.color}` : 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          {!allBranches && <GripVertical size={11} style={{ color: meta.color, flexShrink: 0 }} aria-hidden="true" />}
          <span style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[...new Set(cls.programs)].join(', ') || 'Class'}
          </span>
        </span>
        <span style={{ display: 'block', fontSize: '0.61rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {clockLabel(cls.startMin)}–{clockLabel(shownEnd)} · {shownEnd - cls.startMin}m
        </span>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.63rem', color: 'var(--text-secondary)' }}>
            <Users size={9} /> {occ.regular} reg
            {occ.guests > 0 && <span style={{ color: '#6d28d9', fontWeight: 700 }}>+{occ.guests}</span>}
          </span>
          <span style={{
            fontSize: '0.63rem', fontWeight: 700, color: meta.color,
            background: 'var(--panel-bg)', borderRadius: '5px', padding: '0.05rem 0.28rem',
          }}>
            {occ.total}/{seats} Pax
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
          position: 'relative', height: boxH, borderRadius: '8px',
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

  // A full class fits here.
  if (cell.kind === 'free') {
    if (allBranches) {
      return <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', textAlign: 'center' }}>·</span>;
    }
    return (
      <button
        type="button"
        disabled={!!moving}
        // Press starts a draw; a press without movement still opens the picker
        // on release, so clicking behaves exactly as it did before.
        onPointerDown={(e) => { if (!moving && e.button === 0) beginDraw(inst, rowIdx, e); }}
        // Keyboard activation produces a click with detail 0 and no pointer
        // events at all, so it needs its own way in.
        onClick={(e) => { if (!moving && e.detail === 0) openPicker(inst, start, cell); }}
        title={moving
          ? `${moving.label} does not fit here`
          : `Plan ${clockLabel(start)} for ${inst.name} — ${cell.openable.join(' or ')}, free for ${cell.window} min. Drag down to set the length.`}
        aria-label={`Plan ${clockLabel(start)} for ${inst.name}`}
        className="grid-add-slot"
        style={{
          width: '100%', height: boxH, borderRadius: '7px',
          cursor: moving ? 'not-allowed' : (inDraw ? 'ns-resize' : 'pointer'),
          border: `1px ${inDraw ? 'solid' : 'dashed'} rgba(5,150,105,${inDraw ? 0.9 : 0.5})`,
          background: inDraw ? 'rgba(5,150,105,0.2)' : 'rgba(5,150,105,0.07)',
          color: '#047857', fontSize: '0.68rem', fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem',
          opacity: moving ? 0.35 : 1,
          touchAction: 'none',
        }}
      >
        {inDraw
          ? (drawAnchor ? `${drawnDuration} min` : '')
          : <><Plus size={11} strokeWidth={2.5} /> {cell.openable.length === 1 ? cell.openable[0] : 'Add'}</>}
      </button>
    );
  }

  // Free, but no full class fits. Still usable for a meeting or training, so
  // it stays clickable rather than reading as a dead end.
  if (cell.kind === 'short') {
    if (allBranches) {
      return <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', textAlign: 'center' }}>·</span>;
    }
    return (
      <button
        type="button"
        disabled={!!moving}
        onPointerDown={(e) => { if (!moving && e.button === 0) beginDraw(inst, rowIdx, e); }}
        onClick={(e) => { if (!moving && e.detail === 0) openPicker(inst, start, cell); }}
        title={moving
          ? `${moving.label} does not fit here`
          : `Free for ${cell.window} min — too short for a class, but fine for a meeting, training or break. Drag down to set the length.`}
        aria-label={`Plan a ${cell.window} minute session for ${inst.name} at ${clockLabel(start)}`}
        className="grid-short-slot"
        style={{
          width: '100%', height: boxH, borderRadius: '7px',
          cursor: moving ? 'not-allowed' : (inDraw ? 'ns-resize' : 'pointer'),
          border: `1px ${inDraw ? 'solid' : 'dashed'} ${inDraw ? 'rgba(5,150,105,0.9)' : 'var(--border-color)'}`,
          background: inDraw ? 'rgba(5,150,105,0.2)' : 'transparent',
          color: inDraw ? '#047857' : 'var(--text-muted)', fontSize: '0.63rem',
          fontWeight: inDraw ? 700 : 500,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem',
          opacity: moving ? 0.35 : 1,
          touchAction: 'none',
        }}
      >
        {inDraw
          ? (drawAnchor ? `${drawnDuration} min` : '')
          : `${cell.window} min free`}
      </button>
    );
  }

  // Genuinely unavailable.
  const notable = cell.verdict.code === AVAIL.ON_LEAVE ||
    cell.verdict.code === AVAIL.TEACHING_ELSEWHERE;
  return (
    <span
      title={cell.verdict.reason}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: boxH, fontSize: '0.62rem', lineHeight: 1.2, textAlign: 'center',
        fontWeight: notable ? 600 : 400,
        color: cell.verdict.code === AVAIL.ON_LEAVE ? 'var(--danger)' : 'var(--text-muted)',
        opacity: notable ? 0.95 : 0.55,
      }}
    >
      {shortReason(cell.verdict.code, cell.verdict.conflict)}
    </span>
  );
}
