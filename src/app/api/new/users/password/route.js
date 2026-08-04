/**
 * New Operations — employee passwords.
 *
 * GET /api/new/users/password?id=   read a stored password back  (Admin only)
 * PUT /api/new/users/password       set or reset a password
 *
 * A separate route from `/api/new/users` on purpose. Reading a password back is
 * the one operation in this system that hands over a live credential, so it is
 * kept on its own path where it can be gated and audited by itself, and where a
 * list response can never accidentally include it.
 *
 * Every read is written to the activity log with the Admin who made it and whose
 * password it was. That log is the actual control here — the reveal cannot be
 * prevented, since the design requires it, so the answer is that it cannot be
 * done quietly.
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { auditAccountAction, canAdminAccounts, identify } from '@/lib/apiIdentity';
import { CredentialKeyError, decryptPassword, encryptPassword } from '@/lib/employeeCredentials';
import { defaultPasswordFor } from '@/lib/employeeAccounts';

function forbidden() {
  return NextResponse.json(
    {
      error: 'Forbidden',
      message: 'Reading or setting an employee password needs the Admin role, or the New Operations API key.',
    },
    { status: 403 }
  );
}

function keyMissing(error) {
  return NextResponse.json(
    { error: 'Not configured', message: error.message },
    { status: 503 }
  );
}

export async function GET(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    await ensureTable('internal_users');

    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Missing or invalid id query parameter' }, { status: 400 });
    }

    const res = await query(
      'SELECT id, username, email, password_encrypted FROM internal_users WHERE id = $1',
      [id]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const row = res.rows[0];
    if (!row.password_encrypted) {
      return NextResponse.json(
        {
          error: 'No password on record',
          message: 'This account has never had a password set. Use PUT to set one.',
        },
        { status: 409 }
      );
    }

    let password;
    try {
      password = decryptPassword(row.password_encrypted);
    } catch (error) {
      if (error instanceof CredentialKeyError) return keyMissing(error);
      // Unreadable ciphertext means the key changed under the data. Say that,
      // rather than a 500 that looks like a bug in this route.
      return NextResponse.json(
        {
          error: 'Stored password could not be read',
          message: 'It was encrypted with a different EMPLOYEE_CREDENTIAL_KEY. Set a new password to recover the account.',
        },
        { status: 409 }
      );
    }

    // Audited before responding: if the write fails the read is still logged as
    // attempted by the console error inside `auditAccountAction`.
    await auditAccountAction(identity, 'reveal', `Read the password for account: ${row.username}`);

    return NextResponse.json(
      { id: row.id, username: row.username, email: row.email, password },
      // Caches and proxies must not keep a copy of this body.
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    if (error instanceof CredentialKeyError) return keyMissing(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    await Promise.all([ensureTable('internal_users'), ensureTable('internal_sessions')]);

    const body = await req.json().catch(() => null);
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Missing or invalid user id' }, { status: 400 });
    }

    // `reset: true` is the common case — put the account back to the shared
    // default rather than making an Admin invent a password.
    //
    // The default depends on the account's ROLE, so the role is read from the
    // database rather than taken from the request: an instructor resets to
    // `instructor12345`, and a caller must not be able to change which default
    // applies by sending a different role.
    const resetting = body?.reset === true;

    /*
      Resetting your OWN password is refused, and this is not pedantry — it is a
      trap that has already caught someone.

      A reset sets the password to a value every colleague knows, and then ends
      every session for that account, including the one making the request. The
      Admin is signed out mid-task, every subsequent call answers 403, and the
      screen looks broken rather than logged out. The only way back in is to
      guess that the shared default now applies to them.

      Choosing your own new password is still allowed. That also ends your
      sessions, but you know what you set and "you changed your password, sign in
      again" is a comprehensible outcome.
    */
    if (resetting && identity.kind === 'session' && identity.userId === id) {
      return NextResponse.json(
        {
          error: 'That would sign you out',
          message:
            'Resetting your own password would set it to the shared default and end this '
            + 'session immediately. Send a password you have chosen instead, or have another '
            + 'Admin reset it for you.',
        },
        { status: 409 }
      );
    }

    let resetRole = null;
    if (resetting) {
      const existing = await query('SELECT role FROM internal_users WHERE id = $1', [id]);
      if (existing.rowCount === 0) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      }
      resetRole = existing.rows[0].role;
    }

    const password = resetting
      ? defaultPasswordFor(resetRole)
      : (typeof body?.password === 'string' ? body.password : '');

    if (!password) {
      return NextResponse.json(
        { error: 'Missing password', message: 'Send a password, or reset: true to use the default.' },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password too short', message: 'Use at least 8 characters.' },
        { status: 400 }
      );
    }

    let encrypted;
    try {
      encrypted = encryptPassword(password);
    } catch (error) {
      if (error instanceof CredentialKeyError) return keyMissing(error);
      throw error;
    }

    // A password set by an Admin has to be changed on first use, because the
    // Admin knows it. One the user set for themselves does not.
    const mustChange = body?.mustChangePassword === undefined
      ? true
      : Boolean(body.mustChangePassword);

    const res = await query(
      `UPDATE internal_users
          SET password_encrypted = $2, must_change_password = $3
        WHERE id = $1
        RETURNING id, username`,
      [id, encrypted, mustChange]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Changing a password ends every existing session for that account. If the
    // reason for the change was a suspected compromise, leaving the attacker's
    // session alive would defeat the point.
    await query('DELETE FROM internal_sessions WHERE user_id = $1', [id]);

    await auditAccountAction(
      identity,
      'password',
      `${resetting ? 'Reset' : 'Changed'} the password for account: ${res.rows[0].username}`
    );

    return NextResponse.json({
      success: true,
      id: res.rows[0].id,
      username: res.rows[0].username,
      mustChangePassword: mustChange,
      sessionsEnded: true,
      // Only when the server chose it, so the Admin knows what to pass on.
      password: resetting ? password : undefined,
    });
  } catch (error) {
    if (error instanceof CredentialKeyError) return keyMissing(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
