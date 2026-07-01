import { NextResponse } from 'next/server';

const EXPECTED_API_KEY = process.env.CRM_API_KEY || 'crm-secure-key-12345';
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'weekly-schedule-chatbot';
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyAmeryoAv6Nisk7foNUPOAQ3WIfYUajyOQ';

/**
 * POST /api/crm
 * Webhook endpoint for WhatsApp bots to insert leads into CRM.
 * Expects Authorization: Bearer <CRM_API_KEY>
 */
export async function POST(request) {
  console.log('CRM API Route POST Request Received!');
  try {
    // 1. Validate API Key
    const authHeader = request.headers.get('authorization');
    console.log('Auth Header received:', authHeader);
    console.log('Expected Key config:', EXPECTED_API_KEY);
    if (!authHeader || authHeader !== `Bearer ${EXPECTED_API_KEY}`) {
      console.log('Auth Mismatch: unauthorized!');
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

    // 3. Add to Firestore collection 'crmLeads' using standard REST API to bypass gRPC issues in server context
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/crmLeads?key=${API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          name: { stringValue: name.trim() },
          phone: { stringValue: phone.trim() },
          message: { stringValue: message || '' },
          status: { stringValue: status || 'interest_trial' },
          notes: { stringValue: notes || '' },
          branch: { stringValue: branch || '' },
          createdAt: { timestampValue: new Date().toISOString() },
          updatedAt: { timestampValue: new Date().toISOString() }
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firestore REST API returned ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const docId = data.name.split('/').pop();

    return NextResponse.json({
      success: true,
      message: 'CRM lead successfully created',
      id: docId
    }, { status: 200 });

  } catch (error) {
    console.error('CRM Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
