import { query } from '@/lib/db';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { classifyLead } from '@/utils/crmPerformance';
import { NextResponse } from 'next/server';

const setTagInNotes = (existingNotes, key, val) => {
  let str = String(existingNotes || '');
  const regex = new RegExp(`\\[${key}:\\s*[a-z_]+\\\]`, 'gi');
  str = str.replace(regex, '').trim();
  return `[${key}: ${val}] ${str}`.trim();
};

const mapRow = (row) => {
  const notesStr = String(row.notes || '');
  const attMatch = notesStr.match(/\[Attendance:\s*([a-z_]+)\]/i);
  const payMatch = notesStr.match(/\[Payment:\s*([a-z_]+)\]/i);

  let attendanceStatus = attMatch ? attMatch[1].toLowerCase() : row.attendance_status;
  if (!attendanceStatus) {
    if (notesStr.toLowerCase().includes('[attended]')) attendanceStatus = 'attended';
    else if (notesStr.toLowerCase().includes('[absent]')) attendanceStatus = 'absent';
    else attendanceStatus = 'pending';
  }

  let paymentStatus = payMatch ? payMatch[1].toLowerCase() : row.payment_status;
  if (!paymentStatus) {
    if (notesStr.toLowerCase().includes('[paid]')) paymentStatus = 'paid';
    else if (notesStr.toLowerCase().includes('[unpaid]')) paymentStatus = 'unpaid';
    else paymentStatus = 'pending';
  }

  let followUps = [];
  if (row.follow_ups) {
    if (Array.isArray(row.follow_ups)) followUps = row.follow_ups;
    else if (typeof row.follow_ups === 'string') {
      try { followUps = JSON.parse(row.follow_ups); } catch (_) {}
    }
  }
  if (!followUps.length && notesStr) {
    const fuMatch = notesStr.match(/\[FollowUps:\s*(\[.*?\])\]/s);
    if (fuMatch) {
      try { followUps = JSON.parse(fuMatch[1]); } catch (_) {}
    }
  }

  const statusLower = String(row.status || '').toLowerCase();
  const isScheduled = statusLower === 'trial_booked' || Boolean(row.trial_date);
  const isJunk = statusLower === 'junk' || statusLower === 'spam' || notesStr.toLowerCase().includes('[junk]') || notesStr.toLowerCase().includes('[spam]');
  const isProfiled = isScheduled || notesStr.toLowerCase().includes('[profiled]') || /(parent of|ortu|ayah|ibu|mama|papa|anak)/i.test(row.name || '');
  const needsFollowUp = !isJunk && !isScheduled && (isProfiled || notesStr.toLowerCase().includes('[need follow up]'));

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    message: row.message,
    status: row.status,
    branch: row.branch,
    trialDate: row.trial_date,
    notes: row.notes,
    attendanceStatus: attendanceStatus || 'pending',
    paymentStatus: paymentStatus || 'pending',
    followUps,
    followUpCount: followUps.length,
    lastFollowUp: followUps.length > 0 ? followUps[followUps.length - 1] : null,
    needsFollowUp,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

/**
 * GET: Fetch new CRM leads.
 * Optional: ?id=&search=&status=&branch=&metric=&limit=
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');

    if (idParam) {
      const res = await query('SELECT * FROM new_crm_leads WHERE id = $1', [idParam]);
      if (res.rowCount === 0) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      }
      return NextResponse.json(mapRow(res.rows[0]));
    }

    const { clause, params, limit } = buildListQuery(searchParams, {
      searchColumns: ['name', 'phone', 'message', 'notes'],
      filters: { status: 'status', branch: 'branch' },
    });
    const { sql, params: finalParams } = withLimit(
      `SELECT * FROM new_crm_leads ${clause} ORDER BY updated_at DESC`,
      params,
      limit
    );
    const res = await query(sql, finalParams);
    let mapped = res.rows.map(mapRow);

    const metric = searchParams.get('metric');
    if (metric) {
      const m = metric.toLowerCase();
      mapped = mapped.filter((lead) => {
        const c = classifyLead(lead);
        if (m === 'junk' || m === 'spam') return c.isJunk;
        if (m === 'scheduled' || m === 'trial_scheduled') return c.isScheduled;
        if (m === 'profiling' || m === 'profile') return c.isProfiled;
        if (m === 'leads') return true;
        return true;
      });
    }

    return NextResponse.json(mapped);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Helper to extract normalized fields from various payload key conventions
 */
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
    // Must have at least 6 digits and no alphabetic characters
    if (digitsOnly.length >= 6 && !/[a-zA-Z]/.test(str) && !digitsOnly.startsWith('6280000') && digitsOnly !== '123456789') {
      return formatWhatsAppPhone(str);
    }
  }

  // Fallback: extract phone number pattern from message or notes
  const textBody = `${body.message || ''} ${body.notes || ''}`;
  const phoneMatch = textBody.match(/(?:\+?62|0)\s*\d{3,4}[-\s]?\d{3,4}[-\s]?\d{3,5}/);
  if (phoneMatch) {
    return formatWhatsAppPhone(phoneMatch[0].trim());
  }

  return '';
}

