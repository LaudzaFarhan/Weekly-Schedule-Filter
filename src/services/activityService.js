import { collection, addDoc, serverTimestamp, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Log an activity to Firestore.
 * @param {string} userEmail - The email of the user performing the action.
 * @param {string} action - The action performed (e.g., 'logged in', 'synced all branches').
 * @param {string} meta - Any extra metadata.
 */
export async function logActivity(userEmail, action, meta = '') {
  try {
    const name = userEmail ? userEmail.split('@')[0] : 'Unknown';
    await addDoc(collection(db, 'activityLogs'), {
      user: name,
      email: userEmail || '',
      action,
      meta,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.error('Failed to log activity', err);
  }
}

/**
 * Subscribe to the latest activity logs in real-time.
 * @param {number} maxLogs - The maximum number of logs to fetch.
 * @param {function} callback - Function to call with the updated logs array.
 * @returns {function} Unsubscribe function.
 */
export function subscribeToActivities(maxLogs = 20, callback) {
  const q = query(
    collection(db, 'activityLogs'),
    orderBy('timestamp', 'desc'),
    limit(maxLogs)
  );

  return onSnapshot(q, (snapshot) => {
    const logs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(logs);
  });
}
