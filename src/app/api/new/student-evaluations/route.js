/**
 * Evaluation_API — `/api/new/student-evaluations`.
 *
 * One Evaluation_Record per student per calendar day (D1). Re-saving a day
 * replaces that day rather than adding a second row, which is why `POST` is an
 * upsert on `(student_id, eval_date)` and every updatable column is taken from
 * `EXCLUDED`: the second write of a day wins in full (Req 2.2, 2.3).
 *
 * Shape follows `students/route.js` — a module-level `mapRow` whitelist, one
 * exported handler per verb, and `catch (error) → 500 { error: error.message }`
 * so the page can show the message it was given (Req 2.14).
 */

import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { validateEvaluationPayload } from '@/lib/evaluationValidation';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { NextResponse } from 'next/server';

/**
 * Evaluations live in a table added after the original schema, so provision it
 * before the first query of EVERY request. `ensureTable` caches success only —
 * a failed provision is retried on the next request (Req 2.13).
 */
const ready = () => ensureTable('internal_student_evaluations');

/** The only date shape accepted from a caller or produced for one. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `eval_date` is a `DATE`, which `pg` hands back as a `Date` in the server's
 * local zone. Format from the local parts, never `toISOString()`, so a date
 * cannot slip to the previous day east of UTC. Same helper as `leave/route.js`.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
const toISODate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Stored row → the documented `Evaluation` record.
 *
 * A whitelist, not a spread: exactly these keys leave the endpoint, so a column
 * added to the table later — and every snake_case column name — is omitted
 * rather than leaking into the API surface (Req 2.1).
 *
 * @param {Record<string, any>} row
 * @returns {Object} the documented `Evaluation` record and nothing else
 */
