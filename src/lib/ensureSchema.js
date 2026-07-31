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
  internal_student_evaluations: [
    `CREATE TABLE IF NOT EXISTS internal_student_evaluations (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL,
        eval_date DATE NOT NULL DEFAULT CURRENT_DATE,
        lesson_topic TEXT,
        concept INTEGER NOT NULL CHECK (concept BETWEEN 1 AND 5),
        building INTEGER NOT NULL CHECK (building BETWEEN 1 AND 5),
        problem_solving INTEGER NOT NULL CHECK (problem_solving BETWEEN 1 AND 5),
        focus INTEGER NOT NULL CHECK (focus BETWEEN 1 AND 5),
        attitude INTEGER NOT NULL CHECK (attitude BETWEEN 1 AND 5),
        instructor_notes TEXT,
        instructor_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT internal_student_evaluations_student_date_key
            UNIQUE (student_id, eval_date)
    )`,
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
