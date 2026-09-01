import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';
import { CONTINUATION_OPTIONS, LESSONS_PER_LEVEL, CATEGORIES, lessonsForCategory } from '@/lib/programRules';

/** Progress lives in a table added later; create it on first use. */
const ready = async () => {
  await ensureTable('internal_live_progress');
  try {
    await query(`
      ALTER TABLE internal_live_progress
      ADD COLUMN IF NOT EXISTS arranged_lesson VARCHAR(50),
      ADD COLUMN IF NOT EXISTS arranged_teacher VARCHAR(255),
      ADD COLUMN IF NOT EXISTS main_teacher VARCHAR(255)
    `);
  } catch (err) {
    // Ignore schema update error if database user lacks DDL table ownership
  }
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const setNoteTag = (existingNotes, key, val) => {
  let str = String(existingNotes || '');
  const regex = new RegExp(`\\[${key}:\\s*([^\\]]+)\\]`, 'gi');
  str = str.replace(regex, '').trim();
  if (val) {
    return `[${key}: ${val}] ${str}`.trim();
  }
  return str;
};

const mapRow = (row) => {
  const noteStr = String(row.continuation_note || '');
  const tMatch = noteStr.match(/\[ArrangedTeacher:\s*([^\]]+)\]/i);
  const lMatch = noteStr.match(/\[ArrangedLesson:\s*([^\]]+)\]/i);
  const mMatch = noteStr.match(/\[MainTeacher:\s*([^\]]+)\]/i);
  const puStatusMatch = noteStr.match(/\[ProgressUpdateStatus:\s*([^\]]+)\]/i);
  const puDateMatch = noteStr.match(/\[ProgressUpdateDate:\s*([^\]]+)\]/i);
  const puNoteMatch = noteStr.match(/\[ProgressUpdateNote:\s*([^\]]+)\]/i);

  return {
    id: row.id,
    studentName: row.student_name,
    programCode: row.program_code,
    category: row.category,
    attendance: row.attendance || {},
    videos: row.videos || {},
    continuation: row.continuation,
    continuationNote: row.continuation_note,
    arrangedLesson: row.arranged_lesson || (lMatch ? lMatch[1].trim() : null),
    arrangedTeacher: row.arranged_teacher || (tMatch ? tMatch[1].trim() : null),
    mainTeacher: row.main_teacher || (mMatch ? mMatch[1].trim() : null),
    progressUpdateStatus: row.progress_update_status || (puStatusMatch ? puStatusMatch[1].trim() : null),
    progressUpdateDate: row.progress_update_date || (puDateMatch ? puDateMatch[1].trim() : null),
    progressUpdateNote: row.progress_update_note || (puNoteMatch ? puNoteMatch[1].trim() : null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * Validate the attendance map.
 *
 * Rejected rather than coerced: a lesson number outside the level, or a date the
 * grid cannot parse, would show as a silently missing tick, which is worse than
 * a failed save.
 */
function normaliseAttendance(value, category) {
  if (value == null) return { attendance: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'attendance must be an object keyed by lesson number' };
  }
  const maxLessons = category === 'Coder' ? 100 : lessonsForCategory(category);
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > maxLessons) {
      return { error: `attendance key "${key}" is not a lesson from 1 to ${maxLessons}` };
    }
    if (entry == null) continue; // an explicit null clears the tick
    if (typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: `attendance.${key} must be an object` };
    }
    const date = entry.date == null ? null : String(entry.date).trim();
    if (date && !ISO_DATE.test(date)) {
      return { error: `attendance.${key}.date is "${date}" — expected "YYYY-MM-DD"` };
    }
    out[n] = {
      date: date || null,
      note: entry.note == null ? '' : String(entry.note),
      recordedBy: entry.recordedBy ? String(entry.recordedBy).trim() : (entry.user ? String(entry.user).trim() : null),
      recordedByName: entry.recordedByName ? String(entry.recordedByName).trim() : null,
      recordedAt: entry.recordedAt ? String(entry.recordedAt).trim() : null,
      updatedBy: entry.updatedBy ? String(entry.updatedBy).trim() : null,
      updatedAt: entry.updatedAt ? String(entry.updatedAt).trim() : null,
      teacher: entry.teacher ? String(entry.teacher).trim() : null,
      arrangedTeacher: entry.arrangedTeacher ? String(entry.arrangedTeacher).trim() : null,
    };
  }
  return { attendance: out };
}

