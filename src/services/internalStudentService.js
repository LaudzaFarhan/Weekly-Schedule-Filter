/**
 * API client service for New Operations Students (PostgreSQL Database via Next.js routes)
 */

const API_PATH = '/api/new/students';

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
      console.error('Polling error in internal students:', error);
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
