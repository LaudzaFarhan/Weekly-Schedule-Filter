/**
 * API client for trial availability (/api/new/trial-availability).
 *
 * The calculation lives on the server because it joins five tables — branch
 * rules, instructors, classes, Live Progress and the seat rules — and the
 * browser used to reimplement a thinner version of it that disagreed. One
 * answer, computed once.
 */

const API_PATH = '/api/new/trial-availability';

/** Build the query string, omitting filters that are unset or 'all'. */
const toQuery = ({ branch, day, category } = {}) => {
  const params = new URLSearchParams();
  if (branch && branch !== 'all') params.set('branch', branch);
  if (day && day !== 'all') params.set('day', day);
  if (category && category !== 'all') params.set('category', category);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

/** Fetch availability once. */
export async function getTrialAvailability(filters) {
  const res = await fetch(`${API_PATH}${toQuery(filters)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Failed to fetch trial availability');
  return body;
}

/**
 * Subscribe via polling, matching the other New Ops services.
 *
 * Thirty seconds rather than the five used for branch rules: this reads five
 * tables and recomputes every window, and availability does not change by the
 * second. Changing a filter re-subscribes, so a new answer is immediate.
 */
export function subscribeToTrialAvailability(filters, callback, onError) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getTrialAvailability(filters);
      if (active) callback(data);
    } catch (error) {
      if (active && onError) onError(error);
    }
  };

  poll();
  const interval = setInterval(poll, 30000);

  return () => {
    active = false;
    clearInterval(interval);
  };
}
