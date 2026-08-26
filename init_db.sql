-- ===========================================================================
-- DATABASE INITIALIZATION SCRIPT FOR NEW OPERATIONS (VPS POSTGRESQL)
-- ===========================================================================

-- 1. Create function to automatically update 'updated_at' timestamps
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 2. Create 'internal_classes' table (Schedule)
CREATE TABLE IF NOT EXISTS internal_classes (
    id SERIAL PRIMARY KEY,
    day VARCHAR(50) NOT NULL,
    time VARCHAR(100) NOT NULL,
    program VARCHAR(255) NOT NULL,
    student VARCHAR(255) NOT NULL,
    teacher VARCHAR(255) NOT NULL,
    branch_name VARCHAR(255) NOT NULL,
    class_type VARCHAR(50) DEFAULT 'Regular' NOT NULL,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE TRIGGER update_internal_classes_changetimestamp
    BEFORE UPDATE ON internal_classes
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- 3. Create 'internal_students' table (Students Database)
CREATE TABLE IF NOT EXISTS internal_students (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    level VARCHAR(255) NOT NULL,
    branch_name VARCHAR(255) NOT NULL,
    parent_name VARCHAR(255),
    contact VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'Active' NOT NULL,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE TRIGGER update_internal_students_changetimestamp
    BEFORE UPDATE ON internal_students
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- 4. Create 'internal_instructors' table (Instructors capability & allocation)
CREATE TABLE IF NOT EXISTS internal_instructors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    level VARCHAR(255) NOT NULL,
    branches TEXT[] NOT NULL, -- PostgreSQL array type for multi-branch allocations
    contact VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'Active' NOT NULL,
    aliases TEXT[] DEFAULT '{}' NOT NULL,
    verified_aliases TEXT[] DEFAULT '{}' NOT NULL,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE TRIGGER update_internal_instructors_changetimestamp
    BEFORE UPDATE ON internal_instructors
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- 5. Create 'new_crm_leads' table (CRM Pipeline)
CREATE TABLE IF NOT EXISTS new_crm_leads (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(255) NOT NULL,
    message TEXT,
    status VARCHAR(50) DEFAULT 'interest_trial' NOT NULL,
    branch VARCHAR(255),
    trial_date VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE TRIGGER update_new_crm_leads_changetimestamp
    BEFORE UPDATE ON new_crm_leads
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- 6. Create 'internal_operationals' table (Operationals: per branch/day rules)
--    One row per branch + day. `slots` holds the Class Operation plan as JSON:
--    [{ "type": "kinder|junior|coder|any|break|training|meeting",
--       "start": "13:00", "end": "15:00", "label": "" }]
CREATE TABLE IF NOT EXISTS internal_operationals (
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
);

CREATE OR REPLACE TRIGGER update_internal_operationals_changetimestamp
    BEFORE UPDATE ON internal_operationals
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- 7. Create 'internal_activity' table (Activity log, shared across devices)
CREATE TABLE IF NOT EXISTS internal_activity (
    id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,          -- add | edit | delete | bulk | ...
    summary TEXT NOT NULL,
    item_count INTEGER DEFAULT 1 NOT NULL,
    user_email VARCHAR(255),
    source VARCHAR(50) DEFAULT 'schedule' NOT NULL, -- schedule | crm | students | ...
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS internal_activity_created_at_idx
    ON internal_activity (created_at DESC);

-- 8. Create 'internal_student_history' table (Student branch assignment history)
CREATE TABLE IF NOT EXISTS internal_student_history (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL,
    student_name VARCHAR(255),
    branch_name VARCHAR(255) NOT NULL,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS internal_student_history_student_idx
    ON internal_student_history (student_id, created_at);

-- 9. Create 'internal_leaves' table (Leave Management)
CREATE TABLE IF NOT EXISTS internal_leaves (
    id SERIAL PRIMARY KEY,
    instructor_name VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(50) DEFAULT 'Approved' NOT NULL, -- Approved | Pending | Rejected
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE TRIGGER update_internal_leaves_changetimestamp
    BEFORE UPDATE ON internal_leaves
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

CREATE INDEX IF NOT EXISTS internal_leaves_range_idx
    ON internal_leaves (instructor_name, start_date, end_date);
-- 10. Create 'internal_student_evaluations' table (Report Cards: one
--     five-competency evaluation per student per LESSON)
--     UNIQUE (student_id, lesson_number) makes a duplicated lesson
--     unrepresentable, so re-saving a lesson edits it rather than stacking a
--     second opinion on the same lesson. It is keyed by lesson and NOT by day
--     because the lessons do not run in sequence and two can be graded on one
--     day; eval_date records when the lesson was taught. lesson_number is
--     nullable so rows predating the column keep coexisting (NULLs are distinct
--     in a unique constraint); the API requires one on every new record.
--     The five scores are NOT NULL CHECK (... BETWEEN 1 AND 5) so a
--     write that bypasses the route validator is refused here too.
--     No foreign key on student_id: the application's database user does not own
--     internal_students, so a referencing constraint cannot be created.
CREATE TABLE IF NOT EXISTS internal_student_evaluations (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL,
    eval_date DATE NOT NULL DEFAULT CURRENT_DATE, -- eval_date, not date: date is a type name
    lesson_topic TEXT,
    lesson_number INTEGER CHECK (lesson_number BETWEEN 1 AND 10), -- identifies the report; lessons are not sequential
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
);

CREATE OR REPLACE TRIGGER update_internal_student_evaluations_changetimestamp
    BEFORE UPDATE ON internal_student_evaluations
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

CREATE INDEX IF NOT EXISTS internal_student_evaluations_student_date_idx
    ON internal_student_evaluations (student_id, eval_date);

-- 11. Create 'internal_student_terms' table (Report Cards: term subscriptions
--     driving the T1-T4 badges; one row per student per term per year)
--     There is no is_current column. The start term is the earliest row by
--     (term_year, term_number) and the current term is the latest paid row, both
--     derived on read, which makes a second "current" term unrepresentable. No
--     price, currency or invoice column either: this table answers "paid or
--     not", it is not a billing system.
CREATE TABLE IF NOT EXISTS internal_student_terms (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL,
    term_year INTEGER NOT NULL CHECK (term_year BETWEEN 2000 AND 2100), -- term_year, not year
    term_number INTEGER NOT NULL CHECK (term_number BETWEEN 1 AND 4),
    paid BOOLEAN NOT NULL DEFAULT FALSE,
    paid_at DATE,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT internal_student_terms_student_term_key
        UNIQUE (student_id, term_year, term_number)
);

CREATE OR REPLACE TRIGGER update_internal_student_terms_changetimestamp
    BEFORE UPDATE ON internal_student_terms
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

CREATE INDEX IF NOT EXISTS internal_student_terms_student_idx
    ON internal_student_terms (student_id, term_year, term_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- Employee accounts, migrated off Firebase Auth + Firestore `profiles`.
--
-- `password_encrypted` holds AES-256-GCM ciphertext, never plaintext and never a
-- hash: an Admin has to be able to read a password back when an employee forgets
-- it. The key lives in EMPLOYEE_CREDENTIAL_KEY, so this column on its own is
-- useless to anyone holding only a database dump.
--
-- The role list is a CHECK rather than free text, so a typo'd role cannot
-- silently become unprivileged-but-accepted.
CREATE TABLE IF NOT EXISTS internal_users (
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
);

CREATE OR REPLACE TRIGGER update_internal_users_changetimestamp
    BEFORE UPDATE ON internal_users
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

CREATE INDEX IF NOT EXISTS internal_users_role_idx ON internal_users (role);

-- Which instructor this account belongs to, for accounts generated from the
-- instructor registry. NULL for staff accounts, and PostgreSQL allows any number
-- of NULLs under a UNIQUE index, so one index gives "at most one account per
-- instructor" without excluding accounts that have no instructor.
--
-- This is what makes provisioning idempotent. Matching on name or username would
-- not: both get edited, and either would hand a renamed instructor a second
-- account.
ALTER TABLE internal_users ADD COLUMN IF NOT EXISTS instructor_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS internal_users_instructor_key
    ON internal_users (instructor_id);

-- Login sessions.
--
-- Server-side rows rather than a self-contained signed cookie, because a signed
-- token cannot be revoked before it expires — and the point of the users screen
-- is that an Admin can kill a compromised credential now.
--
-- Only the SHA-256 of the cookie value is stored, so reading this table yields
-- no usable session tokens. Expired rows are deleted opportunistically as they
-- are encountered; there is no scheduler on this host.
CREATE TABLE IF NOT EXISTS internal_sessions (
    id SERIAL PRIMARY KEY,
    token_hash CHAR(64) NOT NULL,
    user_id INTEGER NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT internal_sessions_token_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS internal_sessions_user_idx ON internal_sessions (user_id);
CREATE INDEX IF NOT EXISTS internal_sessions_expiry_idx ON internal_sessions (expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Application configuration, one row per key. This is what replaces the Google
-- Sheet for New Operations; the Sheet-backed /api/config still serves Old
-- Operations, and both run at once until Old Operations is retired.
--
-- Key/value rather than a column per setting: each setting is read and written
-- whole by whoever owns it, and adding one should not need a migration. The set
-- of accepted keys is enforced in the route, not here, so a typo'd key cannot be
-- written but a new key does not need a schema change.
CREATE TABLE IF NOT EXISTS internal_config (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Report-card rubrics, per programme category.
--
-- The five competencies used to be hardcoded, which meant Kinder and Coder were
-- graded on the same axes despite teaching different things. A category with no
-- rows here falls back to that hardcoded set, so an empty table behaves exactly
-- like the previous build.
--
-- `key` is immutable once created, because recorded evaluations reference it.
-- Removal is a soft delete via `active`, so retiring a competency does not orphan
-- the scores already stored against it.
CREATE TABLE IF NOT EXISTS internal_rubric_competencies (
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
);

CREATE OR REPLACE TRIGGER update_internal_rubric_competencies_changetimestamp
    BEFORE UPDATE ON internal_rubric_competencies
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

CREATE INDEX IF NOT EXISTS internal_rubric_competencies_category_idx
    ON internal_rubric_competencies (category, sort_order);
