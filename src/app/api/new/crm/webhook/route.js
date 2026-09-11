import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { classifyLead } from '@/utils/crmPerformance';

function formatWhatsAppPhone(phone) {
  if (!phone) return '';
  const str = String(phone).trim();
  if (/[a-zA-Z]/.test(str)) return '';
  let digits = str.replace(/[^\d]/g, '');
  if (digits.length < 6 || digits.startsWith('6280000') || digits === '123456789') return '';

  if (digits.startsWith('0')) {
    digits = '62' + digits.substring(1);
  } else if (!digits.startsWith('62') && digits.length >= 9) {
    digits = '62' + digits;
  }

  if (digits.startsWith('62')) {
    const main = digits.substring(2);
    if (main.length >= 9) {
      const part1 = main.substring(0, 3);
      const part2 = main.substring(3, 7);
      const part3 = main.substring(7);
      return `+62 ${part1}-${part2}-${part3}`;
    }
  }

  return `+${digits}`;
}

function extractValidPhone(body = {}) {
  const candidates = [
    body.phone,
    body.phone_number,
    body.wa_id,
    body.wa_number,
    body.whatsapp,
    body.mobile,
    body.sender_phone,
    body.customer_phone,
    body.contact,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const str = String(raw).trim();
    const digitsOnly = str.replace(/[^\d]/g, '');
    if (digitsOnly.length >= 6 && !/[a-zA-Z]/.test(str) && !digitsOnly.startsWith('6280000') && digitsOnly !== '123456789') {
      return formatWhatsAppPhone(str);
    }
  }

  // Fallback regex search in text
  const textBody = `${body.message || ''} ${body.notes || ''}`;
  const phoneMatch = textBody.match(/(?:\+?62|0)\s*\d{3,4}[-\s]?\d{3,4}[-\s]?\d{3,5}/);
  if (phoneMatch) {
    return formatWhatsAppPhone(phoneMatch[0].trim());
  }

  return '';
}

/** Ensure required columns exist in database */
const ready = async () => {
  try {
    await query(`ALTER TABLE new_crm_leads ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(50) DEFAULT 'pending'`);
  } catch (_) {}
  try {
    await query(`ALTER TABLE new_crm_leads ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'pending'`);
  } catch (_) {}
};

/**
 * POST: Inbound webhook to capture and classify leads from WhatsApp/Qontak/Zapier/forms
 */
export async function POST(req) {
  try {
    await ready();

    let body = {};
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      body = await req.json().catch(() => ({}));
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData().catch(() => new Map());
      formData.forEach((value, key) => {
        body[key] = value;
      });
    } else {
      // Fallback try JSON
      body = await req.json().catch(() => ({}));
    }

    const parentName = String(body.parent_name || body.parentName || body.parent || '').trim();
    const childName = String(body.child_name || body.childName || body.student_name || body.student || '').trim();
    const age = String(body.age || body.student_age || body.child_age || '').trim();

    let name = String(body.name || '').trim();
    if (!name && (parentName || childName)) {
      if (parentName && childName) {
        name = `${parentName} (Parent of ${childName})`;
      } else {
        name = parentName || childName;
      }
    }

    const phone = extractValidPhone(body);
    if (!name || !phone) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed: A valid name (or parent/child name) and phone number are required.',
          received: { name: name || null, phone: phone || null },
        },
        { status: 400 }
      );
    }

    const branch = String(body.branch || body.branchName || body.branch_name || body.location || '').trim() || null;
    const trialDate = body.trialDate || body.trial_date || body.date || null;
    const status = body.status || (trialDate ? 'trial_booked' : 'interest_trial');
    const message = body.message || body.text || null;
    let notes = String(body.notes || '').trim();

    // Auto-enrich notes with profile information if provided
    if (age && !notes.toLowerCase().includes('usia') && !notes.toLowerCase().includes('th') && !notes.toLowerCase().includes('yo')) {
      notes = `[Age: ${age} yo] ${notes}`.trim();
    }
    if (parentName && childName && age && !notes.includes('[profiled]')) {
      notes = `[profiled] ${notes}`.trim();
    }

    const attendanceStatus = body.attendanceStatus || body.attendance_status || 'pending';
    const paymentStatus = body.paymentStatus || body.payment_status || 'pending';

    // Check classification
    const leadPreview = {
      name,
      phone,
      message,
      status,
      branch,
      trialDate,
      notes,
    };
    const classification = classifyLead(leadPreview);

    let res;
    try {
      const sql = `
        INSERT INTO new_crm_leads (name, phone, message, status, branch, trial_date, notes, attendance_status, payment_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;
      const params = [
        name,
        phone,
        message,
        status,
        branch,
        trialDate,
        notes || null,
        attendanceStatus,
        paymentStatus,
      ];
      res = await query(sql, params);
    } catch (err) {
      // Fallback if attendance_status or payment_status column does not exist in DB
      const fallbackSql = `
        INSERT INTO new_crm_leads (name, phone, message, status, branch, trial_date, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      const fallbackParams = [
        name,
        phone,
        message,
        status,
        branch,
        trialDate,
        notes || null,
      ];
      res = await query(fallbackSql, fallbackParams);
    }

    const row = res.rows[0];

    return NextResponse.json(
      {
        success: true,
        message: 'Lead successfully ingested into CRM',
        lead: {
          id: row.id,
          name: row.name,
          phone: row.phone,
          message: row.message,
          status: row.status,
          branch: row.branch,
          trialDate: row.trial_date,
          notes: row.notes,
          attendanceStatus: row.attendance_status || 'pending',
          paymentStatus: row.payment_status || 'pending',
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
        classification,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in CRM webhook ingestion:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
