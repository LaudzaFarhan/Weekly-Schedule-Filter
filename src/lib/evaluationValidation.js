/**
 * Server-side validation of an untrusted evaluation payload.
 *
 * `validateEvaluationPayload(body)` returns EXACTLY ONE of `{ value }` or
 * `{ error }` — never both, never neither. The route turns an `error` into a
 * `400` carrying that message verbatim, so every message is a single sentence
 * that names the offending field and, where it helps, carries the value that
 * was received.
 *
 * The one rule this module exists to enforce (Req 1.4, 1.5): a score outside
 * `1..5` is REJECTED. It is never clamped to the nearest valid value and never
 * replaced by a default. A report card that a parent keeps must not hold a
 * score no instructor entered, so a refused save beats an invented 3. There is
 * deliberately no coercion path anywhere below that could turn `7` into `5` or
 * a blank into a number.
 *
 * Competency keys and labels come from `reportCardRubric.js`, so an error
 * message names a competency with the same label the form shows.
 *
 * Pure module — no React, no `pg`, no side effects beyond reading the clock for
 * the date default. `body` is never mutated.
 */

import { COMPETENCIES } from './reportCardRubric';

/** The only date shape accepted or produced: `YYYY-MM-DD`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A clean, optionally signed run of digits. `'4'` yes; `'4.5'`, `'abc'`, `''` no. */
const INTEGER_TEXT = /^[+-]?\d+$/;

/** `instructor_name` is `VARCHAR(255)` in the schema (Req 1.9). */
const INSTRUCTOR_NAME_MAX = 255;

/**
 * The server's current calendar date as `YYYY-MM-DD`, in the server's local
 * time zone (Req 1.7).
 *
 * Local rather than UTC on purpose: an instructor saving an evening lesson in
 * Jakarta (UTC+7) would otherwise sometimes be filed under the previous day.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function todayIso(now = new Date()) {
  const yyyy = String(now.getFullYear()).padStart(4, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * True when `iso` is a real calendar date, not merely the right shape.
 * `2026-02-30` has the shape and is not a date, so it is refused.
 *
 * @param {string} iso
 * @returns {boolean}
 */
export function isRealDate(iso) {
  if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return false;
  const parsed = new Date(`${iso}T00:00:00Z`);
  // A rolled-over date (Feb 30 -> Mar 2) no longer prints as what went in.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

/**
 * Read an integer out of an untrusted value without ever coercing something
 * that is not one.
 *
 * Numbers must already be integers. Strings must be a clean run of digits, so
 * `'4'` is accepted (a caller may send JSON strings) while `'4.5'` and `'abc'`
 * are not. Everything else — `null`, `undefined`, `true`, `[]`, `[4]`, `{}` —
 * returns `null`, which closes the `Number('') === 0`, `Number(null) === 0`,
 * `Number(true) === 1` and `Number([4]) === 4` traps in one place.
 *
 * @param {unknown} raw
 * @returns {number|null} the integer, or `null` when `raw` is not one
 */
function asInteger(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!INTEGER_TEXT.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

/** True for a value the payload simply did not supply: absent, or blank text. */
function isBlank(raw) {
  if (raw === null || raw === undefined) return true;
  return typeof raw === 'string' && raw.trim() === '';
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

/** Optional free text: absent stays absent, anything else becomes a string. */
function optionalText(raw) {
  return raw === null || raw === undefined ? null : String(raw);
}

/**
 * @typedef {Object} EvaluationInput
 * @property {number} studentId       positive integer
 * @property {string} date            `YYYY-MM-DD`, a real calendar date
 * @property {number} concept         integer 1..5
 * @property {number} building        integer 1..5
 * @property {number} problemSolving  integer 1..5
 * @property {number} focus           integer 1..5
 * @property {number} attitude        integer 1..5
 * @property {string|null} lessonTopic
 * @property {string|null} instructorNotes
 * @property {string|null} instructorName  trimmed, at most 255 characters
 */

/**
 * Validate an untrusted evaluation payload.
 *
 * On success the returned `value` is safe to hand straight to the upsert: every
 * required field is present and in range, and the optional fields are strings
 * or `null`. On failure `error` is one non-empty sentence naming the offending
 * field. `body` is not mutated, and no substitute is ever stored in place of a
 * received value (Req 1.2–1.5, 1.7–1.9).
 *
 * @param {unknown} body untrusted request JSON
 * @returns {{ value: EvaluationInput }|{ error: string }} exactly one of the two
 */
export function validateEvaluationPayload(body) {
  // A non-object body (null, an array, a string, a number) is refused with a
  // message rather than throwing on a property read.
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object' };
  }

  // --- studentId: a positive integer (Req 1.2) ---
  const studentId = asInteger(body.studentId);
  if (studentId === null || studentId <= 0) {
    return {
      error: `studentId must be a positive integer — got ${received(body.studentId)}`,
    };
  }

  // --- date: defaulted when absent or blank, otherwise real (Req 1.7, 1.8) ---
  const dateAbsent = isBlank(body.date);
  // A supplied date must be text before anything looks at its shape: coercing
  // first would let `['2026-03-04']` through as a date, the same trap
  // `asInteger` closes for `[4]`. `undefined`/`null`/blank still default (Req 1.7).
  if (!dateAbsent && typeof body.date !== 'string') {
    return { error: `date must be "YYYY-MM-DD" — got ${received(body.date)}` };
  }
  const date = dateAbsent ? todayIso() : body.date.trim();
  if (!ISO_DATE.test(date) || !isRealDate(date)) {
    // Same message for a malformed shape and for a shaped-but-unreal date such
    // as 2026-02-30: both name the field and carry what arrived (Req 1.8).
    return { error: `date must be "YYYY-MM-DD" — got ${received(body.date)}` };
  }

  // --- the five competency scores (Req 1.2, 1.3, 1.4, 1.5) ---
  const scores = {};
  for (const { key, label } of COMPETENCIES) {
    // INVARIANT: every competency visited before this one produced an integer
    // in [1,5] and is already recorded in `scores`.
    const raw = body[key];

    if (isBlank(raw)) {
      return { error: `${label} is required — every competency must be rated from 1 to 5` };
    }

    const score = asInteger(raw);
    if (score === null || score < 1 || score > 5) {
      // Rejected, not clamped and not defaulted (Req 1.5).
      return {
        error: `${label} must be an integer from 1 to 5 — got ${received(raw)}`,
      };
    }

    scores[key] = score;
  }

  // --- optional text (Req 1.9) ---
  const instructorNameRaw = optionalText(body.instructorName);
  const instructorName = instructorNameRaw === null ? null : instructorNameRaw.trim() || null;
  if (instructorName !== null && instructorName.length > INSTRUCTOR_NAME_MAX) {
    return { error: `instructorName must be ${INSTRUCTOR_NAME_MAX} characters or fewer` };
  }

  return {
    value: {
      studentId,
      date,
      ...scores,
      lessonTopic: optionalText(body.lessonTopic),
      instructorNotes: optionalText(body.instructorNotes),
      instructorName,
    },
  };
}
