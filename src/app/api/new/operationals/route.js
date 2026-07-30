import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';

/** Create the table on first use so a fresh database needs no manual migration. */
const ready = () => ensureTable('internal_operationals');

const mapRow = (row) => ({
  id: row.id,
  branchName: row.branch_name,
  day: row.day,
  isOpen: row.is_open,
  openTime: row.open_time,
  closeTime: row.close_time,
  slots: row.slots || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/** Slot kinds accepted in a day's Class Operation plan. */
const SLOT_TYPES = ['kinder', 'junior', 'coder', 'any', 'break', 'training', 'meeting'];

/** Kinds that hold a class, and so can carry an intended instructor. */
const BOOKABLE_TYPES = ['kinder', 'junior', 'coder', 'any'];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate and normalise the incoming slots array. Rejects unknown types and
 * any window whose end is not after its start, so the stored plan is always
 * usable by the Schedule page.
 */
function normaliseSlots(slots) {
  if (slots == null) return { slots: [] };
  if (!Array.isArray(slots)) return { error: '`slots` must be an array' };

  const out = [];
  for (let i = 0; i < slots.length; i += 1) {
    const s = slots[i] || {};
    const type = String(s.type || 'any').toLowerCase();
    if (!SLOT_TYPES.includes(type)) {
      return { error: `slots[${i}].type must be one of: ${SLOT_TYPES.join(', ')}` };
    }
    if (!HHMM.test(String(s.start || '')) || !HHMM.test(String(s.end || ''))) {
      return { error: `slots[${i}] start/end must be 24h "HH:MM"` };
    }
    if (s.end <= s.start) {
      return { error: `slots[${i}].end must be after start` };
    }

    const slot = { type, start: s.start, end: s.end, label: String(s.label || '').trim() };

    // Optional intended instructor, set when the slot was opened from the
    // schedule grid. Only meaningful for class slots — a break belongs to the
    // whole branch. Slots without one are simply unassigned.
    const instructor = String(s.instructor || '').trim();
    if (instructor) {
      if (!BOOKABLE_TYPES.includes(type)) {
        return { error: `slots[${i}].instructor is only valid for class slots, not "${type}"` };
      }
      slot.instructor = instructor;
    }

    out.push(slot);
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return { slots: out };
}

/**
 * GET: Operational rules per branch/day.
 * Optional filters: ?branch=Bekasi&day=Monday&openOnly=true
 */
export async function GET(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const branch = searchParams.get('branch');
    const day = searchParams.get('day');
    const openOnly = searchParams.get('openOnly') === 'true';

    const where = [];
    const params = [];
    if (branch) { params.push(branch); where.push(`branch_name = $${params.length}`); }
    if (day) { params.push(day); where.push(`day = $${params.length}`); }
    if (openOnly) where.push('is_open = TRUE');

    const sql = `
      SELECT * FROM internal_operationals
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY branch_name ASC, id ASC
    `;
    const res = await query(sql, params);
    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Upsert one branch/day rule. Because (branch_name, day) is unique,
 * posting the same pair twice updates it rather than creating a duplicate.
 * Body: { branchName, day, isOpen?, openTime?, closeTime?, slots? }
 */
export async function POST(req) {
  try {
    await ready();
    const body = await req.json();
    const { branchName, day, isOpen, openTime, closeTime } = body;

    if (!branchName || !day) {
      return NextResponse.json({ error: 'branchName and day are required' }, { status: 400 });
    }
    if (openTime && !HHMM.test(openTime)) {
      return NextResponse.json({ error: 'openTime must be 24h "HH:MM"' }, { status: 400 });
    }
    if (closeTime && !HHMM.test(closeTime)) {
      return NextResponse.json({ error: 'closeTime must be 24h "HH:MM"' }, { status: 400 });
    }
    if (openTime && closeTime && closeTime <= openTime) {
      return NextResponse.json({ error: 'closeTime must be after openTime' }, { status: 400 });
    }

    const { slots, error } = normaliseSlots(body.slots);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const sql = `
      INSERT INTO internal_operationals (branch_name, day, is_open, open_time, close_time, slots)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (branch_name, day) DO UPDATE
        SET is_open = EXCLUDED.is_open,
            open_time = EXCLUDED.open_time,
            close_time = EXCLUDED.close_time,
            slots = EXCLUDED.slots,
            updated_at = now()
      RETURNING *
    `;
    const params = [
      branchName,
      day,
      isOpen !== false,
      openTime || null,
      closeTime || null,
      JSON.stringify(slots)
    ];
    const res = await query(sql, params);
    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: Update an existing rule by id.
 * Body: { id, isOpen?, openTime?, closeTime?, slots? }
 */
export async function PUT(req) {
  try {
    await ready();
    const body = await req.json();
    const { id, isOpen, openTime, closeTime } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing operational rule ID' }, { status: 400 });
    }
    if (openTime && !HHMM.test(openTime)) {
      return NextResponse.json({ error: 'openTime must be 24h "HH:MM"' }, { status: 400 });
    }
    if (closeTime && !HHMM.test(closeTime)) {
      return NextResponse.json({ error: 'closeTime must be 24h "HH:MM"' }, { status: 400 });
    }

    const { slots, error } = normaliseSlots(body.slots);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const sql = `
      UPDATE internal_operationals
      SET is_open = COALESCE($1, is_open),
          open_time = $2,
          close_time = $3,
          slots = $4::jsonb
      WHERE id = $5
      RETURNING *
    `;
    const params = [
      isOpen === undefined ? null : isOpen,
      openTime || null,
      closeTime || null,
      JSON.stringify(slots),
      id
    ];
    const res = await query(sql, params);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Operational rule not found' }, { status: 404 });
    }
    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Remove a rule by ?id=, or by ?branch=&day=
 */
export async function DELETE(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const branch = searchParams.get('branch');
    const day = searchParams.get('day');

    let res;
    if (id) {
      res = await query('DELETE FROM internal_operationals WHERE id = $1 RETURNING *', [id]);
    } else if (branch && day) {
      res = await query(
        'DELETE FROM internal_operationals WHERE branch_name = $1 AND day = $2 RETURNING *',
        [branch, day]
      );
    } else {
      return NextResponse.json(
        { error: 'Provide ?id= or both ?branch= and ?day=' },
        { status: 400 }
      );
    }

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Operational rule not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: 'Operational rule deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
