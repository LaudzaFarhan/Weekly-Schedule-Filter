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
    const { name, phone, message, status, notes } = body;

    if (!name || !phone) {
      return NextResponse.json({ error: 'Missing required fields: name, phone' }, { status: 400 });
    }

    // 3. Add to Firestore collection 'crmLeads'
    const colRef = collection(db, 'crmLeads');
    const docRef = await addDoc(colRef, {
      name: name.trim(),
      phone: phone.trim(),
      message: message || '',
      status: status || 'interest_trial',
      notes: notes || '',
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
