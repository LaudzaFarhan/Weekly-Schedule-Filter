/**
 * The single answer to "is this instructor available?" for New Operations.
 *
 * Before this existed, four places each had their own partial version:
 * the Operationals capacity check counted heads without looking at bookings,
 * the Schedule form checked nothing at all, the recommended-times panel
 * ignored classes at other branches, and nothing anywhere read leave.
 *
 * Everything that makes a scheduling decision should call `availabilityFor`
 * so the planner and the save step can never disagree.
 *
 * All data comes from PostgreSQL (New Operations). The Google Sheets branch
 * config belongs to Old Operations and is deliberately not consulted.
 */

import { parseTimeSlot } from '../utils/timeUtils';
import { DAY_NAMES } from '../utils/constants';

/** Stable reason codes so callers can style or filter by cause. */
export const AVAIL = {
  FREE: 'free',
  NOT_AT_BRANCH: 'not_at_branch',
  NO_CAPABILITY: 'no_capability',
  TEACHING: 'teaching',
  TEACHING_ELSEWHERE: 'teaching_elsewhere',
  ON_LEAVE: 'on_leave',
  BLOCKED: 'blocked',
  OUTSIDE_HOURS: 'outside_hours',
};

/** Leave statuses that do NOT stop someone from teaching. */
const NON_BLOCKING_LEAVE = new Set(['rejected', 'cancelled', 'canceled', 'declined']);

// ── time helpers ─────────────────────────────────────────────────────────────

/** "13:30" -> 810. Returns null for anything unparseable. */
export function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((n) => parseInt(n, 10));
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
}

