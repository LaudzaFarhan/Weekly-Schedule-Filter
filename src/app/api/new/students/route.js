import { bulkWipeStudents } from '@/lib/bulkWipeStudents';
import { query } from '@/lib/db';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { matchesConfirmationPhrase } from '@/lib/wipeConfirmation';
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
 * GET: Fetch internal students.
 * Optional: ?search=&branch=&status=&limit=
 * With no parameters this returns every student, as before.
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const { clause, params, limit } = buildListQuery(searchParams, {
      searchColumns: ['name', 'parent_name', 'contact', 'level'],
      filters: { branch: 'branch_name', status: 'status' },
    });
    const { sql, params: finalParams } = withLimit(
      `SELECT * FROM internal_students ${clause} ORDER BY name ASC`,
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
 * POST: Create a new student record
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { name, level, branchName, parentName, contact, status, remarks } = body;

    if (!name || !level || !branchName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const sql = `
      INSERT INTO internal_students (name, level, branch_name, parent_name, contact, status, remarks)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const params = [name, level, branchName, parentName || null, contact || '', status || 'Active', remarks || null];
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
    const params = [name, level, branchName, parentName || null, contact || '', status || 'Active', remarks || null, id];
    const res = await query(sql, params);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** The 400 sent when no id and no usable confirmation value are supplied. Req 5.2, 5.5 */
const CONFIRMATION_REQUIRED_MESSAGE =
  'Provide ?id=<studentId> to delete one student, or send '
  + '{ "confirm": "DELETE ALL STUDENTS" } to delete every student record. '
  + 'The confirmation phrase is required for a bulk delete.';

/** The 400 sent when a confirmation value is present but wrong. Req 5.3 */
const CONFIRMATION_MISMATCH_MESSAGE =
  'The confirmation phrase does not match. Send exactly "DELETE ALL STUDENTS" '
  + '(case-sensitive) to delete every student record.';

/** The 500 sent when the wipe transaction misses its deadline. Req 6.8 */
const WIPE_TIMEOUT_MESSAGE =
  'The bulk delete exceeded its 30-second time limit and was rolled back. '
  + 'No records were deleted.';

/**
 * DELETE: delete one student record by id, or every student record with a
 * typed confirmation phrase in the request body.
 *
 * `?id=` always wins. A request carrying an id is a single-record delete and
 * its body is never read, even when that body holds a valid confirmation
 * phrase (Req 5.4, 5.6). Only a request with no id can reach the bulk path,
 * and only with an exact confirmation phrase (Req 5.1).
 *
 * Both branches run after `middleware.js` has already admitted the request,
 * whether as same-origin or by API key, so the confirmation requirement
 * applies to every admitted caller (Req 5.8).
 */
export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  // Single-record delete: unchanged behaviour, body ignored. Req 5.4, 5.6, 5.7
  if (id) {
    try {
      const res = await query('DELETE FROM internal_students WHERE id = $1 RETURNING *', [id]);

      if (res.rowCount === 0) {
        return NextResponse.json({ error: 'Student not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, message: 'Student deleted successfully' });
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // No id: the only remaining legal request is a confirmed bulk wipe.
  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null; // unparseable body, treated as no confirmation. Req 5.2
  }
  const confirm = body && typeof body === 'object' ? body.confirm : undefined;

  // Missing, blank or unusable confirmation. One message names both legal
  // request shapes, because Req 5.2 and Req 5.5 describe the same input.
  if (confirm === undefined || confirm === null || String(confirm).trim() === '') {
    return NextResponse.json({ error: CONFIRMATION_REQUIRED_MESSAGE }, { status: 400 });
  }

  // Present but wrong: rejected before any database call is made. Req 5.3
  if (!matchesConfirmationPhrase(String(confirm))) {
    return NextResponse.json({ error: CONFIRMATION_MISMATCH_MESSAGE }, { status: 400 });
  }

  try {
    // Req 6.1, 6.5, 7.1, 9.1 — three counts, always present, zeros included.
    const counts = await bulkWipeStudents();
    return NextResponse.json({ success: true, ...counts });
  } catch (error) {
    // Name check rather than instanceof: the error may cross module instances.
    const message = error?.name === 'WipeTimeoutError'
      ? WIPE_TIMEOUT_MESSAGE
      : error?.message || 'Failed to delete all students';
    return NextResponse.json({ error: message }, { status: 500 }); // Req 6.2, 6.8
  }
}
