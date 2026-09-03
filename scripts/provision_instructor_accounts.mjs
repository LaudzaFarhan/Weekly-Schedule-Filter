/**
 * Provision user accounts for all registered active instructors.
 *
 * Reads instructors from `internal_instructors`, plans user accounts via
 * `planInstructorAccounts`, encrypts starter passwords with AES-256-GCM, and
 * inserts the accounts into `internal_users` with `is_verified = TRUE`.
 */

import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { planInstructorAccounts, INSTRUCTOR_DEFAULT_PASSWORD } from '../src/lib/employeeAccounts.js';
import { encryptPassword, isCredentialKeyConfigured } from '../src/lib/employeeCredentials.js';

function loadEnv(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

loadEnv('.env.local');
loadEnv('.env');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not defined in .env or .env.local');
  process.exit(1);
}

if (!isCredentialKeyConfigured()) {
  console.error('EMPLOYEE_CREDENTIAL_KEY is not configured in .env.local');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('Fetching active instructors and existing users...');
    const [instructorsRes, accountsRes] = await Promise.all([
      client.query(
        "SELECT id, name, status, contact, remarks, branches, level FROM internal_instructors WHERE (status IS NULL OR status = 'Active' OR status != 'Inactive') ORDER BY id ASC"
      ),
      client.query('SELECT id, instructor_id, username, email FROM internal_users'),
    ]);

    const instructors = instructorsRes.rows || [];
    const accounts = (accountsRes.rows || []).map((r) => ({
      id: r.id,
      instructorId: r.instructor_id,
      username: r.username,
      email: r.email,
    }));

    console.log(`Instructors in database: ${instructors.length}`);
    console.log(`Existing users in database: ${accounts.length}`);

    const plan = planInstructorAccounts(instructors, accounts);
    console.log(`Accounts to create: ${plan.create.length}`);
    console.log(`Accounts skipped: ${plan.skipped.length}`);

    if (plan.skipped.length > 0) {
      console.warn('Skipped instructors:', plan.skipped);
    }

    if (plan.create.length === 0) {
      console.log('No new instructor accounts need to be created. All active instructors already have accounts.');
      return;
    }

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

    console.log(`Encrypting default password "${INSTRUCTOR_DEFAULT_PASSWORD}" with unique IVs...`);
    const encryptedPasswords = plan.create.map(() => encryptPassword(INSTRUCTOR_DEFAULT_PASSWORD));
    const verifyImmediately = true;
    const verifiedBy = 'Admin';
    const verifiedAt = new Date().toISOString();

    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO internal_users
        (username, email, role, password_encrypted, must_change_password, status,
         fullname, phone_number, location, instructor_id, is_verified, verified_at, verified_by)
      SELECT username, email, 'Instructor', pwd, TRUE, 'Active',
             fullname, phone, loc, instructor_id, is_ver, ver_at, ver_by
        FROM UNNEST(
          $1::varchar[], $2::varchar[], $3::text[], $4::varchar[],
          $5::varchar[], $6::varchar[], $7::int[], $8::boolean[],
          $9::timestamptz[], $10::varchar[]
        ) AS t(username, email, pwd, fullname, phone, loc, instructor_id, is_ver, ver_at, ver_by)
      ON CONFLICT DO NOTHING
      RETURNING id, username, email, role, fullname, phone_number, location, instructor_id,
                is_verified, verified_at, verified_by, must_change_password
    `;

    const res = await client.query(insertQuery, [
      plan.create.map((entry) => entry.username),
      emailList,
      encryptedPasswords,
      plan.create.map((entry) => entry.name),
      plan.create.map((entry) => entry.contact || null),
      plan.create.map((entry) => entry.location || null),
      plan.create.map((entry) => entry.instructorId),
      plan.create.map(() => verifyImmediately),
      plan.create.map(() => (verifyImmediately ? verifiedAt : null)),
      plan.create.map(() => (verifyImmediately ? verifiedBy : null)),
    ]);

    // Record in activity log
    await client.query(
      `INSERT INTO internal_activity (action, summary, item_count, user_email, source, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'provision',
        `Provisioned ${res.rows.length} instructor account(s) from instructor registry (verified)`,
        res.rows.length,
        'admin',
        'users',
        JSON.stringify({
          createdCount: res.rows.length,
          usernames: res.rows.map((r) => r.username),
        }),
      ]
    );

    await client.query('COMMIT');

    console.log(`\nSuccessfully created and verified ${res.rows.length} instructor accounts!`);
    console.log('Sample created accounts:');
    res.rows.slice(0, 10).forEach((r) => {
      console.log(`  - User ID ${r.id} | Instructor ID ${r.instructor_id} | ${r.username} (${r.email}) | Verified: ${r.is_verified}`);
    });
    if (res.rows.length > 10) {
      console.log(`  ... and ${res.rows.length - 10} more accounts.`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to provision instructor accounts:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
