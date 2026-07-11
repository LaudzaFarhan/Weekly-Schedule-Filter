import { query } from '@/lib/db';
import { NextResponse } from 'next/server';

const mapRow = (row) => ({
  id: row.id,
  name: row.name,
  level: row.level,
  branchName: row.branch_name,
  parentName: row.parent_name,
  contact: row.contact,
  status: row.status,
  remarks: row.remarks,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/**
 * GET: Fetch all internal students
 */
export async function GET() {
  try {
    const res = await query('SELECT * FROM internal_students ORDER BY name ASC');
    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Create a new student record
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { name, level, branchName, parentName, contact, status, remarks } = body;

    if (!name || !level || !branchName || !contact) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const sql = `
      INSERT INTO internal_students (name, level, branch_name, parent_name, contact, status, remarks)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const params = [name, level, branchName, parentName || null, contact, status || 'Active', remarks || null];
    const res = await query(sql, params);

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: Update an existing student record
 */
export async function PUT(req) {
  try {
    const body = await req.json();
    const { id, name, level, branchName, parentName, contact, status, remarks } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing student ID' }, { status: 400 });
    }

    const sql = `
      UPDATE internal_students
      SET name = $1, level = $2, branch_name = $3, parent_name = $4, contact = $5, status = $6, remarks = $7
      WHERE id = $8
      RETURNING *
    `;
    const params = [name, level, branchName, parentName || null, contact, status || 'Active', remarks || null, id];
    const res = await query(sql, params);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Delete a student record
 */
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing student ID in query parameter' }, { status: 400 });
    }

    const res = await query('DELETE FROM internal_students WHERE id = $1 RETURNING *', [id]);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Student deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
