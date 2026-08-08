'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Users, Filter, Trash2, X, CalendarDays, CalendarPlus, AlertTriangle, Clock,
  GripVertical, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Plus, Pencil, Building2, UserPlus, Repeat, FileText, UserX, Sparkles, Send, Calendar, Eye, User,
} from 'lucide-react';
import {
  getProgressUpdateStatus,
  PROGRESS_UPDATE_STATUSES,
  PROGRESS_UPDATE_BADGES,
} from '../../utils/progressUpdateUtils';
import {
  AVAIL, ATTENDANCE, isExpired, isoOf, availabilityFor, toMinutes, fromMinutes, clockLabel, slotLabelFor,
  overlaps, instructorsAtBranch, categoriesFor, levelCovers, weekStartISO, dateForDay,
  nextDateForDay, leaveOn, occupancyForWeek, attendsInWeek,
} from '../../lib/instructorAvailability';
import {
  SLOT_TYPES, SESSION_TYPES, slotTypeMeta, slotKeyForCategory,
  durationForCategory, isInstructorScoped, getCategoryColorStyle,
} from '../../lib/slotTypes';
import { maxStudentsFor } from '../../lib/programRules';
import { DAY_NAMES, isSameBranch, DEFAULT_BRANCH_LIST } from '../../utils/constants';
import { isSameTeacher } from '../../utils/instructorUtils';

const CATEGORIES = ['Kinder', 'Junior', 'Coder'];

/** Timeline granularity. Classes run 90 or 120 minutes, so 30 divides both. */
const STEP = 30;

/** Pixel height of one STEP row — resize maths converts drag distance with it. */
const ROW_H = 34;
/** Shortest session we will let anything be. */
const MIN_DURATION = 30;

/** Cell kinds that draw as a solid card, as opposed to an empty or blocked slot. */
const CARD_KINDS = new Set(['class', 'planned', 'session']);

/**
 * How tall a card has to be before START/END edge labels are worth drawing.
 * Three rows (90 min) is the shortest real class, and the shortest card that
 * still has room for the labels without squeezing the details.
 */
const EDGE_MARK_MIN_SPAN = 3;

/**
 * Shortest length anything may be booked as a *class*.
 *
 * Derived from the shortest standard class length rather than fixed, so it
 * follows the duration rules instead of drifting from them. A drag shorter than
 * this is a session — break, training, meeting — not a class: a 30-minute
 * "class" is not a thing the school runs.
 */
const MIN_CLASS_DURATION = Math.min(...CATEGORIES.map(durationForCategory));

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

