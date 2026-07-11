import { db } from './firebase';
import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  onSnapshot,
  serverTimestamp 
} from 'firebase/firestore';

const CRM_COLLECTION = 'newCrmLeads';

/**
 * Create a new CRM lead
 * @param {Object} leadData { name, phone, message, status, notes }
 */
export async function createLead(leadData) {
  const colRef = collection(db, CRM_COLLECTION);
  return addDoc(colRef, {
    ...leadData,
    status: leadData.status || 'interest_trial',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Update an existing CRM lead
 */
export async function updateLead(leadId, updates) {
  const docRef = doc(db, CRM_COLLECTION, leadId);
  return updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a CRM lead
 */
export async function deleteLead(leadId) {
  const docRef = doc(db, CRM_COLLECTION, leadId);
  return deleteDoc(docRef);
}

/**
 * Listen to all CRM leads
 * @param {function} callback - Receives array of leads
 * @returns unsubscribe function
 */
export function listenToLeads(callback) {
  const q = query(collection(db, CRM_COLLECTION));
  return onSnapshot(q, (snapshot) => {
    const leads = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
      };
    });
    // Sort descending by updatedAt
    leads.sort((a, b) => {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return timeB - timeA;
    });
    callback(leads);
  });
}
