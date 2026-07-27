import { query } from '@/lib/db';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { NextResponse } from 'next/server';

// Map database snake_case row to frontend camelCase object
const mapRow = (row) => ({
  id: row.id,
  day: row.day,
  time: row.time,
  program: row.program,
  student: row.student,
  teacher: row.teacher,
  branchName: row.branch_name,
  classType: row.class_type,
  remarks: row.remarks,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/**
 * GET: Fetch internal schedule classes.
 * Optional: ?search=&day=&branch=&teacher=&classType=&limit=
 * With no parameters this returns every class, as before.
 */
export async function GET(req) {
  try {
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
    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Create a new internal class
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { day, time, program, student, teacher, branchName, classType, remarks } = body;

    if (!day || !time || !program || !student || !teacher || !branchName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const sql = `
      INSERT INTO internal_classes (day, time, program, student, teacher, branch_name, class_type, remarks)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const params = [day, time, program, student, teacher, branchName, classType || 'Regular', remarks || null];
    const res = await query(sql, params);
    
    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: Update an existing internal class
 */
export async function PUT(req) {
  try {
    const body = await req.json();
    const { id, day, time, program, student, teacher, branchName, classType, remarks } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing class ID' }, { status: 400 });
    }

    const sql = `
      UPDATE internal_classes
      SET day = $1, time = $2, program = $3, student = $4, teacher = $5, branch_name = $6, class_type = $7, remarks = $8
      WHERE id = $9
      RETURNING *
    `;
    const params = [day, time, program, student, teacher, branchName, classType || 'Regular', remarks || null, id];
    const res = await query(sql, params);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 });
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Delete an internal class
 */
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing class ID in query parameter' }, { status: 400 });
    }

    const res = await query('DELETE FROM internal_classes WHERE id = $1 RETURNING *', [id]);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Class deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
