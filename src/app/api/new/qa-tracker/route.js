import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';

const ready = async () => {
  await ensureTable('internal_qa_issues');
  await ensureTable('internal_qa_comments');
};

const mapRow = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  type: row.type,
  status: row.status,
  priority: row.priority,
  module: row.module,
  reporterEmail: row.reporter_email,
  reporterName: row.reporter_name,
  assigneeEmail: row.assignee_email,
  assigneeName: row.assignee_name,
  environment: typeof row.environment === 'string' ? JSON.parse(row.environment) : (row.environment || {}),
  attachments: typeof row.attachments === 'string' ? JSON.parse(row.attachments) : (row.attachments || []),
  commentCount: Number(row.comment_count || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/**
 * GET: List QA issues with optional filtering and search.
 * Filters: ?status=Open&type=Bug&priority=High&module=Schedule&search=login&limit=100
 */
export async function GET(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const priority = searchParams.get('priority');
    const moduleName = searchParams.get('module');
    const search = searchParams.get('search');
    const limitRaw = parseInt(searchParams.get('limit'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    if (id) {
      const sql = `
        SELECT i.*, 
          COALESCE((SELECT COUNT(*) FROM internal_qa_comments c WHERE c.issue_id = i.id), 0) AS comment_count
        FROM internal_qa_issues i
        WHERE i.id = $1
      `;
      const res = await query(sql, [id]);
      if (res.rows.length === 0) {
        return NextResponse.json({ error: 'QA Issue not found' }, { status: 404 });
      }
      return NextResponse.json(mapRow(res.rows[0]));
    }

    const where = [];
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      where.push(`i.status = $${params.length}`);
    }
    if (type && type !== 'all') {
      params.push(type);
      where.push(`i.type = $${params.length}`);
    }
    if (priority && priority !== 'all') {
      params.push(priority);
      where.push(`i.priority = $${params.length}`);
    }
    if (moduleName && moduleName !== 'all') {
      params.push(moduleName);
      where.push(`i.module = $${params.length}`);
    }
    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      where.push(`(
        LOWER(i.title) LIKE $${params.length} OR 
        LOWER(i.description) LIKE $${params.length} OR 
        LOWER(COALESCE(i.reporter_name, '')) LIKE $${params.length} OR 
        LOWER(COALESCE(i.assignee_name, '')) LIKE $${params.length}
      )`);
    }

    params.push(limit);

    const sql = `
      SELECT i.*, 
        COALESCE((SELECT COUNT(*) FROM internal_qa_comments c WHERE c.issue_id = i.id), 0) AS comment_count
      FROM internal_qa_issues i
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY 
        CASE 
          WHEN i.priority = 'Critical' THEN 1
          WHEN i.priority = 'High' THEN 2
          WHEN i.priority = 'Medium' THEN 3
          WHEN i.priority = 'Low' THEN 4
          ELSE 5
        END ASC,
        i.created_at DESC
      LIMIT $${params.length}
    `;

    const res = await query(sql, params);
    return NextResponse.json(res.rows.map(mapRow));
  } catch (error) {
    console.error('Error fetching QA issues:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Create a new QA issue.
 */
export async function POST(req) {
  try {
    await ready();
    const body = await req.json();
    const {
      title,
      description,
      type = 'Bug',
      status = 'Open',
      priority = 'Medium',
      module = 'General',
      reporterEmail,
      reporterName,
      assigneeEmail,
      assigneeName,
      environment = {},
      attachments = []
    } = body;

    if (!title || !title.trim()) {
      return NextResponse.json({ error: 'Title / Topic is required' }, { status: 400 });
    }
    if (!description || !description.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    const sql = `
      INSERT INTO internal_qa_issues (
        title, description, type, status, priority, module,
        reporter_email, reporter_name, assignee_email, assignee_name,
        environment, attachments
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const params = [
      title.trim(),
      description.trim(),
      type || 'Bug',
      status || 'Open',
      priority || 'Medium',
      module || 'General',
      reporterEmail || null,
      reporterName || null,
      assigneeEmail || null,
      assigneeName || null,
      JSON.stringify(environment || {}),
      JSON.stringify(attachments || [])
    ];

    const res = await query(sql, params);
    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    console.error('Error creating QA issue:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH: Update an existing QA issue.
 */
export async function PATCH(req) {
  try {
    await ready();
    const body = await req.json();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id') || body.id;

    if (!id) {
      return NextResponse.json({ error: 'Issue ID is required' }, { status: 400 });
    }

    const fields = [];
    const params = [];

    const fieldMap = {
      title: 'title',
      description: 'description',
      type: 'type',
      status: 'status',
      priority: 'priority',
      module: 'module',
      reporterEmail: 'reporter_email',
      reporterName: 'reporter_name',
      assigneeEmail: 'assignee_email',
      assigneeName: 'assignee_name',
      environment: 'environment',
      attachments: 'attachments'
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if (body[key] !== undefined) {
        params.push(
          key === 'environment' || key === 'attachments'
            ? JSON.stringify(body[key])
            : body[key]
        );
        fields.push(`${col} = $${params.length}`);
      }
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    params.push(id);
    const sql = `
      UPDATE internal_qa_issues
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING *, (SELECT COUNT(*) FROM internal_qa_comments c WHERE c.issue_id = internal_qa_issues.id) AS comment_count
    `;

    const res = await query(sql, params);
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'QA Issue not found' }, { status: 404 });
    }

    return NextResponse.json(mapRow(res.rows[0]));
  } catch (error) {
    console.error('Error updating QA issue:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Delete a QA issue and its comments.
 */
export async function DELETE(req) {
  try {
    await ready();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Issue ID is required' }, { status: 400 });
    }

    // Delete comments first
    await query('DELETE FROM internal_qa_comments WHERE issue_id = $1', [id]);
    const res = await query('DELETE FROM internal_qa_issues WHERE id = $1 RETURNING id', [id]);

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'QA Issue not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    console.error('Error deleting QA issue:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