/** Validate the video flags. Either true, a URL string, or an object { link: '...', date: '...' } */
function normaliseVideos(value) {
  if (value == null) return { videos: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'videos must be an object keyed by level code' };
  }
  const out = {};
  for (const [key, on] of Object.entries(value)) {
    const level = String(key).trim();
    if (!level) return { error: 'videos contains an empty level code' };
    if (on) {
      if (typeof on === 'string') {
        out[level] = { link: on, sent: true };
      } else if (typeof on === 'object' && on !== null) {
        out[level] = { link: on.link || '', sent: true, date: on.date || null };
      } else {
        out[level] = true;
      }
    }
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

    const att = normaliseAttendance(body.attendance, category);
    if (att.error) return NextResponse.json({ error: att.error }, { status: 400 });
    const vid = normaliseVideos(body.videos);
    if (vid.error) return NextResponse.json({ error: vid.error }, { status: 400 });
    const cont = normaliseContinuation(body.continuation);
    if (cont.error) return NextResponse.json({ error: cont.error }, { status: 400 });

    let noteVal = body.continuationNote == null ? null : String(body.continuationNote);
    if (body.arrangedTeacher !== undefined) {
      noteVal = setNoteTag(noteVal, 'ArrangedTeacher', body.arrangedTeacher || '');
    }
    if (body.arrangedLesson !== undefined) {
      noteVal = setNoteTag(noteVal, 'ArrangedLesson', body.arrangedLesson || '');
    }
    if (body.mainTeacher !== undefined) {
      noteVal = setNoteTag(noteVal, 'MainTeacher', body.mainTeacher || '');
    }
    if (body.progressUpdateStatus !== undefined) {
      noteVal = setNoteTag(noteVal, 'ProgressUpdateStatus', body.progressUpdateStatus || '');
    }
    if (body.progressUpdateDate !== undefined) {
      noteVal = setNoteTag(noteVal, 'ProgressUpdateDate', body.progressUpdateDate || '');
    }
    if (body.progressUpdateNote !== undefined) {
      noteVal = setNoteTag(noteVal, 'ProgressUpdateNote', body.progressUpdateNote || '');
    }

    let res;
    try {
      res = await query(
        `INSERT INTO internal_live_progress
           (student_name, program_code, category, attendance, videos, continuation, continuation_note, arranged_lesson, arranged_teacher, main_teacher)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)
         ON CONFLICT (student_name, program_code) DO UPDATE SET
           category = EXCLUDED.category,
           attendance = EXCLUDED.attendance,
           videos = EXCLUDED.videos,
           continuation = EXCLUDED.continuation,
           continuation_note = EXCLUDED.continuation_note,
           arranged_lesson = EXCLUDED.arranged_lesson,
           arranged_teacher = EXCLUDED.arranged_teacher,
           main_teacher = COALESCE(internal_live_progress.main_teacher, EXCLUDED.main_teacher)
         RETURNING *`,
        [
          studentName,
          programCode,
          category || null,
          JSON.stringify(att.attendance),
          JSON.stringify(vid.videos),
          cont.continuation,
          noteVal,
          body.arrangedLesson || null,
          body.arrangedTeacher || null,
          body.mainTeacher || null,
        ]
      );
    } catch (dbErr) {
      // Fallback if arranged_lesson or arranged_teacher column does not exist on DB
      res = await query(
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
          noteVal,
        ]
      );
    }

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
    const all = searchParams.get('all');

    if (all === 'true') {
      const res = await query('DELETE FROM internal_live_progress RETURNING *');
      return NextResponse.json({ success: true, count: res.rowCount, message: 'All live progress records cleared' });
    }

    if (!id) {
      return NextResponse.json({ error: 'Missing id or all parameter' }, { status: 400 });
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
