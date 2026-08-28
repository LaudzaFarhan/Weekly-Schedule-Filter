/**
 * Whether the students nominally filling a class seat are still genuinely coming.
 *
 * A configured slot being "open" is only half the answer. The other half is
 * whether the seats it holds are really taken, and that is what Live Progress
 * knows and nothing else does:
 *
 *   - a student answering "Not Continue" or "Break" is leaving after this level,
 *     so their seat is about to come free;
 *   - a student who has ticked every meeting of their term has finished it, so
 *     their seat is free until they renew.
 *
 * Live Progress cannot say *when* a class meets — it holds no day, time, branch
 * or instructor, and is keyed by (student name, level code). So occupancy still
 * comes from `internal_classes`; this module only decides which of those seats
 * are still warm.
 *
 * Everything here is pure so both the API and the browser can apply the same
 * rules to the same data and agree.
 */

import {
  parseProgram, normaliseCoderLevel, lessonsForCategory,
} from './programRules';
import { categorize, splitStudents } from './newOpsAnalytics';

/**
 * Continuation answers that free a seat.
 *
 * "Uncertain" deliberately does not: an undecided parent is still attending, and
 * counting them out would offer a trial seat that is very likely still taken.
 */
export const RELEASING_CONTINUATIONS = ['Not Continue', 'Break'];

/** Stable identity for a progress record. Mirrors the table's unique key. */
export const progressKey = (studentName, programCode) =>
  `${String(studentName || '').trim().toLowerCase()}||${String(programCode || '').trim().toLowerCase()}`;

/**
 * The level code a class's program maps to in Live Progress.
 *
 * Coder levels are stored whole, so a legacy numbered one folds onto its stage.
 * Kinder and Junior use the bare code without the lesson number, because
 * progress spans the level rather than one lesson of it.
 */
export function levelCodeFor(program, category) {
  const cat = category || categorize(program);
  const parsed = parseProgram(program);
  if (cat === 'Coder') return normaliseCoderLevel(parsed.code || program);
  return parsed.code || (cat === 'Kinder' ? 'K1' : 'J1');
}

/** Index progress rows by student + level, for lookups per seat. */
export function indexProgress(rows) {
  const map = new Map();
  for (const p of rows || []) {
    map.set(progressKey(p.studentName ?? p.student_name, p.programCode ?? p.program_code), p);
  }
  return map;
}

/** Index students by name, for reading their meeting target. */
export function indexStudents(rows) {
  const map = new Map();
  for (const s of rows || []) {
    const name = String(s.name || '').trim().toLowerCase();
    if (name) map.set(name, s);
  }
  return map;
}

/**
 * Meetings the student is expected to attend in their current term.
 *
 * The registry carries this as a `[TargetMeetings: n]` tag on remarks, written
 * when their package was recorded. Without one, fall back to the category's
 * standard term length rather than guessing from a subscription string.
 */
export function targetMeetingsFor(student, category) {
  const tagged = String(student?.remarks || '').match(/\[TargetMeetings:\s*(\d+)\]/i);
  if (tagged) {
    const n = Number(tagged[1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const explicit = Number(student?.targetMeetings);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  return lessonsForCategory(category);
}

/** Meetings actually ticked off. */
export function attendedCount(attendance) {
  if (!attendance || typeof attendance !== 'object') return 0;
  return Object.keys(attendance).filter((k) => attendance[k]).length;
}

/**
 * Why this student's seat is coming free, or null while they are still coming.
 *
 * A student with no progress row counts as still attending. That is the
 * conservative reading: nobody has recorded anything about them, so treating the
 * seat as free would offer a trial place that is probably taken.
 */
export function seatRelease(progress, targetMeetings) {
  if (!progress) return null;

  const continuation = String(progress.continuation || '').trim();
  if (RELEASING_CONTINUATIONS.includes(continuation)) {
    return {
      kind: 'continuation',
      continuation,
      reason: continuation === 'Break' ? 'taking a break' : 'not continuing',
    };
  }

  const attended = attendedCount(progress.attendance);
  if (targetMeetings > 0 && attended >= targetMeetings) {
    return {
      kind: 'termComplete',
      attended,
      targetMeetings,
      reason: `finished all ${targetMeetings} meetings`,
    };
  }

  return null;
}

/**
 * Seat occupancy for one class, refined by Live Progress.
 *
 * @param {object}  slot            a grouped class: { students[], program }
 * @param {Map}     progressIndex   from indexProgress()
 * @param {Map}     studentIndex    from indexStudents()
 * @returns {{
 *   category: string|null,
 *   levelCode: string,
 *   holders: Array<{ name, releasing: boolean, reason: string|null }>,
 *   occupied: number,       // seats still genuinely taken
 *   releasing: number,      // seats about to come free
 *   enrolled: number        // seats on paper
 * }}
 */
export function slotOccupancy(slot, progressIndex, studentIndex) {
  const names = Array.isArray(slot?.students)
    ? slot.students.flatMap((s) => splitStudents(s))
    : [];
  const category = categorize(slot?.program);
  const levelCode = levelCodeFor(slot?.program, category);

  const holders = names.map((name) => {
    const progress = progressIndex?.get(progressKey(name, levelCode)) || null;
    const student = studentIndex?.get(String(name).trim().toLowerCase()) || null;
    const release = seatRelease(progress, targetMeetingsFor(student, category));
    return {
      name,
      releasing: Boolean(release),
      reason: release?.reason || null,
      releaseKind: release?.kind || null,
    };
  });

  const releasing = holders.filter((h) => h.releasing).length;
  return {
    category,
    levelCode,
    holders,
    enrolled: holders.length,
    releasing,
    occupied: holders.length - releasing,
  };
}

/**
 * Seats a class can still take, counting the ones Live Progress says are on
 * their way out.
 *
 * `seatsLeft` is what a trial can be offered against today; `seatsLeftStrict`
 * ignores the releasing seats, which is the honest number if nobody has yet
 * confirmed the leavers are gone.
 */
export function seatsFor(slot, capacity, progressIndex, studentIndex) {
  const occ = slotOccupancy(slot, progressIndex, studentIndex);
  const max = Number(capacity) || 0;
  return {
    ...occ,
    maxStudents: max,
    seatsLeft: Math.max(0, max - occ.occupied),
    seatsLeftStrict: Math.max(0, max - occ.enrolled),
  };
}
