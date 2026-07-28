import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';
import { CATEGORIES, DEFAULT_RULES, withDefaults } from '@/lib/programRules';

const ready = () => ensureTable('internal_schedule_rules');

/**
 * GET: The current slot-combination rules.
 *
 * Always returns a complete rule set — stored values merged over the defaults —
 * so a caller never has to handle a partially configured state.
 */
export async function GET() {
  try {
    await ready();
    const res = await query('SELECT rules, updated_at FROM internal_schedule_rules WHERE id = 1');
    const stored = res.rows[0]?.rules || null;
    return NextResponse.json({
      rules: withDefaults(stored),
      configured: !!stored,
      defaults: DEFAULT_RULES,
      updatedAt: res.rows[0]?.updated_at || null,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT: Replace the rules.
 * Body: { allowMixCategories, Kinder: { allowMixFamilies, maxDistinctLessons, enforcement }, Junior: {...}, Coder: {...} }
 */
export async function PUT(req) {
  try {
    await ready();
    const body = await req.json();

    // Normalise so nothing unexpected reaches the database.
    const clean = { allowMixCategories: !!body.allowMixCategories };
    for (const cat of CATEGORIES) {
      const src = body[cat] || {};
      const max = parseInt(src.maxDistinctLessons, 10);
      const enforcement = src.enforcement === 'warn' ? 'warn' : 'block';
      if (Number.isFinite(max) && (max < 0 || max > 10)) {
        return NextResponse.json(
          { error: `${cat}.maxDistinctLessons must be between 0 and 10 (0 = unlimited)` },
          { status: 400 }
        );
      }
      clean[cat] = {
        allowMixFamilies: !!src.allowMixFamilies,
        maxDistinctLessons: Number.isFinite(max) ? max : DEFAULT_RULES[cat].maxDistinctLessons,
        enforcement,
      };
    }

    const res = await query(
      `INSERT INTO internal_schedule_rules (id, rules, updated_at)
       VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET rules = EXCLUDED.rules, updated_at = now()
       RETURNING rules, updated_at`,
      [JSON.stringify(clean)]
    );

    return NextResponse.json({
      rules: withDefaults(res.rows[0].rules),
      configured: true,
      updatedAt: res.rows[0].updated_at,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE: Revert to the built-in defaults. */
export async function DELETE() {
  try {
    await ready();
    await query('DELETE FROM internal_schedule_rules WHERE id = 1');
    return NextResponse.json({ success: true, rules: withDefaults(null), configured: false });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
