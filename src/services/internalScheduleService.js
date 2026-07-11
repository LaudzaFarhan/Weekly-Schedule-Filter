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

const COLLECTION = 'internalClasses';

/**
 * Fetch all internal classes once
 */
export async function getAllInternalClasses() {
  try {
    const querySnapshot = await getDocs(collection(db, COLLECTION));
    const classes = [];
    querySnapshot.forEach((doc) => {
      classes.push({ id: doc.id, ...doc.data() });
    });
    return classes;
  } catch (error) {
    console.error('Error fetching internal classes:', error);
    throw error;
  }
}

/**
 * Subscribe to internal classes in real-time
 */
export function subscribeToInternalClasses(callback) {
  const q = query(collection(db, COLLECTION));
  return onSnapshot(q, (snapshot) => {
    const classes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(classes);
  }, (error) => {
    console.error('Error in internal classes snapshot listener:', error);
  });
}

/**
 * Create a new internal class
 */
export async function createInternalClass(classData) {
  try {
    const colRef = collection(db, COLLECTION);
    return await addDoc(colRef, {
      ...classData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
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
    const docRef = doc(db, COLLECTION, classId);
    return await updateDoc(docRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
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
    const docRef = doc(db, COLLECTION, classId);
    return await deleteDoc(docRef);
  } catch (error) {
    console.error('Error deleting internal class:', error);
    throw error;
  }
}
