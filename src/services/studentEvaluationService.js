/**
 * API client for Student Evaluations (PostgreSQL via /api/new/student-evaluations).
 *
 * Shape follows `src/services/internalStudentService.js`: a module-level
 * `API_PATH`, one `fetch` per verb, and `if (!res.ok) throw new Error(errData.error || …)`
 * so the message the endpoint chose — the validator's field-naming message, the
 * 409 pointing at an existing day, the 500 carrying the database error — reaches
 * the Evaluation_Form and is displayed verbatim (Req 1.13, 2.14).
 *
 * There is deliberately **no** polling subscription here. Evaluations change
 * only through this page's own save, so the page updates its local list from the
 * record returned by the save (Req 3.11) and a 3-second poll would be pure load.
 */

const API_PATH = '/api/new/student-evaluations';

/**
 * Fetch evaluations once, optionally narrowed to one student and a date range.
 *
 * Absent parameters are omitted from the query string rather than sent empty:
 * the endpoint treats a supplied `from`/`to` as a filter and rejects one that is
 * not `YYYY-MM-DD`, so sending `from=` would turn "no lower bound" into a 400.
 * With no parameters at all this returns every evaluation.
 *
 * The endpoint also accepts `instructorName`, `search` and `limit`; the report
 * cards page filters by student and date range only, so those are not exposed.
 *
 * @param {{ studentId?: number|string, from?: string, to?: string }} [params]
 *   `from`/`to` are inclusive bounds in `YYYY-MM-DD` (Req 2.5).
 * @returns {Promise<Object[]>} evaluations ascending by date, then by id.
 * @throws {Error} carrying the endpoint's `error` message on a non-ok response.
 */
export async function getEvaluations({ studentId, from, to } = {}) {
  try {
    const qs = new URLSearchParams();
    if (studentId) qs.set('studentId', String(studentId));
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const res = await fetch(`${API_PATH}${suffix}`);
    if (!res.ok) {
      // A 500 raised before the response body is written may carry no JSON at
      // all, so an unparseable body must not mask the failure with a parse error.
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to fetch evaluations');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching evaluations:', error);
    throw error;
  }
}

/**
 * Save one student's evaluation for one day.
 *
 * A POST, which the endpoint handles as an upsert on `(student_id, eval_date)`:
 * re-saving a day replaces that day rather than adding a second row, so the form
 * needs no "does today already exist" check before saving (Req 2.2, 2.3).
 *
 * The whole record is sent every time, matching that upsert — a partial body
 * would blank the columns it left out.
 *
 * @param {Object} payload - `{ studentId, date, lessonTopic, concept, building,
 *   problemSolving, focus, attitude, instructorNotes, instructorName }`.
 * @returns {Promise<Object>} the saved evaluation record.
 * @throws {Error} carrying the endpoint's `error` message on a non-ok response.
 */
export async function saveEvaluation(payload) {
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to save evaluation');
    }
    return await res.json();
  } catch (error) {
    console.error('Error saving evaluation:', error);
    throw error;
  }
}

/**
 * Edit an existing evaluation, identified by the `id` on the payload.
 *
 * Moving a record onto a date the same student already holds is a 409 whose
 * message names that date and points at the existing day; it arrives here as the
 * thrown message so the form can show it unchanged (Req 2.8).
 *
 * @param {Object} payload - the full record, including its `id`.
 * @returns {Promise<Object>} the updated evaluation record.
 * @throws {Error} carrying the endpoint's `error` message on a non-ok response.
 */
export async function updateEvaluation(payload) {
  try {
    const res = await fetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to update evaluation');
    }
    return await res.json();
  } catch (error) {
    console.error('Error updating evaluation:', error);
    throw error;
  }
}

/**
 * Delete exactly one evaluation, identified by `?id=`.
 *
 * There is no bulk form on the endpoint and none is offered here: one call
 * removes at most one record (Req 2.10).
 *
 * @param {number|string} id
 * @returns {Promise<{ success: boolean, message: string }>}
 * @throws {Error} carrying the endpoint's `error` message on a non-ok response.
 */
export async function deleteEvaluation(id) {
  try {
    const res = await fetch(`${API_PATH}?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to delete evaluation');
    }
    return await res.json();
  } catch (error) {
    console.error('Error deleting evaluation:', error);
    throw error;
  }
}
