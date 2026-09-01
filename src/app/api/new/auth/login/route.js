/**
 * New Operations — sign in.
 *
 * POST /api/new/auth/login  { identifier, password }
 *
 * `identifier` is a username or an email, because that is what the login screen
 * has always accepted and people type whichever they remember.
 *
 * On success a `lab_session` cookie is set and the user is returned. The token is
 * only ever sent in this response; the database holds its SHA-256 and nothing
 * more, so a leaked dump cannot be replayed as a login.
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import {
  CredentialKeyError, decryptPassword, isCredentialKeyConfigured, passwordsMatch,
} from '@/lib/employeeCredentials';
import {
  SESSION_COOKIE,
  createSessionToken,
  foldIdentifier,
  hashSessionToken,
  sessionCookieOptions,
  sessionExpiry,
} from '@/lib/authSession';

/**
 * One message for "no such account" and "wrong password".
 *
 * Distinguishing them tells an attacker which usernames are real, and tells a
 * legitimate user nothing they can act on that this does not.
 */
const REJECTED = 'That username or password is not right.';

/**
 * Did this request arrive over HTTPS?
 *
 * `req.url` is not enough. In production nginx terminates TLS and proxies to
 * 127.0.0.1:3000 over plain HTTP, so the app sees `http:` on a request the
 * browser made over `https:`. Trusting that would leave the session cookie
 * unmarked `Secure` on a properly encrypted site — the cookie would still work,
 * which is why the mistake would go unnoticed.
 *
 * `X-Forwarded-Proto` is set by our own nginx (see DEPLOYMENT.md). It is a
 * client-settable header in general, but the only way to reach the app is through
 * that proxy, which overwrites it. The failure direction is also the safe one: a
 * forged `https` marks the cookie `Secure`, which restricts it further.
 *
 * Plain HTTP has to keep working — development is over HTTP, and a `Secure`
 * cookie there is silently dropped, which looks exactly like a wrong password.
 */
function isHttps(req) {
  const forwarded = req.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim() === 'https';
  return new URL(req.url).protocol === 'https:';
}

const publicUser = (row) => ({
  id: row.id,
  username: row.username,
  email: row.email,
  role: row.role,
  status: row.status,
  fullname: row.fullname,
  nickname: row.nickname,
  mustChangePassword: row.must_change_password,
  lastLoginAt: row.last_login_at,
});

export async function POST(req) {
  try {
    if (!isCredentialKeyConfigured()) {
      // A deployment problem, not a caller problem — say so with a 503 so an
      // operator is not left reading it as a bad password.
      return NextResponse.json(
        {
          error: 'Sign-in is not configured',
          message: 'EMPLOYEE_CREDENTIAL_KEY is not set on this deployment, so stored passwords cannot be read.',
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => null);
    const identifier = foldIdentifier(body?.identifier ?? body?.username ?? body?.email);
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!identifier || !password) {
      return NextResponse.json(
        { error: 'Missing credentials', message: 'Send both identifier and password.' },
        { status: 400 }
      );
    }

    await Promise.all([ensureTable('internal_users'), ensureTable('internal_sessions')]);

    const res = await query(
      `SELECT * FROM internal_users
        WHERE LOWER(email) = $1 OR LOWER(username) = $1
        LIMIT 1`,
      [identifier]
    );
    const row = res.rows[0];

    if (!row || !row.password_encrypted) {
      return NextResponse.json({ error: REJECTED }, { status: 401 });
    }

    // A suspended account is refused before the password is even considered, so
    // a correct password on a disabled account still gets nowhere.
    if (row.status && row.status !== 'Active') {
      return NextResponse.json(
        { error: 'This account is not active. Ask an Admin to re-enable it.' },
        { status: 403 }
      );
    }

    // Unverified accounts (except Admins) must be approved and verified by an Administrator
    if (row.role !== 'Admin' && row.is_verified === false) {
      return NextResponse.json(
        {
          error: 'Account Pending Verification',
          message: 'Your account is pending verification by an Administrator. Please contact an Admin to verify and activate your login.',
          isPendingVerification: true,
        },
        { status: 403 }
      );
    }

    let stored;
    try {
      stored = decryptPassword(row.password_encrypted);
    } catch (error) {
      if (error instanceof CredentialKeyError) throw error;
      // Ciphertext that will not authenticate means the key was rotated without
      // re-encrypting, or the column was edited by hand. Either way this account
      // cannot be signed into and an Admin has to reset it — which is a different
      // problem from a wrong password, so it gets a different answer.
      console.error(`[auth] Unreadable credential for user ${row.id}: ${error.message}`);
      return NextResponse.json(
        {
          error: 'This account needs its password reset',
          message: 'The stored password could not be read. Ask an Admin to set a new one.',
        },
        { status: 409 }
      );
    }

    if (!passwordsMatch(stored, password)) {
      return NextResponse.json({ error: REJECTED }, { status: 401 });
    }

    const token = createSessionToken();
    const expiresAt = sessionExpiry();
    await query(
      `INSERT INTO internal_sessions (token_hash, user_id, expires_at, last_seen_at)
       VALUES ($1, $2, $3, NOW())`,
      [hashSessionToken(token), row.id, expiresAt]
    );
    await query('UPDATE internal_users SET last_login_at = NOW() WHERE id = $1', [row.id]);

    const response = NextResponse.json({
      user: publicUser(row),
      expiresAt,
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions({ secure: isHttps(req) }));
    return response;
  } catch (error) {
    if (error instanceof CredentialKeyError) {
      return NextResponse.json({ error: 'Sign-in is not configured', message: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
