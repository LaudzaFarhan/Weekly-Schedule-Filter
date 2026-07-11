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
