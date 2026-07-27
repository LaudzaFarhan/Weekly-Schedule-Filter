import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';

/** Create the table on first use so a fresh database needs no manual migration. */
const ready = () => ensureTable('internal_leaves');

/** Dates come back as "YYYY-MM-DD" so the UI can compare them as strings. */
const toISODate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const mapRow = (row) => ({
  id: row.id,
  name: row.instructor_name,
  startDate: toISODate(row.start_date),
  endDate: toISODate(row.end_date),
  reason: row.reason,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET: Leave records, soonest first.
 * Optional filters: ?instructor=Angel&from=2026-07-01&to=2026-07-31&status=Approved
 * `from`/`to` return any leave that overlaps the window.
 */
export async function GET(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const instructor = searchParams.get('instructor');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const status = searchParams.get('status');

    const where = [];
    const params = [];
    if (instructor) { params.push(instructor); where.push(`instructor_name = $${params.length}`); }
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    // Overlap test: leave starts before the window ends and ends after it starts.
    if (to) { params.push(to); where.push(`start_date <= $${params.length}`); }
    if (from) { params.push(from); where.push(`end_date >= $${params.length}`); }

    const sql = `
      SELECT * FROM internal_leaves
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY start_date DESC, instructor_name ASC
    `;
    const res = await query(sql, params);
    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Record a leave.
 * Body: { name, startDate, endDate, reason?, status? }
 */
export async function POST(req) {
  try {
    await ready();
    const body = await req.json();
    const { name, startDate, endDate, reason, status } = body;

    if (!name || !startDate || !endDate) {
      return NextResponse.json({ error: 'name, startDate and endDate are required' }, { status: 400 });
    }
    if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
      return NextResponse.json({ error: 'Dates must be "YYYY-MM-DD"' }, { status: 400 });
    }
    if (endDate < startDate) {
      return NextResponse.json({ error: 'endDate must be on or after startDate' }, { status: 400 });
    }

    // Reject an identical range for the same instructor.
    const dupe = await query(
      'SELECT id FROM internal_leaves WHERE instructor_name = $1 AND start_date = $2 AND end_date = $3',
      [name, startDate, endDate]
    );
    if (dupe.rowCount > 0) {
      return NextResponse.json(
        { error: `${name} already has leave recorded for ${startDate} to ${endDate}` },
        { status: 409 }
      );
    }

    const sql = `
      INSERT INTO internal_leaves (instructor_name, start_date, end_date, reason, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const res = await query(sql, [name, startDate, endDate, reason || null, status || 'Approved']);
    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: Update a leave record.
 * Body: { id, name?, startDate?, endDate?, reason?, status? }
 */
export async function PUT(req) {
  try {
    await ready();
    const body = await req.json();
    const { id, name, startDate, endDate, reason, status } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing leave ID' }, { status: 400 });
    }
    if (startDate && !ISO_DATE.test(startDate)) {
      return NextResponse.json({ error: 'startDate must be "YYYY-MM-DD"' }, { status: 400 });
    }
    if (endDate && !ISO_DATE.test(endDate)) {
      return NextResponse.json({ error: 'endDate must be "YYYY-MM-DD"' }, { status: 400 });
    }
    if (startDate && endDate && endDate < startDate) {
      return NextResponse.json({ error: 'endDate must be on or after startDate' }, { status: 400 });
    }

    const sql = `
      UPDATE internal_leaves
      SET instructor_name = COALESCE($1, instructor_name),
          start_date = COALESCE($2::date, start_date),
          end_date = COALESCE($3::date, end_date),
          reason = $4,
          status = COALESCE($5, status)
      WHERE id = $6
      RETURNING *
    `;
    const res = await query(sql, [
      name || null,
      startDate || null,
      endDate || null,
      reason ?? null,
      status || null,
      id
    ]);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Leave record not found' }, { status: 404 });
    }
    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Remove a leave record — /api/new/leave?id={id}
 */
export async function DELETE(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing leave ID in query parameter' }, { status: 400 });
    }

    const res = await query('DELETE FROM internal_leaves WHERE id = $1 RETURNING *', [id]);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Leave record not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: 'Leave record deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
