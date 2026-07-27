import { query } from '@/lib/db';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { NextResponse } from 'next/server';

const mapRow = (row) => ({
  id: row.id,
  name: row.name,
  level: row.level,
  branches: row.branches || [],
  contact: row.contact,
  status: row.status,
  remarks: row.remarks,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/**
 * GET: Fetch internal instructors.
 * Optional: ?search=&branch=&level=&status=&limit=
 * `branch` also matches instructors assigned to "All Branches".
 * With no parameters this returns every instructor, as before.
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const { clause, params, limit } = buildListQuery(searchParams, {
      searchColumns: ['name', 'level', 'contact'],
      filters: { level: 'level', status: 'status' },
      arrayFilters: { branch: 'branches' },
    });
    const { sql, params: finalParams } = withLimit(
      `SELECT * FROM internal_instructors ${clause} ORDER BY name ASC`,
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
 * POST: Create a new instructor record
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { name, level, branches, contact, status, remarks } = body;

    if (!name || !level || !branches || !contact) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const sql = `
      INSERT INTO internal_instructors (name, level, branches, contact, status, remarks)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const params = [name, level, branches || [], contact, status || 'Active', remarks || null];
    const res = await query(sql, params);

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: Update an existing instructor record
 */
export async function PUT(req) {
  try {
    const body = await req.json();
    const { id, name, level, branches, contact, status, remarks } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing instructor ID' }, { status: 400 });
    }

    const sql = `
      UPDATE internal_instructors
      SET name = $1, level = $2, branches = $3, contact = $4, status = $5, remarks = $6
      WHERE id = $7
      RETURNING *
    `;
    const params = [name, level, branches || [], contact, status || 'Active', remarks || null, id];
    const res = await query(sql, params);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Instructor not found' }, { status: 404 });
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Delete an instructor record
 */
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing instructor ID in query parameter' }, { status: 400 });
    }

    const res = await query('DELETE FROM internal_instructors WHERE id = $1 RETURNING *', [id]);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Instructor not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Instructor deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
