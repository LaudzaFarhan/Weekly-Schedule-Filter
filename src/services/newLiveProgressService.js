/**
 * API client for Live Progress (PostgreSQL via /api/new/live-progress).
 *
 * Only the progress itself lives here. A student's day, time, instructor and
 * program come from the schedule feed the pages already subscribe to, so this
 * service never duplicates them.
 */

const API_PATH = '/api/new/live-progress';

/** Fetch progress rows once, optionally for one category. */
export async function getLiveProgress({ category } = {}) {
  try {
    const qs = new URLSearchParams();
    if (category) qs.set('category', category);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const res = await fetch(`${API_PATH}${suffix}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch live progress');
    }
    return await res.json();
  } catch (error) {
    console.warn('[liveProgressService] Fetch live progress failed (will retry):', error?.message || error);
    throw error;
  }
}

/**
 * Save one student's progress for one level.
 *
 * The whole record is sent every time, matching the endpoint's upsert: a partial
 * body would blank the fields it left out.
 */
export async function saveLiveProgress(record) {
  const res = await fetch(API_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save progress');
  }
  return await res.json();
}

/** Clear a stored progress row. */
export async function deleteLiveProgress(id) {
  const res = await fetch(`${API_PATH}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to clear progress');
  }
  return await res.json();
}

/**
 * Subscribe via polling, matching the other New Ops services.
 *
 * Ten seconds rather than three: progress is edited by hand a few times a day,
 * so a faster poll would only add load and risk overwriting a cell mid-edit.
 */
export function subscribeToLiveProgress(callback, onError, options = {}) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getLiveProgress(options);
      if (active) callback(data);
    } catch (error) {
      if (active && onError) onError(error);
    }
  };

  poll();
  const interval = setInterval(poll, 10000);

  return () => {
    active = false;
    clearInterval(interval);
  };
}
