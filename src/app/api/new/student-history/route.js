import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';

/** Create the table on first use so a fresh database needs no manual migration. */
const ready = () => ensureTable('internal_student_history');

const mapRow = (row) => ({
  id: row.id,
  studentId: row.student_id,
  studentName: row.student_name,
  branchName: row.branch_name,
  note: row.note,
  createdAt: row.created_at
});

/**
 * GET: Branch assignment history.
 * Optional filters: ?studentId=12&branch=Bekasi
 * Oldest first, so the result reads as a timeline.
 */
export async function GET(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const studentId = searchParams.get('studentId');
    const branch = searchParams.get('branch');

    const where = [];
    const params = [];
    if (studentId) { params.push(studentId); where.push(`student_id = $${params.length}`); }
    if (branch) { params.push(branch); where.push(`branch_name = $${params.length}`); }

    const sql = `
      SELECT * FROM internal_student_history
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY student_id ASC, created_at ASC
    `;
    const res = await query(sql, params);
    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Append a branch assignment.
 * Body: { studentId, branchName, studentName?, note? }
 */
export async function POST(req) {
  try {
    await ready();
    const body = await req.json();
    const { studentId, branchName, studentName, note } = body;

    if (!studentId || !branchName) {
      return NextResponse.json({ error: 'studentId and branchName are required' }, { status: 400 });
    }

    const sql = `
      INSERT INTO internal_student_history (student_id, student_name, branch_name, note)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const res = await query(sql, [studentId, studentName || null, branchName, note || null]);
    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Remove one entry with ?id=, or a student's whole history
 * with ?studentId=
 */
export async function DELETE(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const studentId = searchParams.get('studentId');

    if (id) {
      const res = await query('DELETE FROM internal_student_history WHERE id = $1 RETURNING *', [id]);
      if (res.rowCount === 0) {
        return NextResponse.json({ error: 'History entry not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, deleted: 1 });
    }

    if (studentId) {
      const res = await query('DELETE FROM internal_student_history WHERE student_id = $1', [studentId]);
      return NextResponse.json({ success: true, deleted: res.rowCount });
    }

    return NextResponse.json({ error: 'Provide ?id= or ?studentId=' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
