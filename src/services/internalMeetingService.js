/**
 * API client service for New Operations Meetings & Schedule Conflict Prediction
 */

const API_PATH = '/api/new/meetings';

/**
 * Fetch all internal meetings
 */
export async function getAllInternalMeetings(params = {}) {
  try {
    const queryStr = new URLSearchParams(params).toString();
    const url = queryStr ? `${API_PATH}?${queryStr}` : API_PATH;
    const res = await fetch(url);
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to fetch meetings');
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching internal meetings:', error);
    throw error;
  }
}

/**
 * Subscribe to internal meetings in real-time via polling
 */
export function subscribeToInternalMeetings(callback, params = {}) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getAllInternalMeetings(params);
      if (active) {
        callback(data);
      }
    } catch (error) {
      console.warn('[meetingService] Polling retry on next interval:', error?.message || error);
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
 * Create a new meeting
 */
export async function createInternalMeeting(meetingData) {
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meetingData)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to create meeting');
    }
    return await res.json();
  } catch (error) {
    console.error('Error creating meeting:', error);
    throw error;
  }
}

/**
 * Update an existing meeting (e.g. details, status, or attendance)
 */
export async function updateInternalMeeting(meetingId, updates) {
  try {
    const res = await fetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: meetingId, ...updates })
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update meeting');
    }
    return await res.json();
  } catch (error) {
    console.error('Error updating meeting:', error);
    throw error;
  }
}

/**
 * Delete a meeting
 */
export async function deleteInternalMeeting(meetingId) {
  try {
    const res = await fetch(`${API_PATH}?id=${meetingId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to delete meeting');
    }
    return await res.json();
  } catch (error) {
    console.error('Error deleting meeting:', error);
    throw error;
  }
}

/**
 * Predict schedule conflicts for a list of teachers on a specific date and time slot
 */
export async function predictTeacherConflicts(payload) {
  try {
    const res = await fetch(`${API_PATH}/predict-conflicts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to predict conflicts');
    }
    return await res.json();
  } catch (error) {
    console.error('Error predicting teacher conflicts:', error);
    throw error;
  }
}
