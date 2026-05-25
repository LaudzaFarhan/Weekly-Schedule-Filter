/**
 * Workload analytics for instructors based on synced schedule data.
 *
 * Hours are computed using INTERVAL UNION so overlapping group classes or
 * back-to-back rows don't double-count. A 1-hour group with 4 students
 * counts as 1 hour / 1 session / 4 students.
 *
 * Working window is fixed at 10:30 am – 6:30 pm (8 hours per active day).
 * Utilization = teaching hours ÷ (8h × number of days the instructor taught).
 */

import { parseTimeSlot } from './timeUtils';
import { DAY_NAMES } from './constants';

/** Working window in minutes from midnight (10:30 → 18:30). */
export const WORKING_WINDOW_START_MIN = 10 * 60 + 30;
export const WORKING_WINDOW_END_MIN = 18 * 60 + 30;
export const WORKING_WINDOW_MINUTES = WORKING_WINDOW_END_MIN - WORKING_WINDOW_START_MIN; // 480

/**
 * Default workload thresholds. Caller may override.
 * Hours are weekly unless suffixed with `Daily`.
 */
export const DEFAULT_THRESHOLDS = {
  weeklyAmber: 20,
  weeklyRed: 30,
  dailyAmber: 4,
  dailyRed: 6,
};

/**
 * Classify a weekly hours value into 'low' | 'normal' | 'high' | 'overload'.
 * <amber → low (under-utilized)
 * amber..red → normal/high split at midpoint
 * >red → overload
 */
export function classifyWeekly(hours, thresholds = DEFAULT_THRESHOLDS) {
  const { weeklyAmber, weeklyRed } = thresholds;
  if (hours <= 0) return 'idle';
  if (hours < weeklyAmber) return 'low';
  if (hours < weeklyRed) return 'normal';
  return 'overload';
}

export function classifyDaily(hours, thresholds = DEFAULT_THRESHOLDS) {
  const { dailyAmber, dailyRed } = thresholds;
  if (hours <= 0) return 'idle';
  if (hours < dailyAmber) return 'low';
  if (hours < dailyRed) return 'normal';
  return 'overload';
}

/**
 * Merge a list of [start, end) intervals into the smallest set of
 * non-overlapping intervals. Returns intervals in ascending order.
 */
function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1]) {
      // overlap or touching → extend
      if (cur[1] > last[1]) last[1] = cur[1];
    } else {
      merged.push(cur.slice());
    }
  }
  return merged;
}

/** Sum of interval lengths (minutes). */
function totalMinutes(intervals) {
  return intervals.reduce((sum, [s, e]) => sum + (e - s), 0);
}

/**
 * Aggregate per-day teaching load across the whole school week.
 *
 * Returns one entry per day in DAY_NAMES order:
 *   { day, hours, sessions, students, peakSlot, peakInstructor }
 *
 * Hours = sum of each instructor's interval-union hours for that day, so
 * two instructors each teaching 1h at the same time = 2h (instructor-hours,
 * which is what matters for capacity).
 *
 * Sessions = distinct (day, time) pairs taught — group classes count as 1.
 *
 * Students = distinct student names taught that day.
 *
 * peakSlot = the time string with the most sessions running concurrently
 * (best descriptor of "the busiest moment").
 */
