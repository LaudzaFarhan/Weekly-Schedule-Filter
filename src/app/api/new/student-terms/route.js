import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { isRealDate } from '@/lib/evaluationValidation';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { NextResponse } from 'next/server';

/**
 * Term subscriptions: one row per `(student_id, term_year, term_number)`.
 *
 * This endpoint answers "paid or not" and nothing else. There is no price, no
 * currency and no invoice reference here or in the table (Req 4.10) — billing is
 * out of scope for this feature. There is also no current-term or start-term
 * field: both are derived on read by `src/lib/reportCard.js`, which is what makes
 * "one current term per student" unrepresentable rather than merely discouraged
 * (Req 4.4). A payload key naming either of those is simply not read.
 */

/** The table is added by this feature; create it on first use (Req 2.13). */
const ready = () => ensureTable('internal_student_terms');

/**
 * Whitelist, matching `students/route.js`, so a column added to the table later
 * cannot leak into the API surface by accident (Req 2.1). Exactly the documented
 * `StudentTerm` keys, and no snake-case key: `year` is `term_year` translated
 * here, the same trick `date`/`eval_date` uses on the evaluations route.
 *
 * @param {Record<string, any>} row
 */
export const mapRow = (row) => ({
  id: row.id,
  studentId: row.student_id,
  year: row.term_year,
  termNumber: row.term_number,
  paid: row.paid,
  paidAt: row.paid_at,
  note: row.note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Permitted bounds, stated once and quoted into every message (Req 2.12). */
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;
const TERM_MIN = 1;
const TERM_MAX = 4;

/** A clean, optionally signed run of digits. `'4'` yes; `'4.5'`, `''`, `'abc'` no. */
const INTEGER_TEXT = /^[+-]?\d+$/;

/**
 * Read an integer without coercing something that is not one, closing the
 * `Number('') === 0`, `Number(null) === 0`, `Number(true) === 1` and
 * `Number([4]) === 4` traps in one place.
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
function asInteger(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!INTEGER_TEXT.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

/** The received value, quoted for a message. `undefined` has no JSON form. */
function received(raw) {
  if (raw === undefined) return 'undefined';
  try {
    const json = JSON.stringify(raw);
    return json === undefined ? String(raw) : json;
  } catch {
    return String(raw);
  }
}

/** `{ value }` or `{ error }` — never both. Message names the field and bounds. */
function checkYear(raw) {
  const year = asInteger(raw);
  if (year === null || year < YEAR_MIN || year > YEAR_MAX) {
    return {
      error: `year must be an integer from ${YEAR_MIN} to ${YEAR_MAX} — got ${received(raw)}`,
    };
  }
  return { value: year };
}

/** `{ value }` or `{ error }` — never both. Message names the field and bounds. */
function checkTermNumber(raw) {
  const termNumber = asInteger(raw);
  if (termNumber === null || termNumber < TERM_MIN || termNumber > TERM_MAX) {
    return {
      error: `termNumber must be an integer from ${TERM_MIN} to ${TERM_MAX} — got ${received(raw)}`,
    };
  }
  return { value: termNumber };
}

/** `{ value }` or `{ error }`. Positive integer, same message as the other routes. */
function checkStudentId(raw) {
  const studentId = asInteger(raw);
  if (studentId === null || studentId <= 0) {
    return { error: `studentId must be a positive integer — got ${received(raw)}` };
  }
  return { value: studentId };
}

/**
 * `paid` is `BOOLEAN NOT NULL` in the schema, so it is read strictly: a real
 * boolean, or the text/number forms a JSON caller plausibly sends. Anything else
 * is refused rather than run through `Boolean(...)`, where `'false'` would come
 * out true and mark an unpaid term paid.
 *
 * @returns {{ value: boolean }|{ error: string }}
 */
function checkPaid(raw) {
  if (typeof raw === 'boolean') return { value: raw };
  if (raw === 1 || raw === 0) return { value: raw === 1 };
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (text === 'true' || text === '1') return { value: true };
    if (text === 'false' || text === '0') return { value: false };
  }
  return { error: `paid must be true or false — got ${received(raw)}` };
}

/** `paidAt` is a `DATE`: a real `YYYY-MM-DD`, or explicit `null` to clear it. */
function checkPaidAt(raw) {
  if (raw === null) return { value: null };
  const text = String(raw).trim();
  if (text === '') return { value: null };
  if (!isRealDate(text)) {
    return { error: `paidAt must be "YYYY-MM-DD" — got ${received(raw)}` };
  }
  return { value: text };
}

/**
 * The three subscription values, in the order they are written. Each is optional
 * on a write, and each carries its own reader.
 *
 * OMITTED IS NOT THE SAME AS FALSE. A payload that leaves `paid` out is a
 * payload that says nothing about payment, so the stored flag is left as it is;
 * only `paid: false` marks a term unpaid. The alternative — treating an absent
 * key as `false`, which the `BOOLEAN NOT NULL DEFAULT FALSE` column invites —
 * would let a request that only edits `note` silently flip a paid term to
 * unpaid, and an administrator would then chase a subscription that is settled.
 * `paidAt` and `note` follow the same rule for consistency: absent keeps,
 * explicit `null` clears. Req 2.11 is satisfied because a request that *does*
 * carry a value always leaves that value stored.
 */
const OPTIONAL_FIELDS = [
  { key: 'paid', column: 'paid', check: checkPaid },
  { key: 'paidAt', column: 'paid_at', check: checkPaidAt },
  { key: 'note', column: 'note', check: (raw) => ({ value: raw === null ? null : String(raw) }) },
];

/**
 * Validate an untrusted term payload. Returns EXACTLY ONE of `{ value }` or
 * `{ error }`, so a route can reject with a `400` before it touches the
 * database — an out-of-bounds request must write nothing at all (Req 2.12).
 *
 * `body` is not mutated and no value is ever clamped into range.
 *
 * @param {unknown} body
 * @param {{ requireIdentity?: boolean }} [options] when false, `studentId`,
 *   `year` and `termNumber` are not required (the `PUT` path identifies the row
 *   by `id` instead), but any that are supplied are still bounds-checked.
 * @returns {{ value: { studentId?: number, year?: number, termNumber?: number,
 *   supplied: Array<{ column: string, value: any }> } }|{ error: string }}
 */
export function validateTermPayload(body, { requireIdentity = true } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object' };
  }

  /** @type {{ studentId?: number, year?: number, termNumber?: number, supplied: Array<{ column: string, value: any }> }} */
  const value = { supplied: [] };

  if (requireIdentity || body.studentId !== undefined) {
    const studentId = checkStudentId(body.studentId);
    if (studentId.error) return { error: studentId.error };
    value.studentId = studentId.value;
  }

  if (requireIdentity || body.year !== undefined) {
    const year = checkYear(body.year);
    if (year.error) return { error: year.error };
    value.year = year.value;
  }

  if (requireIdentity || body.termNumber !== undefined) {
    const termNumber = checkTermNumber(body.termNumber);
    if (termNumber.error) return { error: termNumber.error };
    value.termNumber = termNumber.value;
  }

  for (const { key, column, check } of OPTIONAL_FIELDS) {
    // INVARIANT: only keys the payload actually carries reach `supplied`, so an
    // absent key never overwrites a stored value.
    if (body[key] === undefined) continue;
    const read = check(body[key]);
    if (read.error) return { error: read.error };
    value.supplied.push({ column, value: read.value });
  }

  return { value };
}

