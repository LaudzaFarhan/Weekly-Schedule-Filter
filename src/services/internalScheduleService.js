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
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to fetch schedule');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching internal classes:', error);
    throw error;
  }
}

/**
 * Subscribe to internal classes using polling (simulates real-time)
 */
export function subscribeToInternalClasses(callback, onError) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getAllInternalClasses();
      if (active) {
        callback(data);
      }
    } catch (error) {
      console.error('Polling error in internal classes:', error);
      if (active && typeof onError === 'function') {
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
