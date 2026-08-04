/**
 * Who is calling a New Operations route.
 *
 * `src/middleware.js` answers "may this request reach the API at all" with a
 * shared secret. It cannot answer "which person is this", and role-gated
 * endpoints need that. This module resolves a request to an identity, or says
 * plainly that it could not.
 *
 * Three kinds of caller:
 *
 *   1. A session cookie, set by `POST /api/new/auth/login`. Carries a real user
 *      row, so it has a role.
 *   2. The `NEW_OPS_API_KEY` bearer token. Machine callers — Hermes, scripts,
 *      curl — have no user row, so they are treated as `Admin`. That is a
 *      deliberate widening: whoever holds that key can already read and write
 *      every record through the other routes, so refusing them the users API
 *      would protect nothing while making the accounts impossible to bootstrap.
 *   3. Nobody. Returns `kind: 'anonymous'`.
 *
 * Results are returned, not thrown. A route usually needs to shape its own
 * refusal — a GET wants 401, a role failure wants 403 with a different message —
 * and exceptions make that read worse.
 */

import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import {
  SESSION_COOKIE,
  canManageAccounts,
  hashSessionToken,
  isSessionActive,
  sessionExpiry,
  shouldRefreshSession,
} from '@/lib/authSession';

/** The identity of a request carrying the shared API key. */
const MACHINE_IDENTITY = Object.freeze({
  kind: 'apiKey',
  userId: null,
  email: null,
  username: 'api-key',
  role: 'Admin',
  displayName: 'API key',
});

const ANONYMOUS = Object.freeze({
  kind: 'anonymous',
  userId: null,
  email: null,
  username: null,
  role: null,
  displayName: 'anonymous',
});

/** The bearer or `x-api-key` value on a request, or null. */
function presentedKey(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return req.headers.get('x-api-key');
}

/**
 * Resolve the caller.
 *
 * The session cookie is checked first, so a signed-in Admin is attributed by
 * name in the audit log even on a request that also carries the shared key.
 */
export async function identify(req) {
  const token = req.cookies?.get?.(SESSION_COOKIE)?.value || null;

  if (token) {
    const session = await lookupSession(token);
    if (session) return session;
    // A cookie that no longer resolves is stale, not hostile — fall through to
    // the key rather than refusing outright.
  }

  const key = presentedKey(req);
  if (key && process.env.NEW_OPS_API_KEY && key === process.env.NEW_OPS_API_KEY) {
    return MACHINE_IDENTITY;
  }

  return ANONYMOUS;
}

/**
 * The user behind a session token, or null when it is unknown, expired or
 * belongs to a suspended account.
 *
 * Expired rows are deleted as they are encountered. There is no scheduler on
 * this host, so opportunistic cleanup on the path that already found the row is
 * the only sweeping that happens.
 */
async function lookupSession(token) {
  let tokenHash;
  try {
    tokenHash = hashSessionToken(token);
  } catch {
    return null;
  }

  await Promise.all([ensureTable('internal_users'), ensureTable('internal_sessions')]);

  const res = await query(
    `SELECT s.id AS session_id, s.expires_at, u.id, u.username, u.email, u.role,
            u.status, u.fullname, u.must_change_password
       FROM internal_sessions s
       JOIN internal_users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [tokenHash]
  );
  const row = res.rows[0];
  if (!row) return null;

  const session = { expiresAt: row.expires_at };
  if (!isSessionActive(session)) {
    await query('DELETE FROM internal_sessions WHERE id = $1', [row.session_id]);
    return null;
  }

  // A suspended account must lose access without an Admin having to hunt down
  // its sessions, so status is re-read on every request rather than trusted from
  // whatever it was at login.
  if (row.status && row.status !== 'Active') return null;

  if (shouldRefreshSession(session)) {
    await query(
      'UPDATE internal_sessions SET expires_at = $1, last_seen_at = NOW() WHERE id = $2',
      [sessionExpiry(), row.session_id]
    );
  } else {
    await query('UPDATE internal_sessions SET last_seen_at = NOW() WHERE id = $1', [row.session_id]);
  }

  return {
    kind: 'session',
    sessionId: row.session_id,
    userId: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    status: row.status,
    displayName: row.fullname || row.username || row.email,
    mustChangePassword: row.must_change_password,
  };
}

/** Is the caller signed in, by cookie or by key? */
export function isAuthenticated(identity) {
  return Boolean(identity) && identity.kind !== 'anonymous';
}

/**
 * True when the caller may manage accounts.
 *
 * Kept as one predicate so "who may do this" lives in `authSession.js` and every
 * route agrees, rather than each one spelling out a role list.
 */
export function canAdminAccounts(identity) {
  return isAuthenticated(identity) && canManageAccounts(identity.role);
}

/**
 * Record something an account-management call did.
 *
 * Best-effort: a failed audit write must not fail the operation the user asked
 * for, but it is logged loudly so a silently broken audit trail is noticeable in
 * the server logs.
 */
export async function auditAccountAction(identity, action, summary) {
  try {
    await ensureTable('internal_activity');
    await query(
      `INSERT INTO internal_activity (action, summary, item_count, user_email, source)
       VALUES ($1, $2, 1, $3, 'accounts')`,
      [action, summary, identity?.email || identity?.username || null]
    );
  } catch (error) {
    console.error('[accounts] Audit write failed:', error.message);
  }
}