/**
 * GET: term rows. Optional `?studentId=&year=&limit=`
 *
 * Filters go through `buildListQuery`, the same helper every other list endpoint
 * uses, so every value stays a bind parameter (Req 2.4 in spirit — no request
 * value is ever concatenated into the SQL text). Ordering is `term_year` then
 * `term_number`, which is the `(year, termNumber)` order the derivation module
 * reads terms in.
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);

  // Bounds first, before any database call: a malformed year is a 400, not a
  // failed integer cast surfacing as a 500 (Req 2.12).
  const yearParam = searchParams.get('year');
  if (yearParam !== null && yearParam.trim() !== '') {
    const year = checkYear(yearParam);
    if (year.error) return NextResponse.json({ error: year.error }, { status: 400 });
  }
  const studentIdParam = searchParams.get('studentId');
  if (studentIdParam !== null && studentIdParam.trim() !== '') {
    const studentId = checkStudentId(studentIdParam);
    if (studentId.error) return NextResponse.json({ error: studentId.error }, { status: 400 });
  }

  try {
    await ready();
    const { clause, params, limit } = buildListQuery(searchParams, {
      filters: { studentId: 'student_id', year: 'term_year' },
    });
    const { sql, params: finalParams } = withLimit(
      `SELECT * FROM internal_student_terms ${clause}
       ORDER BY term_year ASC, term_number ASC, id ASC`,
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
 * POST: record one term for one student in one year.
 *
 * An upsert on `(student_id, term_year, term_number)`, so the store holds exactly
 * one row per triple however many times the same term is saved (Req 2.11). The
 * caller never has to know whether the row exists — marking T2 paid is one
 * request either way, which is also why there is no separate create/update
 * split on the natural key.
 *
 * Only the columns the payload carries appear in the `DO UPDATE SET` list. The
 * column names come from the fixed `OPTIONAL_FIELDS` table and every value is a
 * bind parameter, so nothing from the request reaches the SQL text.
 */