export function computeWeeklyByDay(classes, { disabledInstructors } = {}) {
  // teacher → day → time → rows[]
  const byTeacher = new Map();
  const studentsByDay = {};
  const sessionsByDayTime = {};

  for (const c of classes) {
    if (!c.day || !c.time || !c.teacher || c.teacher === '-') continue;
    if (disabledInstructors && disabledInstructors.has(c.teacher)) continue;
    if (!byTeacher.has(c.teacher)) byTeacher.set(c.teacher, {});
    const tDays = byTeacher.get(c.teacher);
    if (!tDays[c.day]) tDays[c.day] = {};
    if (!tDays[c.day][c.time]) tDays[c.day][c.time] = [];
    tDays[c.day][c.time].push(c);

    if (!studentsByDay[c.day]) studentsByDay[c.day] = new Set();
    if (c.student) studentsByDay[c.day].add(c.student);

    const key = `${c.day}|${c.time}`;
    if (!sessionsByDayTime[key]) sessionsByDayTime[key] = { day: c.day, time: c.time, count: 0, parsed: parseTimeSlot(c.time) };
    sessionsByDayTime[key].count += 1;
  }

  // Aggregate per-day hours (instructor-hours, summed across instructors)
  // and session counts (distinct day×time tuples school-wide).
  const result = DAY_NAMES.map((day) => ({
    day,
    hours: 0,
    sessions: 0,
    students: studentsByDay[day]?.size || 0,
    peakSlot: null,
    peakConcurrent: 0,
  }));
  const indexByDay = Object.fromEntries(DAY_NAMES.map((d, i) => [d, i]));

  // Hours: per teacher per day, union their intervals then sum
  for (const tDays of byTeacher.values()) {
    for (const day of Object.keys(tDays)) {
      const idx = indexByDay[day];
      if (idx === undefined) continue;
      const intervals = [];
      for (const time of Object.keys(tDays[day])) {
        const parsed = parseTimeSlot(time);
        if (!parsed || parsed.end <= parsed.start) continue;
        intervals.push([parsed.start, parsed.end]);
      }
      const merged = mergeIntervals(intervals);
      result[idx].hours += totalMinutes(merged) / 60;
    }
  }

  // Sessions and peak slot
  for (const key of Object.keys(sessionsByDayTime)) {
    const { day, time, count } = sessionsByDayTime[key];
    const idx = indexByDay[day];
    if (idx === undefined) continue;
    result[idx].sessions += 1;
    if (count > result[idx].peakConcurrent) {
      result[idx].peakConcurrent = count;
      result[idx].peakSlot = time;
    }
  }

  return result;
}

/**
 * Clip a list of intervals to the working window so that "off-hours"
 * teaching doesn't inflate utilization.
 */
function clipToWorkingWindow(intervals) {
  const result = [];
  for (const [s, e] of intervals) {
    const cs = Math.max(s, WORKING_WINDOW_START_MIN);
    const ce = Math.min(e, WORKING_WINDOW_END_MIN);
    if (ce > cs) result.push([cs, ce]);
  }
  return result;
}

/**
 * Group classes by teacher. Each entry is the raw list of class rows for
 * that teacher (one row per student).
 */
function groupByTeacher(classes) {
  const map = new Map();
  for (const c of classes) {
    if (!c.teacher || c.teacher === '-') continue;
    if (!map.has(c.teacher)) map.set(c.teacher, []);
    map.get(c.teacher).push(c);
  }
  return map;
}

/**
 * Compute per-day stats for a single instructor's class rows.
 * Returns { byDay: { Monday: {...}, ... }, weekly: {...} }
 */
