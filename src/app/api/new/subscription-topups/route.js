import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { isRealDate } from '@/lib/evaluationValidation';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { NextResponse } from 'next/server';

/**
 * The top-up ledger: one row per package payment a parent makes.
 *
 * A subscription target is a single number, so it cannot say when a package was
 * paid for or how many packages a student has bought. Each payment is recorded
 * here instead, which is what lets the subscription modal show a dated history
 * and a purchase count beside the meeting figures.
 *
 * Rows are inserted, never upserted: two payments of the same size on the same
 * day are legitimate, so there is no natural key that could collapse them. A
 * mistaken row is removed with `DELETE`, not overwritten.
 *
 * Like `student-terms`, this endpoint records that a payment happened and what
 * it bought. There is no price, currency or invoice column — billing is out of
 * scope and a payload naming one is simply not read.
 */

/** The table is added by this feature; create it on first use. */
const ready = () => ensureTable('internal_subscription_topups');

/**
 * Whitelist, so a column added to the table later cannot leak into the API
 * surface by accident. `paidAt` is `paid_at` translated here, the same way the
 * student-terms route handles it.
 *
 * @param {Record<string, any>} row
 */
export const mapRow = (row) => ({
  id: row.id,
  studentId: row.student_id,
  studentName: row.student_name,
  meetings: row.meetings,
  paidAt: row.paid_at instanceof Date ? isoOf(row.paid_at) : row.paid_at,
  packageLabel: row.package_label,
  note: row.note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * A `DATE` column comes back from `pg` as a local-midnight `Date`. Formatting it
 * with `toISOString()` would shift it a day west of Greenwich, so the parts are
 * read in local time — the same rule `formatDateISO` follows on the client.
 */
function isoOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Bounds, stated once and quoted into every message. */
const MEETINGS_MIN = 1;
const MEETINGS_MAX = 100;
const PACKAGE_LABEL_MAX = 120;

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

/** `{ value }` or `{ error }`. Positive integer, same message as the other routes. */
function checkStudentId(raw) {
  const studentId = asInteger(raw);
  if (studentId === null || studentId <= 0) {
    return { error: `studentId must be a positive integer — got ${received(raw)}` };
  }
  return { value: studentId };
}

/**
 * `{ value }` or `{ error }`. The bounds match the `CHECK` on the column, so a
 * request the validator accepts is one the database also accepts — an
 * out-of-range top-up is a 400 with a readable message, not a 500 from a
 * constraint violation.
 */
function checkMeetings(raw) {
  const meetings = asInteger(raw);
  if (meetings === null || meetings < MEETINGS_MIN || meetings > MEETINGS_MAX) {
    return {
      error: `meetings must be an integer from ${MEETINGS_MIN} to ${MEETINGS_MAX} — got ${received(raw)}`,
    };
  }
  return { value: meetings };
}

/**
 * `paidAt` is the date the parent paid: a real `YYYY-MM-DD`. Required, because a
 * payment with no date is the one thing this table exists to record.
 */
function checkPaidAt(raw) {
  const text = String(raw ?? '').trim();
  if (!isRealDate(text)) {
    return { error: `paidAt must be a real "YYYY-MM-DD" date — got ${received(raw)}` };
  }
  return { value: text };
}

/** Free text, length-capped to the column so a long label is a 400 not a 500. */
function checkPackageLabel(raw) {
  if (raw === null || raw === undefined) return { value: null };
  const text = String(raw).trim();
  if (text === '') return { value: null };
  if (text.length > PACKAGE_LABEL_MAX) {
    return { error: `packageLabel must be ${PACKAGE_LABEL_MAX} characters or fewer — got ${text.length}` };
  }
  return { value: text };
}

/** Optional display name, stored so the ledger survives a rename. */
function checkStudentName(raw) {
  if (raw === null || raw === undefined) return { value: null };
  const text = String(raw).trim();
  if (text === '') return { value: null };
  return { value: text.slice(0, 255) };
}

/**
 * Validate an untrusted top-up payload. Returns EXACTLY ONE of `{ value }` or
 * `{ error }`, so a route can reject with a `400` before it touches the
 * database. `body` is not mutated and no value is ever clamped into range.
 *
 * @param {unknown} body
 */
export function validateTopUpPayload(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object' };
  }

  const studentId = checkStudentId(body.studentId);
  if (studentId.error) return { error: studentId.error };

  const meetings = checkMeetings(body.meetings);
  if (meetings.error) return { error: meetings.error };

  const paidAt = checkPaidAt(body.paidAt);
  if (paidAt.error) return { error: paidAt.error };

  const packageLabel = checkPackageLabel(body.packageLabel);
  if (packageLabel.error) return { error: packageLabel.error };

  const studentName = checkStudentName(body.studentName);
  if (studentName.error) return { error: studentName.error };

  return {
    value: {
      studentId: studentId.value,
      studentName: studentName.value,
      meetings: meetings.value,
      paidAt: paidAt.value,
      packageLabel: packageLabel.value,
      note: body.note === null || body.note === undefined ? null : String(body.note),
    },
  };
}

/**
 * GET: the payment ledger. Optional `?studentId=&limit=`
 *
 * Newest payment first, because that is the order the history panel reads and
 * the only order it renders. Filters go through `buildListQuery`, so every
 * value stays a bind parameter.
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);

  // Bounds first, before any database call: a malformed studentId is a 400, not
  // a failed integer cast surfacing as a 500.
  const studentIdParam = searchParams.get('studentId');
  if (studentIdParam !== null && studentIdParam.trim() !== '') {
    const studentId = checkStudentId(studentIdParam);
    if (studentId.error) return NextResponse.json({ error: studentId.error }, { status: 400 });
  }

  try {
    await ready();
    const { clause, params, limit } = buildListQuery(searchParams, {
      filters: { studentId: 'student_id' },
    });
    const { sql, params: finalParams } = withLimit(
      `SELECT * FROM internal_subscription_topups ${clause}
       ORDER BY paid_at DESC, id DESC`,
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
 * POST: record one payment.
 *
 * A plain `INSERT`, not an upsert: every payment is a new row, which is the
 * whole point of a ledger. Recording the same top-up twice by mistake is fixed
 * with `DELETE`, not prevented by a key that would also reject two genuine
 * same-day payments.
 */
export async function POST(req) {
  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null; // unparseable body, refused by the validator below
  }

  // Validated before `ready()` and before any query: an out-of-bounds request
  // must not create the table, open a connection or write a row.
  const parsed = validateTopUpPayload(body);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { studentId, studentName, meetings, paidAt, packageLabel, note } = parsed.value;

  try {
    await ready();
    const res = await query(
      `INSERT INTO internal_subscription_topups
         (student_id, student_name, meetings, paid_at, package_label, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [studentId, studentName, meetings, paidAt, packageLabel, note]
    );
    return NextResponse.json(mapRow(res.rows[0]), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: remove one mistaken payment record, by `?id=`.
 *
 * Single-row only. There is no bulk delete: clearing a student's payment history
 * wholesale is not an operation the page needs, and not offering it means a
 * missing filter cannot empty the ledger.
 */
export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get('id');
  const id = asInteger(idParam);
  if (id === null || id <= 0) {
    return NextResponse.json(
      { error: `id must be a positive integer — got ${received(idParam)}` },
      { status: 400 }
    );
  }

  try {
    await ready();
    const res = await query(
      'DELETE FROM internal_subscription_topups WHERE id = $1 RETURNING *',
      [id]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Payment record not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: 'Payment record deleted' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
