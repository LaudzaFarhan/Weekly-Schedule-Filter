/**
 * The typed confirmation that gates the student bulk wipe.
 *
 * Deliberately dependency-free: both the browser dialog
 * (`WipeStudentsDialog`) and the server handler
 * (`DELETE /api/new/students`) import this module, so the two can never
 * disagree on what counts as a valid confirmation.
 */

/** The exact text a caller must supply to authorise a bulk wipe. Req 3.4 */
export const WIPE_CONFIRMATION_PHRASE = 'DELETE ALL STUDENTS';

/**
 * True only for a string whose surrounding whitespace, once removed, equals
 * the confirmation phrase character for character with case preserved.
 *
 * Trim-then-exact and case-sensitive: `'  DELETE ALL STUDENTS\n'` passes,
 * `'delete all students'`, `'DELETE  ALL STUDENTS'`, `''` and any non-string
 * value (including `null` and `undefined`) do not.
 *
 * Req 3.5, 5.1, 5.3
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function matchesConfirmationPhrase(value) {
  return typeof value === 'string' && value.trim() === WIPE_CONFIRMATION_PHRASE;
}