function computeForInstructor(rows) {
  const byDay = {};
  for (const day of DAY_NAMES) {
    byDay[day] = {
      day,
      hours: 0,
      hoursClipped: 0,
      sessions: 0,
      sessionList: [],   // [{ time, students, durationMin }]
      students: 0,
      studentSet: new Set(),
      programs: new Set(),
      busiestStartMin: null,
      busiestEndMin: null,
      intervals: [],
    };
  }

  // Bucket rows by day → time
  const dayTimeMap = {}; // day → time → { rows: [], parsed }
  const unparsed = []; // rows whose time string could not be parsed
  for (const r of rows) {
    if (!r.day || !r.time) continue;
    const parsed = parseTimeSlot(r.time);
    if (!parsed || parsed.end <= parsed.start) {
      unparsed.push(r);
      continue;
    }
    if (!dayTimeMap[r.day]) dayTimeMap[r.day] = {};
    if (!dayTimeMap[r.day][r.time]) dayTimeMap[r.day][r.time] = { rows: [], parsed };
    dayTimeMap[r.day][r.time].rows.push(r);
  }

  // Aggregate per day
  for (const day of Object.keys(dayTimeMap)) {
    const timeMap = dayTimeMap[day];
    const intervals = [];

    for (const [timeStr, { rows: bucket, parsed }] of Object.entries(timeMap)) {
      const studentsInSlot = new Set();
      bucket.forEach((b) => {
        if (b.student) studentsInSlot.add(b.student);
        if (b.program) byDay[day].programs.add(b.program);
      });
      const durationMin = parsed.end - parsed.start;
      // Capture per-student detail so the heatmap modal can show
      // "what is being taught at this slot".
      const studentDetails = bucket.map((b) => ({
        student: b.student || '',
        program: b.program || '',
        lessonDetail: b.lessonDetail || '',
        fullProgram: b.fullProgram || '',
        branchName: b.branchName || '',
        remarks: b.remarks || '',
        notArranged: !!b.notArranged,
      }));
      const programs = Array.from(
        new Set(bucket.map((b) => b.lessonDetail || b.program).filter(Boolean))
      );
      const branches = Array.from(
        new Set(bucket.map((b) => b.branchName).filter(Boolean))
      );
      byDay[day].sessionList.push({
        time: timeStr,
        start: parsed.start,
        end: parsed.end,
        students: studentsInSlot.size || bucket.length,
        studentList: Array.from(studentsInSlot),
        studentDetails,
        programs,
        branches,
        durationMin,
      });
      intervals.push([parsed.start, parsed.end]);
      bucket.forEach((b) => {
        if (b.student) byDay[day].studentSet.add(b.student);
      });
    }

    const merged = mergeIntervals(intervals);
    const clipped = clipToWorkingWindow(merged);

    byDay[day].intervals = merged;
    byDay[day].hours = totalMinutes(merged) / 60;
    byDay[day].hoursClipped = totalMinutes(clipped) / 60;
    byDay[day].sessions = byDay[day].sessionList.length;
    byDay[day].students = byDay[day].studentSet.size;
    byDay[day].sessionList.sort((a, b) => a.start - b.start);

    if (merged.length > 0) {
      byDay[day].busiestStartMin = merged[0][0];
      byDay[day].busiestEndMin = merged[merged.length - 1][1];
    }
  }

  // Weekly aggregates
  let totalHours = 0;
  let totalHoursClipped = 0;
  let totalSessions = 0;
  let totalStudentEnrolments = 0; // sum of distinct students per session
  const allStudents = new Set();
  const activeDays = [];
  let busiestDay = null;
  let busiestDayHours = 0;

  for (const day of DAY_NAMES) {
    const d = byDay[day];
    totalHours += d.hours;
    totalHoursClipped += d.hoursClipped;
    totalSessions += d.sessions;
    totalStudentEnrolments += d.sessionList.reduce((s, sess) => s + sess.students, 0);
    d.studentSet.forEach((s) => allStudents.add(s));
    if (d.sessions > 0) activeDays.push(day);
    if (d.hours > busiestDayHours) {
      busiestDayHours = d.hours;
      busiestDay = day;
    }
  }

  const denominator = activeDays.length > 0
    ? activeDays.length * (WORKING_WINDOW_MINUTES / 60)
    : 0;
  const utilization = denominator > 0 ? (totalHoursClipped / denominator) * 100 : 0;

  // Average session length in minutes
  const allSessions = DAY_NAMES.flatMap((d) => byDay[d].sessionList);
  const avgSessionMin = allSessions.length > 0
    ? allSessions.reduce((s, x) => s + x.durationMin, 0) / allSessions.length
    : 0;

  // Average group size = students per session (1 = solo)
  const avgGroupSize = totalSessions > 0
    ? totalStudentEnrolments / totalSessions
    : 0;

  // Average gap between sessions within a day (only counts days with ≥2 sessions)
  let totalGapMin = 0;
  let gapDays = 0;
  for (const day of activeDays) {
    const sessions = byDay[day].sessionList;
    if (sessions.length < 2) continue;
    let dayGap = 0;
    for (let i = 1; i < sessions.length; i++) {
      const prev = sessions[i - 1];
      const cur = sessions[i];
      dayGap += Math.max(0, cur.start - prev.end);
    }
    totalGapMin += dayGap / (sessions.length - 1);
    gapDays++;
  }
  const avgGapMin = gapDays > 0 ? totalGapMin / gapDays : 0;

  return {
    byDay,
    weekly: {
      hours: totalHours,
      hoursClipped: totalHoursClipped,
      sessions: totalSessions,
      students: allStudents.size,
      studentEnrolments: totalStudentEnrolments,
      activeDays: activeDays.length,
      activeDayList: activeDays,
      busiestDay,
      busiestDayHours,
      utilization,
      avgSessionMin,
      avgGroupSize,
      avgGapMin,
      unparsedCount: unparsed.length,
      unparsedSamples: unparsed.slice(0, 3).map((r) => ({ day: r.day, time: r.time, student: r.student })),
    },
  };
}

