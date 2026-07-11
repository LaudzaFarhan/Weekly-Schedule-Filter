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

const COLLECTION = 'internalStudents';

/**
 * Fetch all internal students once
 */
export async function getAllInternalStudents() {
  try {
    const querySnapshot = await getDocs(collection(db, COLLECTION));
    const students = [];
    querySnapshot.forEach((doc) => {
      students.push({ id: doc.id, ...doc.data() });
    });
    return students;
  } catch (error) {
    console.error('Error fetching internal students:', error);
    throw error;
  }
}

/**
 * Subscribe to internal students in real-time
 */
export function subscribeToInternalStudents(callback) {
  const q = query(collection(db, COLLECTION));
  return onSnapshot(q, (snapshot) => {
    const students = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(students);
  }, (error) => {
    console.error('Error in internal students snapshot listener:', error);
  });
}

/**
 * Create a new internal student
 */
export async function createInternalStudent(studentData) {
  try {
    const colRef = collection(db, COLLECTION);
    return await addDoc(colRef, {
      ...studentData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
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
    const docRef = doc(db, COLLECTION, studentId);
    return await updateDoc(docRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
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
    const docRef = doc(db, COLLECTION, studentId);
    return await deleteDoc(docRef);
  } catch (error) {
    console.error('Error deleting internal student:', error);
    throw error;
  }
}
