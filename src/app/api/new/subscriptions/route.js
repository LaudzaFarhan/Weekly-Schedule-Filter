import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import {
  calculateSubscriptionStatus,
  parseProgressDetails,
  formatDateISO,
  DEFAULT_TARGET_MEETINGS,
} from '@/utils/subscriptionUtils';
import { NextResponse } from 'next/server';

/**
 * Ensure the tables this route reads exist.
 *
 * Only `internal_live_progress` is self-provisioned. `internal_students` and
 * `internal_classes` come from `init_db.sql` and have no `DEFINITIONS` entry, so
 * asking `ensureTable` for them threw "No schema definition for table" and made
 * every GET and PUT here a 500 — silently, because the caller swallowed it.
 */
const ready = async () => {
  await ensureTable('internal_live_progress');
};

/**
 * Helper to compute full subscription metrics for a student database row
 */
function buildSubscriptionRow(st, classesMap = {}, progressMap = {}) {
  const nameKey = String(st.name || '').trim().toLowerCase();
  const sched = classesMap[nameKey] || null;
  const prog = progressMap[nameKey] || null;

  const { attendedCount, firstMeetingDate } = parseProgressDetails(prog);

  // Check if remarks contain override for startDate or targetMeetings
  let startDateOverride = null;
  let targetOverride = null;
  if (st.remarks && typeof st.remarks === 'string') {
    const startMatch = st.remarks.match(/\[StartDate:\s*(\d{4}-\d{2}-\d{2})\]/i);
    if (startMatch && startMatch[1]) startDateOverride = startMatch[1];
    const targetMatch = st.remarks.match(/\[TargetMeetings:\s*(\d+)\]/i);
    if (targetMatch && targetMatch[1]) targetOverride = Number(targetMatch[1]);
  }

  const startDateStr = startDateOverride || firstMeetingDate || (st.created_at ? formatDateISO(st.created_at) : null);
  const targetMeetings = targetOverride || DEFAULT_TARGET_MEETINGS;

  const levelStr = String(st.level || '').toLowerCase();
  const category = levelStr.includes('kinder') ? 'Kinder' : levelStr.includes('coder') ? 'Coder' : 'Junior';

  const statusResult = calculateSubscriptionStatus({
    startDateStr,
    targetMeetings,
    attendedCount,
  });

  return {
    id: st.id,
    studentName: st.name,
    level: st.level || '—',
    category,
    branchName: st.branch_name || sched?.branch_name || '—',
    instructor: sched?.teacher || '—',
    startDate: startDateStr,
    targetMeetings,
    attendedCount,
    progressPercent: Math.min(100, Math.round((attendedCount / targetMeetings) * 100)),
    predictedEndDate: statusResult.predictedEndDate ? formatDateISO(statusResult.predictedEndDate) : null,
    status: statusResult.status,
    isOverdue: statusResult.isOverdue,
    daysRemaining: statusResult.daysRemaining,
    createdAt: st.created_at,
    updatedAt: st.updated_at,
  };
}

/**
 * GET: Retrieve all student subscriptions with calculated end dates and overdue flags.
 * Query Parameters: ?search=&branch=&status=&category=&limit=
 */
export async function GET(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);

    // Fetch students, classes, and progress in parallel for maximum speed
    const [studentsRes, classesRes, progressRes] = await Promise.all([
      query(`SELECT * FROM internal_students ORDER BY name ASC`),
      query(`SELECT * FROM internal_classes`),
      query(`SELECT * FROM internal_live_progress`),
    ]);

    const classesMap = {};
    for (const c of classesRes.rows) {
      if (c.student && c.teacher) {
        classesMap[String(c.student).trim().toLowerCase()] = c;
      }
    }

    const progressMap = {};
    for (const p of progressRes.rows) {
      if (p.student_name) {
        progressMap[String(p.student_name).trim().toLowerCase()] = p;
      }
    }

    let rows = studentsRes.rows.map((st) => buildSubscriptionRow(st, classesMap, progressMap));

    // Filter by query parameters
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const status = (searchParams.get('status') || '').trim();
    const branch = (searchParams.get('branch') || '').trim();
    const category = (searchParams.get('category') || '').trim();
    const limit = Number(searchParams.get('limit')) || 0;

    if (search) {
      rows = rows.filter((r) =>
        r.studentName.toLowerCase().includes(search) ||
        r.instructor.toLowerCase().includes(search) ||
        r.branchName.toLowerCase().includes(search) ||
        r.level.toLowerCase().includes(search)
      );
    }
    if (status && status !== 'all') {
      rows = rows.filter((r) => r.status.toLowerCase() === status.toLowerCase());
    }
    if (branch && branch !== 'all') {
      rows = rows.filter((r) => r.branchName.toLowerCase() === branch.toLowerCase());
    }
    if (category && category !== 'all') {
      rows = rows.filter((r) => r.category.toLowerCase() === category.toLowerCase());
    }

    if (limit > 0) {
      rows = rows.slice(0, limit);
    }

    return NextResponse.json({
      total: rows.length,
      active: rows.filter((r) => r.status === 'Active').length,
      endingSoon: rows.filter((r) => r.status === 'Ending Soon').length,
      overdue: rows.filter((r) => r.status === 'Overdue').length,
      completed: rows.filter((r) => r.status === 'Completed').length,
      subscriptions: rows,
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: Update subscription start date or target meetings for a student
 * Body: { studentId, startDate, targetMeetings }
 */
export async function PUT(req) {
  try {
    await ready();
    const body = await req.json();
    const { studentId, studentName, startDate, targetMeetings } = body;

    if (!studentId && !studentName) {
      return NextResponse.json({ error: 'Missing studentId or studentName' }, { status: 400 });
    }

    let fetchSql = `SELECT * FROM internal_students WHERE `;
    let fetchParams = [];
    if (studentId) {
      fetchSql += `id = $1`;
      fetchParams = [studentId];
    } else {
      fetchSql += `LOWER(name) = LOWER($1)`;
      fetchParams = [studentName];
    }

    const stRes = await query(fetchSql, fetchParams);
    if (stRes.rowCount === 0) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    const st = stRes.rows[0];
    let remarks = st.remarks || '';

    if (startDate) {
      remarks = remarks.replace(/\[StartDate:[^\]]+\]\s*/g, '').trim();
      remarks = `${remarks ? `${remarks} ` : ''}[StartDate: ${startDate}]`.trim();
    }
    if (targetMeetings) {
      remarks = remarks.replace(/\[TargetMeetings:[^\]]+\]\s*/g, '').trim();
      remarks = `${remarks ? `${remarks} ` : ''}[TargetMeetings: ${targetMeetings}]`.trim();
    }

    const updateRes = await query(
      `UPDATE internal_students SET remarks = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [remarks, st.id]
    );

    const [classesRes, progressRes] = await Promise.all([
      query(`SELECT * FROM internal_classes WHERE LOWER(student) = LOWER($1)`, [st.name]),
      query(`SELECT * FROM internal_live_progress WHERE LOWER(student_name) = LOWER($1)`, [st.name]),
    ]);

    const classesMap = {};
    if (classesRes.rowCount > 0) classesMap[String(st.name).trim().toLowerCase()] = classesRes.rows[0];
    const progressMap = {};
    if (progressRes.rowCount > 0) progressMap[String(st.name).trim().toLowerCase()] = progressRes.rows[0];

    const updatedRow = buildSubscriptionRow(updateRes.rows[0], classesMap, progressMap);
    return NextResponse.json(updatedRow);
  } catch (error) {
    console.error('Error updating subscription:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