/**
 * Build a workload report for every instructor in `classes`.
 * Optionally exclude `disabledInstructors` (Set<string>) so the page can
 * respect the existing admin-disabled list.
 *
 * Returns an array of `{ teacher, byDay, weekly }` sorted by weekly hours desc.
 */
export function buildWorkloadReport(classes, { disabledInstructors } = {}) {
  const grouped = groupByTeacher(classes);
  const rows = [];
  for (const [teacher, list] of grouped) {
    if (disabledInstructors && disabledInstructors.has(teacher)) continue;
    const stats = computeForInstructor(list);
    rows.push({ teacher, ...stats });
  }
  rows.sort((a, b) => b.weekly.hours - a.weekly.hours);
  return rows;
}

/**
 * Aggregate report-level summary: averages, max, count over threshold.
 * Useful for the "distribution" KPI strip at the top of the workload page.
 */
export function summarizeWorkload(report, thresholds = DEFAULT_THRESHOLDS) {
  if (report.length === 0) {
    return {
      instructors: 0,
      avgHours: 0,
      medianHours: 0,
      maxHours: 0,
      maxTeacher: null,
      minHours: 0,
      minTeacher: null,
      overloadedCount: 0,
      underloadedCount: 0,
      totalHours: 0,
      totalSessions: 0,
      totalStudents: 0,
    };
  }

  const sortedHours = report.map((r) => r.weekly.hours).sort((a, b) => a - b);
  const totalHours = sortedHours.reduce((s, x) => s + x, 0);
  const avgHours = totalHours / report.length;
  const medianHours = sortedHours[Math.floor(sortedHours.length / 2)];
  const max = report[0]; // already sorted desc
  const min = report[report.length - 1];

  const overloadedCount = report.filter((r) => r.weekly.hours > thresholds.weeklyRed).length;
  const underloadedCount = report.filter((r) => r.weekly.hours > 0 && r.weekly.hours < thresholds.weeklyAmber).length;

  const allStudents = new Set();
  let totalSessions = 0;
  for (const r of report) {
    totalSessions += r.weekly.sessions;
    DAY_NAMES.forEach((d) => r.byDay[d].studentSet.forEach((s) => allStudents.add(s)));
  }

  return {
    instructors: report.length,
    avgHours,
    medianHours,
    maxHours: max.weekly.hours,
    maxTeacher: max.teacher,
    minHours: min.weekly.hours,
    minTeacher: min.teacher,
    overloadedCount,
    underloadedCount,
    totalHours,
    totalSessions,
    totalStudents: allStudents.size,
  };
}

/** Format minutes as "Hh Mm" or just "Hh" when whole. */
export function formatHoursMinutes(hours) {
  if (!hours || hours <= 0) return '0h';
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Convert minutes-from-midnight to a friendly label like "10:30 am". */
export function formatMinutesToClock(min) {
  if (min === null || min === undefined || isNaN(min)) return '—';
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const isPM = h24 >= 12;
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  const mm = String(m).padStart(2, '0');
  return `${h12}:${mm} ${isPM ? 'pm' : 'am'}`;
}
