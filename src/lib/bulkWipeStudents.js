import { withTransaction } from './db';
import { ensureTable } from './ensureSchema';

/**
 * Fixed advisory-lock key for the student wipe.
 *
 * A fixed key is what lets two concurrent wipes serialise: the second
 * transaction blocks on the same key until the first commits or rolls back
 * (Req 9.6). Row locks cannot do this, because the first transaction may have
 * already emptied `internal_students`, leaving no rows to lock.
 */
export const WIPE_LOCK_KEY = 774120531;

/**
 * Delete every student record and the two data sets keyed to it, in one
 * transaction.
 *
 * Takes no arguments at all, deliberately: with no filter parameter there is no
 * way for any caller to narrow a wipe to a subset of records (Req 4.9). The
 * statements reference only `internal_students`, `internal_student_history` and
 * `internal_live_progress`, so the protected tables (`internal_classes`,
 * `internal_instructors`, `internal_leaves`, `internal_operationals`,
 * `new_crm_leads`) are left untouched structurally rather than by assertion
 * (Req 4.5, 4.10).
 *
 * @returns {Promise<{ deletedStudents: number, deletedHistory: number, deletedProgress: number }>}
 *   Row counts from the three deletions. All three are always present integers,
 *   including 0 when nothing matched (Req 6.5, 7.1, 9.1).
 */
export async function bulkWipeStudents() {
  // DDL runs on the pool before BEGIN. Inside the wipe transaction it would
  // widen the rollback surface for no benefit, and both definitions are
  // IF NOT EXISTS, so they are already idempotent.
  await ensureTable('internal_student_history');
  await ensureTable('internal_live_progress');

  return withTransaction(async (client) => {
    // First statement in the transaction, so a concurrent wipe waits here
    // rather than part-way through the deletions. Released automatically at
    // COMMIT or ROLLBACK (Req 9.6).
    await client.query('SELECT pg_advisory_xact_lock($1)', [WIPE_LOCK_KEY]);

    // Live progress first: it is matched by name, and those names only exist
    // while the student rows do. The compare trims and folds case, and blank
    // or whitespace-only student names select nothing (Req 4.3, 4.4, 4.11,
    // 4.12).
    const progress = await client.query(`
      DELETE FROM internal_live_progress
       WHERE lower(btrim(student_name)) IN (
             SELECT lower(btrim(name)) FROM internal_students WHERE btrim(name) <> ''
       )`);

    // Branch history second: exact student_id match, so history rows that
    // matched no student at the start of the transaction survive (Req 4.2,
    // 4.13).
    const history = await client.query(`
      DELETE FROM internal_student_history
       WHERE student_id IN (SELECT id FROM internal_students)`);

    // Clean up student class schedule rows from internal_classes table so the schedule grid resets
    await client.query(`
      DELETE FROM internal_classes
       WHERE (student IS NOT NULL AND btrim(student) <> '')
          OR lower(btrim(class_type)) IN ('regular', 'trial', 'replacement', 'additional')
    `);
    await client.query('DELETE FROM internal_class_sessions');

    // Students last, unconditionally — every record held when the transaction
    // started, across every branch and every status (Req 4.1, 4.8, 4.9, 9.2).
    const students = await client.query('DELETE FROM internal_students');

    return {
      deletedStudents: students.rowCount,
      deletedHistory: history.rowCount,
      deletedProgress: progress.rowCount,
    };
  });
}

export default bulkWipeStudents;
