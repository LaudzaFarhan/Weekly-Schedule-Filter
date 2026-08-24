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
 * Delete student records (or all records if branches is omitted) and the two
 * data sets keyed to them, in one transaction.
 *
 * @param {Array<string>|string|null} [branches] Optional branch name or list of branch names.
 * @returns {Promise<{ deletedStudents: number, deletedHistory: number, deletedProgress: number }>}
 *   Row counts from the three deletions. All three are always present integers,
 *   including 0 when nothing matched (Req 6.5, 7.1, 9.1).
 */
export async function bulkWipeStudents(branches = null) {
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

    const branchList = Array.isArray(branches)
      ? branches.map((b) => (typeof b === 'string' ? b.trim() : (b?.name || ''))).filter(Boolean)
      : null;

    const isBranchScoped = Array.isArray(branchList) && branchList.length > 0;

    let progressQuery, progressParams;
    let historyQuery, historyParams;
    let studentsQuery, studentsParams;

    if (isBranchScoped) {
      // Scoped by selected branches
      progressQuery = `
        DELETE FROM internal_live_progress
         WHERE lower(btrim(student_name)) IN (
               SELECT lower(btrim(name)) FROM internal_students
                WHERE btrim(name) <> '' AND branch_name = ANY($1)
         )`;
      progressParams = [branchList];

      historyQuery = `
        DELETE FROM internal_student_history
         WHERE student_id IN (
               SELECT id FROM internal_students WHERE branch_name = ANY($1)
         )`;
      historyParams = [branchList];

      studentsQuery = `
        DELETE FROM internal_students WHERE branch_name = ANY($1)`;
      studentsParams = [branchList];
    } else {
      // Unconditional wipe across all branches
      progressQuery = `
        DELETE FROM internal_live_progress
         WHERE lower(btrim(student_name)) IN (
               SELECT lower(btrim(name)) FROM internal_students WHERE btrim(name) <> ''
         )`;

      historyQuery = `
        DELETE FROM internal_student_history
         WHERE student_id IN (SELECT id FROM internal_students)`;

      studentsQuery = 'DELETE FROM internal_students';
    }

    const progress = progressParams
      ? await client.query(progressQuery, progressParams)
      : await client.query(progressQuery);
    const history = historyParams
      ? await client.query(historyQuery, historyParams)
      : await client.query(historyQuery);
    const students = studentsParams
      ? await client.query(studentsQuery, studentsParams)
      : await client.query(studentsQuery);

    return {
      deletedStudents: students.rowCount,
      deletedHistory: history.rowCount,
      deletedProgress: progress.rowCount,
    };
  });
}

export default bulkWipeStudents;
