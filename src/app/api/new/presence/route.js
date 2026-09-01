import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';

export const dynamic = 'force-dynamic';

/**
 * Compute the effective presence status based on last_seen_at and reported status:
 * - 'offline' if reported as offline or last_seen_at > 15 minutes ago
 * - 'away' if reported as away, or last_seen_at between 3 and 15 minutes ago
 * - 'online' if active within the last 3 minutes and reported as online
 */
function computeStatus(reportedStatus, lastSeenAt) {
  if (!lastSeenAt) return 'offline';
  if (reportedStatus === 'offline') return 'offline';

  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  const threeMinMs = 3 * 60 * 1000;
  const fifteenMinMs = 15 * 60 * 1000;

  if (reportedStatus === 'away') {
    return diffMs <= fifteenMinMs ? 'away' : 'offline';
  }

  if (diffMs <= threeMinMs) return 'online';
  if (diffMs <= fifteenMinMs) return 'away';
  return 'offline';
}

/**
 * GET /api/new/presence
 * List all users with their live presence status (online, away, offline) and summary counts.
 */
export async function GET() {
  try {
    await Promise.all([ensureTable('internal_users'), ensureTable('internal_user_presence')]);

    const sql = `
      SELECT 
        u.id, 
        u.username, 
        u.email, 
        u.fullname, 
        u.nickname, 
        u.role, 
        u.status AS account_status,
        u.location,
        u.last_login_at,
        p.status AS reported_status,
        p.custom_status,
        p.current_page,
        p.last_seen_at
      FROM internal_users u
      LEFT JOIN internal_user_presence p ON LOWER(u.email) = LOWER(p.email)
      WHERE u.status = 'Active'
      ORDER BY 
        CASE 
          WHEN p.last_seen_at >= NOW() - INTERVAL '3 minutes' AND COALESCE(p.status, 'online') = 'online' THEN 1
          WHEN (p.last_seen_at >= NOW() - INTERVAL '15 minutes' AND COALESCE(p.status, 'online') = 'online') OR p.status = 'away' THEN 2
          ELSE 3
        END ASC,
        p.last_seen_at DESC NULLS LAST,
        u.fullname ASC,
        u.username ASC
    `;

    const res = await query(sql);

    const users = (res.rows || []).map((row) => {
      const computed = computeStatus(row.reported_status, row.last_seen_at);
      return {
        id: row.id,
        username: row.username,
        email: row.email,
        fullname: row.fullname || row.nickname || row.username,
        nickname: row.nickname || '',
        role: row.role || 'Instructor',
        location: row.location || '',
        status: computed,
        reportedStatus: row.reported_status || 'offline',
        customStatus: row.custom_status || '',
        currentPage: row.current_page || '',
        lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      };
    });

    const counts = {
      total: users.length,
      online: users.filter((u) => u.status === 'online').length,
      away: users.filter((u) => u.status === 'away').length,
      offline: users.filter((u) => u.status === 'offline').length,
    };

    return NextResponse.json({
      counts,
      users,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/new/presence
 * Updates/heartbeats the current user's presence.
 */
export async function POST(req) {
  try {
    await Promise.all([ensureTable('internal_users'), ensureTable('internal_user_presence')]);

    const body = await req.json().catch(() => ({}));
    const { email, username, fullname, role, status = 'online', currentPage = '', customStatus = '' } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid user email is required.' }, { status: 400 });
    }

    const safeStatus = ['online', 'away', 'offline'].includes(status) ? status : 'online';
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = (username || cleanEmail.split('@')[0]).trim();
    const cleanFullname = fullname ? fullname.trim() : cleanUsername;
    const cleanRole = role || 'Instructor';
    const cleanPage = (currentPage || '').trim();
    const cleanCustom = (customStatus || '').trim();

    const sql = `
      INSERT INTO internal_user_presence (
        email, username, fullname, role, status, current_page, custom_status, last_seen_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET
        username = EXCLUDED.username,
        fullname = COALESCE(NULLIF(EXCLUDED.fullname, ''), internal_user_presence.fullname),
        role = COALESCE(NULLIF(EXCLUDED.role, ''), internal_user_presence.role),
        status = EXCLUDED.status,
        current_page = EXCLUDED.current_page,
        custom_status = CASE WHEN EXCLUDED.custom_status IS NOT NULL THEN EXCLUDED.custom_status ELSE internal_user_presence.custom_status END,
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `;

    const res = await query(sql, [
      cleanEmail,
      cleanUsername,
      cleanFullname,
      cleanRole,
      safeStatus,
      cleanPage,
      cleanCustom,
    ]);

    return NextResponse.json({
      ok: true,
      presence: res.rows[0],
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
