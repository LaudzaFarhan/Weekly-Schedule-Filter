/**
 * API client service for New Operations Instructors (PostgreSQL Database via Next.js routes)
 */

const API_PATH = '/api/new/instructors';

/**
 * Fetch all internal instructors once
 */
export async function getAllInternalInstructors() {
  try {
    const res = await fetch(API_PATH);
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to fetch instructors');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching internal instructors:', error);
    throw error;
  }
}

/**
 * Subscribe to internal instructors in real-time via polling
 */
export function subscribeToInternalInstructors(callback) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getAllInternalInstructors();
      if (active) {
        callback(data);
      }
    } catch (error) {
      console.error('Polling error in internal instructors:', error);
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
 * Create a new internal instructor
 */
export async function createInternalInstructor(instructorData) {
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(instructorData)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to create instructor');
    }
    return await res.json();
  } catch (error) {
    console.error('Error creating internal instructor:', error);
    throw error;
  }
}

/**
 * Update an existing internal instructor
 */
export async function updateInternalInstructor(instructorId, updates) {
  try {
    const res = await fetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: instructorId, ...updates })
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update instructor');
    }
    return await res.json();
  } catch (error) {
    console.error('Error updating internal instructor:', error);
    throw error;
  }
}

/**
 * Delete an internal instructor
 */
export async function deleteInternalInstructor(instructorId) {
  try {
    const res = await fetch(`${API_PATH}?id=${instructorId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to delete instructor');
    }
    return await res.json();
  } catch (error) {
    console.error('Error deleting internal instructor:', error);
    throw error;
  }
}