/**
 * Helper to extract normalized fields from various payload key conventions
 */
function extractLeadFields(body) {
  const parentName = body.parent_name || '';
  const childName = body.child_name || '';
  let name = body.name;
  if (!name && (parentName || childName)) {
    name = parentName && childName ? `${parentName} (Parent of ${childName})` : parentName || childName;
  }

  const phone = extractValidPhone(body);
  const branch = body.branch || body.branchName || body.branch_name || body.location || null;
  const trialDate = body.trialDate || body.trial_date || body.date || null;
  const status = body.status || 'interest_trial';
  const message = body.message || null;
  const notes = body.notes || null;
  const attendanceStatus = body.attendanceStatus || body.attendance_status || 'pending';
  const paymentStatus = body.paymentStatus || body.payment_status || 'pending';

  return { name, phone, branch, trialDate, status, message, notes, attendanceStatus, paymentStatus };
}

/** Ensure attendance_status and payment_status columns exist */
const ready = async () => {
  try {
    await query(`ALTER TABLE new_crm_leads ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(50) DEFAULT 'pending'`);
  } catch (err) {
    console.error('Migration notice attendance_status:', err.message);
  }
  try {
    await query(`ALTER TABLE new_crm_leads ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'pending'`);
  } catch (err) {
    console.error('Migration notice payment_status:', err.message);
  }
  try {
    await query(`ALTER TABLE new_crm_leads ADD COLUMN IF NOT EXISTS follow_ups JSONB DEFAULT '[]'::jsonb`);
  } catch (err) {
    console.error('Migration notice follow_ups:', err.message);
  }
};

/**
 * POST: Create a new CRM lead record
 */
