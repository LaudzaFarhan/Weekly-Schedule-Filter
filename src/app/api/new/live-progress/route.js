import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';
import { CONTINUATION_OPTIONS, LESSONS_PER_LEVEL, CATEGORIES } from '@/lib/programRules';

/** Progress lives in a table added later; create it on first use. */
const ready = () => ensureTable('internal_live_progress');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const mapRow = (row) => ({
  id: row.id,
  studentName: row.student_name,
  programCode: row.program_code,
  category: row.category,
  // Sparse map of lesson number -> { date, note }. Absent means not attended.
  attendance: row.attendance || {},
  // Level code -> true once the video for that level has been sent.
  videos: row.videos || {},
  continuation: row.continuation,
  continuationNote: row.continuation_note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Validate the attendance map.
 *
 * Rejected rather than coerced: a lesson number outside the level, or a date the
 * grid cannot parse, would show as a silently missing tick, which is worse than
 * a failed save.
 */
function normaliseAttendance(value) {
  if (value == null) return { attendance: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'attendance must be an object keyed by lesson number' };
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > LESSONS_PER_LEVEL) {
      return { error: `attendance key "${key}" is not a lesson from 1 to ${LESSONS_PER_LEVEL}` };
    }
    if (entry == null) continue; // an explicit null clears the tick
    if (typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: `attendance.${key} must be an object` };
    }
    const date = entry.date == null ? null : String(entry.date).trim();
    if (date && !ISO_DATE.test(date)) {
      return { error: `attendance.${key}.date is "${date}" — expected "YYYY-MM-DD"` };
    }
    out[n] = { date: date || null, note: entry.note == null ? '' : String(entry.note) };
  }
  return { attendance: out };
}

/** Validate the video flags. Only ever true; a false flag is simply dropped. */
function normaliseVideos(value) {
  if (value == null) return { videos: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'videos must be an object keyed by level code' };
  }
  const out = {};
  for (const [key, on] of Object.entries(value)) {
    const level = String(key).trim();
    if (!level) return { error: 'videos contains an empty level code' };
    if (on) out[level] = true;
  }
  return { videos: out };
}

/** Reject an unknown continuation so the dropdown stays the source of truth. */
function normaliseContinuation(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { continuation: CONTINUATION_OPTIONS[0] };
  const match = CONTINUATION_OPTIONS.find((o) => o.toLowerCase() === raw.toLowerCase());
  if (!match) {
    return { error: `continuation must be one of ${CONTINUATION_OPTIONS.join(', ')} — got "${raw}"` };
  }
  return { continuation: match };
}

/**
 * GET: progress rows. Optional ?category=Kinder|Junior|Coder
 *
 * Returns only the stored progress. The student's day, time, instructor and
 * program come from the schedule, and are joined in the browser so this endpoint
 * stays a plain read of one table.
 */
export async function GET(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');

    if (category && !CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `category must be one of ${CATEGORIES.join(', ')}` },
        { status: 400 }
      );
    }

    const res = category
      ? await query(
        `SELECT * FROM internal_live_progress WHERE category = $1
           ORDER BY student_name ASC, program_code ASC`,
        [category]
      )
      : await query(
        'SELECT * FROM internal_live_progress ORDER BY student_name ASC, program_code ASC'
      );

    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: upsert one student's progress for one level.
 *
 * An upsert rather than separate create and update because the caller never has
 * an id to begin with: a student appears in the table as soon as they are
 * enrolled, and the first edit is what brings the row into existence.
 */
export async function PUT(req) {
  try {
    await ready();
    const body = await req.json();
    const { studentName, programCode, category } = body;

    if (!studentName || !programCode) {
      return NextResponse.json(
        { error: 'studentName and programCode are required' },
        { status: 400 }
      );
    }
    if (category && !CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `category must be one of ${CATEGORIES.join(', ')}` },
        { status: 400 }
      );
    }

    const att = normaliseAttendance(body.attendance);
    if (att.error) return NextResponse.json({ error: att.error }, { status: 400 });
    const vid = normaliseVideos(body.videos);
    if (vid.error) return NextResponse.json({ error: vid.error }, { status: 400 });
    const cont = normaliseContinuation(body.continuation);
    if (cont.error) return NextResponse.json({ error: cont.error }, { status: 400 });

    const res = await query(
      `INSERT INTO internal_live_progress
         (student_name, program_code, category, attendance, videos, continuation, continuation_note)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       ON CONFLICT (student_name, program_code) DO UPDATE SET
         category = EXCLUDED.category,
         attendance = EXCLUDED.attendance,
         videos = EXCLUDED.videos,
         continuation = EXCLUDED.continuation,
         continuation_note = EXCLUDED.continuation_note
       RETURNING *`,
      [
        studentName,
        programCode,
        category || null,
        JSON.stringify(att.attendance),
        JSON.stringify(vid.videos),
        cont.continuation,
        body.continuationNote == null ? null : String(body.continuationNote),
      ]
    );

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE: clear a student's progress for one level, by row id. */
export async function DELETE(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id in query parameter' }, { status: 400 });
    }

    const res = await query(
      'DELETE FROM internal_live_progress WHERE id = $1 RETURNING *',
      [id]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Progress row not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: 'Progress cleared' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