export async function POST(req) {
  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null; // unparseable body, refused by the validator below
  }

  // Validated before `ready()` and before any query: an out-of-bounds request
  // must not create the table, open a connection or write a row (Req 2.12).
  const parsed = validateTermPayload(body);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { studentId, year, termNumber, supplied } = parsed.value;

  try {
    await ready();

    const columns = ['student_id', 'term_year', 'term_number', ...supplied.map((s) => s.column)];
    const values = [studentId, year, termNumber, ...supplied.map((s) => s.value)];
    const placeholders = values.map((_, i) => `$${i + 1}`);
    // With nothing optional supplied the conflict branch is a deliberate no-op
    // re-assignment: it keeps every stored value and still returns the row, which
    // `DO NOTHING` would not.
    const updates = supplied.length
      ? supplied.map((s) => `${s.column} = EXCLUDED.${s.column}`).join(', ')
      : 'student_id = EXCLUDED.student_id';

    const res = await query(
      `INSERT INTO internal_student_terms (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (student_id, term_year, term_number) DO UPDATE SET ${updates}
       RETURNING *`,
      values
    );

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: edit the subscription values of one existing row, by `id`.
 *
 * The triple that identifies a term is deliberately not editable here — moving a
 * row onto another student's term is not an operation the page needs, and leaving
 * it out means a `PUT` can never collide with the unique constraint. Re-filing a
 * term is a `POST` of the new triple plus a `DELETE` of the old row.
 */
export async function PUT(req) {
  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const id = body && typeof body === 'object' && !Array.isArray(body) ? body.id : undefined;
  if (id === undefined || id === null || String(id).trim() === '') {
    return NextResponse.json({ error: 'Missing term ID' }, { status: 400 });
  }

  const parsed = validateTermPayload(body, { requireIdentity: false });
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { supplied } = parsed.value;

  if (!supplied.length) {
    return NextResponse.json(
      { error: 'Supply at least one of paid, paidAt or note to update' },
      { status: 400 }
    );
  }

  try {
    await ready();
    const values = supplied.map((s) => s.value);
    const assignments = supplied.map((s, i) => `${s.column} = $${i + 1}`).join(', ');
    const res = await query(
      `UPDATE internal_student_terms SET ${assignments}
       WHERE id = $${values.length + 1}
       RETURNING *`,
      [...values, id]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Term not found' }, { status: 404 });
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE: remove one term row by `?id=`. One row per request, no bulk form. */
export async function DELETE(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id in query parameter' }, { status: 400 });
    }

    const res = await query(
      'DELETE FROM internal_student_terms WHERE id = $1 RETURNING *',
      [id]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Term not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: 'Term deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
