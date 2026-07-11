import { query } from '@/lib/db';
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
 * GET: Fetch all new CRM leads
 */
export async function GET() {
  try {
    const res = await query('SELECT * FROM new_crm_leads ORDER BY updated_at DESC');
    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Create a new CRM lead record
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { name, phone, message, status, branch, trialDate, notes } = body;

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: Update an existing CRM lead record
 */
export async function PUT(req) {
  try {
    const body = await req.json();
    const { id, name, phone, message, status, branch, trialDate, notes } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing lead ID' }, { status: 400 });
    }

    const sql = `
      UPDATE new_crm_leads
      SET name = $1, phone = $2, message = $3, status = $4, branch = $5, trial_date = $6, notes = $7
      WHERE id = $8
      RETURNING *
    `;
    const params = [name, phone, message || null, status || 'interest_trial', branch || null, trialDate || null, notes || null, id];
    const res = await query(sql, params);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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
