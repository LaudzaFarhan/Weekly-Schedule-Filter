/**
 * API client service for New Operations Students (PostgreSQL Database via Next.js routes)
 */

const API_PATH = '/api/new/students';

/** Default deadline for a bulk wipe request, in milliseconds (Req 6.9). */
export const BULK_DELETE_TIMEOUT_MS = 30000;

/**
 * Raised when no response arrives before the bulk wipe deadline (Req 6.9).
 *
 * This is neither a success nor a failure: the transaction may well have
 * committed after the client stopped listening, so the caller must report the
 * outcome as unconfirmed and advise a reload rather than claim the wipe failed.
 *
 * Carries a recognisable `name` and an `unconfirmed` flag in addition to being
 * an `Error` subclass, so callers can identify it without relying on
 * `instanceof` across module instances.
 */
export class WipeUnconfirmedError extends Error {
  constructor(timeoutMs = BULK_DELETE_TIMEOUT_MS) {
    super(
      `No response was received within ${Math.round(timeoutMs / 1000)} seconds, so the outcome ` +
      'of the bulk delete is unconfirmed. Reload the page to see the current student record count.'
    );
    this.name = 'WipeUnconfirmedError';
    this.unconfirmed = true;
    this.timeoutMs = timeoutMs;
  }
}

/** True for the unconfirmed-outcome signal raised by `bulkDeleteAllStudents` (Req 6.9). */
export function isWipeUnconfirmedError(error) {
  return Boolean(
    error && (error instanceof WipeUnconfirmedError || error.name === 'WipeUnconfirmedError' || error.unconfirmed === true)
  );
}

/**
 * Fetch all internal students once
 */
export async function getAllInternalStudents() {
  try {
    const res = await fetch(API_PATH);
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to fetch students');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching internal students:', error);
    throw error;
  }
}

/**
 * Subscribe to internal students in real-time via polling
 */
export function subscribeToInternalStudents(callback) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getAllInternalStudents();
      if (active) {
        callback(data);
      }
    } catch (error) {
      console.warn('[studentService] Polling retry on next interval:', error?.message || error);
    }
  };

  poll();
  const interval = setInterval(poll, 3000); // Poll database every 3 seconds

  return () => {
    active = false;
    clearInterval(interval);
  };
}

/**
 * Create a new internal student
 */
export async function createInternalStudent(studentData) {
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(studentData)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to create student');
    }
    return await res.json();
  } catch (error) {
    console.error('Error creating internal student:', error);
    throw error;
  }
}

/**
 * Bulk create internal students
 */
export async function bulkCreateInternalStudents(studentsArray) {
  try {
    const res = await fetch(`${API_PATH}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ students: studentsArray })
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to bulk import students');
    }
    return await res.json();
  } catch (error) {
    console.error('Error bulk importing students:', error);
    throw error;
  }
}

/**
 * Update an existing internal student
 */
export async function updateInternalStudent(studentId, updates) {
  try {
    const res = await fetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: studentId, ...updates })
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update student');
    }
    return await res.json();
  } catch (error) {
    console.error('Error updating internal student:', error);
    throw error;
  }
}

/**
 * Delete an internal student
 */
export async function deleteInternalStudent(studentId) {
  try {
    const res = await fetch(`${API_PATH}?id=${studentId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to delete student');
    }
    return await res.json();
  } catch (error) {
    console.error('Error deleting internal student:', error);
    throw error;
  }
}

/**
 * Delete internal student records (optionally scoped to selected branches),
 * plus the branch history and live progress records keyed to them, in one server-side transaction.
 *
 * Sends `DELETE` to the students path with no `?id=` and the confirmation
 * phrase in the JSON body, which is what the endpoint requires before it will
 * treat the request as a bulk wipe rather than a malformed single delete.
 *
 * @param {string} confirm - The confirmation phrase, sent to the server verbatim.
 * @param {{ branches?: Array<string>, timeoutMs?: number }} [options]
 * @returns {Promise<{ success: boolean, deletedStudents: number, deletedHistory: number, deletedProgress: number }>}
 * @throws {WipeUnconfirmedError} When no response arrives before the deadline (Req 6.9).
 * @throws {Error} Carrying the server's `error` string on a non-ok response.
 */
export async function bulkDeleteAllStudents(confirm, { branches, timeoutMs = BULK_DELETE_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = { confirm };
    if (branches && Array.isArray(branches) && branches.length > 0) {
      payload.branches = branches;
    }
    const res = await fetch(API_PATH, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) {
      // A 500 from a rolled-back wipe may not carry a JSON body at all, so an
      // unparseable response must not mask the failure with a parse error.
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to delete all students');
    }
    return await res.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      const unconfirmed = new WipeUnconfirmedError(timeoutMs);
      console.warn('Bulk delete of internal students is unconfirmed:', unconfirmed.message);
      throw unconfirmed;
    }
    console.error('Error deleting all internal students:', error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
