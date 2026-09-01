/**
 * Automatic Sync: Link all Instructors into User Management accounts.
 *
 * Automatically checks for any instructors in the instructors registry who do
 * not yet have an authentication account in `internal_users`, provisions them
 * with their detected email from remarks, branches, phone number, and leaves
 * them in `is_verified = FALSE` (Pending verification) so the Admin can approve them.
 */

import { query, withTransaction } from '@/lib/db';
import { ensureTable } from '@/lib/ensureSchema';
import { planInstructorAccounts, defaultPasswordFor } from '@/lib/employeeAccounts';
import { encryptPassword, isCredentialKeyConfigured } from '@/lib/employeeCredentials';

export async function autoSyncInstructorAccounts() {
  try {
    if (!isCredentialKeyConfigured()) {
      return { created: [], skipped: [] };
    }

    await Promise.all([ensureTable('internal_users'), ensureTable('internal_instructors')]);

    const [instructorsRes, accountsRes] = await Promise.all([
      query(`SELECT id, name, status, contact, remarks, branches, level FROM internal_instructors WHERE (status IS NULL OR status = 'Active' OR status != 'Inactive') ORDER BY name ASC`),
      query(`SELECT id, instructor_id, username, email FROM internal_users`),
    ]);

    const instructors = instructorsRes.rows || [];
    const accounts = (accountsRes.rows || []).map((r) => ({
      id: r.id,
      instructorId: r.instructor_id,
      username: r.username,
      email: r.email,
    }));

    const plan = planInstructorAccounts(instructors, accounts);
    if (!plan || plan.create.length === 0) {
      return { created: [], skipped: plan?.skipped || [] };
    }

    const defaultPwd = defaultPasswordFor('Instructor');
    const encrypted = encryptPassword(defaultPwd);

    const takenEmails = new Set(
      accounts.map((a) => (a.email ? String(a.email).toLowerCase() : '')).filter(Boolean)
    );

    const emailList = plan.create.map((e) => {
      if (e.email && !takenEmails.has(String(e.email).toLowerCase())) {
        takenEmails.add(String(e.email).toLowerCase());
        return e.email;
      }
      let candidate = `${e.username}@instructor.local`.toLowerCase();
      let suffix = 2;
      while (takenEmails.has(candidate)) {
        candidate = `${e.username}${suffix}@instructor.local`.toLowerCase();
        suffix += 1;
      }
      takenEmails.add(candidate);
      return candidate;
    });

    const createdRows = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO internal_users
           (username, email, role, password_encrypted, must_change_password, status,
            fullname, phone_number, location, instructor_id, is_verified, verified_at, verified_by)
         SELECT username, email, 'Instructor', pwd, TRUE, 'Active',
                fullname, phone, loc, instructor_id, FALSE, NULL, NULL
           FROM UNNEST(
             $1::varchar[], $2::varchar[], $3::text[], $4::varchar[],
             $5::varchar[], $6::varchar[], $7::int[]
           ) AS t(username, email, pwd, fullname, phone, loc, instructor_id)
         ON CONFLICT DO NOTHING
         RETURNING id, username, email, role, fullname, phone_number, location, instructor_id,
                   is_verified, verified_at, verified_by, must_change_password`,
        [
          plan.create.map((e) => e.username),
          emailList,
          plan.create.map(() => encrypted),
          plan.create.map((e) => e.name),
          plan.create.map((e) => e.contact || null),
          plan.create.map((e) => e.location || null),
          plan.create.map((e) => e.instructorId),
        ]
      );
      return res.rows;
    });

    return { created: createdRows, skipped: plan.skipped };
  } catch (error) {
    console.error('[autoSyncInstructorAccounts] Error syncing instructors:', error.message);
    return { error: error.message, created: [], skipped: [] };
  }
}
