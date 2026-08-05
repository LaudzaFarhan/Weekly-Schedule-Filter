import { query } from '@/lib/db';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';

const ready = () => ensureTable('internal_meetings');

const toISODate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const mapRow = (row) => ({
  id: row.id,
  title: row.title,
  meetingDate: toISODate(row.meeting_date),
  day: row.day,
  time: row.time,
  branchName: row.branch_name,
  location: row.location,
  agenda: row.agenda,
  invitedTeachers: row.invited_teachers || [],
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/**
 * GET: Fetch internal meetings
 * Optional: ?search=&branch=&status=&date=&limit=
 */
export async function GET(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const { clause, params, limit } = buildListQuery(searchParams, {
      searchColumns: ['title', 'location', 'agenda', 'branch_name', 'day'],
      filters: {
        branch: 'branch_name',
        status: 'status',
      },
    });

    const { sql, params: finalParams } = withLimit(
      `SELECT * FROM internal_meetings ${clause} ORDER BY meeting_date DESC, id DESC`,
      params,
      limit
    );
    const res = await query(sql, finalParams);
    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    console.error('Error fetching meetings:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Create a new meeting
 */
export async function POST(req) {
  try {
    await ready();
    const body = await req.json();
    const { title, meetingDate, day, time, branchName, location, agenda, invitedTeachers, status, createdBy } = body;

    if (!title || !meetingDate || !day || !time || !branchName) {
      return NextResponse.json({ error: 'Missing required meeting fields (title, date, day, time, branch)' }, { status: 400 });
    }

    const sql = `
      INSERT INTO internal_meetings (title, meeting_date, day, time, branch_name, location, agenda, invited_teachers, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
      RETURNING *
    `;
    const params = [
      title,
      meetingDate,
      day,
      time,
      branchName,
      location || null,
      agenda || null,
      JSON.stringify(invitedTeachers || []),
      status || 'Scheduled',
      createdBy || null
    ];

    const res = await query(sql, params);
    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    console.error('Error creating meeting:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: Update an existing meeting (including attendance status)
 */
export async function PUT(req) {
  try {
    await ready();
    const body = await req.json();
    const { id, title, meetingDate, day, time, branchName, location, agenda, invitedTeachers, status } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing meeting ID' }, { status: 400 });
    }

    const sql = `
      UPDATE internal_meetings
      SET title = COALESCE($1, title),
          meeting_date = COALESCE($2, meeting_date),
          day = COALESCE($3, day),
          time = COALESCE($4, time),
          branch_name = COALESCE($5, branch_name),
          location = COALESCE($6, location),
          agenda = COALESCE($7, agenda),
          invited_teachers = COALESCE($8::jsonb, invited_teachers),
          status = COALESCE($9, status)
      WHERE id = $10
      RETURNING *
    `;
    const params = [
      title || null,
      meetingDate || null,
      day || null,
      time || null,
      branchName || null,
      location !== undefined ? location : null,
      agenda !== undefined ? agenda : null,
      invitedTeachers ? JSON.stringify(invitedTeachers) : null,
      status || null,
      id
    ];

    const res = await query(sql, params);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    console.error('Error updating meeting:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Delete a meeting
 */
export async function DELETE(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing meeting ID' }, { status: 400 });
    }

    const res = await query('DELETE FROM internal_meetings WHERE id = $1 RETURNING *', [id]);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Meeting deleted successfully' });
  } catch (error) {
    console.error('Error deleting meeting:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
