/**
 * API client service for New Operations subscription top-up payments
 * (PostgreSQL database via the Next.js route `/api/new/subscription-topups`).
 *
 * Same shape as `studentTermService.js`: one `fetch` per verb, and a non-ok
 * response is re-thrown carrying the server's own `error` string, so the message
 * the API wrote is the message the UI shows.
 *
 * There is no polling helper. Payment rows change only through this page's own
 * writes, so a timer would add load without adding information.
 */

const API_PATH = '/api/new/subscription-topups';

/**
 * @typedef {Object} SubscriptionTopUp
 * @property {number} id
 * @property {number} studentId
 * @property {string|null} studentName
 * @property {number} meetings       how many meetings this payment bought
 * @property {string} paidAt         "YYYY-MM-DD", the date the parent paid
 * @property {string|null} packageLabel
 * @property {string|null} note
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * List payments, newest first, optionally narrowed to one student.
 *
 * @param {{ studentId?: number|string }} [filters]
 * @returns {Promise<SubscriptionTopUp[]>}
 * @throws {Error} carrying the API's `error` message on a non-ok response.
 */
export async function getTopUps({ studentId } = {}) {
  try {
    const params = new URLSearchParams();
    if (studentId !== undefined && studentId !== null && String(studentId) !== '') {
      params.set('studentId', String(studentId));
    }
    const queryString = params.toString();
    const res = await fetch(queryString ? `${API_PATH}?${queryString}` : API_PATH);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to fetch payment history');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching payment history:', error);
    throw error;
  }
}

/**
 * Record one payment.
 *
 * @param {{ studentId: number|string, studentName?: string, meetings: number,
 *   paidAt: string, packageLabel?: string|null, note?: string|null }} payload
 * @returns {Promise<SubscriptionTopUp>}
 * @throws {Error} carrying the API's `error` message on a non-ok response.
 */
export async function createTopUp(payload) {
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to record payment');
    }
    return await res.json();
  } catch (error) {
    console.error('Error recording payment:', error);
    throw error;
  }
}

/**
 * Remove one mistaken payment record.
 *
 * @param {number|string} id
 * @returns {Promise<{ success: boolean, message: string }>}
 * @throws {Error} carrying the API's `error` message on a non-ok response.
 */
export async function deleteTopUp(id) {
  try {
    const res = await fetch(`${API_PATH}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to delete payment record');
    }
    return await res.json();
  } catch (error) {
    console.error('Error deleting payment record:', error);
    throw error;
  }
}
