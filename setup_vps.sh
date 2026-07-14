#!/bin/bash

# ===========================================================================
# VPS POSTGRESQL DATABASE SETUP FOR THE LAB OPERATION SYSTEM (NEW OPS)
# ===========================================================================
# This script guides you through installing PostgreSQL, configuring security,
# allowing Vercel connections, and initializing database tables.
#
# Run these commands as root or a user with sudo access on your VPS.
# ===========================================================================

# Exit immediately if a command exits with a non-zero status
set -e

echo "=========================================="
echo "Starting PostgreSQL Installation on VPS..."
echo "=========================================="

# 1. Update system package index
sudo apt update

# 2. Install PostgreSQL and contrib packages
sudo apt install -y postgresql postgresql-contrib

# 3. Enable and start PostgreSQL service
sudo systemctl enable postgresql
sudo systemctl start postgresql

echo "------------------------------------------"
echo "PostgreSQL installed and running."
echo "------------------------------------------"

# 4. Create database and user
# Replace 'dbpassword' with a very secure password!
DB_USER="lab_operator"
DB_NAME="thelabops"
DB_PASS="calculated213" # Change this password!

echo "Creating database user '${DB_USER}' and database '${DB_NAME}'..."

# Idempotent: only create the role/database if they don't already exist, so
# re-running the script (e.g. after a partial run) doesn't abort under `set -e`.
sudo -i -u postgres psql -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}'; END IF; END \$\$;"
# Keep the password in sync in case it changed.
sudo -i -u postgres psql -c "ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';"
sudo -i -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -i -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
sudo -i -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

echo "------------------------------------------"
echo "Database created successfully."
echo "------------------------------------------"

# 5. Initialize Tables
# Copy the 'init_db.sql' file to your VPS and run the command:
# sudo -i -u postgres psql -d thelabops -f /path/to/init_db.sql
# Or we can inline the schema initialization:
echo "Initializing database tables..."
sudo -i -u postgres psql -d ${DB_NAME} -c "
-- 1. Create function to automatically update 'updated_at' timestamps
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS \$\$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
\$\$ language 'plpgsql';

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
    branches TEXT[] NOT NULL,
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
"

echo "------------------------------------------"
echo "Tables initialized successfully."
echo "------------------------------------------"

# 5b. Grant table/sequence privileges to the app user.
# The tables above were created by the 'postgres' superuser, so they are owned
# by 'postgres'. Without these grants, the app user ('${DB_USER}') would get
# "permission denied for table ..." on every query. We also set DEFAULT
# PRIVILEGES so any future tables created by postgres stay accessible.
echo "Granting privileges to '${DB_USER}'..."
sudo -i -u postgres psql -d ${DB_NAME} -c "
GRANT ALL ON SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${DB_USER};
"
echo "Privileges granted."

# 6. Enable Remote Connections (So Vercel can connect)
echo "Configuring PostgreSQL to allow remote connections..."

PG_VERSION=$(psql --version | grep -oE '[0-9]+\.[0-9]+' | head -n1 | cut -d. -f1)
if [ -z "$PG_VERSION" ]; then
    PG_VERSION=$(psql --version | grep -oE '[0-9]+' | head -n1)
fi

CONF_DIR="/etc/postgresql/${PG_VERSION}/main"

# Allow PostgreSQL to listen on all interfaces
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/g" "${CONF_DIR}/postgresql.conf"

# Append host access record to pg_hba.conf (Allows connections with password
# authentication from any IP). PostgreSQL 14+ stores passwords as scram-sha-256
# by default, so we must use scram-sha-256 here (md5 would fail to authenticate).
# In production, restrict this to Vercel's IP ranges if needed, or secure via SSL.
# Guarded so re-running the script doesn't append duplicate lines.
if ! sudo grep -q "0.0.0.0/0" "${CONF_DIR}/pg_hba.conf"; then
    echo "host    all             all             0.0.0.0/0               scram-sha-256" | sudo tee -a "${CONF_DIR}/pg_hba.conf"
fi

# Restart PostgreSQL service to apply config changes
sudo systemctl restart postgresql

echo "------------------------------------------"
echo "PostgreSQL remote connections enabled."
echo "------------------------------------------"

# 7. Configure Firewall (Allows port 5432)
echo "Opening firewall port 5432 for PostgreSQL..."
if command -v ufw >/dev/null; then
    sudo ufw allow 5432/tcp
    echo "Firewall rules updated."
else
    echo "ufw firewall not installed. Please ensure port 5432 is open in your cloud provider security group."
fi

VPS_IP=$(hostname -I | awk '{print $1}')

echo "======================================================================="
echo " VPS POSTGRESQL SETUP COMPLETED SUCCESSFULLY!"
echo "======================================================================="
echo " Your PostgreSQL details:"
echo " - Database Name: ${DB_NAME}"
echo " - Username:      ${DB_USER}"
echo " - Password:      ${DB_PASS}"
echo " - Port:          5432"
echo " - VPS Public IP: ${VPS_IP}"
echo ""
echo " Connection String (Add this as DATABASE_URL in Vercel):"
echo " postgres://${DB_USER}:${DB_PASS}@${VPS_IP}:5432/${DB_NAME}"
echo "======================================================================="
