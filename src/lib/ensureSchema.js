import { query } from './db';

/**
 * Self-provisioning schema for the newer New Operations tables.
 *
 * The original four tables (classes, students, instructors, CRM leads) were
 * created by hand from init_db.sql. The tables added later would otherwise
 * fail with `relation "..." does not exist` until someone remembered to re-run
 * that script on the VPS. Each route calls `ensureTable()` before its first
 * query instead, so a fresh database heals itself.
 *
 * Everything here is `IF NOT EXISTS`, so it is safe to run repeatedly and it
 * never touches existing data. The result is cached per process, so this costs
 * one round trip after a cold start rather than one per request.
 */

const TIMESTAMP_FN = `
  CREATE OR REPLACE FUNCTION update_modified_column()
  RETURNS TRIGGER AS $$
  BEGIN
      NEW.updated_at = now();
      RETURN NEW;
  END;
  $$ language 'plpgsql';
`;

const DEFINITIONS = {
  /**
   * Dates a non-regular student actually attends their class.
   *
   * A Regular keeps the same weekly place, so needs no dates. A Replacement
   * comes once, or a handful of times within a period, so each attendance is a
   * row here keyed by the class row it belongs to.
   *
   * This is a companion table rather than a column on `internal_classes`
   * because the application's database user does not own that table — an
   * `ALTER TABLE` on it is refused with "must be owner of table". It can create
   * new tables, which is how the other tables here came to exist.
   */
  internal_class_sessions: [
    `CREATE TABLE IF NOT EXISTS internal_class_sessions (
        id SERIAL PRIMARY KEY,
        class_id INTEGER NOT NULL,
        session_date DATE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT internal_class_sessions_unique UNIQUE (class_id, session_date)
    )`,
    `CREATE INDEX IF NOT EXISTS internal_class_sessions_class_idx
        ON internal_class_sessions (class_id)`,
    `CREATE INDEX IF NOT EXISTS internal_class_sessions_date_idx
        ON internal_class_sessions (session_date)`,
  ],

  internal_leaves: [
    `CREATE TABLE IF NOT EXISTS internal_leaves (
        id SERIAL PRIMARY KEY,
        instructor_name VARCHAR(255) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        reason TEXT,
        status VARCHAR(50) DEFAULT 'Approved' NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS internal_leaves_range_idx
        ON internal_leaves (instructor_name, start_date, end_date)`,
    { trigger: 'update_internal_leaves_changetimestamp', table: 'internal_leaves' },
  ],

  internal_operationals: [
    `CREATE TABLE IF NOT EXISTS internal_operationals (
        id SERIAL PRIMARY KEY,
        branch_name VARCHAR(255) NOT NULL,
        day VARCHAR(50) NOT NULL,
        is_open BOOLEAN DEFAULT TRUE NOT NULL,
        open_time VARCHAR(10),
        close_time VARCHAR(10),
        slots JSONB DEFAULT '[]'::jsonb NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT internal_operationals_branch_day_key UNIQUE (branch_name, day)
    )`,
    { trigger: 'update_internal_operationals_changetimestamp', table: 'internal_operationals' },
  ],

  internal_activity: [
    `CREATE TABLE IF NOT EXISTS internal_activity (
        id SERIAL PRIMARY KEY,
        action VARCHAR(50) NOT NULL,
        summary TEXT NOT NULL,
        item_count INTEGER DEFAULT 1 NOT NULL,
        user_email VARCHAR(255),
        source VARCHAR(50) DEFAULT 'schedule' NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS internal_activity_created_at_idx
        ON internal_activity (created_at DESC)`,
  ],

  // Single-row table holding the configurable slot-combination rules.
  internal_schedule_rules: [
    `CREATE TABLE IF NOT EXISTS internal_schedule_rules (
        id INTEGER PRIMARY KEY DEFAULT 1,
        rules JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT internal_schedule_rules_single_row CHECK (id = 1)
    )`,
  ],

  /**
   * Application configuration, one row per key.
   *
   * This is what replaces the Google Sheet for New Operations. The Sheet-backed
   * `/api/config` still serves Old Operations, and both will be live at once for
   * a while, so this is a separate store rather than a migration of that one.
   *
   * A key/value table rather than a column per setting: the settings that live
   * here are read and written whole by whoever owns them (branches by the header,
   * the role map by the users screen), and adding a setting should not need a
   * migration. JSONB so a value can be a list, a map or a scalar without three
   * different columns.
   */
  internal_config: [
    `CREATE TABLE IF NOT EXISTS internal_config (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_by VARCHAR(255)
    )`,
  ],

  /**
   * Report-card rubrics, per programme category.
   *
   * The five competencies used to be hardcoded in `lib/reportCardRubric.js`, which
   * meant Kinder and Coder were graded on the same axes even though they teach
   * different things. Rows here replace that list; the hardcoded set remains as
   * the fallback for a category with no rows yet, so an empty table behaves
   * exactly like the old build.
   *
   * `key` is immutable once created, because stored evaluations reference it. The
   * label can be renamed freely — that is presentation.
   *
   * Removal is a soft delete via `active`, so turning a competency off does not
   * orphan the scores already recorded against it.
   */
  internal_rubric_competencies: [
    `CREATE TABLE IF NOT EXISTS internal_rubric_competencies (
        id SERIAL PRIMARY KEY,
        category VARCHAR(50) NOT NULL,
        key VARCHAR(60) NOT NULL,
        label VARCHAR(120) NOT NULL,
        color VARCHAR(30),
        sort_order INTEGER NOT NULL DEFAULT 0,
        descriptors JSONB NOT NULL DEFAULT '{}'::jsonb,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT internal_rubric_competencies_key UNIQUE (category, key)
    )`,
    `CREATE INDEX IF NOT EXISTS internal_rubric_competencies_category_idx
        ON internal_rubric_competencies (category, sort_order)`,
    { trigger: 'update_internal_rubric_competencies_changetimestamp', table: 'internal_rubric_competencies' },
  ],

  /**
   * Live Progress: how far a student has got through one program level.
   *
   * Keyed by student name + program code rather than by class row, because
   * progress belongs to the student's journey through a level, not to the seat
   * they happen to occupy. Moving a student to another day, time or instructor
   * must not reset their attendance — and it would, if this hung off a
   * `internal_classes` row that gets deleted and recreated.
   *
   * The per-lesson detail is JSONB rather than ten columns or ten rows: it is
   * always read and written as a whole, and the shape is a sparse map of lesson
   * number to { date, note }. `videos` is the same idea for the "video sent"
   * flags, whose keys are the level codes of the student's category.
   */
  internal_live_progress: [
    `CREATE TABLE IF NOT EXISTS internal_live_progress (
        id SERIAL PRIMARY KEY,
        student_name VARCHAR(255) NOT NULL,
        program_code VARCHAR(100) NOT NULL,
        category VARCHAR(50),
        attendance JSONB DEFAULT '{}'::jsonb NOT NULL,
        videos JSONB DEFAULT '{}'::jsonb NOT NULL,
        continuation VARCHAR(50) DEFAULT 'Not Decide Yet' NOT NULL,
        continuation_note TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT internal_live_progress_student_program_key
            UNIQUE (student_name, program_code)
    )`,
    `CREATE INDEX IF NOT EXISTS internal_live_progress_category_idx
        ON internal_live_progress (category)`,
    { trigger: 'update_internal_live_progress_changetimestamp', table: 'internal_live_progress' },
  ],

  internal_student_history: [
    `CREATE TABLE IF NOT EXISTS internal_student_history (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL,
        student_name VARCHAR(255),
        branch_name VARCHAR(255) NOT NULL,
        note TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS internal_student_history_student_idx
        ON internal_student_history (student_id, created_at)`,
  ],

  /**
   * One five-competency evaluation per student per day.
   *
   * `UNIQUE (student_id, eval_date)` makes a duplicated day unrepresentable, so
   * re-saving a date edits it (the route upserts) rather than stacking a second
   * opinion on the same lesson.
   *
   * The five scores are `NOT NULL CHECK (… BETWEEN 1 AND 5)` so a write that
   * bypasses the route validator is still refused here: an evaluation holding a
   * score no instructor entered is worse than a failed save.
   *
   * No foreign key on `student_id` — the application's database user does not
   * own `internal_students`, so a referencing constraint cannot be created.
   * `internal_student_history` above sets the same precedent.
   *
   * The column is `eval_date`, not `date`: `date` is a type name and would force
   * quoting in every `ORDER BY`.
   */
  /**
   * Employee accounts, migrated off Firebase Auth + Firestore `profiles`.
   *
   * `password_encrypted` holds AES-256-GCM ciphertext, never plaintext and never
   * a hash: an Admin has to be able to read a password back when an employee
   * forgets it. The key lives in `EMPLOYEE_CREDENTIAL_KEY`, so this column is
   * useless on its own to anyone holding only a database dump.
   *
   * Profile fields are columns here rather than a companion table. The
   * `internal_student_credentials` split exists because the app's DB user does
   * not own `internal_students`; it DOES own this table, and `profiles` was
   * already one-to-one with an account, so a join would buy nothing.
   *
   * The five roles are `ROLES` in `AdminPage.jsx`. A `CHECK` rather than free
   * text, so a typo'd role cannot silently become unprivileged-but-accepted.
   */
  internal_users: [
    `CREATE TABLE IF NOT EXISTS internal_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(150) NOT NULL,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'Instructor'
            CHECK (role IN ('Admin', 'SPA', 'EC', 'Instructor', 'Supervisor')),
        password_encrypted TEXT,
        must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
        status VARCHAR(50) NOT NULL DEFAULT 'Active',
        firebase_uid VARCHAR(128),
        fullname VARCHAR(255),
        nickname VARCHAR(255),
        specialization VARCHAR(255),
        phone_number VARCHAR(255),
        location VARCHAR(255),
        training_progress JSONB DEFAULT '{}'::jsonb NOT NULL,
        last_login_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT internal_users_email_key UNIQUE (email),
        CONSTRAINT internal_users_username_key UNIQUE (username)
    )`,
    `CREATE INDEX IF NOT EXISTS internal_users_role_idx ON internal_users (role)`,

    /**
     * Which instructor this account belongs to, for the ones generated from the
     * instructor registry.
     *
     * Added by ALTER because the table shipped before instructor provisioning
     * existed. Safe to run on every cold start, which is what happens.
     *
     * This is what makes provisioning idempotent. Matching on name or username
     * would not: names get corrected and usernames get edited, and either would
     * hand a renamed instructor a second account.
     *
     * NULL for staff accounts, and PostgreSQL allows any number of NULLs under a
     * UNIQUE constraint, so one constraint covers "at most one account per
     * instructor" without excluding accounts that have no instructor.
     */
    `ALTER TABLE internal_users
        ADD COLUMN IF NOT EXISTS instructor_id INTEGER`,
    `CREATE UNIQUE INDEX IF NOT EXISTS internal_users_instructor_key
        ON internal_users (instructor_id)`,

    { trigger: 'update_internal_users_changetimestamp', table: 'internal_users' },
  ],

  /**
   * Login sessions.
   *
   * Server-side records rather than a self-contained signed cookie, because a
   * self-contained token cannot be revoked before it expires — and the point of
   * the users screen is that an Admin can kill a compromised credential NOW.
   *
   * Only the SHA-256 of the cookie value is stored, so reading this table yields
   * no usable session tokens. `expires_at` is checked on every request; expired
   * rows are deleted opportunistically rather than by a scheduled job, since
   * there is no scheduler on this host.
   */
  internal_sessions: [
    `CREATE TABLE IF NOT EXISTS internal_sessions (
        id SERIAL PRIMARY KEY,
        token_hash CHAR(64) NOT NULL,
        user_id INTEGER NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP WITH TIME ZONE,
        CONSTRAINT internal_sessions_token_key UNIQUE (token_hash)
    )`,
    `CREATE INDEX IF NOT EXISTS internal_sessions_user_idx ON internal_sessions (user_id)`,
    `CREATE INDEX IF NOT EXISTS internal_sessions_expiry_idx ON internal_sessions (expires_at)`,
  ],

  internal_student_evaluations: [
    `CREATE TABLE IF NOT EXISTS internal_student_evaluations (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL,
        eval_date DATE NOT NULL DEFAULT CURRENT_DATE,
        lesson_topic TEXT,
        lesson_number INTEGER CHECK (lesson_number BETWEEN 1 AND 10),
        concept INTEGER NOT NULL CHECK (concept BETWEEN 1 AND 5),
        building INTEGER NOT NULL CHECK (building BETWEEN 1 AND 5),
        problem_solving INTEGER NOT NULL CHECK (problem_solving BETWEEN 1 AND 5),
        focus INTEGER NOT NULL CHECK (focus BETWEEN 1 AND 5),
        attitude INTEGER NOT NULL CHECK (attitude BETWEEN 1 AND 5),
        instructor_notes TEXT,
        instructor_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT internal_student_evaluations_student_lesson_key
            UNIQUE (student_id, lesson_number)
    )`,
    /**
     * `lesson_number` was added after this table had already been provisioned,
     * so `CREATE TABLE IF NOT EXISTS` above will not reach a live database that
     * already holds the table — it is skipped whole. This heals that database.
     *
     * Non-destructive and idempotent: the column is nullable with no default,
     * so existing rows keep their data and simply read `null` until someone
     * tags them. Safe to run on every cold start, which is what happens.
     *
     * `ADD COLUMN IF NOT EXISTS` needs PostgreSQL 9.6+; the VPS runs 14+, which
     * the `scram-sha-256` line in `setup_vps.sh` already relies on.
     */
    `ALTER TABLE internal_student_evaluations
        ADD COLUMN IF NOT EXISTS lesson_number INTEGER`,
    /**
     * The bound, added separately so it lands on a table that predates the
     * column too. `NOT VALID` would let existing rows escape the check, so the
     * constraint is added plain — every existing row is `null`, and `CHECK`
     * passes `null` by design, so nothing can fail validation here.
     */
    `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conname = 'internal_student_evaluations_lesson_number_check'
         ) THEN
           ALTER TABLE internal_student_evaluations
             ADD CONSTRAINT internal_student_evaluations_lesson_number_check
             CHECK (lesson_number BETWEEN 1 AND 10);
         END IF;
       END $$`,
    /**
     * Identity moved from the day to the lesson.
     *
     * It was `(student_id, eval_date)`, one report per student per day. That is
     * wrong for how the lessons actually run: two lessons can be graded on the
     * same day, and they do not happen in order. Under the old key, recording
     * lesson 5 on a day that already held lesson 2 upserted onto lesson 2's row
     * and lesson 2 was lost.
     *
     * So the day constraint goes and `(student_id, lesson_number)` takes its
     * place. `eval_date` stays as the day the lesson was taught — recorded, no
     * longer identifying.
     *
     * `lesson_number` stays NULLABLE on purpose. PostgreSQL treats NULLs as
     * distinct in a unique constraint, so rows recorded before the column
     * existed keep coexisting instead of colliding, and no NOT NULL backfill has
     * to guess a lesson number for them. New records always carry one, enforced
     * by `validateEvaluationPayload`.
     *
     * The ADD is wrapped: if a database already holds two rows for one
     * (student, lesson) the constraint cannot be created, and a warning is far
     * better than a route that throws on every request. Nothing is deleted to
     * force it through.
     */
    `DO $$
       BEGIN
         ALTER TABLE internal_student_evaluations
           DROP CONSTRAINT IF EXISTS internal_student_evaluations_student_date_key;

         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conname = 'internal_student_evaluations_student_lesson_key'
         ) THEN
           BEGIN
             ALTER TABLE internal_student_evaluations
               ADD CONSTRAINT internal_student_evaluations_student_lesson_key
               UNIQUE (student_id, lesson_number);
           EXCEPTION WHEN unique_violation THEN
             RAISE WARNING 'internal_student_evaluations: duplicate (student_id, lesson_number) rows exist, so the unique constraint was not added';
           END;
         END IF;
       END $$`,
    `CREATE INDEX IF NOT EXISTS internal_student_evaluations_student_date_idx
        ON internal_student_evaluations (student_id, eval_date)`,
    {
      trigger: 'update_internal_student_evaluations_changetimestamp',
      table: 'internal_student_evaluations',
    },
  ],

  /**
   * Which terms a student has paid for: one row per student per term per year.
   *
   * There is no `is_current` column. The start term is the earliest row by
   * `(term_year, term_number)` and the current term is the latest paid row, both
   * derived on read — which makes a second "current" term unrepresentable rather
   * than merely discouraged. No price or invoice column either; this table
   * answers "paid or not", it is not a billing system.
   *
   * `term_year` rather than `year`, and no foreign key on `student_id`, for the
   * same reasons as `internal_student_evaluations` above.
   */
  internal_student_terms: [
    `CREATE TABLE IF NOT EXISTS internal_student_terms (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL,
        term_year INTEGER NOT NULL CHECK (term_year BETWEEN 2000 AND 2100),
        term_number INTEGER NOT NULL CHECK (term_number BETWEEN 1 AND 4),
        paid BOOLEAN NOT NULL DEFAULT FALSE,
        paid_at DATE,
        note TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT internal_student_terms_student_term_key
            UNIQUE (student_id, term_year, term_number)
    )`,
    `CREATE INDEX IF NOT EXISTS internal_student_terms_student_idx
        ON internal_student_terms (student_id, term_year, term_number)`,
    {
      trigger: 'update_internal_student_terms_changetimestamp',
      table: 'internal_student_terms',
    },
  ],

  internal_meetings: [
    `CREATE TABLE IF NOT EXISTS internal_meetings (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        meeting_date DATE NOT NULL,
        day VARCHAR(50) NOT NULL,
        time VARCHAR(100) NOT NULL,
        branch_name VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        agenda TEXT,
        invited_teachers JSONB DEFAULT '[]'::jsonb NOT NULL,
        status VARCHAR(50) DEFAULT 'Scheduled' NOT NULL,
        created_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS internal_meetings_date_idx ON internal_meetings (meeting_date, day)`,
    `CREATE INDEX IF NOT EXISTS internal_meetings_branch_idx ON internal_meetings (branch_name)`,
    {
      trigger: 'update_internal_meetings_changetimestamp',
      table: 'internal_meetings',
    },
  ],
};

