/**
 * New Operations — Verify / Approve User Accounts.
 *
 * PUT /api/new/users/verify
 *
 * Allows Administrators to verify individual accounts, a list of accounts,
 * or all pending unverified accounts in a single call.
 */

import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { auditAccountAction, canAdminAccounts, identify } from '@/lib/apiIdentity';

function forbidden() {
  return NextResponse.json(
    {
      error: 'Forbidden',
      message: 'Verifying user accounts needs the Admin role, or the New Operations API key.',
    },
    { status: 403 }
  );
}

export async function PUT(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    await ensureTable('internal_users');

    const body = await req.json().catch(() => null);
    const isVerified = body?.isVerified !== undefined ? Boolean(body.isVerified) : true;
    const verifiedBy = isVerified ? (identity.username || identity.email || 'Admin') : null;
    const allPending = Boolean(body?.allPending);

    let targetIds = [];
    if (allPending) {
      const pendingRes = await query(
        "SELECT id FROM internal_users WHERE (is_verified IS FALSE OR is_verified IS NULL) AND role != 'Admin'"
      );
      targetIds = pendingRes.rows.map((r) => r.id);
    } else if (Array.isArray(body?.ids)) {
      targetIds = body.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    } else if (body?.id !== undefined) {
      const singleId = Number(body.id);
      if (Number.isInteger(singleId) && singleId > 0) {
        targetIds = [singleId];
      }
    }

    if (targetIds.length === 0) {
      return NextResponse.json({
        verifiedCount: 0,
        message: allPending ? 'No pending unverified accounts found.' : 'No user IDs specified.',
      });
    }

    // Safety check: Cannot unverify self if session user is in targetIds
    if (!isVerified && identity.kind === 'session' && targetIds.includes(identity.userId)) {
      return NextResponse.json(
        { error: 'Cannot unverify your own account.' },
        { status: 409 }
      );
    }

    const updated = await withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE internal_users SET
           is_verified = $1,
           verified_at = CASE WHEN $1 = TRUE THEN NOW() ELSE NULL END,
           verified_by = $2
         WHERE id = ANY($3::int[])
         RETURNING id, username, email, role, is_verified, verified_at, verified_by`,
        [isVerified, verifiedBy, targetIds]
      );

      if (!isVerified) {
        await ensureTable('internal_sessions');
        await client.query('DELETE FROM internal_sessions WHERE user_id = ANY($1::int[])', [targetIds]);
      }

      return res.rows;
    });

    await auditAccountAction(
      identity,
      'verify',
      `${isVerified ? 'Verified' : 'Unverified'} ${updated.length} user account${updated.length === 1 ? '' : 's'}`
    );

    return NextResponse.json({
      success: true,
      verifiedCount: updated.length,
      isVerified,
      users: updated,
      message: `Successfully ${isVerified ? 'verified' : 'unverified'} ${updated.length} account${updated.length === 1 ? '' : 's'}.`,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