/** 810 -> "13:30" */
export function fromMinutes(mins) {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** 810 -> "1:30 PM", for display. */
export function clockLabel(mins) {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** 810 -> "1.30 pm", the form class times are stored in. */
export function clockShort(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}.${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Build the stored class time string, e.g. "1.00 pm - 2.30 pm".
 * Must match what the Schedule page writes, or the two views stop agreeing on
 * which rows belong to the same class.
 */
export function slotLabelFor(startMin, endMin) {
  return `${clockShort(startMin)} - ${clockShort(endMin)}`;
}

/** Turn a stored class time ("1.00 - 3.00 pm") into minute bounds. */
export function classWindow(timeLabel) {
  const parsed = parseTimeSlot(timeLabel);
  if (!parsed) return null;
  return { start: parsed.start, end: parsed.end };
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  if ([aStart, aEnd, bStart, bEnd].some((v) => v == null)) return false;
  return aStart < bEnd && bStart < aEnd;
}

// ── instructor helpers ───────────────────────────────────────────────────────

/**
 * Can this instructor level cover a slot category?
 *
 * Levels in New Operations are only "Kinder and Junior" and "Junior and
 * Coder" — no level covers all three categories.
 */
export function levelCovers(level, category) {
  const l = String(level || '').toLowerCase();
  if (!category) return true; // "Any Class" — anyone can take it
  if (category === 'Kinder') return l.includes('kinder');
  if (category === 'Junior') return l.includes('junior');
  if (category === 'Coder') return l.includes('coder');
  return true;
}

/** Instructors assigned to a branch, explicitly or via "All Branches". */
export function instructorsAtBranch(instructors, branchName) {
  if (!branchName) return instructors || [];
  return (instructors || []).filter((i) => {
    const brs = Array.isArray(i.branches) ? i.branches : [];
    return brs.includes(branchName) || brs.includes('All Branches');
  });
}

/** Categories an instructor's level lets them teach. */
export function categoriesFor(instructor, categories = ['Kinder', 'Junior', 'Coder']) {
  return categories.filter((c) => levelCovers(instructor?.level, c));
}

// ── dates and leave ──────────────────────────────────────────────────────────

/** Monday-based start of the week containing `date`, as "YYYY-MM-DD". */
export function weekStartISO(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const shift = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - shift);
  return isoOf(d);
}

export function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The concrete date a weekday falls on inside a given week.
 * The Class Operation plan is a recurring weekly pattern, so leave — which is
 * date-specific — is only meaningful once anchored to a week.
 */
export function dateForDay(day, weekStart) {
  const idx = DAY_NAMES.indexOf(day);
  if (idx < 0 || !weekStart) return null;
  const [y, m, d] = weekStart.split('-').map((n) => parseInt(n, 10));
  if (!y) return null;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + idx);
  return isoOf(date);
}

/**
 * The next date a weekday falls on, counting today as valid.
 *
 * Booking a dated session must never land in the past. `dateForDay` anchored to
 * the current week does exactly that whenever the weekday has already gone by:
 * asked for Wednesday on a Friday it returns the Wednesday two days ago, which
 * would expire the moment it was saved.
 */
export function nextDateForDay(day, from = new Date()) {
  const idx = DAY_NAMES.indexOf(day);
  if (idx < 0) return null;
  const base = from instanceof Date ? from : new Date(from);
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const todayIdx = (start.getDay() + 6) % 7; // Monday = 0, matching DAY_NAMES
  const ahead = (idx - todayIdx + 7) % 7;
  start.setDate(start.getDate() + ahead);
  return isoOf(start);
}

/** The leave record blocking this instructor on this date, if any. */
export function leaveOn(leaves, instructorName, isoDate) {
  if (!isoDate) return null;
  return (leaves || []).find((l) =>
    l.name === instructorName &&
    !NON_BLOCKING_LEAVE.has(String(l.status || '').toLowerCase()) &&
    l.startDate <= isoDate &&
    l.endDate >= isoDate
  ) || null;
}

// ── classes ──────────────────────────────────────────────────────────────────

/**
 * Collapse `internal_classes` rows into actual classes.
 *
 * Each row is one enrolled student, so a class of four Kinder students is four
 * rows sharing branch + day + time + teacher. Seat occupancy is the row count.
 */
export function groupClasses(classes) {
  const map = new Map();
  for (const c of classes || []) {
    if (!c.teacher || !c.day || !c.time) continue;
    const key = `${c.branchName || ''}||${c.day}||${c.time}||${c.teacher}`;
    if (!map.has(key)) {
      const win = classWindow(c.time);
      map.set(key, {
        key,
        branchName: c.branchName || '',
        day: c.day,
        time: c.time,
        teacher: c.teacher,
        classType: c.classType || 'Regular',
        programs: [],
        students: [],
        ids: [],
        // One entry per enrolled student, so a roster can be shown and edited.
        members: [],
        startMin: win?.start ?? null,
        endMin: win?.end ?? null,
      });
    }
    const group = map.get(key);
    group.ids.push(c.id);
    if (c.program) group.programs.push(c.program);
    if (c.student) group.students.push(c.student);
    group.members.push({
      id: c.id,
      student: c.student || '',
      program: c.program || '',
      classType: c.classType || 'Regular',
      sessionDates: Array.isArray(c.sessionDates) ? c.sessionDates : [],
      remarks: c.remarks || '',
    });
  }
  return [...map.values()];
}

/**
 * Attendance kinds a student can hold in a class.
 *
 * Regular is the fixed weekly place. The other three are pinned to specific
 * dates and are spent once those dates pass:
 * - Replacement — the student misses their own regular week and sits in this
 *   class instead, just for the dates listed.
 * - Additional — an extra session on top of whatever else they attend, so a
 *   week can hold more than one.
 * - Trial — a prospective student sampling the class.
 */
export const ATTENDANCE = {
  REGULAR: 'Regular',
  REPLACEMENT: 'Replacement',
  ADDITIONAL: 'Additional',
  TRIAL: 'Trial',
};

/** Kinds that only ever attend on recorded dates. */
export const DATED_ATTENDANCE = [
  ATTENDANCE.REPLACEMENT,
  ATTENDANCE.ADDITIONAL,
  ATTENDANCE.TRIAL,
];

/** Does this kind attend only on recorded dates? */
export function isDatedKind(classType) {
  return DATED_ATTENDANCE.includes(String(classType || ''));
}

/**
 * Has a dated place been used up?
 *
 * A replacement or extra session booked for last Tuesday is over: it should no
 * longer take a seat or show on the schedule. A Regular never expires, and a
 * dated member with no dates recorded is treated as still pending rather than
 * expired, so an incomplete record is never silently dropped.
 */
export function isExpired(member, todayISO) {
  if (!member || !isDatedKind(member.classType)) return false;
  const dates = member.sessionDates || [];
  if (dates.length === 0) return false;
  const today = todayISO || isoOf(new Date());
  return dates.every((d) => d < today);
}

/**
 * Does this member attend in the week starting `weekStart`?
 *
 * A Regular attends every week, so always yes. Anyone else attends only on
 * their recorded dates.
 */
export function attendsInWeek(member, weekStart) {
  if (!member) return false;
  if (member.classType === ATTENDANCE.REGULAR) return true;
  if (!weekStart) return (member.sessionDates || []).length === 0;
  const dates = member.sessionDates || [];
  if (dates.length === 0) return true; // no dates recorded — assume it applies
  const end = dateForDay('Sunday', weekStart);
  return dates.some((d) => d >= weekStart && d <= end);
}

/** Seats taken in a class for a given week: regulars plus that week's guests. */
export function occupancyForWeek(group, weekStart) {
  const members = group?.members || [];
  const regular = members.filter((m) => m.classType === ATTENDANCE.REGULAR);
  const guests = members.filter((m) => m.classType !== ATTENDANCE.REGULAR && attendsInWeek(m, weekStart));
  return { regular: regular.length, guests: guests.length, total: regular.length + guests.length };
}

/**
 * Members that still hold a place: everyone except spent dated ones.
 *
 * Used wherever the question is "who is in this class now", as opposed to
 * `occupancyForWeek`, which answers it for one particular week.
 */
export function activeMembers(group, todayISO) {
  return (group?.members || []).filter((m) => !isExpired(m, todayISO));
}

/** Dated places whose dates have all passed, ready to be cleared out. */
export function expiredMembers(group, todayISO) {
  return (group?.members || []).filter((m) => isExpired(m, todayISO));
}

/** Classes a named instructor teaches on a day, anywhere. */
export function classesForInstructor(groups, instructorName, day) {
  return (groups || []).filter((g) => g.teacher === instructorName && g.day === day);
}

// ── the verdict ──────────────────────────────────────────────────────────────

/**
 * Is `instructor` free to take a class in `[startMin, endMin)`?
 *
 * @param {object} instructor         New Ops instructor record
 * @param {object} ctx
 * @param {string} ctx.branchName     branch the class would run at
 * @param {string} ctx.day            weekday name
 * @param {number} ctx.startMin       window start, minutes from midnight
 * @param {number} ctx.endMin         window end
 * @param {string|null} ctx.category  'Kinder' | 'Junior' | 'Coder' | null for any
 * @param {Array}  ctx.classGroups    output of groupClasses()
 * @param {Array}  ctx.leaves         leave records
 * @param {string|null} ctx.date      ISO date the window falls on, for leave
 * @param {Array}  ctx.blocks         non-class slots for the day: [{type,start,end,label}]
 * @param {object|null} ctx.hours     { start, end } branch hours
 * @param {Array}  ctx.plannedSlots   planned slots already assigned to this instructor
 * @param {boolean} ctx.requireBranch check branch assignment (default true)
 *
 * @returns {{ free: boolean, code: string, reason: string, conflict: object|null }}
 */
export function availabilityFor(instructor, ctx) {
  const {
    branchName, day, startMin, endMin, category = null,
    classGroups: groups = [], leaves = [], date = null, blocks = [],
    hours = null, plannedSlots = [], requireBranch = true,
  } = ctx || {};

  const name = instructor?.name;

  // 1. Outside the branch's operating hours.
  if (hours) {
    const openMin = toMinutes(hours.start);
    const closeMin = toMinutes(hours.end);
    if (openMin != null && closeMin != null && (startMin < openMin || endMin > closeMin)) {
      return {
        free: false,
        code: AVAIL.OUTSIDE_HOURS,
        reason: `Outside ${branchName || 'branch'} hours (${hours.start}–${hours.end})`,
        conflict: null,
      };
    }
  }

  // 2. Assigned to this branch at all.
  if (requireBranch && branchName) {
    const brs = Array.isArray(instructor?.branches) ? instructor.branches : [];
    if (!brs.includes(branchName) && !brs.includes('All Branches')) {
      return {
        free: false,
        code: AVAIL.NOT_AT_BRANCH,
        reason: `Not assigned to ${branchName}`,
        conflict: null,
      };
    }
  }

  // 3. Qualified for the category.
  if (category && !levelCovers(instructor?.level, category)) {
    return {
      free: false,
      code: AVAIL.NO_CAPABILITY,
      reason: `${name || 'This instructor'} is ${instructor?.level || 'unclassified'} — cannot teach ${category}`,
      conflict: null,
    };
  }

  // 4. On leave. Date-specific, so only checked when a week is anchored.
  const leave = leaveOn(leaves, name, date);
  if (leave) {
    return {
      free: false,
      code: AVAIL.ON_LEAVE,
      reason: `On leave ${leave.startDate} to ${leave.endDate}${leave.reason ? ` — ${leave.reason}` : ''}`,
      conflict: leave,
    };
  }

  // 5. Already teaching — at ANY branch, which is the check that was missing.
  const clash = classesForInstructor(groups, name, day)
    .find((g) => overlaps(startMin, endMin, g.startMin, g.endMin));
  if (clash) {
    const elsewhere = branchName && clash.branchName && clash.branchName !== branchName;
    return {
      free: false,
      code: elsewhere ? AVAIL.TEACHING_ELSEWHERE : AVAIL.TEACHING,
      reason: elsewhere
        ? `Teaching ${clash.time} at ${clash.branchName}`
        : `Teaching ${clash.time}`,
      conflict: clash,
    };
  }

  // 6. Held by a slot already planned for this instructor.
  const planned = (plannedSlots || []).find((s) =>
    overlaps(startMin, endMin, toMinutes(s.start), toMinutes(s.end))
  );
  if (planned) {
    return {
      free: false,
      code: AVAIL.TEACHING,
      reason: `Already planned ${planned.start}–${planned.end}`,
      conflict: planned,
    };
  }

  // 7. Branch-wide blocked time (break / training / meeting).
  const block = (blocks || []).find((s) =>
    overlaps(startMin, endMin, toMinutes(s.start), toMinutes(s.end))
  );
  if (block) {
    return {
      free: false,
      code: AVAIL.BLOCKED,
      reason: `${block.label || block.type} ${block.start}–${block.end}`,
      conflict: block,
    };
  }

  return { free: true, code: AVAIL.FREE, reason: 'Free', conflict: null };
}

export default availabilityFor;