// table name -> Promise, so concurrent requests share one bootstrap.
const inFlight = new Map();

async function provision(table) {
  const steps = DEFINITIONS[table];
  if (!steps) throw new Error(`No schema definition for table "${table}"`);

  for (const step of steps) {
    if (typeof step === 'string') {
      await query(step);
      continue;
    }
    // Triggers need the shared timestamp function to exist first, and
    // CREATE OR REPLACE TRIGGER requires PostgreSQL 14+. Both are optional
    // niceties — a failure here shouldn't block the table from being usable.
    try {
      await query(TIMESTAMP_FN);
      await query(`
        CREATE OR REPLACE TRIGGER ${step.trigger}
            BEFORE UPDATE ON ${step.table}
            FOR EACH ROW
            EXECUTE FUNCTION update_modified_column()
      `);
    } catch (err) {
      console.warn(`[schema] Skipped trigger ${step.trigger}: ${err.message}`);
    }
  }
}

/**
 * Make sure a table exists before querying it. Cached per process.
 * @param {string} table - one of the keys in DEFINITIONS
 */
export function ensureTable(table) {
  if (!inFlight.has(table)) {
    inFlight.set(
      table,
      provision(table).catch((err) => {
        // Don't cache a failure — the next request should retry (the database
        // may simply have been unreachable at that moment).
        inFlight.delete(table);
        throw err;
      })
    );
  }
  return inFlight.get(table);
}
