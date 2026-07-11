import { db } from './firebase';
import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  onSnapshot,
  getDocs,
  serverTimestamp 
} from 'firebase/firestore';

const COLLECTION = 'internalInstructors';

/**
 * Fetch all internal instructors once
 */
export async function getAllInternalInstructors() {
  try {
    const querySnapshot = await getDocs(collection(db, COLLECTION));
    const instructors = [];
    querySnapshot.forEach((doc) => {
      instructors.push({ id: doc.id, ...doc.data() });
    });
    return instructors;
  } catch (error) {
    console.error('Error fetching internal instructors:', error);
    throw error;
  }
}

/**
 * Subscribe to internal instructors in real-time
 */
export function subscribeToInternalInstructors(callback) {
  const q = query(collection(db, COLLECTION));
  return onSnapshot(q, (snapshot) => {
    const instructors = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(instructors);
  }, (error) => {
    console.error('Error in internal instructors snapshot listener:', error);
  });
}

/**
 * Create a new internal instructor
 */
export async function createInternalInstructor(instructorData) {
  try {
    const colRef = collection(db, COLLECTION);
    return await addDoc(colRef, {
      ...instructorData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
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
    const docRef = doc(db, COLLECTION, instructorId);
    return await updateDoc(docRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
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
    const docRef = doc(db, COLLECTION, instructorId);
    return await deleteDoc(docRef);
  } catch (error) {
    console.error('Error deleting internal instructor:', error);
    throw error;
  }
}