function instructorHasLevel(instructor, levelCategory, classGroups) {
  if (!levelCategory || levelCategory === 'all') return true;
  if (!instructor) return false;

  if (levelCovers(instructor.level, levelCategory)) return true;

  if (Array.isArray(classGroups)) {
    const hasMatchingClass = classGroups.some((g) => {
      if (g.teacher !== instructor.name) return false;
      const progs = Array.isArray(g.programs) ? g.programs : [g.program];
      return progs.some((p) => {
        const str = String(p || '').toLowerCase();
        if (levelCategory === 'Kinder' && (str.includes('kinder') || /^kf?\d/i.test(str))) return true;
        if (levelCategory === 'Junior' && (str.includes('junior') || /^jf?\d/i.test(str))) return true;
        if (levelCategory === 'Coder' && (str.includes('coder') || /^c\d/i.test(str))) return true;
        return false;
      });
    });
    if (hasMatchingClass) return true;
  }

  return false;
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
  liveProgress = [],
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
  /** Opens a student's report card by NAME; absent when navigation is unavailable. */
  onOpenStudentReport,
  onUpdateStudent,
}) {
  const liveProgressMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(liveProgress)) {
      for (const p of liveProgress) {
        if (p.studentName) {
          map.set(String(p.studentName).toLowerCase().trim(), p);
        }
      }
    }
    return map;
  }, [liveProgress]);

  const selectable = useMemo(() => {
    const list = branches.filter((b) => b.name !== 'Default Branch');
    return list.length ? list : DEFAULT_BRANCH_LIST;
  }, [branches]);

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
  // Selected class for right side preview panel
  const [previewClass, setPreviewClass] = useState(null);

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
      const filtered = DAY_NAMES.filter((d) => set.has(d));
      return filtered.length ? filtered : DAY_NAMES;
    }
    if (!branch) return DAY_NAMES;
    const days = DAY_NAMES.filter((d) => draft[branch.id]?.has(d));
    return days.length ? days : DAY_NAMES;
  }, [allBranches, selectable, branch, draft]);

  const day = DAY_NAMES.includes(dayChoice) ? dayChoice : (DAY_NAMES[0] || 'Monday');

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

  const pool = useMemo(() => {
    return allBranches ? instructors : instructorsAtBranch(instructors, branch?.name, classGroups);
  }, [allBranches, instructors, branch, classGroups]);

  const columns = useMemo(() => {
    const sorted = [...pool].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (teacher === 'all') return sorted;
    if (teacher === 'Kinder' || teacher === 'Junior' || teacher === 'Coder') {
      return sorted.filter((i) => instructorHasLevel(i, teacher, classGroups));
    }
    return sorted.filter((i) => isSameTeacher(i.name, teacher));
  }, [pool, teacher, classGroups]);

  const teacherOptions = useMemo(() => {
    return [...pool].map((i) => i.name).sort((a, b) => String(a).localeCompare(String(b)));
  }, [pool]);

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
      if (!columns.some((i) => isSameTeacher(i.name, g.teacher))) continue;
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
      isSameTeacher(s.instructor, inst.name) && slotTypeMeta(s.type).bookable && !sameSlot(s)
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
      if (isSameTeacher(s.instructor, inst.name) && slotTypeMeta(s.type).bookable) consider(toMinutes(s.start));
    }
    for (const g of classGroups) {
      if (isSameTeacher(g.teacher, inst.name) && g.day === day) consider(g.startMin);
    }
    return soonest;
  }, [closeMin, branchBlocks, personalBlocks, daySlots, classGroups, day]);

  /** Lay out each column, cards claiming a rowSpan for their real duration. */
  const layout = useMemo(() => {
    const out = new Map();

    for (const inst of columns) {
      const cells = new Array(rowStarts.length).fill(null);
      const mineClasses = daySlots.filter((s) => isSameTeacher(s.instructor, inst.name) && slotTypeMeta(s.type).bookable);
      const mineBlocks = personalBlocks(inst.name);
      const teaching = classGroups.filter((g) => isSameTeacher(g.teacher, inst.name) && g.day === day);

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

      // Two cards can sit back to back with no gap: one ends at 2:30 and the
      // next starts at 2:30. Their shared edge draws as a single straight line,
      // so the pair reads as one block and neither end time is legible. Flag
      // both sides so the boundary can be drawn as a step instead.
      // Both cards have to be tall enough to carry edge labels in the first
      // place: the tab hangs into the next card, and a one-row card would be
      // almost entirely covered by it.
      for (let k = 0; k < cells.length; k += 1) {
        const c = cells[k];
        if (!c || !CARD_KINDS.has(c.kind) || c.span < EDGE_MARK_MIN_SPAN) continue;
        const next = cells[k + c.span];
        if (next && CARD_KINDS.has(next.kind) && next.span >= EDGE_MARK_MIN_SPAN) {
          c.buttedNext = true;
          next.buttedPrev = true;
        }
      }

      out.set(inst.name, cells);
    }
    return out;
  }, [columns, rowStarts, daySlots, classGroups, branchBlocks, personalBlocks, day, allBranches,
    canOccupy, nextObstacleAfter, spanFor, timelineEnd]);

  const load = useMemo(() => {
    const out = new Map();
    for (const inst of columns) {
      const teaching = classGroups.filter((g) => isSameTeacher(g.teacher, inst.name) && g.day === day);
      const planned = daySlots.filter((s) => isSameTeacher(s.instructor, inst.name) && slotTypeMeta(s.type).bookable);
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
    // A new drag replaces whatever was selected, so two highlights never compete.
    setSelection(null);
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

  /**
   * Minutes covered by a row range. Shared by the in-progress drag and the
   * selection it leaves behind, so the two can never report different lengths
   * for the same rows.
   */
  const rangeMinutes = useCallback((startIdx, endIdx) => {
    const startMin = rowStarts[startIdx];
    if (startMin == null || rowStarts[endIdx] == null) return 0;
    const endMin = endIdx + 1 < rowStarts.length ? rowStarts[endIdx + 1] : timelineEnd;
    return Math.max(STEP, endMin - startMin);
  }, [rowStarts, timelineEnd]);

  /**
   * How many timeline rows a range covers.
   *
   * Counted from the row indices rather than divided out of the duration: the
   * last row can be short where the branch closes mid-step, and dividing would
   * then report a fraction of a row.
   */
  const rangeRows = (startIdx, endIdx) => endIdx - startIdx + 1;

  const drawnDuration = useMemo(
    () => (draw ? rangeMinutes(draw.startIdx, draw.endIdx) : 0),
    [draw, rangeMinutes]
  );
  const drawnRows = draw ? rangeRows(draw.startIdx, draw.endIdx) : 0;

  const isDrawing = !!draw;

  // ── the selection a finished drag leaves behind ─────────────────────────────
  // Releasing marks the rows out and stops there. Nothing is asked of the user
  // until they press Edit: drawing a length and deciding what goes in it are two
  // separate decisions, and a modal appearing on release forced them together.
  const [selection, setSelection] = useState(null); // { instructorName, startIdx, endIdx }

  const selDuration = useMemo(
    () => (selection ? rangeMinutes(selection.startIdx, selection.endIdx) : 0),
    [selection, rangeMinutes]
  );
  const selRows = selection ? rangeRows(selection.startIdx, selection.endIdx) : 0;

  const clearSelection = useCallback(() => setSelection(null), []);

  /** Open the picker for the current selection — the Edit trigger. */
  const editSelection = useCallback(() => {
    if (!selection) return;
    const inst = columns.find((i) => i.name === selection.instructorName);
    if (!inst) return;
    const startMin = rowStarts[selection.startIdx];
    if (startMin == null) return;
    const cell = (layout.get(inst.name) || [])[selection.startIdx];
    // A single-row selection offers the whole gap, as a plain click always has;
    // a longer one offers the length that was actually drawn.
    const drawn = selection.endIdx > selection.startIdx
      ? rangeMinutes(selection.startIdx, selection.endIdx)
      : null;
    openPicker(inst, startMin, cell, drawn);
  }, [selection, columns, rowStarts, layout, rangeMinutes, openPicker]);

  // Release anywhere ends the drag — one that finishes off the grid should still
  // register, rather than leaving the highlight stuck to the cursor.
  useEffect(() => {
    if (!isDrawing) return undefined;
    const onUp = () => {
      const cur = drawRef.current;
      setDraw(null);
      if (!cur) return;
      const inst = columns.find((i) => i.name === cur.instructorName);
      if (!inst || rowStarts[cur.startIdx] == null) return;
      setSelection({
        instructorName: cur.instructorName,
        startIdx: cur.startIdx,
        endIdx: cur.endIdx,
      });
    };
    // A cancelled gesture is an abandoned one — clear it without selecting
    // anything, so an interrupted drag never leaves a stray highlight.
    const onCancel = () => setDraw(null);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [isDrawing, columns, rowStarts]);

  // Escape drops the selection, matching the rest of the app.
  useEffect(() => {
    if (!selection || picker) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') clearSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, picker, clearSelection]);



  /** Class options, each re-checked at its real length. */
  const classOptions = useMemo(() => {
    if (!picker) return [];
    const { instructor, startMin, drawn } = picker;
    const out = [];
    for (const category of categoriesFor(instructor)) {
      const standard = durationForCategory(category);
      // The length that was drawn is offered alongside the category's standard
      // one. Without this, drawing 90 minutes for a Junior or Coder instructor
      // left every class option disabled — both default to 120, neither fits a
      // 90-minute window — so the only bookable things were break, training and
      // meeting. Drawing a length should let you book a class at that length.
      const lengths = [...new Set([drawn, standard].filter((m) => m && m >= MIN_CLASS_DURATION))];
      for (const duration of lengths) {
        const v = canOccupy(instructor, startMin, startMin + duration, { category });
        out.push({
          key: `${category}-${duration}`,
          category,
          duration,
          isStandard: duration === standard,
          end: fromMinutes(startMin + duration),
          seats: maxStudentsFor(category === 'Coder' ? 'Coder' : `${category === 'Kinder' ? 'K' : 'J'}1`, rules),
          ...v,
        });
      }
    }
    // Bookable options lead; the order within a category is otherwise preserved,
    // so the drawn length sits ahead of the standard one.
    return out.sort((a, b) => (a.free === b.free ? 0 : a.free ? -1 : 1));
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
  /** Today, for telling a spent dated place from a current one. */
  const todayISO = useMemo(() => isoOf(new Date()), []);

  const openRoster = (group) => {
    setRosterKey(group.key);
    setNewStudent('');
    setNewProgram(group.programs[0] || '');
    setNewKind(ATTENDANCE.REGULAR);
    setNewDates([]);
    // The occurrence being planned, but never one already gone: this week's
    // Wednesday is in the past by Friday, and a date-specific place seeded there
    // would be expired the moment it was saved.
    const planned = dateForDay(group.day, week);
    const today = isoOf(new Date());
    setDateDraft(((planned && planned >= today) ? planned : nextDateForDay(group.day)) || '');
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

  // ── horizontal scroll affordance ────────────────────────────────────────────
  // With more instructors than fit, the columns off to the right are invisible
  // and there is nothing to suggest they exist — the sticky time column hides
  // the usual clue that the table is wider than its box.
  const scrollerRef = useRef(null);
  const [scrollNav, setScrollNav] = useState({ left: false, right: false, hidden: 0 });

  const syncScrollNav = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // A pixel of slack: fractional layout widths otherwise leave the arrow
    // showing at the very end of the scroll.
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft < max - 1;
    // How many instructor columns are still out of view, so the hint can say
    // what is over there rather than just pointing. Rounded up: a column only
    // half in view is one you still cannot read, and rounding down reported
    // "0 more" while the arrow was still offering to scroll.
    const hidden = Math.max(0, Math.ceil((max - el.scrollLeft) / colWidth));
    setScrollNav((prev) => (
      prev.left === left && prev.right === right && prev.hidden === hidden
        ? prev
        : { left, right, hidden }
    ));
  }, [colWidth]);

  // Re-measure when the box or the number of columns changes, not just on scroll:
  // collapsing the sidebar or filtering to one teacher both change whether there
  // is anything left to scroll to.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    syncScrollNav();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(syncScrollNav)
      : null;
    observer?.observe(el);
    window.addEventListener('resize', syncScrollNav);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncScrollNav);
    };
  }, [syncScrollNav, columns.length, rowStarts.length]);

  /** Scroll by roughly a screenful, but always a whole number of columns. */
  const scrollByColumns = (direction) => {
    const el = scrollerRef.current;
    if (!el) return;
    const perScreen = Math.max(1, Math.floor((el.clientWidth - timeColWidth) / colWidth) - 1);
    el.scrollBy({ left: direction * perScreen * colWidth, behavior: 'smooth' });
  };
  const isHour = (mins) => mins % 60 === 0;

  return (
    <div>
      {/* Filters */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '0.75rem',
        padding: '0.9rem 1.5rem', borderBottom: '1px solid var(--border-color)',
      }}>
        {/* Row 1: Day Filter */}
        <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', alignItems: 'center', width: '100%' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', minWidth: '68px' }}>
            <Filter size={13} /> Day
          </span>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }} role="group" aria-label="Day filter">
            {DAY_NAMES.map((d) => (
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
        </div>

        {/* Row 2: Program Filter Pills (Left) & Controls (Right) - 1 horizontal line */}
        <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', minWidth: '68px' }}>
            Program
          </span>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }} role="group" aria-label="Program level filter">
            {[
              { id: 'all', label: 'All', color: 'var(--primary-blue)', bg: 'var(--primary-blue)', textColor: '#fff' },
              { id: 'Kinder', label: 'K', color: '#d97706', bg: '#fef08a', textColor: '#78350f', border: '#f59e0b' },
              { id: 'Junior', label: 'J', color: '#00c7d4', bg: '#00FFFF', textColor: '#082f49', border: '#00e5ff' },
              { id: 'Coder', label: 'C', color: '#60a5fa', bg: '#1e3a8a', textColor: '#ffffff', border: '#1e40af' },
            ].map((cat) => {
              const isSelected = teacher === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setTeacher(cat.id)}
                  aria-pressed={isSelected}
                  title={cat.id === 'all' ? 'All Programs' : `${cat.id} Class`}
                  style={{
                    borderRadius: '8px', padding: '0.35rem 0.85rem', fontSize: '0.78rem', fontWeight: 700,
                    cursor: 'pointer', border: '1px solid',
                    borderColor: isSelected ? (cat.border || cat.color) : 'var(--border-color)',
                    background: isSelected ? cat.bg : 'transparent',
                    color: isSelected ? cat.textColor : 'var(--text-secondary)',
                    boxShadow: isSelected ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.15s ease-in-out',
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
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
              Level
              <select
                value={teacher}
                onChange={(e) => setTeacher(e.target.value)}
                className="modal-select-field field-compact"
                style={{ minWidth: '175px' }}
              >
                <option value="all">All Levels ({pool.length})</option>
                <optgroup label="Filter by Level">
                  <option value="Kinder">Kinder</option>
                  <option value="Junior">Junior</option>
                  <option value="Coder">Coder</option>
                </optgroup>
                <optgroup label="Filter by Teacher">
                  {teacherOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                </optgroup>
              </select>
            </label>
          </div>
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
          Drawing <strong>{drawnRows} row{drawnRows === 1 ? '' : 's'}</strong> ={' '}
          <strong>{drawnDuration} min</strong> for {draw.instructorName} from{' '}
          {clockLabel(rowStarts[draw.startIdx])} to{' '}
          {clockLabel(rowStarts[draw.startIdx] + drawnDuration)}.
          Release to keep it.
        </div>
      )}

      {/* A finished selection sits here waiting. Nothing is filled in until Edit
          is pressed, so the drag can be adjusted or abandoned first. */}
      {selection && !draw && selDuration > 0 && (
        <div style={{
          margin: '0.9rem 1.5rem 0', padding: '0.65rem 0.9rem', borderRadius: '10px',
          background: 'rgba(5,150,105,0.1)', border: '1px solid rgba(5,150,105,0.4)',
          fontSize: '0.78rem', color: 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
        }}>
          <span style={{ flex: 1, minWidth: '12rem' }}>
            Selected <strong>{selRows} row{selRows === 1 ? '' : 's'}</strong> ={' '}
            <strong>{selDuration} min</strong> for {selection.instructorName},{' '}
            {clockLabel(rowStarts[selection.startIdx])}–
            {clockLabel(rowStarts[selection.startIdx] + selDuration)}.
          </span>
          <button
            type="button"
            onClick={editSelection}
            title="Choose what goes in the selected time"
            className="btn btn-primary"
            style={{
              borderRadius: '8px', padding: '0.35rem 0.8rem', fontSize: '0.76rem',
              display: 'inline-flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0,
            }}
          >
            <Pencil size={13} /> Edit
          </button>
          <button
            type="button"
            onClick={clearSelection}
            title="Drop the selection (Esc)"
            style={{
              border: '1px solid var(--border-color)', background: 'transparent',
              borderRadius: '8px', padding: '0.35rem 0.7rem', fontSize: '0.76rem',
              color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0,
            }}
          >
            Clear
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
          <div style={{ position: 'relative' }}>
          {/* Edge fades sit above the table but must not eat clicks meant for
              the cells underneath, hence pointer-events: none. */}
          {scrollNav.left && (
            <div aria-hidden="true" style={{
              position: 'absolute', top: 0, bottom: 0, left: timeColWidth, width: '38px',
              zIndex: 4, pointerEvents: 'none',
              background: 'linear-gradient(to right, var(--panel-bg), transparent)',
            }} />
          )}
          {scrollNav.right && (
            <div aria-hidden="true" style={{
              position: 'absolute', top: 0, bottom: 0, right: 0, width: '48px',
              zIndex: 4, pointerEvents: 'none',
              background: 'linear-gradient(to left, var(--panel-bg), transparent)',
            }} />
          )}

          {scrollNav.left && (
            <button
              type="button"
              onClick={() => scrollByColumns(-1)}
              className="grid-scroll-nav"
              title="Scroll left"
              aria-label="Scroll the grid left"
              style={{ left: `${timeColWidth + 6}px` }}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {scrollNav.right && (
            <button
              type="button"
              onClick={() => scrollByColumns(1)}
              className="grid-scroll-nav grid-scroll-nav-right"
              title={scrollNav.hidden > 0
                ? `Scroll right — about ${scrollNav.hidden} more instructor${scrollNav.hidden === 1 ? '' : 's'} this way`
                : 'Scroll right for more instructors'}
              aria-label="Scroll the grid right for more instructors"
              style={{ right: '10px' }}
            >
              <ChevronRight size={18} />
              {scrollNav.hidden > 0 && (
                <span className="grid-scroll-nav-count">{scrollNav.hidden}</span>
              )}
            </button>
          )}

          <div
            ref={scrollerRef}
            onScroll={syncScrollNav}
            style={{ overflow: 'auto', maxHeight: '640px' }}
          >
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
                    {/* Above the butted cells below, which take z-index 1 so their
                        seam chip can straddle the edge between them. */}
                    <th scope="row" className="schedule-grid-sticky-col" style={{
                      position: 'sticky', left: 0, zIndex: 2, background: 'var(--panel-bg)',
                      // A row's bottom rule is the gridline for the time that starts
                      // the *next* row, so its weight follows that time, not this one.
                      borderBottom: `1px solid ${isHour(start + STEP) ? 'var(--border-color)' : 'rgba(120,120,120,0.12)'}`,
                      borderRight: '1px solid var(--border-color)',
                      padding: '0 0.8rem', verticalAlign: 'top', height: ROW_H,
                      fontSize: isHour(start) ? '0.7rem' : '0.62rem',
                      fontWeight: isHour(start) ? 700 : 500,
                      color: isHour(start) ? 'var(--text-secondary)' : 'var(--text-muted)',
                      textAlign: 'left', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {/*
                        Centred on the gridline it names, not inside the row below it.
                        A card running 2:30–4:30 has its bottom edge on the 4:30 line;
                        with the label sitting under that line, "4:00 PM" was the last
                        label inside the card and it read as ending at 4:00. On the
                        line, the card visibly spans label to label.
                        The first row is left alone — there is no gridline above it to
                        straddle, and half the label would fall outside the table.
                      */}
                      <span style={{ display: 'inline-block', transform: rowIdx === 0 ? 'none' : 'translateY(-50%)' }}>
                        {clockLabel(start)}
                      </span>
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
                      const inSel = !draw && !!selection && selection.instructorName === inst.name &&
                        rowIdx >= selection.startIdx && rowIdx <= selection.endIdx;
                      // The two halves of the selection chip sit at opposite ends of
                      // the block: the size reads as a heading on the first row, and
                      // the Edit trigger as a footer on the last. On a single-row
                      // selection both land on the same row and render side by side.
                      const selSummaryRow = inSel && rowIdx === selection.startIdx;
                      const selEditRow = inSel && rowIdx === selection.endIdx;

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
                            // Same convention as the time column: this rule is the
                            // gridline for the time the next row starts, so its
                            // weight follows that time. A multi-row cell always
                            // gets the strong rule, since its edge is a real end.
                            borderBottom: `1px solid ${isHour(rowStarts[rowIdx + cell.span] ?? timelineEnd) || cell.span > 1 ? 'var(--border-color)' : 'rgba(120,120,120,0.12)'}`,
                            borderRight: '1px solid var(--border-color)',
                            padding: '0.2rem 0.3rem', verticalAlign: 'top', height: ROW_H * cell.span,
                            // Back-to-back cards meet on the gridline, so the
                            // padding between them goes. The seam chip straddles
                            // that edge and the cell below comes later in the
                            // DOM, so the upper cell needs lifting.
                            // The gridline goes too: the two card borders meeting
                            // there already draw the divider, in both colours, so
                            // it says whose time ends and whose begins.
                            ...(cell.buttedNext
                              ? { paddingBottom: 0, borderBottomColor: 'transparent', position: 'relative', zIndex: 1 }
                              : null),
                            ...(cell.buttedPrev ? { paddingTop: 0 } : null),
                            background: inDraw
                              ? 'rgba(5,150,105,0.16)'
                              // A settled selection reads slightly stronger than
                              // one still being dragged, so "kept" is distinct
                              // from "in progress".
                              : inSel
                                ? 'rgba(5,150,105,0.22)'
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
                            liveProgressMap={liveProgressMap}
                            resizing={resizingThis ? resizing : null}
                            openPicker={openPicker}
                            rowIdx={rowIdx}
                            beginDraw={beginDraw}
                            inDraw={inDraw}
                            drawAnchor={drawAnchor}
                            drawnDuration={drawnDuration}
                            drawnRows={drawnRows}
                            inSel={inSel}
                            selSummaryRow={selSummaryRow}
                            selEditRow={selEditRow}
                            selStart={inSel ? rowStarts[selection.startIdx] : null}
                            selDuration={selDuration}
                            selRows={selRows}
                            onEditSelection={editSelection}
                            openEditor={openEditor}
                            openRoster={openRoster}
                            onPreviewClass={(c) => setPreviewClass(c)}
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
          </div>

          {/* Right Side Class Preview Panel */}
          {previewClass && (() => {
            const meta = getCategoryColorStyle(categoryOfProgram(previewClass) || 'Kinder');
            const seats = maxStudentsFor(previewClass.programs[0] || 'Kinder', rules);
            const occ = occupancyForWeek(previewClass, week);

            return (
              <div style={{
                width: '380px', flexShrink: 0, display: 'flex', flexDirection: 'column',
                border: '1.5px solid var(--border-color)', borderRadius: '14px', background: 'var(--panel-bg)',
                boxShadow: '0 10px 30px rgba(0,0,0,0.15)', overflow: 'hidden', minHeight: '500px', margin: '0 1rem 1rem 0',
              }}>
                {/* Header */}
                <div style={{
                  padding: '1rem 1.2rem', borderBottom: '1px solid var(--border-color)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                  background: meta.bg,
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 800, color: meta.textColor }}>
                        {previewClass.programs.join(', ') || 'Class'}
                      </span>
                      <span style={{
                        fontSize: '0.66rem', fontWeight: 700, padding: '0.12rem 0.45rem', borderRadius: '6px',
                        color: meta.textColor, background: meta.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.06)',
                      }}>
                        {occ.total}/{seats} Pax
                      </span>
                    </div>
                    <p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem', color: meta.textColor, opacity: 0.9, lineHeight: 1.4 }}>
                      <strong style={{ color: meta.textColor }}>{previewClass.teacher}</strong> · {day}
                      <br />
                      {clockLabel(previewClass.startMin)} – {clockLabel(previewClass.endMin)} ({previewClass.endMin - previewClass.startMin}m)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewClass(null)}
                    aria-label="Close preview"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: meta.textColor, padding: '0.2rem', lineHeight: 0 }}
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Student List */}
                <div style={{ padding: '1rem 1.2rem', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                      Enrolled Students ({previewClass.members.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => { openRoster(previewClass); }}
                      style={{
                        fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary-blue)', background: 'transparent',
                        border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                      }}
                    >
                      <Pencil size={12} /> Full Roster Modal
                    </button>
                  </div>

                  {previewClass.members.length === 0 ? (
                    <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', border: '1px dashed var(--border-color)', borderRadius: '10px' }}>
                      No students enrolled in this class yet.
                    </div>
                  ) : (
                    previewClass.members.map((m) => {
                      const isIzin = m.isIzin || m.notArranged || (m.remarks || '').toLowerCase().includes('izin');
                      const progRecord = liveProgressMap?.get ? liveProgressMap.get(String(m.student || '').toLowerCase().trim()) : null;
                      const progressStatus = getProgressUpdateStatus(m, progRecord);
                      const badgeInfo = PROGRESS_UPDATE_BADGES[progressStatus];

                      return (
                        <div
                          key={m.id}
                          style={{
                            padding: '0.7rem 0.85rem', borderRadius: '10px',
                            border: '1px solid var(--border-color)', background: 'var(--bg-color)',
                            display: 'flex', flexDirection: 'column', gap: '0.4rem',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <User size={14} style={{ color: 'var(--text-muted)' }} />
                              {m.student}
                            </div>
                            <span style={{
                              fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '5px',
                              color: isIzin ? '#b45309' : '#047857', background: isIzin ? '#fef3c7' : 'rgba(16,185,129,0.12)',
                            }}>
                              {isIzin ? 'Izin' : m.classType || 'Regular'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                            <span>Program: <strong style={{ color: 'var(--text-main)' }}>{m.program}</strong></span>
                            {badgeInfo && (
                              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: badgeInfo.color, background: badgeInfo.bg, border: `1px solid ${badgeInfo.borderColor}`, padding: '0.05rem 0.35rem', borderRadius: '4px' }}>
                                {badgeInfo.label}
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.2rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => onUpdateStudent?.(m, { isIzin: !isIzin, notArranged: !isIzin, remarks: !isIzin ? 'Izin' : '' })}
                              style={{
                                padding: '0.25rem 0.55rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                                border: '1px solid ' + (isIzin ? '#f59e0b' : 'var(--border-color)'),
                                background: isIzin ? '#fef3c7' : 'transparent', color: isIzin ? '#b45309' : 'var(--text-secondary)',
                              }}
                            >
                              {isIzin ? 'Mark Attending' : 'Mark Izin'}
                            </button>

                            {onOpenStudentReport && m.student && (
                              <button
                                type="button"
                                onClick={() => onOpenStudentReport(m.student)}
                                style={{
                                  padding: '0.25rem 0.55rem', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
                                  border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)',
                                  display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                                }}
                              >
                                <FileText size={11} /> Report
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => onRemoveStudent?.(m, { day, teacher: previewClass.teacher })}
                              style={{
                                padding: '0.25rem 0.55rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                                border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: 'var(--danger)',
                                marginLeft: 'auto',
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
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
                BOOK A CLASS
              </p>
              <p style={{ margin: '0 0 0.6rem', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                Opens a class {picker.instructor.name.split(' ')[0]} can teach, ready to take students.
                {picker.drawn && ' The length you drew is offered alongside the standard one.'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {classOptions.length === 0 && categoriesFor(picker.instructor).length === 0 && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                    {picker.instructor.name} has no teachable category here. Check their level under Instructors.
                  </p>
                )}
                {/* Every category refused is worth calling out plainly, since the
                    section would otherwise look like a list of dead buttons. */}
                {classOptions.length > 0 && classOptions.every((o) => !o.free) && (
                  <p style={{ fontSize: '0.76rem', color: 'var(--danger)', margin: 0 }}>
                    No class fits this time. Widen the selection, or use a session below.
                  </p>
                )}
                {/* A drag shorter than the shortest class cannot be one, so say
                    so rather than showing an empty section. */}
                {classOptions.length === 0 && categoriesFor(picker.instructor).length > 0 && (
                  <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', margin: 0 }}>
                    {picker.drawn} min is shorter than the shortest class ({MIN_CLASS_DURATION} min).
                    Draw a longer selection to book a class, or use a session below.
                  </p>
                )}
                {classOptions.map((opt) => {
                  const meta = slotTypeMeta(slotKeyForCategory(opt.category));
                  return (
                    <button
                      key={opt.key}
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
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)' }}>
                          {opt.category} · {clockLabel(picker.startMin)} – {clockLabel(picker.startMin + opt.duration)}
                          {/* Which length this is, so a non-standard one is a
                              deliberate choice rather than a surprise. */}
                          <span style={{
                            fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.02em',
                            padding: '0.05rem 0.35rem', borderRadius: '5px', whiteSpace: 'nowrap',
                            color: opt.isStandard ? 'var(--text-muted)' : '#047857',
                            background: opt.isStandard ? 'var(--bg-color)' : 'rgba(5,150,105,0.14)',
                          }}>
                            {opt.isStandard ? 'STANDARD' : 'YOUR LENGTH'}
                          </span>
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
              width: '100%', maxWidth: '780px', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem',
              padding: '1.1rem 1.3rem', borderBottom: '1px solid var(--border-color)',
            }}>
              {(() => {
                const izinCount = roster.members.filter((m) => m.notArranged || m.isIzin || (typeof m.remarks === 'string' && m.remarks.toLowerCase().includes('izin'))).length;
                const attendingCount = Math.max(0, rosterOccupancy.total - izinCount);
                const openReplacementSeats = Math.max(0, rosterSeats - attendingCount);

                return (
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      {[...new Set(roster.programs)].join(', ') || 'Class'} · {roster.time}
                    </h3>
                    <p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--text-main)' }}>{roster.teacher}</strong> · {roster.branchName} · {roster.day}
                      <br />
                      <strong style={{ color: openReplacementSeats > 0 ? '#059669' : 'var(--text-main)' }}>
                        {attendingCount}/{rosterSeats} Attending
                      </strong>
                      {izinCount > 0 && (
                        <span style={{ color: '#b45309', fontWeight: 600, marginLeft: '0.4rem' }}>
                          ({izinCount} Izin · {openReplacementSeats} Replacement Seat{openReplacementSeats === 1 ? '' : 's'} Open)
                        </span>
                      )}
                    </p>
                  </div>
                );
              })()}
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
              {(() => {
                const izinCount = roster.members.filter((m) => m.notArranged || m.isIzin || (typeof m.remarks === 'string' && m.remarks.toLowerCase().includes('izin'))).length;
                const attendingCount = Math.max(0, rosterOccupancy.total - izinCount);
                const openReplacementSeats = Math.max(0, rosterSeats - attendingCount);

                return (
                  <>
                    <p style={{ margin: '0 0 0.5rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                      STUDENTS ({roster.members.length})
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      {roster.members.map((m) => {
                        const replacement = m.classType === ATTENDANCE.REPLACEMENT;
                        const additional = m.classType === ATTENDANCE.ADDITIONAL;
                        const trial = m.classType === ATTENDANCE.TRIAL;
                        const isIzin = !!(m.isIzin || m.notArranged || (typeof m.remarks === 'string' && m.remarks.toLowerCase().includes('izin')));
                        const tint = isIzin ? '#b45309' : replacement ? '#7c3aed' : additional ? '#0891b2' : trial ? '#ea580c' : '#059669';
                        const thisWeek = attendsInWeek(m, week);
                        const spent = isExpired(m, todayISO);

                        const progRecord = liveProgressMap?.get ? liveProgressMap.get(String(m.student || '').toLowerCase().trim()) : null;
                        const progressStatus = getProgressUpdateStatus(m, progRecord);
                        const badgeInfo = progressStatus ? PROGRESS_UPDATE_BADGES[progressStatus] : null;

                        return (
                          <div
                            key={m.id}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '0.75rem',
                              padding: '0.65rem 0.8rem', borderRadius: '10px',
                              border: isIzin ? '1px dashed #f59e0b' : '1px solid var(--border-color)',
                              background: isIzin ? 'rgba(254, 243, 199, 0.25)' : thisWeek ? 'transparent' : 'var(--bg-color)',
                              opacity: spent ? 0.5 : (thisWeek || isIzin) ? 1 : 0.65,
                            }}
                          >
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <span style={{
                                  fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-main)',
                                  textDecoration: (spent || isIzin) ? 'line-through' : 'none',
                                }}>
                                  {m.student || 'Unnamed'}
                                </span>
                                {isIzin ? (
                                  <span style={{
                                    fontSize: '0.63rem', fontWeight: 700, letterSpacing: '0.02em',
                                    color: '#b45309', background: '#fde68a', border: '1px solid #f59e0b',
                                    borderRadius: '5px', padding: '0.1rem 0.35rem',
                                    display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                                  }}>
                                    <UserX size={9} /> IZIN (ON LEAVE)
                                  </span>
                                ) : (
                                  <span style={{
                                    fontSize: '0.63rem', fontWeight: 700, letterSpacing: '0.02em',
                                    color: tint, background: `${tint}1a`,
                                    borderRadius: '5px', padding: '0.1rem 0.35rem',
                                    display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                                  }}>
                                    {replacement && <Repeat size={9} />}
                                    {additional && <CalendarPlus size={9} />}
                                    {m.classType.toUpperCase()}
                                  </span>
                                )}
                                {m.program && (
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                    {m.program}
                                    {(m.term || (m.remarks && /Term\s*[1-4]/i.test(m.remarks))) && (
                                      <span style={{
                                        fontSize: '0.62rem',
                                        fontWeight: 700,
                                        color: '#7c3aed',
                                        background: 'rgba(124, 58, 237, 0.08)',
                                        border: '1px solid rgba(124, 58, 237, 0.2)',
                                        borderRadius: '4px',
                                        padding: '0.05rem 0.3rem',
                                      }}>
                                        {m.term || (m.remarks?.match(/Term\s*[1-4]/i)?.[0])}
                                      </span>
                                    )}
                                  </span>
                                )}

                                {badgeInfo && (
                                  <span
                                    style={{
                                      fontSize: '0.63rem',
                                      fontWeight: 700,
                                      letterSpacing: '0.02em',
                                      color: badgeInfo.color,
                                      background: badgeInfo.bg,
                                      border: `1px solid ${badgeInfo.borderColor}`,
                                      borderRadius: '5px',
                                      padding: '0.1rem 0.35rem',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.2rem',
                                    }}
                                  >
                                    {progressStatus === 'Need update progress' && <Clock size={9} />}
                                    {progressStatus === 'Update Offer' && <Send size={9} />}
                                    {progressStatus === 'Update Scheduled' && <Calendar size={9} />}
                                    {badgeInfo.label}
                                  </span>
                                )}
                              </span>
                              <span style={{ display: 'block', fontSize: '0.72rem', color: isIzin ? '#b45309' : 'var(--text-secondary)', marginTop: '0.15rem' }}>
                                {isIzin ? 'On Leave for this week · Open replacement seat available' : m.classType === ATTENDANCE.REGULAR
                                  ? 'Every week at this time'
                                  : m.sessionDates.length
                                    ? `${m.sessionDates.length} session${m.sessionDates.length === 1 ? '' : 's'}: ${m.sessionDates.join(', ')}`
                                    : 'No dates recorded yet'}
                                {spent ? ' · past, off the schedule' : (!thisWeek && !isIzin) ? ' · not this week' : ''}
                              </span>
                            </span>

                            <span style={{ display: 'flex', gap: '0.3rem', flexShrink: 0, alignItems: 'center' }}>
                              <select
                                value={progressStatus || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  onUpdateStudent?.(m, { progressUpdateStatus: val || 'Completed' });
                                }}
                                title="Update progress tracking status"
                                style={{
                                  border: '1px solid var(--border-color)',
                                  background: 'var(--bg-color)',
                                  color: 'var(--text-secondary)',
                                  borderRadius: '8px',
                                  padding: '0.25rem 0.45rem',
                                  fontSize: '0.71rem',
                                  cursor: 'pointer',
                                }}
                              >
                                <option value="">Progress: None</option>
                                <option value="Need update progress">Need update progress</option>
                                <option value="Update Offer">Update Offer</option>
                                <option value="Update Scheduled">Update Scheduled</option>
                                <option value="Completed">Completed / Clear</option>
                              </select>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => onUpdateStudent?.(m, {
                                  isIzin: !isIzin,
                                  notArranged: !isIzin,
                                  remarks: !isIzin ? 'Izin' : '',
                                })}
                                title={isIzin ? 'Mark as Present / Attending' : 'Mark as Izin (Not attending this week)'}
                                className="btn"
                                style={{
                                  border: '1px solid',
                                  borderColor: isIzin ? '#f59e0b' : 'var(--border-color)',
                                  background: isIzin ? '#fef3c7' : 'transparent',
                                  color: isIzin ? '#b45309' : 'var(--text-secondary)',
                                  borderRadius: '8px', padding: '0.3rem 0.55rem', fontSize: '0.72rem', fontWeight: 600,
                                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                }}
                              >
                                <UserX size={12} /> {isIzin ? 'Izin' : 'Izin'}
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => onUpdateStudent?.(m, {
                                  classType: m.classType === ATTENDANCE.REGULAR
                                    ? ATTENDANCE.REPLACEMENT
                                    : ATTENDANCE.REGULAR,
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
                              {onOpenStudentReport && m.student && (
                                <button
                                  type="button"
                                  onClick={() => onOpenStudentReport(m.student)}
                                  title={`Open ${m.student}'s report card`}
                                  aria-label={`Report card for ${m.student}`}
                                  className="btn"
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                    border: '1px solid var(--border-color)', background: 'transparent',
                                    color: 'var(--text-secondary)', borderRadius: '8px',
                                    padding: '0.3rem 0.55rem', fontSize: '0.72rem', cursor: 'pointer',
                                  }}
                                >
                                  <FileText size={12} aria-hidden="true" /> Report
                                </button>
                              )}
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

                    {openReplacementSeats > 0 && (
                      <div style={{
                        margin: '0.5rem 0 0.8rem', padding: '0.65rem 0.85rem', borderRadius: '8px',
                        background: 'rgba(16, 185, 129, 0.12)', border: '1px solid #10b981',
                        fontSize: '0.78rem', color: '#047857', display: 'flex', alignItems: 'center', gap: '0.5rem',
                      }}>
                        <Sparkles size={16} style={{ flexShrink: 0, color: '#10b981' }} />
                        <span>
                          <strong>{openReplacementSeats} Replacement Seat{openReplacementSeats === 1 ? '' : 's'} Open!</strong> {izinCount} student{izinCount === 1 ? ' is' : 's are'} on Izin this week. You can add a replacement student to fill this slot.
                        </span>
                      </div>
                    )}

                    {attendingCount >= rosterSeats && openReplacementSeats === 0 && (
                      <p style={{ display: 'flex', gap: '0.4rem', margin: '0 0 0.5rem', fontSize: '0.75rem', color: 'var(--danger)' }}>
                        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                        This class is at capacity for the week of {week} ({attendingCount}/{rosterSeats}).
                      </p>
                    )}
                  </>
                );
              })()}

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
                {[ATTENDANCE.REGULAR, ATTENDANCE.REPLACEMENT, ATTENDANCE.ADDITIONAL, ATTENDANCE.TRIAL].map((kind) => (
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
                  : newKind === ATTENDANCE.REPLACEMENT
                    ? 'A replacement sits here instead of their own regular week, only on the dates below. It drops off the schedule once the last one passes.'
                    : newKind === ATTENDANCE.ADDITIONAL
                      ? 'An extra session on top of whatever else they attend, so a week can hold more than one. Add several dates for a run.'
                      : 'A trial attends only the dates you pick below.'}
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

/** Vertical padding inside a grid cell, in px — `0.2rem`, spelled out for maths. */
const CELL_PAD_Y = 3.2;

/** Height of the chip that sits on the seam between two back-to-back cards. */
const SEAM_CHIP_H = 15;

/**
 * Labels pinned to the card's own top and bottom edges.
 *
 * Back-to-back cards are the awkward case: one ends at 2:30 and the next starts
 * at 2:30. The two cards are drawn touching, with their facing corners squared,
 * so the pair reads as one unbroken run of time — which is what it is. The shared
 * instant is printed once on a chip straddling the seam, so END and START are not
 * fighting for the same line and the time is not stated twice.
 *
 * Hidden from assistive tech: the card already states the range in text, and
 * repeating it would just be noise.
 */
function EdgeMarks({ color, textColor, startLabel, endLabel, gripped, buttedNext, buttedPrev, isDark }) {
  const markColor = textColor || color;
  const band = {
    position: 'absolute', pointerEvents: 'none', left: 0, right: 0,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.3rem',
    padding: '0 0.4rem', lineHeight: 1,
    fontSize: '0.5rem', fontWeight: 800, letterSpacing: '0.09em',
    color: markColor, opacity: 0.9, fontVariantNumeric: 'tabular-nums',
  };
  return (
    <>
      <span aria-hidden="true" style={{ ...band, top: '3px' }}>
        <span>START</span>
        {/* The seam chip above already carries this time. */}
        {!buttedPrev && <span style={{ opacity: 0.85 }}>{startLabel}</span>}
      </span>

      {/* Sits above the resize grip band so the two never overlap. */}
      <span aria-hidden="true" style={{ ...band, bottom: gripped ? '12px' : '3px' }}>
        <span>END</span>
        {!buttedNext && <span style={{ opacity: 0.85 }}>{endLabel}</span>}
      </span>

      {buttedNext && (
        // Straddles the shared edge, half in each card. Opaque so the seam does
        // not read through it.
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', pointerEvents: 'none',
            right: '0.45rem', bottom: `-${SEAM_CHIP_H / 2}px`, height: `${SEAM_CHIP_H}px`,
            display: 'inline-flex', alignItems: 'center', padding: '0 0.4rem',
            borderRadius: '999px', border: `1px solid ${color || markColor}`,
            background: isDark ? '#1e293b' : 'var(--panel-bg)',
            fontSize: '0.5rem', fontWeight: 800, letterSpacing: '0.06em',
            color: isDark ? '#ffffff' : markColor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            zIndex: 3,
          }}
        >
          {endLabel}
        </span>
      )}
    </>
  );
}

/**
 * Card padding that leaves room for the edge labels when they are drawn.
 * Without them the padding is unchanged from before, so short cards look the same.
 */
function cardPadding(edgeMarks, gripped) {
  if (!edgeMarks) return '0.3rem 0.4rem 0.7rem';
  return `0.95rem 0.4rem ${gripped ? '1.4rem' : '0.85rem'}`;
}

/**
 * Corner radii. A card touching another one squares the facing corners so the
 * pair draws as a single continuous block instead of two lozenges with a pinch
 * between them.
 */
function cardRadius(buttedPrev, buttedNext) {
  const top = buttedPrev ? '0' : '8px';
  const bottom = buttedNext ? '0' : '8px';
  return `${top} ${top} ${bottom} ${bottom}`;
}

/** One cell's content. */
function Cell({
  cell, inst, start, height, allBranches, rules, saving, week, liveProgressMap,
  moving, isTarget, resizing, openPicker, openEditor, openRoster, onPreviewClass, onRemoveSlot,
  beginMoveClass, beginMoveSlot, setMoving, applyMove, beginResize, nudge,
  rowIdx, beginDraw, inDraw, drawAnchor, drawnDuration, drawnRows,
  inSel, selSummaryRow, selEditRow, selStart, selDuration, selRows, onEditSelection,
}) {
  // Back-to-back cards give up the cell padding on the side they touch, so their
  // edges meet on the gridline instead of leaving a 6px pinch between them. The
  // cell drops the same padding, so nothing overflows.
  const bleed = (cell.buttedPrev ? CELL_PAD_Y : 0) + (cell.buttedNext ? CELL_PAD_Y : 0);
  const boxH = Math.max(height - 2 * CELL_PAD_Y + bleed, 22);
  // What the drag reports back while it is in progress. Rows lead because that is
  // what the gesture is actually doing; the minutes are the consequence. Shown on
  // the row the drag started from only, so it is not repeated down the selection.
  const drawLabel = `${drawnRows} row${drawnRows === 1 ? '' : 's'} · ${drawnDuration} min`;

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
    const gripped = !allBranches && personal;
    const edgeMarks = cell.span >= EDGE_MARK_MIN_SPAN;

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
          position: 'relative', height: boxH, borderRadius: cardRadius(cell.buttedPrev, cell.buttedNext),
          border: `1px solid ${meta.color}55`, background: meta.bg,
          padding: edgeMarks ? cardPadding(true, gripped) : '0.25rem 0.4rem 0.7rem',
          // The seam chip has to be allowed past the card's own edge.
          overflow: cell.buttedNext ? 'visible' : 'hidden',
          cursor: allBranches ? 'default' : (personal ? 'grab' : 'default'),
          outline: resizing ? `2px solid ${meta.color}` : 'none',
        }}
      >
        {edgeMarks && (
          <EdgeMarks
            color={meta.color}
            startLabel={slot.start}
            endLabel={fromMinutes(shownEnd)}
            gripped={gripped}
            buttedNext={cell.buttedNext}
            buttedPrev={cell.buttedPrev}
          />
        )}
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
    const meta = getCategoryColorStyle(cell.category);
    const seats = maxStudentsFor(cls.programs[0] || cell.category, rules);
    const occ = occupancyForWeek(cls, week);
    const item = {
      kind: 'class', cls, instructorName: inst.name, startMin: cls.startMin,
      duration: (cls.endMin ?? 0) - (cls.startMin ?? 0),
      category: cell.category, label: [...new Set(cls.programs)].join(', ') || 'Class',
    };
    const shownEnd = resizing ? resizing.previewEnd : cls.endMin;
    const gripped = !allBranches;
    const edgeMarks = cell.span >= EDGE_MARK_MIN_SPAN;

    return (
      <div
        draggable={!allBranches && !saving}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', cls.key);
          beginMoveClass(cls);
        }}
        onDragEnd={() => setMoving(null)}
        onClick={() => {
          if (!allBranches) {
            if (onPreviewClass) onPreviewClass(cls);
            else openRoster(cls);
          }
        }}
        role={allBranches ? undefined : 'button'}
        tabIndex={allBranches ? undefined : 0}
        onKeyDown={(e) => {
          if (allBranches) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (onPreviewClass) onPreviewClass(cls);
            else openRoster(cls);
          }
        }}
        title={allBranches ? undefined : 'Click to preview class & students'}
        style={{
          position: 'relative', height: boxH, borderRadius: cardRadius(cell.buttedPrev, cell.buttedNext),
          border: `1px solid ${meta.border || meta.color}`, background: meta.bg,
          padding: cardPadding(edgeMarks, gripped),
          overflow: cell.buttedNext ? 'visible' : 'hidden',
          cursor: allBranches ? 'default' : 'pointer',
          outline: resizing ? `2px solid ${meta.border || meta.color}` : 'none',
        }}
      >
        {edgeMarks && (
          <EdgeMarks
            color={meta.border || meta.color}
            textColor={meta.textColor}
            startLabel={clockLabel(cls.startMin)}
            endLabel={clockLabel(shownEnd)}
            gripped={gripped}
            buttedNext={cell.buttedNext}
            buttedPrev={cell.buttedPrev}
            isDark={meta.isDark}
          />
        )}
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', minWidth: 0 }}>
            {!allBranches && <GripVertical size={11} style={{ color: meta.textColor, flexShrink: 0 }} aria-hidden="true" />}
            <span style={{ fontSize: '0.73rem', fontWeight: 700, color: meta.textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[...new Set(cls.programs)].join(', ') || 'Class'}
            </span>
          </span>
          {!allBranches && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openRoster(cls);
              }}
              title="Open full student management tab"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                padding: '0.1rem 0.35rem', borderRadius: '4px', cursor: 'pointer',
                fontSize: '0.6rem', fontWeight: 700, border: '1px solid ' + (meta.border || meta.color),
                background: meta.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.9)',
                color: meta.textColor, flexShrink: 0,
              }}
            >
              <Eye size={10} /> Show
            </button>
          )}
        </span>
        <span style={{ display: 'block', fontSize: '0.61rem', color: meta.subtextColor || 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {clockLabel(cls.startMin)}–{clockLabel(shownEnd)} · {shownEnd - cls.startMin}m
        </span>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.63rem', color: meta.subtextColor || 'var(--text-secondary)' }}>
            <Users size={9} /> {occ.regular} reg
            {occ.guests > 0 && <span style={{ color: meta.isDark ? '#e9d5ff' : '#6d28d9', fontWeight: 700 }}>+{occ.guests}</span>}
          </span>
          <span style={{
            fontSize: '0.63rem', fontWeight: 700, color: meta.textColor,
            background: meta.isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.06)', borderRadius: '5px', padding: '0.05rem 0.28rem',
          }}>
            {occ.total}/{seats} Pax
          </span>
        </span>
        {(() => {
          let needUpdateCount = 0;
          let offerCount = 0;
          let scheduledCount = 0;
          if (Array.isArray(cls.members)) {
            for (const m of cls.members) {
              const progRecord = liveProgressMap?.get ? liveProgressMap.get(String(m.student || '').toLowerCase().trim()) : null;
              const st = getProgressUpdateStatus(m, progRecord);
              if (st === 'Need update progress') needUpdateCount += 1;
              else if (st === 'Update Offer') offerCount += 1;
              else if (st === 'Update Scheduled') scheduledCount += 1;
            }
          }

          if (needUpdateCount === 0 && offerCount === 0 && scheduledCount === 0) return null;

          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginTop: '0.25rem' }}>
              {needUpdateCount > 0 && (
                <span
                  style={{
                    fontSize: '0.58rem',
                    fontWeight: 700,
                    color: '#b45309',
                    background: '#fef3c7',
                    border: '1px solid #f59e0b',
                    borderRadius: '4px',
                    padding: '0.05rem 0.28rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.15rem',
                  }}
                  title={`${needUpdateCount} student(s) need progress update`}
                >
                  <Clock size={8} /> Need Update {needUpdateCount > 1 ? `(${needUpdateCount})` : ''}
                </span>
              )}
              {offerCount > 0 && (
                <span
                  style={{
                    fontSize: '0.58rem',
                    fontWeight: 700,
                    color: '#1d4ed8',
                    background: '#eff6ff',
                    border: '1px solid #3b82f6',
                    borderRadius: '4px',
                    padding: '0.05rem 0.28rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.15rem',
                  }}
                  title={`${offerCount} student(s) update offer sent`}
                >
                  <Send size={8} /> Offer ({offerCount})
                </span>
              )}
              {scheduledCount > 0 && (
                <span
                  style={{
                    fontSize: '0.58rem',
                    fontWeight: 700,
                    color: '#6d28d9',
                    background: '#f3e8ff',
                    border: '1px solid #8b5cf6',
                    borderRadius: '4px',
                    padding: '0.05rem 0.28rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.15rem',
                  }}
                  title={`${scheduledCount} student(s) update scheduled`}
                >
                  <Calendar size={8} /> Scheduled ({scheduledCount})
                </span>
              )}
            </div>
          );
        })()}
        {allBranches && cls.branchName && (
          <span style={{ display: 'block', fontSize: '0.6rem', color: meta.subtextColor || 'var(--text-muted)' }}>{cls.branchName}</span>
        )}
        {!allBranches && (
          <ResizeGrip
            color={meta.textColor}
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
    const gripped = !allBranches;
    const edgeMarks = cell.span >= EDGE_MARK_MIN_SPAN;

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
          position: 'relative', height: boxH, borderRadius: cardRadius(cell.buttedPrev, cell.buttedNext),
          border: `1px dashed ${meta.color}`, background: 'transparent',
          padding: cardPadding(edgeMarks, gripped),
          // The seam chip has to be allowed past the card's own edge.
          overflow: cell.buttedNext ? 'visible' : 'hidden',
          cursor: allBranches ? 'default' : 'grab',
          outline: resizing ? `2px solid ${meta.color}` : 'none',
        }}
      >
        {edgeMarks && (
          <EdgeMarks
            color={meta.color}
            startLabel={slot.start}
            endLabel={fromMinutes(shownEnd)}
            gripped={gripped}
            buttedNext={cell.buttedNext}
            buttedPrev={cell.buttedPrev}
          />
        )}
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

  // Part of a kept selection. Rendered as a plain container rather than a button
  // so the Edit trigger inside it is not a nested button; pressing the container
  // still starts a fresh drag, so a selection can be redrawn without clearing it.
  if (inSel && !allBranches && (cell.kind === 'free' || cell.kind === 'short')) {
    return (
      <div
        onPointerDown={(e) => { if (!moving && e.button === 0) beginDraw(inst, rowIdx, e); }}
        title={`${selRows} row${selRows === 1 ? '' : 's'} selected — ${selDuration} min from ${clockLabel(selStart ?? start)}. Press Edit to choose what goes in it, or drag to redraw.`}
        style={{
          width: '100%', height: boxH, borderRadius: '7px',
          border: '1px solid rgba(5,150,105,0.9)', background: 'rgba(5,150,105,0.2)',
          color: '#047857', fontSize: '0.66rem', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
          cursor: 'ns-resize', touchAction: 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', padding: '0 0.3rem',
        }}
      >
        {selSummaryRow && (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selRows} row{selRows === 1 ? '' : 's'} · {selDuration} min
          </span>
        )}
        {selEditRow && (
          <button
            type="button"
            // The press must not be read as the start of a new drag.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onEditSelection}
            title="Choose what goes in this time"
            aria-label={`Edit the ${selDuration} minute selection at ${clockLabel(selStart ?? start)} for ${inst.name}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.15rem', flexShrink: 0,
              border: '1px solid rgba(5,150,105,0.9)', background: '#047857', color: '#fff',
              borderRadius: '5px', padding: '0.1rem 0.35rem', fontSize: '0.6rem',
              fontWeight: 700, cursor: 'pointer',
            }}
          >
            <Pencil size={9} /> Edit
          </button>
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
          // The drag label is longer than "Add"; wrapping would overflow a
          // single-row box, which is only 28px tall.
          whiteSpace: 'nowrap', overflow: 'hidden',
        }}
      >
        {inDraw
          ? (drawAnchor ? drawLabel : '')
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
          whiteSpace: 'nowrap', overflow: 'hidden',
        }}
      >
        {inDraw
          ? (drawAnchor ? drawLabel : '')
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
