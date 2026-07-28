/**
 * API client for New Operations branch rules (PostgreSQL via /api/new/operationals).
 *
 * New Operations is Postgres-only: open days, operating hours and the class slot
 * plan live in `internal_operationals`, not in the Google Sheets config that
 * Old Operations uses.
 */

const API_PATH = '/api/new/operationals';

/** Fetch all branch/day rules once. */
export async function getAllOperationals() {
  const res = await fetch(API_PATH);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch operational rules');
  }
  return await res.json();
}

/** Subscribe via polling, matching the other New Ops services. */
export function subscribeToOperationals(callback, onError) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getAllOperationals();
      if (active) callback(data);
    } catch (error) {
      if (active && onError) onError(error);
    }
  };

  poll();
  const interval = setInterval(poll, 5000);

  return () => {
    active = false;
    clearInterval(interval);
  };
}

/**
 * Create or replace one branch/day rule. The API upserts on
 * (branchName, day), so calling this repeatedly is safe.
 */
export async function saveOperational(rule) {
  const res = await fetch(API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save operational rule');
  }
  return await res.json();
}

/** Save many rules, reporting the first failure with its branch/day. */
export async function saveOperationals(rules) {
  const results = [];
  for (const rule of rules) {
    try {
      results.push(await saveOperational(rule));
    } catch (error) {
      throw new Error(`${rule.branchName} · ${rule.day}: ${error.message}`);
    }
  }
  return results;
}

/** Delete a rule by id, or by branch + day. */
export async function deleteOperational({ id, branch, day }) {
  const qs = id
    ? `id=${encodeURIComponent(id)}`
    : `branch=${encodeURIComponent(branch)}&day=${encodeURIComponent(day)}`;
  const res = await fetch(`${API_PATH}?${qs}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete operational rule');
  }
  return await res.json();
}
