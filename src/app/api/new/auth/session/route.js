/**
 * New Operations — the current session.
 *
 * GET    /api/new/auth/session   who am I
 * DELETE /api/new/auth/session   sign out
 *
 * `GET` is what a client calls on load to find out whether it still has a valid
 * session and what role it carries, so the UI can hide what the caller may not
 * do. It is not a security boundary — every protected route re-checks for itself,
 * because hiding a button is presentation and refusing a request is enforcement.
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { identify, isAuthenticated } from '@/lib/apiIdentity';
import { SESSION_COOKIE, canManageAccounts, hashSessionToken } from '@/lib/authSession';

export async function GET(req) {
  try {
    const identity = await identify(req);
    if (!isAuthenticated(identity)) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    return NextResponse.json({
      authenticated: true,
      via: identity.kind,
      user: {
        id: identity.userId,
        username: identity.username,
        email: identity.email,
        role: identity.role,
        displayName: identity.displayName,
        mustChangePassword: identity.mustChangePassword ?? false,
      },
      permissions: { manageAccounts: canManageAccounts(identity.role) },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const token = req.cookies?.get?.(SESSION_COOKIE)?.value || null;

    // Deleted by token hash rather than by user id, so signing out of this
    // browser does not sign the same person out of their other devices.
    if (token) {
      try {
        await query('DELETE FROM internal_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
      } catch (error) {
        // A cookie for a session that is already gone is the normal outcome of
        // signing out twice. Nothing to report.
        console.error('[auth] Sign-out cleanup failed:', error.message);
      }
    }

    // Always 200, and always clear the cookie. "Sign me out" has no failure the
    // caller could act on, and leaving a dead cookie in place would strand them.
    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
