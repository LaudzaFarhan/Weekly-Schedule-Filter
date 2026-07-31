/**
 * Wording for everything the student bulk wipe reports afterwards: the toast
 * the Admin sees and the single `internal_activity` row that records the
 * attempt.
 *
 * Pure and dependency-free — no React, no services, no database. The page
 * (`NewStudentsPage.handleWipeConfirm`) supplies the server-reported counts and
 * the signed-in email; this module decides only how they read.
 */

/** Action and source of the audit entry a wipe writes. Req 8.1, 8.7 */
export const WIPE_ACTIVITY = Object.freeze({ action: 'bulk', source: 'students' });

/** Recorded against the audit entry when no signed-in email exists. Req 8.6 */
export const UNKNOWN_AUDIT_USER = 'Unknown user';

/** Hard ceiling on the audit summary. Req 8.4 */
export const WIPE_AUDIT_SUMMARY_MAX_LENGTH = 500;

/**
 * The three data sets a wipe clears, in the order the audit summary names them.
 * Exported so callers and tests refer to the wording in one place rather than
 * repeating string literals.
 */
export const WIPE_AUDIT_DATA_SET_LABELS = Object.freeze({
  students: 'student records',
  history: 'branch history records',
  progress: 'live progress records',
});

/**
 * A count as a whole number of 0 or greater. Anything unusable — absent, not a
 * number, negative, NaN, Infinity — reads as 0 rather than leaking `NaN` into a
 * toast or an audit row.
 *
 * @param {unknown} value
 * @returns {number}
 */
function normalizeCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * A count rendered as plain digits, with no grouping separators and never in
 * exponent form, so a message carries exactly one run of digits per count.
 *
 * @param {unknown} value
 * @returns {string}
 */
function formatCount(value) {
  const n = normalizeCount(value);
  return Number.isSafeInteger(n) ? String(n) : BigInt(n).toString();
}

/**
 * The success toast. Carries the count the server reported and nothing else
 * countable: when that number differs from the count the dialog displayed, the
 * dialog's number must not appear anywhere in the message (Req 7.3), so this
 * message holds exactly one number and no other digits.
 *
 * Singular wording at exactly 1, plural for every other value including 0
 * (Req 7.2).
 *
 * @param {{ deletedStudents?: unknown }} [counts]
 * @returns {string}
 */
export function buildWipeSuccessMessage({ deletedStudents } = {}) {
  const count = normalizeCount(deletedStudents);
  const noun = count === 1 ? 'student record' : 'student records';
  return `Bulk wipe complete: deleted ${formatCount(count)} ${noun}.`;
}

/**
 * The audit summary for a successful wipe. Names all three cleared data sets
 * with the count the server reported for each, clamped to 500 characters —
 * clamped rather than assumed, because the counts are unbounded (Req 8.4).
 *
 * @param {{ deletedStudents?: unknown, deletedHistory?: unknown, deletedProgress?: unknown }} [counts]
 * @returns {string}
 */
export function buildWipeAuditSummary({ deletedStudents, deletedHistory, deletedProgress } = {}) {
  const summary =
    `Bulk wipe: deleted ${formatCount(deletedStudents)} ${WIPE_AUDIT_DATA_SET_LABELS.students}, `
    + `${formatCount(deletedHistory)} ${WIPE_AUDIT_DATA_SET_LABELS.history}, `
    + `${formatCount(deletedProgress)} ${WIPE_AUDIT_DATA_SET_LABELS.progress}.`;
  return summary.slice(0, WIPE_AUDIT_SUMMARY_MAX_LENGTH);
}

/**
 * The audit summary for a failed wipe: states that the attempt failed and that
 * nothing was deleted. The entry itself carries a count of 0 (Req 8.7).
 *
 * @returns {string}
 */
export function buildWipeFailureAuditSummary() {
  return 'Bulk wipe attempt failed — no records were deleted.';
}

/**
 * The user value of the audit entry: the recorded email unchanged, or the
 * unidentified-user placeholder when nothing usable is recorded, so the entry
 * is still written (Req 8.3, 8.6).
 *
 * A value that is absent, not a string, or blank once trimmed counts as no
 * email recorded. A recorded email is returned exactly as given — no trimming,
 * no case folding.
 *
 * @param {unknown} email
 * @returns {string}
 */
export function resolveAuditUser(email) {
  if (typeof email !== 'string' || email.trim() === '') return UNKNOWN_AUDIT_USER;
  return email;
}
