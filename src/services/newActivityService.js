/**
 * API client for the New Operations activity log
 * (PostgreSQL via /api/new/activity).
 *
 * Replaces the previous localStorage log, which was per-browser and had no way
 * of recording who made a change.
 */

const API_PATH = '/api/new/activity';

/** Fetch entries once, newest first. */
export async function getActivity({ source, action, limit = 200 } = {}) {
  const qs = new URLSearchParams();
  if (source) qs.set('source', source);
  if (action) qs.set('action', action);
  if (limit) qs.set('limit', String(limit));

  const res = await fetch(`${API_PATH}?${qs.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch activity');
  }
  return await res.json();
}

/** Subscribe via polling, matching the other New Ops services. */
export function subscribeToActivity(callback, onError, options = {}) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getActivity(options);
      if (active) callback(data);
    } catch (error) {
      if (active && onError) onError(error);
    }
  };

  poll();
  const interval = setInterval(poll, 8000);

  return () => {
    active = false;
    clearInterval(interval);
  };
}

/**
 * Record an activity entry.
 * Failures are swallowed — logging must never block the action it describes.
 *
 * @param {object} entry
 * @param {string} entry.action  add | edit | delete | bulk
 * @param {string} entry.summary human-readable description
 * @param {number} [entry.count] how many records were affected
 * @param {string} [entry.userEmail] who did it
 * @param {string} [entry.source] schedule | crm | students | instructors
 * @param {object} [entry.details] structured before/after changes & metadata
 */
export async function logActivity(entry) {
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'schedule', ...entry }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.warn('Could not record activity:', error.message);
    return null;
  }
}

/** Delete one entry, a whole source, or everything. */
export async function deleteActivity({ id, source, all } = {}) {
  const qs = new URLSearchParams();
  if (id) qs.set('id', String(id));
  else if (source) qs.set('source', source);
  else if (all) qs.set('all', 'true');

  const res = await fetch(`${API_PATH}?${qs.toString()}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete activity');
  }
  return await res.json();
}

/** "admin@thelab.id" -> "admin". Falls back to a clear placeholder. */
export function displayUser(email) {
  if (!email) return 'Unknown user';
  return String(email).split('@')[0];
}
