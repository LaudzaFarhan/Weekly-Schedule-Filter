/**
 * New Operations — employee accounts.
 *
 * GET    /api/new/users            list accounts (never passwords)
 * POST   /api/new/users            create an account
 * PUT    /api/new/users            update an account
 * DELETE /api/new/users?id=        remove an account
 *
 * Passwords are never in a list response, on any role. Reading one back is a
 * separate, separately-audited call: `GET /api/new/users/password?id=`.
 *
 * Access
 *   Every verb here needs account-management rights — `Admin`, or the shared
 *   `NEW_OPS_API_KEY`. See `apiIdentity.js` for why the key counts as Admin.
 *
 * Bootstrap
 *   While `internal_users` is empty, `POST` is open and forced to create an
 *   `Admin`. Otherwise the first account could never be made: the API needs an
 *   Admin to create one, and there is no Admin. The hole closes the moment the
 *   first row exists, which is checked inside the same transaction as the insert
 *   so two simultaneous requests cannot both take it.
 */

import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { buildListQuery, withLimit } from '@/lib/listQuery';
import { auditAccountAction, canAdminAccounts, identify } from '@/lib/apiIdentity';
import { isKnownRole, ROLES } from '@/lib/authSession';
import {
  CredentialKeyError, describeCredentialKey, encryptPassword, isCredentialKeyConfigured,
} from '@/lib/employeeCredentials';
import { defaultPasswordFor } from '@/lib/employeeAccounts';
import { autoSyncInstructorAccounts } from '@/lib/syncInstructorAccounts';

/** Account statuses. Anything other than Active is refused at login. */
const STATUSES = ['Active', 'Suspended'];

/**
 * The shape every response uses.
 *
 * `password_encrypted` is not listed and must never be added: this mapper is the
 * one place a row becomes a response, so leaving it out here is what guarantees
 * a password cannot leak through a route that forgot to strip it.
 */
