/**
 * New Operations — report-card rubrics, per programme category.
 *
 * GET    /api/new/rubric-competencies?category=   the rubric in use
 * POST   /api/new/rubric-competencies             add a competency
 * PUT    /api/new/rubric-competencies             edit, or reorder in bulk
 * DELETE /api/new/rubric-competencies?id=         retire a competency
 *
 * Why this exists: the five competencies were hardcoded, so Kinder and Coder were
 * graded on the same axes despite teaching different things.
 *
 * A category with no rows falls back to the hardcoded five. That is what makes
 * this safe to deploy ahead of any UI — an empty table behaves exactly like the
 * previous build, and a category is only "configured" once somebody configures it.
 *
 * `key` is immutable after creation, because recorded evaluations reference it.
 * `label`, `color`, order and descriptors are all free to change; they are
 * presentation.
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { canAdminAccounts, identify, isAuthenticated } from '@/lib/apiIdentity';
import { COMPETENCIES, RUBRIC_LEVELS } from '@/lib/reportCardRubric';

/** The three programme categories a rubric can be scoped to. */
const CATEGORIES = ['Kinder', 'Junior', 'Coder'];

/** Ratings a descriptor map may be keyed by. */
const RATINGS = [1, 2, 3, 4, 5];

/**
 * Upper bound on competencies per category.
 *
 * Not arbitrary: the radar chart is unreadable past about eight axes and the
 * printed card has room for eight mastery rows. Allowing twelve would just move
 * the problem to whoever has to read the report.
 */
const MAX_PER_CATEGORY = 8;

const mapRow = (row) => ({
  id: row.id,
  category: row.category,
  key: row.key,
  label: row.label,
  color: row.color,
  sortOrder: row.sort_order,
  descriptors: row.descriptors || {},
  active: row.active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** The hardcoded rubric, in the shape this route returns. */
function fallbackRubric(category) {
  return COMPETENCIES.map((competency, index) => ({
    id: null,
    category,
    key: competency.key,
    label: competency.label,
    color: competency.color,
    sortOrder: index,
    descriptors: RUBRIC_LEVELS[competency.key] || {},
    active: true,
    createdAt: null,
    updatedAt: null,
  }));
}

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

function forbidden() {
  return NextResponse.json(
    { error: 'Forbidden', message: 'Editing a rubric needs the Admin role, or the New Operations API key.' },
    { status: 403 }
  );
}

/**
 * Competency keys are used as JSON object keys and as part of a unique
 * constraint, so they are restricted to a shape that cannot surprise either.
 */
function invalidKey(key) {
  if (!key) return 'key is required.';
  if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)) {
    return 'key must start with a letter and contain only letters and digits, up to 40 characters.';
  }
  return null;
}

/**
 * Descriptors are optional, but a partial map is not: a rubric row that has
 * wording for three of the five stars leaves the form with blanks the grader
 * cannot interpret. Either describe every rating or none.
 */
function invalidDescriptors(descriptors) {
  if (descriptors === undefined || descriptors === null) return null;
  if (typeof descriptors !== 'object' || Array.isArray(descriptors)) {
    return 'descriptors must be an object keyed by rating 1 to 5.';
  }
  const keys = Object.keys(descriptors);
  if (keys.length === 0) return null;
  for (const rating of RATINGS) {
    const text = descriptors[rating] ?? descriptors[String(rating)];
    if (typeof text !== 'string' || text.trim() === '') {
      return `descriptors must cover every rating 1 to 5, or none at all — ${rating} is missing.`;
    }
  }
  for (const key of keys) {
    if (!RATINGS.includes(Number(key))) return `"${key}" is not a rating between 1 and 5.`;
  }
  return null;
}