export async function POST(req) {
  try {
    await ready();
    const body = await req.json();
    const { name, phone, branch, trialDate, status, message, notes, attendanceStatus, paymentStatus } = extractLeadFields(body);

    if (!name || !phone) {
      return NextResponse.json({ error: 'Name and phone contact are required' }, { status: 400 });
    }

    let res;
    try {
      const sql = `
        INSERT INTO new_crm_leads (name, phone, message, status, branch, trial_date, notes, attendance_status, payment_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;
      const params = [name, phone, message || null, status || 'interest_trial', branch || null, trialDate || null, notes || null, attendanceStatus, paymentStatus];
      res = await query(sql, params);
    } catch (err) {
      const fallbackSql = `
        INSERT INTO new_crm_leads (name, phone, message, status, branch, trial_date, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      const fallbackParams = [name, phone, message || null, status || 'interest_trial', branch || null, trialDate || null, notes || null];
      res = await query(fallbackSql, fallbackParams);
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    console.error('Error creating CRM lead:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Handler for PUT and PATCH requests to dynamically update lead details without nullifying missing fields.
 */
async function handleUpdate(req) {
  try {
    await ready();
    const body = await req.json();
    let targetId = body.id || body.leadId || body.lead_id;

    // Search by phone or name if ID is omitted
    if (!targetId) {
      const searchPhone = body.phone || body.phone_number || body.wa_id || body.contact;
      const searchName = body.name || body.parent_name || body.child_name;

      if (searchPhone) {
        const findRes = await query(`SELECT id FROM new_crm_leads WHERE phone = $1 OR LOWER(name) LIKE LOWER($2) ORDER BY updated_at DESC LIMIT 1`, [String(searchPhone).trim(), `%${searchPhone}%`]);
        if (findRes.rowCount > 0) targetId = findRes.rows[0].id;
      } else if (searchName) {
        const findRes = await query(`SELECT id FROM new_crm_leads WHERE LOWER(name) LIKE LOWER($1) ORDER BY updated_at DESC LIMIT 1`, [`%${searchName}%`]);
        if (findRes.rowCount > 0) targetId = findRes.rows[0].id;
      }
    }

    if (!targetId) {
      return NextResponse.json({ error: 'Missing lead ID or matching search criteria' }, { status: 400 });
    }

    const fieldValues = {};

    if (body.name !== undefined || body.parent_name !== undefined || body.child_name !== undefined) {
      const parentName = body.parent_name || '';
      const childName = body.child_name || '';
      const nameVal = body.name || (parentName && childName ? `${parentName} (Parent of ${childName})` : parentName || childName);
      if (nameVal) fieldValues.name = nameVal;
    }
    if (body.phone !== undefined || body.phone_number !== undefined || body.wa_id !== undefined || body.contact !== undefined) {
      const phoneVal = extractValidPhone(body);
      // Allow explicit clearing of phone (send phone: "")
      if (body.phone === "" && !body.phone_number && !body.wa_id && !body.contact) {
        fieldValues.phone = "";
      } else if (phoneVal) {
        fieldValues.phone = phoneVal;
      }
    }
    if (body.message !== undefined) {
      fieldValues.message = body.message;
    }
    if (body.status !== undefined) {
      fieldValues.status = body.status;
    }
    if (body.branch !== undefined || body.branchName !== undefined || body.branch_name !== undefined || body.location !== undefined) {
      const branchVal = body.branch || body.branchName || body.branch_name || body.location;
      fieldValues.branch = branchVal || null;
    }
    if (body.trialDate !== undefined || body.trial_date !== undefined || body.date !== undefined) {
      const trialVal = body.trialDate || body.trial_date || body.date;
      fieldValues.trial_date = trialVal || null;
    }

    // Fetch current lead row to embed tags into notes as a 100% fail-safe
    const curRes = await query(`SELECT notes, follow_ups, name FROM new_crm_leads WHERE id = $1`, [targetId]);
    let currentNotes = curRes.rowCount > 0 ? (curRes.rows[0].notes || '') : '';
    let existingFollowUps = [];
    let leadName = 'Lead';
    if (curRes.rowCount > 0) {
      leadName = curRes.rows[0].name || 'Lead';
      if (curRes.rows[0].follow_ups) {
        if (Array.isArray(curRes.rows[0].follow_ups)) existingFollowUps = curRes.rows[0].follow_ups;
        else if (typeof curRes.rows[0].follow_ups === 'string') {
          try { existingFollowUps = JSON.parse(curRes.rows[0].follow_ups); } catch (_) {}
        }
      }
      if (!existingFollowUps.length && currentNotes) {
        const m = currentNotes.match(/\[FollowUps:\s*(\[.*?\])\]/s);
        if (m) {
          try { existingFollowUps = JSON.parse(m[1]); } catch (_) {}
        }
      }
    }

    if (body.notes !== undefined) {
      currentNotes = body.notes || '';
    }

    // Support logging a new follow-up attempt
    if (body.newFollowUp) {
      let nfu = body.newFollowUp;
      if (typeof nfu === 'string') nfu = { notes: nfu };
      const attemptNum = existingFollowUps.length + 1;
      const entry = {
        id: `fu_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        performedBy: nfu.performedBy || body.userEmail || body.user || 'Admin',
        userEmail: nfu.userEmail || body.userEmail || null,
        date: nfu.date || new Date().toISOString(),
        channel: nfu.channel || 'WhatsApp',
        outcome: nfu.outcome || null,
        notes: nfu.notes || '',
        attempt: attemptNum,
      };
      existingFollowUps.push(entry);
      fieldValues.follow_ups = JSON.stringify(existingFollowUps);

      // Embed into notes as persistent fallback
      const fuRegex = /\[FollowUps:\s*\[.*?\]\]/gis;
      currentNotes = currentNotes.replace(fuRegex, '').trim();
      currentNotes = `${currentNotes} [FollowUps: ${JSON.stringify(existingFollowUps)}]`.trim();

      if (nfu.status) {
        fieldValues.status = nfu.status;
      }
      if (nfu.trialDate) {
        fieldValues.trial_date = nfu.trialDate;
      }

      // Log to internal_activity table if exists
      try {
        await query(
          `INSERT INTO internal_activity (action, summary, user_email, source, details) VALUES ($1, $2, $3, $4, $5)`,
          [
            'edit',
            `Followed up ${leadName} (${attemptNum}x) via ${entry.channel}${entry.notes ? `: ${entry.notes.substring(0, 80)}` : ''}`,
            entry.userEmail || entry.performedBy,
            'crm',
            JSON.stringify({ leadId: targetId, attempt: attemptNum, channel: entry.channel }),
          ]
        );
      } catch (_) {}
    } else if (body.followUps !== undefined || body.follow_ups !== undefined) {
      const fuList = body.followUps || body.follow_ups;
      const list = Array.isArray(fuList) ? fuList : [];
      fieldValues.follow_ups = JSON.stringify(list);
      const fuRegex = /\[FollowUps:\s*\[.*?\]\]/gis;
      currentNotes = currentNotes.replace(fuRegex, '').trim();
      currentNotes = `${currentNotes} [FollowUps: ${JSON.stringify(list)}]`.trim();
    }

    if (body.needsFollowUp !== undefined) {
      if (body.needsFollowUp) {
        if (!currentNotes.toLowerCase().includes('[need follow up]')) {
          currentNotes = `[need follow up] ${currentNotes}`.trim();
        }
      } else {
        currentNotes = currentNotes.replace(/\[need\s*follow\s*up\]/gi, '').trim();
      }
    }

    if (body.attendanceStatus !== undefined || body.attendance_status !== undefined) {
      const attVal = body.attendanceStatus || body.attendance_status || 'pending';
      currentNotes = setTagInNotes(currentNotes, 'Attendance', attVal);
      fieldValues.attendance_status = attVal;
    }
    if (body.paymentStatus !== undefined || body.payment_status !== undefined) {
      const payVal = body.paymentStatus || body.payment_status || 'pending';
      currentNotes = setTagInNotes(currentNotes, 'Payment', payVal);
      fieldValues.payment_status = payVal;
    }

    fieldValues.notes = currentNotes;

    const buildSqlAndParams = (fields) => {
      const setClauses = [];
      const params = [];
      let paramIdx = 1;

      for (const [col, val] of Object.entries(fields)) {
        setClauses.push(`${col} = $${paramIdx}`);
        params.push(val);
        paramIdx++;
      }

      setClauses.push(`updated_at = NOW()`);
      params.push(targetId);

      const sql = `
        UPDATE new_crm_leads
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIdx}
        RETURNING *
      `;
      return { sql, params };
    };

    let res;
    try {
      const { sql, params } = buildSqlAndParams(fieldValues);
      res = await query(sql, params);
    } catch (err) {
      // Fallback if attendance_status, payment_status, or follow_ups column does not exist in DB
      delete fieldValues.attendance_status;
      delete fieldValues.payment_status;
      delete fieldValues.follow_ups;
      const { sql, params } = buildSqlAndParams(fieldValues);
      res = await query(sql, params);
    }

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    console.error('Error updating CRM lead:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req) {
  return handleUpdate(req);
}

export async function PATCH(req) {
  return handleUpdate(req);
}

/**
 * DELETE: Delete a CRM lead record
 */
export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing lead ID in query parameter' }, { status: 400 });
    }

    const res = await query('DELETE FROM new_crm_leads WHERE id = $1 RETURNING *', [id]);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Lead deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
