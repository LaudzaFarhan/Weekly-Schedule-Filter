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