export async function GET(req) {
  try {
    const identity = await identify(req);
    if (!isAuthenticated(identity)) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Sign in, or send the New Operations API key.' },
        { status: 401 }
      );
    }

    await ensureTable('internal_rubric_competencies');

    const { searchParams } = new URL(req.url);
    const category = trimmed(searchParams.get('category'));
    // Retired competencies are hidden unless asked for, because the evaluation
    // form must not offer them while the setup screen still has to show them.
    const includeInactive = searchParams.get('includeInactive') === 'true';

    if (category && !CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: 'Unknown category', message: `category must be one of: ${CATEGORIES.join(', ')}.` },
        { status: 400 }
      );
    }

    const conditions = [];
    const params = [];
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (!includeInactive) conditions.push('active = TRUE');
    const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const res = await query(
      `SELECT * FROM internal_rubric_competencies ${clause}
        ORDER BY category ASC, sort_order ASC, id ASC`,
      params
    );

    const wanted = category ? [category] : CATEGORIES;
    const byCategory = {};
    const usingFallback = {};
    for (const name of wanted) {
      const rows = res.rows.filter((row) => row.category === name).map(mapRow);
      // Fallback is per category, not global: Kinder can be configured while
      // Coder still runs on the hardcoded set.
      usingFallback[name] = rows.length === 0;
      byCategory[name] = rows.length > 0 ? rows : fallbackRubric(name);
    }

    return NextResponse.json({
      categories: CATEGORIES,
      competencies: byCategory,
      usingFallback,
      maxPerCategory: MAX_PER_CATEGORY,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    await ensureTable('internal_rubric_competencies');

    const body = await req.json().catch(() => null);
    const category = trimmed(body?.category);
    const key = trimmed(body?.key);
    const label = trimmed(body?.label);

    if (!CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: 'Unknown category', message: `category must be one of: ${CATEGORIES.join(', ')}.` },
        { status: 400 }
      );
    }
    const keyProblem = invalidKey(key);
    if (keyProblem) return NextResponse.json({ error: 'Invalid key', message: keyProblem }, { status: 400 });
    if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });

    const descriptorProblem = invalidDescriptors(body?.descriptors);
    if (descriptorProblem) {
      return NextResponse.json({ error: 'Invalid descriptors', message: descriptorProblem }, { status: 400 });
    }

    const existing = await query(
      'SELECT COUNT(*)::int AS n FROM internal_rubric_competencies WHERE category = $1 AND active = TRUE',
      [category]
    );
    if (existing.rows[0].n >= MAX_PER_CATEGORY) {
      return NextResponse.json(
        {
          error: 'Too many competencies',
          message: `${category} already has ${MAX_PER_CATEGORY}. Retire one before adding another — the radar chart and the printed card cannot hold more.`,
        },
        { status: 409 }
      );
    }

    // First write for a category has to materialise the fallback as well, or the
    // rubric would silently drop from five competencies to one.
    const seeded = existing.rows[0].n === 0 ? fallbackRubric(category) : [];

    const res = await query(
      `INSERT INTO internal_rubric_competencies
         (category, key, label, color, sort_order, descriptors, active)
       SELECT * FROM UNNEST(
         $1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[],
         $5::int[], $6::jsonb[], $7::boolean[]
       )
       ON CONFLICT (category, key) DO NOTHING
       RETURNING *`,
      [
        [...seeded.map(() => category), category],
        [...seeded.map((c) => c.key), key],
        [...seeded.map((c) => c.label), label],
        [...seeded.map((c) => c.color), trimmed(body?.color) || '#64748b'],
        [...seeded.map((c, i) => i), seeded.length],
        [...seeded.map((c) => JSON.stringify(c.descriptors)), JSON.stringify(body?.descriptors || {})],
        [...seeded.map(() => true), true],
      ]
    );

    const created = res.rows.find((row) => row.key === key);
    if (!created) {
      return NextResponse.json(
        { error: 'That key already exists in this category', field: 'key' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { competency: mapRow(created), seededFallback: seeded.length > 0 },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    await ensureTable('internal_rubric_competencies');

    const body = await req.json().catch(() => null);

    // Reordering is a bulk operation: dragging one row changes several rows'
    // positions, and applying them one request at a time would leave the rubric
    // briefly duplicated or gapped.
    if (Array.isArray(body?.order)) {
      const ids = body.order.map(Number);
      if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
        return NextResponse.json({ error: 'order must be a list of competency ids' }, { status: 400 });
      }
      const res = await query(
        `UPDATE internal_rubric_competencies AS c
            SET sort_order = ordered.position
           FROM (SELECT id, (ordinality - 1) AS position
                   FROM UNNEST($1::int[]) WITH ORDINALITY AS t(id, ordinality)) AS ordered
          WHERE c.id = ordered.id
        RETURNING c.*`,
        [ids]
      );
      return NextResponse.json({
        competencies: res.rows.map(mapRow).sort((a, b) => a.sortOrder - b.sortOrder),
      });
    }

    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Missing or invalid competency id' }, { status: 400 });
    }

    if (body?.key !== undefined) {
      return NextResponse.json(
        {
          error: 'key cannot be changed',
          message: 'Recorded evaluations reference it. Retire this competency and add a new one instead.',
        },
        { status: 409 }
      );
    }

    const descriptorProblem = invalidDescriptors(body?.descriptors);
    if (descriptorProblem) {
      return NextResponse.json({ error: 'Invalid descriptors', message: descriptorProblem }, { status: 400 });
    }

    const res = await query(
      `UPDATE internal_rubric_competencies SET
         label = COALESCE($2, label),
         color = COALESCE($3, color),
         sort_order = COALESCE($4, sort_order),
         descriptors = COALESCE($5, descriptors),
         active = COALESCE($6, active)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body?.label === undefined ? null : trimmed(body.label) || null,
        body?.color === undefined ? null : trimmed(body.color) || null,
        body?.sortOrder === undefined ? null : Number(body.sortOrder),
        body?.descriptors === undefined ? null : JSON.stringify(body.descriptors),
        body?.active === undefined ? null : Boolean(body.active),
      ]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Competency not found' }, { status: 404 });
    }
    return NextResponse.json({ competency: mapRow(res.rows[0]) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    await ensureTable('internal_rubric_competencies');

    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Missing or invalid id query parameter' }, { status: 400 });
    }

    const target = await query('SELECT category, key FROM internal_rubric_competencies WHERE id = $1', [id]);
    if (target.rowCount === 0) {
      return NextResponse.json({ error: 'Competency not found' }, { status: 404 });
    }

    // A rubric with nothing in it would leave the evaluation form with no rows
    // and no way back, since an empty category also means "use the fallback".
    const remaining = await query(
      'SELECT COUNT(*)::int AS n FROM internal_rubric_competencies WHERE category = $1 AND active = TRUE AND id <> $2',
      [target.rows[0].category, id]
    );
    if (remaining.rows[0].n === 0) {
      return NextResponse.json(
        {
          error: 'That is the last competency',
          message: `${target.rows[0].category} needs at least one. Add a replacement before retiring this one.`,
        },
        { status: 409 }
      );
    }

    // Soft delete by default. Scores already recorded against this key stay
    // readable, and an accidental removal is one PUT away from being undone.
    // `?hard=true` is for a competency created by mistake and never used.
    if (searchParams.get('hard') === 'true') {
      await query('DELETE FROM internal_rubric_competencies WHERE id = $1', [id]);
      return NextResponse.json({ success: true, removed: 'permanently' });
    }

    const res = await query(
      'UPDATE internal_rubric_competencies SET active = FALSE WHERE id = $1 RETURNING *',
      [id]
    );
    return NextResponse.json({ success: true, removed: 'retired', competency: mapRow(res.rows[0]) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
