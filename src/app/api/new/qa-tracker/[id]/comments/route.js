import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { NextResponse } from 'next/server';

const ready = async () => {
  await ensureTable('internal_qa_comments');
};

const mapComment = (row) => ({
  id: row.id,
  issueId: row.issue_id,
  userEmail: row.user_email,
  userName: row.user_name,
  comment: row.comment,
  attachments: typeof row.attachments === 'string' ? JSON.parse(row.attachments) : (row.attachments || []),
  createdAt: row.created_at
});

/**
 * GET: Get all comments for an issue.
 */
export async function GET(req, { params }) {
  try {
    await ready();
    const resolvedParams = await params;
    const issueId = resolvedParams?.id;

    if (!issueId) {
      return NextResponse.json({ error: 'Issue ID is required' }, { status: 400 });
    }

    const sql = `
      SELECT * FROM internal_qa_comments
      WHERE issue_id = $1
      ORDER BY created_at ASC
    `;
    const res = await query(sql, [issueId]);
    return NextResponse.json(res.rows.map(mapComment));
  } catch (error) {
    console.error('Error fetching QA comments:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Add a new comment to an issue.
 */
export async function POST(req, { params }) {
  try {
    await ready();
    const resolvedParams = await params;
    const issueId = resolvedParams?.id;

    if (!issueId) {
      return NextResponse.json({ error: 'Issue ID is required' }, { status: 400 });
    }

    const body = await req.json();
    const { userEmail, userName, comment, attachments = [] } = body;

    if (!comment || !comment.trim()) {
      return NextResponse.json({ error: 'Comment text is required' }, { status: 400 });
    }

    const sql = `
      INSERT INTO internal_qa_comments (issue_id, user_email, user_name, comment, attachments)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const queryParams = [
      issueId,
      userEmail || null,
      userName || null,
      comment.trim(),
      JSON.stringify(attachments || [])
    ];

    const res = await query(sql, queryParams);
    return NextResponse.json(mapComment(res.rows[0]));
  } catch (error) {
    console.error('Error creating QA comment:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
