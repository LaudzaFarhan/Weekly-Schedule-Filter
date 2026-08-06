import { query } from '@/lib/db';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { NextResponse } from 'next/server';

const mapRow = (row) => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  message: row.message,
  status: row.status,
  branch: row.branch,
  trialDate: row.trial_date,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/**
 * GET: Fetch new CRM leads.
 * Optional: ?search=&status=&branch=&limit=
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
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
    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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

  const phone = body.phone || body.phone_number || body.wa_id || body.contact || '';
  const branch = body.branch || body.branchName || body.branch_name || body.location || null;
  const trialDate = body.trialDate || body.trial_date || body.date || null;
  const status = body.status || 'interest_trial';
  const message = body.message || null;
  const notes = body.notes || null;

  return { name, phone, branch, trialDate, status, message, notes };
}

/**
 * POST: Create a new CRM lead record
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { name, phone, branch, trialDate, status, message, notes } = extractLeadFields(body);

    if (!name || !phone) {
      return NextResponse.json({ error: 'Name and phone contact are required' }, { status: 400 });
    }

    const sql = `
      INSERT INTO new_crm_leads (name, phone, message, status, branch, trial_date, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const params = [name, phone, message || null, status || 'interest_trial', branch || null, trialDate || null, notes || null];
    const res = await query(sql, params);

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
      const phoneVal = body.phone || body.phone_number || body.wa_id || body.contact;
      if (phoneVal) fieldValues.phone = String(phoneVal).trim();
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
    if (body.notes !== undefined) {
      fieldValues.notes = body.notes;
    }

    const setClauses = [];
    const params = [];
    let paramIdx = 1;

    for (const [col, val] of Object.entries(fieldValues)) {
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

    const res = await query(sql, params);
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