const mapRow = (row) => ({
  id: row.id,
  username: row.username,
  email: row.email,
  role: row.role,
  status: row.status,
  fullname: row.fullname,
  nickname: row.nickname,
  specialization: row.specialization,
  phoneNumber: row.phone_number,
  location: row.location,
  trainingProgress: row.training_progress || {},
  /** Set when this account was generated from the instructor registry. */
  instructorId: row.instructor_id ?? null,
  /** Whether the account has been approved and verified by an Administrator. */
  isVerified: row.is_verified === true || row.role === 'Admin',
  verifiedAt: row.verified_at,
  verifiedBy: row.verified_by,
  /** Whether a password is set at all — not the password itself. */
  hasPassword: Boolean(row.password_encrypted),
  mustChangePassword: row.must_change_password,
  firebaseUid: row.firebase_uid,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');
const nullable = (value) => (trimmed(value) === '' ? null : trimmed(value));

function forbidden() {
  return NextResponse.json(
    {
      error: 'Forbidden',
      message: 'Managing employee accounts needs the Admin role, or the New Operations API key.',
    },
    { status: 403 }
  );
}

/** Map a unique-constraint violation onto the field that actually collided. */
function conflictResponse(error) {
  if (error?.code !== '23505') return null;
  const field = String(error.constraint || '').includes('username') ? 'username' : 'email';
  return NextResponse.json(
    { error: `That ${field} is already taken`, field },
    { status: 409 }
  );
}

export async function GET(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    await ensureTable('internal_users');

    // Automatically sync instructor accounts so all instructors appear in user management
    await autoSyncInstructorAccounts().catch((err) => {
      console.warn('[GET /api/new/users] autoSync notice:', err.message);
    });

    const { searchParams } = new URL(req.url);
    const { clause, params, limit } = buildListQuery(searchParams, {
      searchColumns: ['username', 'email', 'fullname', 'nickname'],
      filters: { role: 'role', status: 'status' },
    });
    const { sql, params: finalParams } = withLimit(
      `SELECT * FROM internal_users ${clause} ORDER BY role ASC, username ASC`,
      params,
      limit
    );
    const res = await query(sql, finalParams);
    return NextResponse.json({
      users: res.rows.map(mapRow),
      roles: ROLES,
      statuses: STATUSES,
      /** So a client can warn that reveal and sign-in will fail before trying. */
      credentialKeyConfigured: isCredentialKeyConfigured(),
      /**
       * Why it is unusable, when it is. A missing key and a malformed one need
       * opposite advice — generate a new one, versus do not, because a new one
       * orphans every password already stored.
       */
      credentialKey: describeCredentialKey(),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await ensureTable('internal_users');

    const identity = await identify(req);
    const body = await req.json().catch(() => null);

    const username = trimmed(body?.username);
    const email = trimmed(body?.email).toLowerCase();
    if (!username || !email) {
      return NextResponse.json(
        { error: 'Missing required fields', message: 'username and email are both required.' },
        { status: 400 }
      );
    }

    const requestedRole = trimmed(body?.role) || 'Instructor';
    if (!isKnownRole(requestedRole)) {
      return NextResponse.json(
        { error: 'Unknown role', message: `role must be one of: ${ROLES.join(', ')}.` },
        { status: 400 }
      );
    }

    const status = trimmed(body?.status) || 'Active';
    if (!STATUSES.includes(status)) {
      return NextResponse.json(
        { error: 'Unknown status', message: `status must be one of: ${STATUSES.join(', ')}.` },
        { status: 400 }
      );
    }

    // The starter password follows the role: an instructor gets the one their
    // colleagues already know, so a new hire can be told it verbally.
    const rolePassword = defaultPasswordFor(requestedRole);
    const password = typeof body?.password === 'string' && body.password !== ''
      ? body.password
      : rolePassword;
    // A caller-supplied password still has to be changed on first sign-in unless
    // they say otherwise, because whoever typed it knows it.
    const mustChange = body?.mustChangePassword === false ? false : true;

    let encrypted;
    try {
      encrypted = encryptPassword(password);
    } catch (error) {
      if (error instanceof CredentialKeyError) {
        return NextResponse.json({ error: 'Not configured', message: error.message }, { status: 503 });
      }
      throw error;
    }

    // The emptiness check and the insert share one transaction, so the bootstrap
    // window cannot be used twice by two requests arriving together.
    const result = await withTransaction(async (client) => {
      const count = await client.query('SELECT COUNT(*)::int AS n FROM internal_users');
      const bootstrapping = count.rows[0].n === 0;

      if (!bootstrapping && !canAdminAccounts(identity)) return { forbidden: true };

      // The first account is an Admin whatever was asked for. A bootstrap that
      // produced an Instructor would leave the system with no way in.
      const role = bootstrapping ? 'Admin' : requestedRole;
      const isVerified = role === 'Admin' || Boolean(body?.isVerified);
      const verifiedBy = isVerified ? (identity.username || identity.email || 'Admin') : null;
      const verifiedAt = isVerified ? new Date().toISOString() : null;

      const inserted = await client.query(
        `INSERT INTO internal_users
           (username, email, role, password_encrypted, must_change_password, status,
            fullname, nickname, specialization, phone_number, location, training_progress,
            firebase_uid, instructor_id, is_verified, verified_at, verified_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, '{}'::jsonb), $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          username, email, role, encrypted, mustChange, status,
          nullable(body?.fullname), nullable(body?.nickname), nullable(body?.specialization),
          nullable(body?.phoneNumber), nullable(body?.location),
          body?.trainingProgress ? JSON.stringify(body.trainingProgress) : null,
          nullable(body?.firebaseUid),
          Number.isInteger(body?.instructorId) ? body.instructorId : null,
          isVerified,
          verifiedAt,
          verifiedBy,
        ]
      );
      return { row: inserted.rows[0], bootstrapped: bootstrapping };
    });

    if (result.forbidden) return forbidden();

    await auditAccountAction(
      identity,
      'create',
      result.bootstrapped
        ? `Bootstrapped the first Admin account: ${username}`
        : `Created ${result.row.role} account: ${username}`
    );

    return NextResponse.json(
      {
        user: mapRow(result.row),
        bootstrapped: result.bootstrapped,
        // Echoed only when the server chose it, so an Admin creating an account
        // knows what to tell the employee. Never echoes a caller's own password.
        temporaryPassword: password === rolePassword ? rolePassword : undefined,
      },
      { status: 201 }
    );
  } catch (error) {
    const conflict = conflictResponse(error);
    if (conflict) return conflict;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    await ensureTable('internal_users');

    const body = await req.json().catch(() => null);
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Missing or invalid user id' }, { status: 400 });
    }

    if (body?.role !== undefined && !isKnownRole(trimmed(body.role))) {
      return NextResponse.json(
        { error: 'Unknown role', message: `role must be one of: ${ROLES.join(', ')}.` },
        { status: 400 }
      );
    }
    if (body?.status !== undefined && !STATUSES.includes(trimmed(body.status))) {
      return NextResponse.json(
        { error: 'Unknown status', message: `status must be one of: ${STATUSES.join(', ')}.` },
        { status: 400 }
      );
    }

    // Locking yourself out is the one edit that cannot be undone through this
    // API, so it is refused rather than warned about.
    if (identity.kind === 'session' && identity.userId === id) {
      const losingAdmin = body?.role !== undefined && trimmed(body.role) !== 'Admin';
      const suspendingSelf = body?.status !== undefined && trimmed(body.status) !== 'Active';
      const unverifyingSelf = body?.isVerified === false;
      if (losingAdmin || suspendingSelf || unverifyingSelf) {
        return NextResponse.json(
          {
            error: 'That would lock you out',
            message: 'You cannot remove your own Admin role, unverify, or suspend your own account. Ask another Admin.',
          },
          { status: 409 }
        );
      }
    }

    const nextVerified = body?.isVerified !== undefined ? Boolean(body.isVerified) : null;
    const verifiedBy = identity.username || identity.email || 'Admin';

    // COALESCE so an omitted field keeps its stored value: this is a partial
    // update, and a client that only sends `status` must not blank the profile.
    const res = await query(
      `UPDATE internal_users SET
         username = COALESCE($2, username),
         email = COALESCE($3, email),
         role = COALESCE($4, role),
         status = COALESCE($5, status),
         fullname = COALESCE($6, fullname),
         nickname = COALESCE($7, nickname),
         specialization = COALESCE($8, specialization),
         phone_number = COALESCE($9, phone_number),
         location = COALESCE($10, location),
         training_progress = COALESCE($11, training_progress),
         must_change_password = COALESCE($12, must_change_password),
         is_verified = CASE
           WHEN $13::boolean IS NOT NULL THEN $13::boolean
           ELSE is_verified
         END,
         verified_at = CASE
           WHEN $13::boolean = TRUE THEN COALESCE(verified_at, NOW())
           WHEN $13::boolean = FALSE THEN NULL
           ELSE verified_at
         END,
         verified_by = CASE
           WHEN $13::boolean = TRUE THEN COALESCE(verified_by, $14::varchar)
           WHEN $13::boolean = FALSE THEN NULL
           ELSE verified_by
         END
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body?.username === undefined ? null : trimmed(body.username),
        body?.email === undefined ? null : trimmed(body.email).toLowerCase(),
        body?.role === undefined ? null : trimmed(body.role),
        body?.status === undefined ? null : trimmed(body.status),
        body?.fullname === undefined ? null : nullable(body.fullname),
        body?.nickname === undefined ? null : nullable(body.nickname),
        body?.specialization === undefined ? null : nullable(body.specialization),
        body?.phoneNumber === undefined ? null : nullable(body.phoneNumber),
        body?.location === undefined ? null : nullable(body.location),
        body?.trainingProgress === undefined ? null : JSON.stringify(body.trainingProgress),
        body?.mustChangePassword === undefined ? null : Boolean(body.mustChangePassword),
        nextVerified,
        verifiedBy,
      ]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const row = res.rows[0];

    // A suspended or unverified account loses its active sessions immediately
    if (row.status !== 'Active' || row.is_verified === false) {
      await ensureTable('internal_sessions');
      await query('DELETE FROM internal_sessions WHERE user_id = $1', [id]);
    }

    await auditAccountAction(
      identity,
      'update',
      nextVerified !== null
        ? `${nextVerified ? 'Verified' : 'Unverified'} account: ${row.username}`
        : `Updated account: ${row.username}`
    );
    return NextResponse.json({ user: mapRow(row) });
  } catch (error) {
    const conflict = conflictResponse(error);
    if (conflict) return conflict;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    await ensureTable('internal_users');

    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Missing or invalid id query parameter' }, { status: 400 });
    }

    if (identity.kind === 'session' && identity.userId === id) {
      return NextResponse.json(
        { error: 'You cannot delete your own account', message: 'Ask another Admin to do it.' },
        { status: 409 }
      );
    }

    // Refusing to delete the last Admin, for the same reason the first one is
    // forced to be an Admin: an account table with no Admin cannot be managed.
    const target = await query('SELECT username, role FROM internal_users WHERE id = $1', [id]);
    if (target.rowCount === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    if (target.rows[0].role === 'Admin') {
      const admins = await query("SELECT COUNT(*)::int AS n FROM internal_users WHERE role = 'Admin'");
      if (admins.rows[0].n <= 1) {
        return NextResponse.json(
          {
            error: 'That is the last Admin',
            message: 'Promote another account to Admin before deleting this one.',
          },
          { status: 409 }
        );
      }
    }

    await ensureTable('internal_sessions');
    await query('DELETE FROM internal_sessions WHERE user_id = $1', [id]);
    await query('DELETE FROM internal_users WHERE id = $1', [id]);

    await auditAccountAction(identity, 'delete', `Deleted account: ${target.rows[0].username}`);
    return NextResponse.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
