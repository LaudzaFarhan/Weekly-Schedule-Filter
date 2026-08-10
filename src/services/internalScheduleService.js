/**
 * API client service for New Operations Schedule (PostgreSQL Database via Next.js routes)
 */

const API_PATH = '/api/new/schedule';

/**
 * Fetch all internal classes once
 */
export async function getAllInternalClasses() {
  try {
    const res = await fetch(API_PATH);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to fetch schedule');
    }
    return await res.json();
  } catch (error) {
    console.warn('[scheduleService] Fetch internal classes failed (will retry):', error?.message || error);
    throw error;
  }
}

/**
 * Subscribe to internal classes using polling (simulates real-time)
 */
export function subscribeToInternalClasses(callback, onError) {
  let active = true;
  let hasLoaded = false;

  const poll = async () => {
    try {
      const data = await getAllInternalClasses();
      if (active) {
        hasLoaded = true;
        callback(data);
      }
    } catch (error) {
      console.warn('[scheduleService] Polling retry on next interval:', error?.message || error);
      if (active && !hasLoaded && typeof onError === 'function') {
        onError(error);
      }
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
 * Create a new internal class
 */
export async function createInternalClass(classData) {
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(classData)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to create class');
    }
    return await res.json();
  } catch (error) {
    console.error('Error creating internal class:', error);
    throw error;
  }
}

/**
 * Update an existing internal class
 */
export async function updateInternalClass(classId, updates) {
  try {
    const res = await fetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: classId, ...updates })
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update class');
    }
    return await res.json();
  } catch (error) {
    console.error('Error updating internal class:', error);
    throw error;
  }
}

/**
 * Delete an internal class
 */
export async function deleteInternalClass(classId) {
  try {
    const res = await fetch(`${API_PATH}?id=${classId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to delete class');
    }
    return await res.json();
  } catch (error) {
    console.error('Error deleting internal class:', error);
    throw error;
  }
}

/**
 * Bulk create internal schedule classes
 */
export async function bulkCreateInternalClasses(classesArray) {
  try {
    const res = await fetch(`${API_PATH}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classes: classesArray })
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to bulk import schedule classes');
    }
    return await res.json();
  } catch (error) {
    console.error('Error bulk importing schedule classes:', error);
    throw error;
  }
}

/**
 * Bulk delete all internal schedule classes
 */
export async function bulkDeleteAllClasses() {
  try {
    const res = await fetch(`${API_PATH}?all=true`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to clear schedule classes');
    }
    return await res.json();
  } catch (error) {
    console.error('Error clearing internal schedule classes:', error);
    throw error;
  }
}

