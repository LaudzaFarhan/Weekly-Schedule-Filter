import { NextResponse } from 'next/server';
import { db } from '@/services/firebase';
import { collection, addDoc } from 'firebase/firestore';

const EXPECTED_API_KEY = process.env.CRM_API_KEY || 'crm-secure-key-12345';

/**
 * POST /api/crm
 * Webhook endpoint for WhatsApp bots to insert leads into CRM.
 * Expects Authorization: Bearer <CRM_API_KEY>
 */
export async function POST(request) {
  try {
    // 1. Validate API Key
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${EXPECTED_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse request JSON body
    const body = await request.json();
    
    // Check if it's the WhatsApp formatted lead
    const isWhatsAppLead = body.parent_name || body.child_name || body.location;
    
    let name = body.name;
    let phone = body.phone || body.phone_number || body.wa_id || '';
    let message = body.message;
    let status = body.status;
    let notes = body.notes;
    let branch = body.branch || body.branchName || '';

    if (isWhatsAppLead) {
      const parentName = body.parent_name || '';
      const childName = body.child_name || '';
      const age = body.age || '';
      const program = body.program || '';
      const location = body.location || '';
      const instructor = body.instructor || '';
      const day = body.day || '';
      const date = body.date || '';
      const time = body.time || '';

      name = parentName ? `${parentName} (Parent of ${childName})` : childName;
      if (!phone) {
        phone = body.phone || body.phone_number || '08123456789'; // Fallback phone
      }
      
      message = `WhatsApp Lead Details:
- Parent Name: ${parentName}
- Child Name: ${childName} (Age: ${age})
- Program: ${program}
- Location: ${location}
- Instructor: ${instructor}
- Schedule: ${day}, ${date} @ ${time}`;

      branch = location;
      status = status || 'trial_booked'; // Set to trial_booked since a schedule is already assigned
      notes = notes || 'Inserted via WhatsApp chatbot final data';
    }

    if (!name || !phone) {
      return NextResponse.json({ error: 'Missing required fields: name/child_name and phone/phone_number' }, { status: 400 });
    }

    // 3. Add to Firestore collection 'crmLeads'
    const colRef = collection(db, 'crmLeads');
    const docRef = await addDoc(colRef, {
      name: name.trim(),
      phone: phone.trim(),
      message: message || '',
      status: status || 'interest_trial',
      notes: notes || '',
      branch: branch || '',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'CRM lead successfully created',
      id: docRef.id
    }, { status: 200 });

  } catch (error) {
    console.error('CRM Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
