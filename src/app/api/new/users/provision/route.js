/**
 * New Operations — give every instructor a login.
 *
 * GET  /api/new/users/provision   what would be created, without creating it
 * POST /api/new/users/provision   create the missing accounts
 *
 * Usernames are derived from the instructor's name (`Felix Wijaya` →
 * `felix.wijaya`) and the password is the shared instructor starter password.
 * Nobody wants to type fifteen accounts by hand, and a name-derived username is
 * one an instructor can be told over the phone.
 *
 * Idempotent, by instructor id rather than by name. Pressing the button twice
 * creates nothing the second time, and correcting a spelling in the instructor
 * registry does not hand that person a second account.
 *
 * `GET` first is the point of having two verbs: this writes credentials for real
 * people, and seeing the usernames before they exist is cheaper than renaming
 * them afterwards.
 */

import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { auditAccountAction, canAdminAccounts, identify } from '@/lib/apiIdentity';
import { INSTRUCTOR_DEFAULT_PASSWORD, planInstructorAccounts } from '@/lib/employeeAccounts';
import { CredentialKeyError, encryptPassword } from '@/lib/employeeCredentials';

function forbidden() {
  return NextResponse.json(
    {
      error: 'Forbidden',
      message: 'Creating instructor accounts needs the Admin role, or the New Operations API key.',
    },
    { status: 403 }
  );
}

/**
 * The instructor list and the accounts already linked to it.
 *
 * Only `Active` instructors are considered: someone who has left should not be
 * handed a working login by a button press.
 */
async function loadPlan() {
  await Promise.all([ensureTable('internal_users'), ensureTable('internal_instructors')]);

  const [instructors, accounts] = await Promise.all([
    query("SELECT id, name, level, status FROM internal_instructors WHERE status = 'Active' ORDER BY name ASC"),
    query('SELECT instructor_id, username FROM internal_users'),
  ]);

  const plan = planInstructorAccounts(
    instructors.rows.map((row) => ({ id: row.id, name: row.name, status: row.status })),
    accounts.rows.map((row) => ({ instructorId: row.instructor_id, username: row.username }))
  );

  return { plan, instructorCount: instructors.rowCount, accountCount: accounts.rowCount };
}

export async function GET(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    const { plan, instructorCount, accountCount } = await loadPlan();

    return NextResponse.json({
      // Named `willCreate`, not `created`, so a client cannot mistake a preview
      // for a completed run.
      willCreate: plan.create,
      skipped: plan.skipped,
      instructorCount,
      accountCount,
      defaultPassword: INSTRUCTOR_DEFAULT_PASSWORD,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const identity = await identify(req);
    if (!canAdminAccounts(identity)) return forbidden();

    const { plan } = await loadPlan();

    if (plan.create.length === 0) {
      return NextResponse.json({
        created: [],
        skipped: plan.skipped,
        message: plan.skipped.length
          ? 'Every instructor who can have an account already has one.'
          : 'Every instructor already has an account.',
      });
    }

    let encrypted;
    try {
      // One ciphertext per account, not one reused: a fresh IV per call is what
      // stops fifteen accounts sharing a password from being fifteen identical
      // columns to anyone who can read the table.
      encrypted = plan.create.map(() => encryptPassword(INSTRUCTOR_DEFAULT_PASSWORD));
    } catch (error) {
      if (error instanceof CredentialKeyError) {
        return NextResponse.json({ error: 'Not configured', message: error.message }, { status: 503 });
      }
      throw error;
    }

    // One transaction for the whole batch: a partial run would leave some
    // instructors with a login and no record of which, and the button would have
    // to be pressed again to find out.
    const created = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO internal_users
           (username, email, role, password_encrypted, must_change_password, status,
            fullname, instructor_id)
         SELECT username, email, 'Instructor', pwd, TRUE, 'Active', fullname, instructor_id
           FROM UNNEST($1::varchar[], $2::varchar[], $3::text[], $4::varchar[], $5::int[])
             AS t(username, email, pwd, fullname, instructor_id)
         ON CONFLICT DO NOTHING
         RETURNING id, username, email, role, fullname, instructor_id, must_change_password`,
        [
          plan.create.map((entry) => entry.username),
          // A local-domain email, because `email` is NOT NULL and UNIQUE and these
          // accounts have no real mailbox. Derived from the username so it is
          // stable and unique for the same reasons the username is.
          plan.create.map((entry) => `${entry.username}@instructor.local`),
          encrypted,
          plan.create.map((entry) => entry.name),
          plan.create.map((entry) => entry.instructorId),
        ]
      );
      return res.rows;
    });

    await auditAccountAction(
      identity,
      'provision',
      `Created ${created.length} instructor account${created.length === 1 ? '' : 's'} from the instructor registry`
    );

    return NextResponse.json(
      {
        created: created.map((row) => ({
          id: row.id,
          username: row.username,
          email: row.email,
          role: row.role,
          fullname: row.fullname,
          instructorId: row.instructor_id,
          mustChangePassword: row.must_change_password,
        })),
        skipped: plan.skipped,
        // Returned once, here, so the Admin can pass it on. It is also the stored
        // password, readable later through /api/new/users/password.
        password: INSTRUCTOR_DEFAULT_PASSWORD,
        message: `Created ${created.length} account${created.length === 1 ? '' : 's'}. Everyone starts with the password "${INSTRUCTOR_DEFAULT_PASSWORD}" and is asked to change it.`,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof CredentialKeyError) {
      return NextResponse.json({ error: 'Not configured', message: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
