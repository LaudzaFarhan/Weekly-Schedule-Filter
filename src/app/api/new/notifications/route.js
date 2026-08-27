import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';
import { maxStudentsFor, withDefaults } from '@/lib/programRules';
import { buildPlacesByStudent, findUnallocatedStudents } from '@/lib/studentAllocation';
import { DAY_NAMES } from '@/utils/constants';

/**
 * Things in New Operations that need someone's attention.
 *
 * Computed on the server in a handful of small queries and returned as a short
 * list, rather than having the browser download the whole dataset to work it
 * out. That keeps the notification bell cheap enough to poll once a minute.
 *
 * Read-only: this endpoint never writes.
 */

const ready = () => ensureTable('internal_leaves');

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function GET() {
  try {
    await ready();

    const today = new Date();
    const todayISO = iso(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = iso(tomorrow);
    const todayName = DAY_NAMES[(today.getDay() + 6) % 7];

    const [students, classes, leaves, leads, rules, ruleRow, sessions] = await Promise.all([
      query('SELECT id, name, level, branch_name, status FROM internal_students'),
      query('SELECT id, day, time, program, student, teacher, branch_name, class_type FROM internal_classes'),
      query('SELECT instructor_name, start_date, end_date, status FROM internal_leaves'),
      query('SELECT id, name, status, branch, trial_date FROM new_crm_leads'),
      query('SELECT branch_name, day, is_open FROM internal_operationals'),
      query('SELECT rules FROM internal_schedule_rules WHERE id = 1').catch(() => ({ rows: [] })),
      // Attendance dates decide whether a replacement or extra session is spent.
      // Forgiving: without them a dated place is treated as still pending, which
      // is the same thing the schedule page does when the dates are missing.
      query('SELECT class_id, session_date FROM internal_class_sessions').catch(() => ({ rows: [] })),
    ]);

    const seatRules = withDefaults(ruleRow.rows[0]?.rules || null);
    const items = [];
    const add = (item) => items.push(item);

    // 1. Students with no class at all. Same rules as the schedule page's
    //    Unallocated panel, so the bell and the panel never disagree.
    const datesByClass = new Map();
    for (const row of sessions.rows) {
      const day = row.session_date instanceof Date
        ? iso(row.session_date)
        : String(row.session_date).slice(0, 10);
      if (!datesByClass.has(row.class_id)) datesByClass.set(row.class_id, []);
      datesByClass.get(row.class_id).push(day);
    }
    const classRows = classes.rows.map((c) => ({
      ...c,
      classType: c.class_type,
      sessionDates: datesByClass.get(c.id) || [],
    }));
    const places = buildPlacesByStudent(classRows, todayISO);
    const unallocated = findUnallocatedStudents(students.rows, places, { activeOnly: true });
    if (unallocated.length > 0) {
      add({
        id: 'unallocated',
        kind: 'unallocated',
        severity: 'warning',
        title: `${unallocated.length} student${unallocated.length === 1 ? '' : 's'} not allocated`,
        detail: unallocated.slice(0, 4).map((s) => s.name).join(', ')
          + (unallocated.length > 4 ? `, +${unallocated.length - 4} more` : ''),
        count: unallocated.length,
        page: 'schedule',
      });
    }

    // 2. Instructors on leave today who still have classes scheduled today.
    const blocking = leaves.rows.filter((l) =>
      !['rejected', 'cancelled', 'canceled', 'declined'].includes(String(l.status || '').toLowerCase()) &&
      iso(new Date(l.start_date)) <= todayISO &&
      iso(new Date(l.end_date)) >= todayISO
    );
    for (const l of blocking) {
      const affected = classes.rows.filter((c) => c.teacher === l.instructor_name && c.day === todayName);
      if (affected.length === 0) continue;
      add({
        id: `leave-${l.instructor_name}-${todayISO}`,
        kind: 'leave',
        severity: 'danger',
        title: `${l.instructor_name} is on leave today`,
        detail: `${affected.length} class${affected.length === 1 ? '' : 'es'} on ${todayName} need cover`,
        count: affected.length,
        page: 'leave',
      });
    }

    // 3. Classes over their seat limit.
    const groups = new Map();
    for (const c of classes.rows) {
      const key = `${c.branch_name}||${c.day}||${c.time}||${c.teacher}`;
      if (!groups.has(key)) groups.set(key, { ...c, seats: 0, programs: [] });
      const g = groups.get(key);
      g.seats += 1;
      if (c.program) g.programs.push(c.program);
    }
    const over = [...groups.values()].filter((g) => g.seats > maxStudentsFor(g.programs[0] || '', seatRules));
    if (over.length > 0) {
      add({
        id: 'over-capacity',
        kind: 'capacity',
        severity: 'danger',
        title: `${over.length} class${over.length === 1 ? '' : 'es'} over capacity`,
        detail: over.slice(0, 3).map((g) =>
          `${g.teacher} ${g.day} ${g.time} (${g.seats}/${maxStudentsFor(g.programs[0] || '', seatRules)})`
        ).join(' · '),
        count: over.length,
        page: 'schedule',
      });
    }

    // 4. Trials booked for today or tomorrow.
    const soon = leads.rows.filter((l) =>
      l.trial_date && (String(l.trial_date).slice(0, 10) === todayISO || String(l.trial_date).slice(0, 10) === tomorrowISO)
    );
    if (soon.length > 0) {
      add({
        id: 'trials-soon',
        kind: 'trial',
        severity: 'info',
        title: `${soon.length} trial${soon.length === 1 ? '' : 's'} today or tomorrow`,
        detail: soon.slice(0, 4).map((l) => `${l.name}${l.branch ? ` (${l.branch})` : ''}`).join(', '),
        count: soon.length,
        page: 'crm',
      });
    }

    // 5. Leads still waiting on a first response.
    const waiting = leads.rows.filter((l) => String(l.status) === 'interest_trial');
    if (waiting.length > 0) {
      add({
        id: 'leads-waiting',
        kind: 'lead',
        severity: 'info',
        title: `${waiting.length} lead${waiting.length === 1 ? '' : 's'} awaiting follow-up`,
        detail: waiting.slice(0, 4).map((l) => l.name).join(', ')
          + (waiting.length > 4 ? `, +${waiting.length - 4} more` : ''),
        count: waiting.length,
        page: 'crm',
      });
    }

    // 6. Branches that have classes but no operating rules configured.
    const configured = new Set(rules.rows.map((r) => r.branch_name));
    const branchesInUse = new Set(classes.rows.map((c) => c.branch_name).filter(Boolean));
    const unconfigured = [...branchesInUse].filter((b) => !configured.has(b));
    if (unconfigured.length > 0) {
      add({
        id: 'no-rules',
        kind: 'operationals',
        severity: 'warning',
        title: `${unconfigured.length} branch${unconfigured.length === 1 ? '' : 'es'} without operating hours`,
        detail: unconfigured.join(', '),
        count: unconfigured.length,
        page: 'operationals',
      });
    }

    const weight = { danger: 0, warning: 1, info: 2 };
    items.sort((a, b) => weight[a.severity] - weight[b.severity]);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      today: todayISO,
      todayName,
      total: items.reduce((n, i) => n + (i.count || 1), 0),
      items,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
