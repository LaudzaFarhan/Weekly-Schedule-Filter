import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';

const ready = () => Promise.all([
  ensureTable('internal_meetings'),
  ensureTable('internal_leaves')
]);

/**
 * POST /api/new/meetings/predict-conflicts
 * Predict schedule conflicts for a list of teachers on a specific day, date, and time slot.
 * Payload: { day, meetingDate, time, teacherNames, branchName }
 */
export async function POST(req) {
  try {
    await ready();
    const body = await req.json();
    const { day, meetingDate, time, teacherNames, branchName } = body;

    if (!day || !meetingDate || !time) {
      return NextResponse.json({ error: 'Missing required prediction fields: day, meetingDate, time' }, { status: 400 });
    }

    // 1. Fetch instructors
    let instructorsRes;
    if (Array.isArray(teacherNames) && teacherNames.length > 0) {
      instructorsRes = await query(
        `SELECT DISTINCT name, branches FROM internal_instructors WHERE name = ANY($1::text[])`,
        [teacherNames]
      );
    } else {
      instructorsRes = await query(`SELECT DISTINCT name, branches FROM internal_instructors WHERE status = 'Active'`);
    }

    const allTeachers = instructorsRes.rows.map(r => ({
      name: r.name,
      branches: r.branches || []
    }));

    // If specific teacherNames were requested but not in internal_instructors DB table yet, include them
    if (Array.isArray(teacherNames)) {
      teacherNames.forEach(tName => {
        if (!allTeachers.some(t => t.name.toLowerCase() === String(tName).toLowerCase())) {
          allTeachers.push({ name: tName, branches: [] });
        }
      });
    }

    // 2. Fetch branch operation status for the day from internal_operationals
    let branchOps = [];
    try {
      const opRes = await query(
        `SELECT branch_name, slots, is_open FROM internal_operationals WHERE LOWER(day) = LOWER($1)`,
        [day]
      );
      branchOps = opRes.rows;
    } catch (e) {
      console.warn('Could not query internal_operationals:', e);
    }

    // 3. Fetch teaching classes matching the day and time slot
    const classesRes = await query(
      `SELECT teacher, program, student, branch_name, time, class_type
       FROM internal_classes
       WHERE LOWER(day) = LOWER($1) AND LOWER(time) = LOWER($2)`,
      [day, time]
    );
    const assignedClasses = classesRes.rows;

    // 4. Fetch approved leaves overlapping meetingDate
    const leavesRes = await query(
      `SELECT instructor_name, reason, start_date, end_date
       FROM internal_leaves
       WHERE status = 'Approved'
         AND $1::date >= start_date AND $1::date <= end_date`,
      [meetingDate]
    );
    const activeLeaves = leavesRes.rows;

    // 5. Build prediction report for each teacher
    const predictions = allTeachers.map(teacher => {
      const tName = teacher.name;
      const lowerTName = tName.toLowerCase();
      const teacherBranches = Array.isArray(teacher.branches) ? teacher.branches : [];

      // Check branch OFF / non-operational status
      let isBranchOff = false;
      let offBranchName = '';

      if (branchName && branchName !== 'All Branches' && branchName !== 'all') {
        const op = branchOps.find(b => String(b.branch_name).toLowerCase() === String(branchName).toLowerCase());
        if (op && (op.is_open === false || (Array.isArray(op.slots) && op.slots.length === 0))) {
          isBranchOff = true;
          offBranchName = branchName;
        }
      } else if (teacherBranches.length > 0 && branchOps.length > 0) {
        const openForTeacher = teacherBranches.some(tb => {
          const op = branchOps.find(b => String(b.branch_name).toLowerCase() === String(tb).toLowerCase());
          return !op || op.is_open !== false;
        });
        if (!openForTeacher) {
          isBranchOff = true;
          offBranchName = teacherBranches.join(', ');
        }
      }

      if (isBranchOff) {
        return {
          name: tName,
          status: 'branch_off',
          available: false,
          badgeColor: 'secondary',
          badgeText: 'Branch OFF',
          details: `Branch ${offBranchName ? `(${offBranchName})` : ''} is OFF / non-operational on ${day}`
        };
      }

      // Check leave status
      const leave = activeLeaves.find(l => String(l.instructor_name || '').toLowerCase() === lowerTName);
      if (leave) {
        return {
          name: tName,
          status: 'on_leave',
          available: false,
          badgeColor: 'warning',
          badgeText: 'On Leave',
          details: `On leave: ${leave.reason || 'Approved leave'}`
        };
      }

      // Check class teaching schedule collision
      const classesTaught = assignedClasses.filter(c => String(c.teacher || '').toLowerCase() === lowerTName);
      if (classesTaught.length > 0) {
        const classInfo = classesTaught.map(c => `${c.program} (${c.student}) @ ${c.branch_name}`).join(', ');
        return {
          name: tName,
          status: 'busy_class',
          available: false,
          badgeColor: 'danger',
          badgeText: 'Teaching Class',
          details: `Teaching class: ${classInfo}`,
          classes: classesTaught
        };
      }

      // Available
      return {
        name: tName,
        status: 'available',
        available: true,
        badgeColor: 'success',
        badgeText: 'Available',
        details: 'Free to attend'
      };
    });

    return NextResponse.json({
      day,
      meetingDate,
      time,
      branchName: branchName || 'All',
      totalTeachers: predictions.length,
      availableCount: predictions.filter(p => p.available).length,
      conflictCount: predictions.filter(p => !p.available).length,
      predictions
    });
  } catch (error) {
    console.error('Error predicting meeting conflicts:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
