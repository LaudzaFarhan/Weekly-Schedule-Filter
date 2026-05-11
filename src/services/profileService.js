import { db } from './firebase';
import { collection, doc, getDocs, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

const PROFILES_COLLECTION = 'instructorProfiles';

/**
 * Fetch all instructor profiles from Firestore
 */
export async function getAllProfiles() {
  try {
    const querySnapshot = await getDocs(collection(db, PROFILES_COLLECTION));
    const profiles = [];
    querySnapshot.forEach((doc) => {
      profiles.push({ id: doc.id, ...doc.data() });
    });
    return profiles;
  } catch (error) {
    console.error('Error fetching profiles:', error);
    throw error;
  }
}

/**
 * Get a specific profile by email (which we use as Document ID)
 */
export async function getProfileByEmail(email) {
  try {
    const docRef = doc(db, PROFILES_COLLECTION, email);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching profile for ${email}:`, error);
    throw error;
  }
}

/**
 * Create or Update a profile
 */
export async function saveProfile(email, profileData) {
  try {
    const docRef = doc(db, PROFILES_COLLECTION, email);
    // Merge true allows updating only provided fields
    await setDoc(docRef, profileData, { merge: true });
    return { success: true, id: email };
  } catch (error) {
    console.error(`Error saving profile for ${email}:`, error);
    throw error;
  }
}

/**
 * Delete a profile
 */
export async function deleteProfile(email) {
  try {
    const docRef = doc(db, PROFILES_COLLECTION, email);
    await deleteDoc(docRef);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting profile for ${email}:`, error);
    throw error;
  }
}
