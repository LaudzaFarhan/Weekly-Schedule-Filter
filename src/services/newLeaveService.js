/**
 * API client service for New Operations Leave Management
 * (PostgreSQL Database via Next.js routes)
 */

const API_PATH = '/api/new/leave';

/** Fetch all leave records once. */
export async function getAllLeaves() {
  try {
    const res = await fetch(API_PATH);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to fetch leave records');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching leave records:', error);
    throw error;
  }
}

/**
 * Subscribe to leave records via polling, matching the other New Ops services.
 * Returns an unsubscribe function.
 */
export function subscribeToLeaves(callback, onError) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getAllLeaves();
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

/** Create a leave record. */
export async function createLeave(data) {
  const res = await fetch(API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to create leave record');
  }
  return await res.json();
}

/** Update a leave record. Requires `id`. */
export async function updateLeave(id, data) {
  const res = await fetch(API_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...data })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to update leave record');
  }
  return await res.json();
}

/** Delete a leave record by id. */
export async function deleteLeave(id) {
  const res = await fetch(`${API_PATH}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to delete leave record');
  }
  return await res.json();
}
