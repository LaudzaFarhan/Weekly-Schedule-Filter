import { query } from '@/lib/db';
import { NextResponse } from 'next/server';
import {
  programDurationMin,
  parseSlotLabel,
  groupIntoSlots
} from '@/lib/newOpsAnalytics';

/**
 * GET: Instructor workload derived from internal_classes.
 *
 * Read-only. Optional filters: ?branch=Bekasi&day=Monday&instructor=Angel
 *
 * Rules mirrored from the Workload page:
 *  - A "slot" is one lesson (day + time + teacher + branch), regardless of how
 *    many students it holds.
 *  - Slots where every student is on leave (remarks contain "izin") are
 *    reported separately as leaveSessions and excluded from taught hours.
 *  - Class length comes from the program: Kinder 90 min, everything else 120.
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const branch = searchParams.get('branch');
    const day = searchParams.get('day');
    const instructor = searchParams.get('instructor');

    const where = [];
    const params = [];
    if (branch) { params.push(branch); where.push(`branch_name = $${params.length}`); }
    if (day) { params.push(day); where.push(`day = $${params.length}`); }
    if (instructor) { params.push(instructor); where.push(`teacher = $${params.length}`); }

    const sql = `
      SELECT id, day, time, program, student, teacher, branch_name, class_type, remarks
      FROM internal_classes
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `;
    const res = await query(sql, params);
    const classes = res.rows.map((r) => ({
      id: r.id,
      day: r.day,
      time: r.time,
      program: r.program,
      student: r.student,
      teacher: r.teacher,
      branchName: r.branch_name,
      classType: r.class_type,
      remarks: r.remarks
    }));

    const slots = groupIntoSlots(classes);

    const byInstructor = new Map();
    for (const slot of slots) {
      if (!slot.teacher || slot.teacher === '-') continue;
      if (!byInstructor.has(slot.teacher)) {
        byInstructor.set(slot.teacher, {
          instructor: slot.teacher,
          branches: new Set(),
          totalMinutes: 0,
          totalSessions: 0,
          leaveSessions: 0,
          studentCount: 0,
          byDay: {},
          sessions: []
        });
      }
      const agg = byInstructor.get(slot.teacher);
      agg.branches.add(slot.branchName);

      const parsed = parseSlotLabel(slot.time);
      const minutes = parsed ? parsed.end - parsed.start : programDurationMin(slot.program);
      const allOnLeave = !slot.hasAttending;

      agg.sessions.push({
        day: slot.day,
        time: slot.time,
        branchName: slot.branchName,
        program: slot.program,
        students: slot.students,
        studentCount: slot.students.length,
        minutes,
        allOnLeave
      });

      if (allOnLeave) {
        agg.leaveSessions += 1;
        continue; // does not count towards taught hours
      }

      agg.totalSessions += 1;
      agg.totalMinutes += minutes;
      agg.studentCount += slot.students.length;
      agg.byDay[slot.day] = (agg.byDay[slot.day] || 0) + minutes;
    }

    let instRows = [];
    try {
      const instRes = await query('SELECT id, name, aliases, verified_aliases, employment_type, available_days FROM internal_instructors');
      instRows = instRes.rows || [];
    } catch (e) {
      // ignore if instructors table is unavailable
    }

    const findInstProfile = (name) => {
      if (!name) return null;
      const lower = String(name).trim().toLowerCase();
      return instRows.find((i) => {
        if (i.name && i.name.trim().toLowerCase() === lower) return true;
        const aliases = Array.isArray(i.aliases) ? i.aliases : [];
        const verified = Array.isArray(i.verified_aliases) ? i.verified_aliases : [];
        const allAliases = [...aliases, ...verified];
        return allAliases.some((a) => typeof a === 'string' && a.trim().toLowerCase() === lower);
      });
    };

    const data = [...byInstructor.values()]
      .map((a) => {
        const profile = findInstProfile(a.instructor);
        const employmentType = profile?.employment_type || 'Full-Time';
        const availableDays = profile?.available_days || [];
        return {
          instructor: a.instructor,
          employmentType,
          availableDays,
          branches: [...a.branches].sort(),
          totalSessions: a.totalSessions,
          leaveSessions: a.leaveSessions,
          totalMinutes: a.totalMinutes,
          totalHours: Math.round((a.totalMinutes / 60) * 100) / 100,
          studentCount: a.studentCount,
          hoursByDay: Object.fromEntries(
            Object.entries(a.byDay).map(([d, m]) => [d, Math.round((m / 60) * 100) / 100])
          ),
          sessions: a.sessions.sort((x, y) => String(x.day).localeCompare(String(y.day)))
        };
      })
      .sort((x, y) => y.totalMinutes - x.totalMinutes);

    return NextResponse.json({
      filters: { branch: branch || null, day: day || null, instructor: instructor || null },
      instructorCount: data.length,
      totalHours: Math.round((data.reduce((s, d) => s + d.totalMinutes, 0) / 60) * 100) / 100,
      data
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