export const mapRow = (row) => ({
  id: row.id,
  studentId: row.student_id,
  date: toISODate(row.eval_date),
  lessonTopic: row.lesson_topic,
  concept: row.concept,
  building: row.building,
  problemSolving: row.problem_solving,
  focus: row.focus,
  attitude: row.attitude,
  instructorNotes: row.instructor_notes,
  instructorName: row.instructor_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Build the parameterised `WHERE` clause for a list request.
 *
 * `search`, the `studentId`/`instructorName` equality filters and `limit` are
 * delegated to `buildListQuery`. The date range is appended here because
 * `src/lib/listQuery.js` has no range-comparison support and is deliberately
 * not modified — this is a documented local extension.
 *
 * Every value taken from `searchParams` is pushed onto `params` and referenced
 * as `$n`, so the returned `clause` holds no caller-supplied text and its
 * placeholder count equals `params.length` (Req 2.4, 2.5).
 *
 * Exported so its property test can drive it without a database.
 *
 * @param {URLSearchParams} searchParams
 * @returns {{ clause: string, params: any[], limit: number|null }}
 */
export function buildEvaluationListQuery(searchParams) {
  const { clause, params, limit } = buildListQuery(searchParams, {
    searchColumns: ['lesson_topic', 'instructor_notes', 'instructor_name'],
    filters: { studentId: 'student_id', instructorName: 'instructor_name' },
  });

  const extra = [];
  const all = [...params];
  for (const [key, op] of [['from', '>='], ['to', '<=']]) {
    const value = searchParams.get(key);
    if (!value) continue;
    all.push(value);
    // INVARIANT: `all.length` is the index of the value just pushed, so the
    // placeholder always refers to a bind parameter and never to literal text.
    extra.push(`eval_date ${op} $${all.length}::date`);
  }
  if (extra.length === 0) return { clause, params: all, limit };

  return {
    clause: clause ? `${clause} AND ${extra.join(' AND ')}` : `WHERE ${extra.join(' AND ')}`,
    params: all,
    limit,
  };
}

/**
 * GET: list evaluations.
 *
 * Optional `?studentId=&instructorName=&search=&from=&to=&limit=`. With no
 * parameters this returns every evaluation. A malformed `from`/`to` is a 400
 * naming that parameter and returns no records (Req 2.6); ordering is by date
 * then id so a shared date is still deterministic (Req 2.7).
 */
export async function GET(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);

    for (const key of ['from', 'to']) {
      const value = searchParams.get(key);
      if (value && !ISO_DATE.test(value)) {
        return NextResponse.json(
          { error: `${key} must be "YYYY-MM-DD" — got ${JSON.stringify(value)}` },
          { status: 400 }
        );
      }
    }

    const { clause, params, limit } = buildEvaluationListQuery(searchParams);
    const { sql, params: finalParams } = withLimit(
      `SELECT * FROM internal_student_evaluations ${clause} ORDER BY eval_date ASC, id ASC`,
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
 * POST: save one student's evaluation for one day.
 *
 * An upsert, not a create: the form has no id and re-opening a day is an edit
 * of that day. Every updatable column takes `EXCLUDED`, so the payload of the
 * second write is what the row holds afterwards — a re-save replaces the day
 * rather than merging into it (Req 2.2, 2.3).
 */
export async function POST(req) {
  try {
    await ready();
    const body = await req.json();

    const { value, error } = validateEvaluationPayload(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const res = await query(
      `INSERT INTO internal_student_evaluations
         (student_id, eval_date, lesson_topic, concept, building, problem_solving,
          focus, attitude, instructor_notes, instructor_name)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (student_id, eval_date) DO UPDATE SET
         lesson_topic = EXCLUDED.lesson_topic,
         concept = EXCLUDED.concept,
         building = EXCLUDED.building,
         problem_solving = EXCLUDED.problem_solving,
         focus = EXCLUDED.focus,
         attitude = EXCLUDED.attitude,
         instructor_notes = EXCLUDED.instructor_notes,
         instructor_name = EXCLUDED.instructor_name
       RETURNING *`,
      [
        value.studentId, value.date, value.lessonTopic, value.concept, value.building,
        value.problemSolving, value.focus, value.attitude, value.instructorNotes,
        value.instructorName,
      ]
    );

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: edit an existing evaluation by id.
 *
 * Moving a record onto a date the same student already holds violates the
 * `(student_id, eval_date)` unique constraint. PostgreSQL raises `23505` and the
 * statement is rolled back, so both rows keep their field values — that error
 * becomes a 409 naming the clashing date and pointing at the existing day
 * (Req 2.8). An id matching nothing is a 404 (Req 2.9).
 */
export async function PUT(req) {
  try {
    await ready();
    const body = await req.json();

    const id = body?.id;
    if (!id) {
      return NextResponse.json({ error: 'Missing evaluation ID' }, { status: 400 });
    }

    const { value, error } = validateEvaluationPayload(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    let res;
    try {
      res = await query(
        `UPDATE internal_student_evaluations SET
           student_id = $1,
           eval_date = $2::date,
           lesson_topic = $3,
           concept = $4,
           building = $5,
           problem_solving = $6,
           focus = $7,
           attitude = $8,
           instructor_notes = $9,
           instructor_name = $10
         WHERE id = $11
         RETURNING *`,
        [
          value.studentId, value.date, value.lessonTopic, value.concept, value.building,
          value.problemSolving, value.focus, value.attitude, value.instructorNotes,
          value.instructorName, id,
        ]
      );
    } catch (dbError) {
      if (dbError?.code === '23505') {
        return NextResponse.json(
          {
            error: `This student already has an evaluation on ${value.date}. `
              + 'Open that day to edit it.',
          },
          { status: 409 }
        );
      }
      throw dbError;
    }

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: remove exactly one evaluation, identified by `?id=`.
 *
 * There is deliberately no bulk form — no "delete every evaluation of this
 * student", and no body-driven variant. One request deletes at most one row
 * (Req 2.10), and an id matching nothing deletes nothing (Req 2.9).
 */
export async function DELETE(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id in query parameter' }, { status: 400 });
    }

    const res = await query(
      'DELETE FROM internal_student_evaluations WHERE id = $1 RETURNING *',
      [id]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: 'Evaluation deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
