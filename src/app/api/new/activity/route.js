import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';

/** Create the table on first use so a fresh database needs no manual migration. */
const ready = () => ensureTable('internal_activity');

const mapRow = (row) => ({
  id: row.id,
  action: row.action,
  summary: row.summary,
  count: row.item_count,
  userEmail: row.user_email,
  source: row.source,
  createdAt: row.created_at
});

/**
 * GET: Activity log, newest first.
 * Optional filters: ?source=schedule&action=add&limit=50
 */
export async function GET(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const source = searchParams.get('source');
    const action = searchParams.get('action');
    const limitRaw = parseInt(searchParams.get('limit'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    const where = [];
    const params = [];
    if (source) { params.push(source); where.push(`source = $${params.length}`); }
    if (action) { params.push(action); where.push(`action = $${params.length}`); }
    params.push(limit);

    const sql = `
      SELECT * FROM internal_activity
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `;
    const res = await query(sql, params);
    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Record an activity entry.
 * Body: { action, summary, count?, userEmail?, source? }
 */
export async function POST(req) {
  try {
    await ready();
    const body = await req.json();
    const { action, summary, count, userEmail, source } = body;

    if (!action || !summary) {
      return NextResponse.json({ error: 'action and summary are required' }, { status: 400 });
    }

    const sql = `
      INSERT INTO internal_activity (action, summary, item_count, user_email, source)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const params = [
      action,
      summary,
      Number.isFinite(Number(count)) ? Number(count) : 1,
      userEmail || null,
      source || 'schedule'
    ];
    const res = await query(sql, params);
    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Remove one entry with ?id=, or clear a source with ?source=
 * (?all=true clears everything).
 */
export async function DELETE(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const source = searchParams.get('source');
    const all = searchParams.get('all') === 'true';

    if (id) {
      const res = await query('DELETE FROM internal_activity WHERE id = $1 RETURNING *', [id]);
      if (res.rowCount === 0) {
        return NextResponse.json({ error: 'Activity entry not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, deleted: 1 });
    }

    if (source) {
      const res = await query('DELETE FROM internal_activity WHERE source = $1', [source]);
      return NextResponse.json({ success: true, deleted: res.rowCount });
    }

    if (all) {
      const res = await query('DELETE FROM internal_activity');
      return NextResponse.json({ success: true, deleted: res.rowCount });
    }

    return NextResponse.json(
      { error: 'Provide ?id=, ?source=, or ?all=true' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
