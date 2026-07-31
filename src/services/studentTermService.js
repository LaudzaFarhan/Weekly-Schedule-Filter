/**
 * API client service for New Operations student term subscriptions
 * (PostgreSQL database via the Next.js route `/api/new/student-terms`).
 *
 * Same shape as `internalStudentService.js`: one `fetch` per verb, and a
 * non-ok response is re-thrown carrying the server's own `error` string so the
 * message the API wrote is the message the UI shows (Req 2.14).
 *
 * There is no polling helper here. Term rows change only through this page's own
 * writes, so a 3 s poll would add load without adding information.
 */

const API_PATH = '/api/new/student-terms';

/**
 * @typedef {Object} StudentTerm
 * @property {number} id
 * @property {number} studentId
 * @property {number} year
 * @property {number} termNumber   1..4
 * @property {boolean} paid
 * @property {string|null} paidAt
 * @property {string|null} note
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * List term rows, optionally narrowed to one student and one year.
 *
 * Ordered by the route as `(term_year, term_number, id)`, which is the
 * `(year, termNumber)` order `src/lib/reportCard.js` reads terms in, so the
 * caller can hand the array straight to `termSummary()`.
 *
 * @param {{ studentId?: number|string, year?: number|string }} [filters]
 * @returns {Promise<StudentTerm[]>}
 * @throws {Error} carrying the API's `error` message on a non-ok response.
 */
export async function getTerms({ studentId, year } = {}) {
  try {
    const params = new URLSearchParams();
    if (studentId !== undefined && studentId !== null && String(studentId) !== '') {
      params.set('studentId', String(studentId));
    }
    if (year !== undefined && year !== null && String(year) !== '') {
      params.set('year', String(year));
    }
    const queryString = params.toString();
    const res = await fetch(queryString ? `${API_PATH}?${queryString}` : API_PATH);
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to fetch student terms');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching student terms:', error);
    throw error;
  }
}

/**
 * Record one term for one student in one year.
 *
 * The route's `POST` is an upsert on `(studentId, year, termNumber)`, so this one
 * call both creates a term and edits an existing one (Req 2.11); there is no
 * separate update call on that natural key. `deleteTerm` is the only way to
 * remove a row.
 *
 * THE PAYLOAD IS PASSED THROUGH EXACTLY AS SUPPLIED. No default is filled in for
 * `paid`, `paidAt` or `note`, because on this route an omitted key means "leave
 * the stored value alone" and only an explicit `paid: false` marks a term unpaid.
 * Defaulting `paid` to `false` here would let a caller that meant to edit only
 * the note silently un-pay a settled term, and an administrator would then chase
 * a subscription that is already paid. Supply `paid` when, and only when, the
 * caller means to change it.
 *
 * @param {{ studentId: number|string, year: number|string, termNumber: number|string,
 *   paid?: boolean, paidAt?: string|null, note?: string|null }} payload
 * @returns {Promise<StudentTerm>} the stored row as the API mapped it.
 * @throws {Error} carrying the API's `error` message on a non-ok response.
 */
export async function saveTerm(payload) {
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to save student term');
    }
    return await res.json();
  } catch (error) {
    console.error('Error saving student term:', error);
    throw error;
  }
}

/**
 * Delete one term row by identifier. One row per request — the route offers no
 * bulk form.
 *
 * @param {number|string} id
 * @returns {Promise<{ success: boolean, message: string }>}
 * @throws {Error} carrying the API's `error` message on a non-ok response.
 */
export async function deleteTerm(id) {
  try {
    const res = await fetch(`${API_PATH}?${new URLSearchParams({ id: String(id) })}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to delete student term');
    }
    return await res.json();
  } catch (error) {
    console.error('Error deleting student term:', error);
    throw error;
  }
}
