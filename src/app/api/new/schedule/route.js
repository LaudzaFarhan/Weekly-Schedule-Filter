import { query } from '@/lib/db';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';

/** Attendance dates live in a companion table; create it on first use. */
const ready = () => ensureTable('internal_class_sessions');

// Map database snake_case row to frontend camelCase object
const mapRow = (row, dates = []) => ({
  id: row.id,
  day: row.day,
  time: row.time,
  program: row.program,
  student: row.student,
  teacher: row.teacher,
  branchName: row.branch_name,
  classType: row.class_type,
  // Dates a non-regular student actually attends. Empty for a Regular, who
  // keeps this place every week.
  sessionDates: dates,
  remarks: row.remarks,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const toISODate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Attendance dates for the given class rows, as Map(classId -> [ISO dates]).
 * Deliberately forgiving: if the companion table is unreachable, classes still
 * list with no dates rather than the whole endpoint failing.
 */
async function datesFor(ids) {
  const out = new Map();
  if (ids.length === 0) return out;
  try {
    const res = await query(
      `SELECT class_id, session_date FROM internal_class_sessions
       WHERE class_id = ANY($1::int[]) ORDER BY session_date ASC`,
      [ids]
    );
    for (const r of res.rows) {
      if (!out.has(r.class_id)) out.set(r.class_id, []);
      out.get(r.class_id).push(toISODate(r.session_date));
    }
  } catch (err) {
    console.warn(`[schedule] Could not read attendance dates: ${err.message}`);
  }
  return out;
}

/** Replace the stored dates for one class row. */
async function replaceDates(classId, dates) {
  await query('DELETE FROM internal_class_sessions WHERE class_id = $1', [classId]);
  for (const d of dates) {
    await query(
      `INSERT INTO internal_class_sessions (class_id, session_date) VALUES ($1, $2)
       ON CONFLICT (class_id, session_date) DO NOTHING`,
      [classId, d]
    );
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The attendance kinds this column accepts. Whitelisted because the column is
 * free text: a typo would otherwise create a kind that no screen knows how to
 * render and that nothing would ever expire.
 */
const CLASS_TYPES = ['Regular', 'Replacement', 'Additional', 'Trial'];

/** Reject anything outside the known kinds, defaulting a missing one. */
function normaliseClassType(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { classType: 'Regular' };
  const match = CLASS_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  if (!match) {
    return { error: `classType must be one of ${CLASS_TYPES.join(', ')} — got "${raw}"` };
  }
  return { classType: match };
}

/**
 * Validate and normalise the attendance dates.
 * Regular students attend weekly, so any dates on them are dropped.
 */
function normaliseSessionDates(value, classType) {
  if (String(classType || 'Regular') === 'Regular') return { dates: [] };
  if (value == null) return { dates: [] };
  if (!Array.isArray(value)) return { error: 'sessionDates must be an array of "YYYY-MM-DD" strings' };

  const dates = [];
  for (const raw of value) {
    const d = String(raw || '').trim();
    if (!ISO_DATE.test(d)) return { error: `sessionDates contains "${d}" — expected "YYYY-MM-DD"` };
    if (!dates.includes(d)) dates.push(d);
  }
  dates.sort();
  return { dates };
}

/**
 * GET: Fetch internal schedule classes.
 * Optional: ?search=&day=&branch=&teacher=&classType=&limit=
 * With no parameters this returns every class, as before.
 */
export async function GET(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const { clause, params, limit } = buildListQuery(searchParams, {
      searchColumns: ['student', 'teacher', 'program', 'branch_name', 'time'],
      filters: {
        day: 'day',
        branch: 'branch_name',
        teacher: 'teacher',
        classType: 'class_type',
      },
    });
    const { sql, params: finalParams } = withLimit(
      `SELECT * FROM internal_classes ${clause} ORDER BY id DESC`,
      params,
      limit
    );
    const res = await query(sql, finalParams);
    const dates = await datesFor(res.rows.map((r) => r.id));
    return NextResponse.json(res.rows.map((r) => mapRow(r, dates.get(r.id) || [])));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Create a new internal class
 */
export async function POST(req) {
  try {
    await ready();
    const body = await req.json();
    const { day, time, program, student, teacher, branchName, classType, remarks } = body;

    if (!day || !time || !program || !student || !teacher || !branchName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const kind = normaliseClassType(classType);
    if (kind.error) return NextResponse.json({ error: kind.error }, { status: 400 });

    const { dates, error } = normaliseSessionDates(body.sessionDates, kind.classType);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const sql = `
      INSERT INTO internal_classes (day, time, program, student, teacher, branch_name, class_type, remarks)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const params = [
      day, time, program, student, teacher, branchName,
      kind.classType, remarks || null,
    ];
    const res = await query(sql, params);
    const created = res.rows[0];
    if (dates.length) await replaceDates(created.id, dates);

    return NextResponse.json(mapRow(created, dates));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: Update an existing internal class
 */
export async function PUT(req) {
  try {
    await ready();
    const body = await req.json();
    const { id, day, time, program, student, teacher, branchName, classType, remarks } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing class ID' }, { status: 400 });
    }

    const kind = normaliseClassType(classType);
    if (kind.error) return NextResponse.json({ error: kind.error }, { status: 400 });

    const { dates, error } = normaliseSessionDates(body.sessionDates, kind.classType);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const sql = `
      UPDATE internal_classes
      SET day = $1, time = $2, program = $3, student = $4, teacher = $5, branch_name = $6,
          class_type = $7, remarks = $8
      WHERE id = $9
      RETURNING *
    `;
    const params = [
      day, time, program, student, teacher, branchName,
      kind.classType, remarks || null, id,
    ];
    const res = await query(sql, params);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 });
    }

    // Attendance dates are replaced wholesale, matching the rest of this PUT.
    await replaceDates(id, dates);

    return NextResponse.json(mapRow(res.rows[0], dates));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Delete an internal class
 */
export async function DELETE(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const all = searchParams.get('all');

    if (all === 'true' || id === 'all') {
      const res = await query('DELETE FROM internal_classes RETURNING *');
      await query('DELETE FROM internal_class_sessions');
      return NextResponse.json({
        success: true,
        count: res.rowCount,
        message: 'All internal schedule classes deleted successfully',
      });
    }

    if (!id) {
      return NextResponse.json({ error: 'Missing class ID in query parameter' }, { status: 400 });
    }

    const res = await query('DELETE FROM internal_classes WHERE id = $1 RETURNING *', [id]);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 });
    }

    // No foreign key on the companion table, so clean up its rows here rather
    // than leaving attendance dates pointing at a class that no longer exists.
    await query('DELETE FROM internal_class_sessions WHERE class_id = $1', [id]);

    return NextResponse.json({ success: true, message: 'Class deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
