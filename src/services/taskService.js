import { db } from './firebase';
import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  serverTimestamp 
} from 'firebase/firestore';

const TASKS_COLLECTION = 'tasks';

/**
 * Create a new task
 * @param {Object} taskData { title, description, assignee, assigner, status, priority, dueDate }
 */
export async function createTask(taskData) {
  const colRef = collection(db, TASKS_COLLECTION);
  return addDoc(colRef, {
    ...taskData,
    status: taskData.status || 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Update an existing task
 */
export async function updateTask(taskId, updates) {
  const docRef = doc(db, TASKS_COLLECTION, taskId);
  return updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a task
 */
export async function deleteTask(taskId) {
  const docRef = doc(db, TASKS_COLLECTION, taskId);
  return deleteDoc(docRef);
}

/**
 * Listen to tasks assigned TO a specific user (My Tasks)
 * @param {string} assigneeEmail - The email of the assigned instructor
 * @param {function} callback - Receives array of tasks
 * @returns unsubscribe function
 */
export function listenToMyTasks(assigneeEmail, callback) {
  if (!assigneeEmail) return () => {};
  const q = query(
    collection(db, TASKS_COLLECTION),
    where('assignee', '==', assigneeEmail)
  );
  return onSnapshot(q, (snapshot) => {
    const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Sort descending client-side to avoid requiring a composite index
    tasks.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
    callback(tasks);
  });
}

/**
 * Listen to tasks assigned BY a specific user (Delegated by Me)
 * @param {string} assignerEmail 
 * @param {function} callback 
 * @returns unsubscribe function
 */
export function listenToDelegatedTasks(assignerEmail, callback) {
  if (!assignerEmail) return () => {};
  const q = query(
    collection(db, TASKS_COLLECTION),
    where('assigner', '==', assignerEmail)
  );
  return onSnapshot(q, (snapshot) => {
    const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Sort descending client-side to avoid requiring a composite index
    tasks.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
    callback(tasks);
  });
}

/**
 * Listen to ALL tasks (Master View for Admins)
 */
export function listenToAllTasks(callback) {
  const q = query(collection(db, TASKS_COLLECTION));
  return onSnapshot(q, (snapshot) => {
    const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Sort descending client-side
    tasks.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
    callback(tasks);
  });
}
