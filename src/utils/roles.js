/**
 * Role Resolution & Access Control Utilities (RBAC)
 *
 * Provides central authority for:
 * 1. Role resolution for any signed-in user/email.
 * 2. Granular permission checking (View, Read, Write, Admin) per role and module.
 * 3. Module definitions & navigation mapping across New Operations.
 *
 * Pure module: no React, no context, no storage access.
 */

/** All supported roles in the system */
export const SYSTEM_ROLES = ['Admin', 'Supervisor', 'SPA', 'EC', 'Instructor'];

/** The only role with unrestricted root access to destructive and auth actions. */
export const ADMIN_ROLE = 'Admin';

/**
 * The role assumed when nothing is recorded. Deliberately not `ADMIN_ROLE`:
 * an unknown user must never fall into the privileged branch.
 */
export const DEFAULT_ROLE = 'Instructor';

/** Descriptions for each role */
export const ROLE_DESCRIPTIONS = {
  Admin: 'Full access to all system modules, user management, API keys, database wipe & configuration.',
  Supervisor: 'Supervisory access to manage branch schedules, operational timetables, staff workload, students, and activity logs.',
  SPA: 'Student & Parent Advisor: manages student admissions, schedules, progress tracking, and parent communication.',
  EC: 'Education Consultant: consults on student enrollment, schedule inquiries, progress reports, and CRM pipeline.',
  Instructor: 'Teaching staff: manages assigned schedules, records attendance, progress tracking, report card evaluations, and leave.',
};

/**
 * Comprehensive Application Modules for Access Control.
 */
export const APP_MODULES = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'Home',
    category: 'Core',
    description: 'Overview KPIs, branch statistics, today schedules, and live operations summary.',
    pages: ['home', 'dashboard'],
  },
  {
    id: 'schedule',
    label: 'Master Schedule',
    icon: 'Calendar',
    category: 'Operations',
    description: 'Master class schedule, lesson arrangements, temporary schedules, and room allocation.',
    pages: ['schedule'],
  },
  {
    id: 'operationals',
    label: 'Operational Timetables',
    icon: 'Building2',
    category: 'Operations',
    description: 'Weekly operational timetables, branch open days, instructor shift planning, and schedule grid.',
    pages: ['operationals'],
  },
  {
    id: 'students',
    label: 'Student Database',
    icon: 'Users',
    category: 'Students',
    description: 'Student directory, subscription packages, meeting quotas, branch history, and Zoho profile attachments.',
    pages: ['students', 'student-subscriptions'],
  },
  {
    id: 'report-cards',
    label: 'Student Report Cards',
    icon: 'ClipboardList',
    category: 'Students',
    description: 'Term report card evaluations, rubric competency scoring, radar charts, and student performance summaries.',
    pages: ['report-cards', 'report-cards-list', 'report-cards-rubric'],
  },
  {
    id: 'live-progress',
    label: 'Live Progress',
    icon: 'TrendingUp',
    category: 'Students',
    description: 'Real-time lesson attendance tracking, Google Drive video link attachments, continuation notes, and Zoho links.',
    pages: ['progress-kinder', 'progress-junior', 'progress-coder'],
  },
  {
    id: 'instructors',
    label: 'Instructors Directory',
    icon: 'User',
    category: 'Staff',
    description: 'Instructor profiles, teaching capabilities, branch assignments, and contact records.',
    pages: ['instructors'],
  },
  {
    id: 'workload',
    label: 'Workload Matrix',
    icon: 'BarChart3',
    category: 'Staff',
    description: 'Teaching hours summary, weekly workload distribution, student allocation, and capacity utilization.',
    pages: ['workload'],
  },
  {
    id: 'leave',
    label: 'Leave Management',
    icon: 'CalendarOff',
    category: 'Staff',
    description: 'Staff leave requests, calendar approvals, holiday schedules, and instructor absence coverage.',
    pages: ['leave'],
  },
  {
    id: 'trial-availability',
    label: 'Trial Availability',
    icon: 'Star',
    category: 'Enrollment',
    description: 'Real-time available slots for student trial sessions across all branches and programs.',
    pages: ['trial-availability'],
  },
  {
    id: 'crm',
    label: 'CRM Pipeline',
    icon: 'Users',
    category: 'Enrollment',
    description: 'Prospective student leads, parent inquiries, trial status, and enrollment funnel.',
    pages: ['crm'],
  },
  {
    id: 'meetings',
    label: 'Meetings & Zoom',
    icon: 'Video',
    category: 'Communication',
    description: 'Parent-teacher consultation bookings, staff coordination meetings, and session links.',
    pages: ['meetings'],
  },
  {
    id: 'activity',
    label: 'Audit & Activity Log',
    icon: 'Activity',
    category: 'System',
    description: 'Real-time audit log of all schedule changes, student modifications, attendance ticks, and system events.',
    pages: ['activity'],
  },
  {
    id: 'users',
    label: 'User Accounts & Roles',
    icon: 'ShieldCheck',
    category: 'System',
    description: 'User management, credentials reveal, role assignments, and granular RBAC access controls.',
    pages: ['users'],
  },
  {
    id: 'api',
    label: 'Developer API',
    icon: 'Terminal',
    category: 'System',
    description: 'OpenAPI documentation, API keys, webhook integrations, and schema explorer.',
    pages: ['api'],
  },
];

/**
 * Default permission matrix for all roles across all modules.
 * view: Can see in sidebar and open page.
 * read: Can inspect records and view data.
 * write: Can edit, create, tick progress, or arrange schedules.
 * admin: Can perform administrative or destructive actions.
 */
export const DEFAULT_ROLE_PERMISSIONS = {
  Admin: {
    dashboard: { view: true, read: true, write: true, admin: true },
    schedule: { view: true, read: true, write: true, admin: true },
    operationals: { view: true, read: true, write: true, admin: true },
    students: { view: true, read: true, write: true, admin: true },
    'report-cards': { view: true, read: true, write: true, admin: true },
    'live-progress': { view: true, read: true, write: true, admin: true },
    instructors: { view: true, read: true, write: true, admin: true },
    workload: { view: true, read: true, write: true, admin: true },
    leave: { view: true, read: true, write: true, admin: true },
    'trial-availability': { view: true, read: true, write: true, admin: true },
    crm: { view: true, read: true, write: true, admin: true },
    meetings: { view: true, read: true, write: true, admin: true },
    activity: { view: true, read: true, write: true, admin: true },
    users: { view: true, read: true, write: true, admin: true },
    api: { view: true, read: true, write: true, admin: true },
  },
  Supervisor: {
    dashboard: { view: true, read: true, write: true, admin: false },
    schedule: { view: true, read: true, write: true, admin: false },
    operationals: { view: true, read: true, write: true, admin: false },
    students: { view: true, read: true, write: true, admin: false },
    'report-cards': { view: true, read: true, write: true, admin: false },
    'live-progress': { view: true, read: true, write: true, admin: false },
    instructors: { view: true, read: true, write: true, admin: false },
    workload: { view: true, read: true, write: true, admin: false },
    leave: { view: true, read: true, write: true, admin: false },
    'trial-availability': { view: true, read: true, write: true, admin: false },
    crm: { view: true, read: true, write: true, admin: false },
    meetings: { view: true, read: true, write: true, admin: false },
    activity: { view: true, read: true, write: false, admin: false },
    users: { view: true, read: true, write: false, admin: false },
    api: { view: true, read: true, write: false, admin: false },
  },
  SPA: {
    dashboard: { view: true, read: true, write: false, admin: false },
    schedule: { view: true, read: true, write: true, admin: false },
    operationals: { view: true, read: true, write: true, admin: false },
    students: { view: true, read: true, write: true, admin: false },
    'report-cards': { view: true, read: true, write: true, admin: false },
    'live-progress': { view: true, read: true, write: true, admin: false },
    instructors: { view: true, read: true, write: false, admin: false },
    workload: { view: true, read: true, write: false, admin: false },
    leave: { view: true, read: true, write: false, admin: false },
    'trial-availability': { view: true, read: true, write: true, admin: false },
    crm: { view: true, read: true, write: true, admin: false },
    meetings: { view: true, read: true, write: true, admin: false },
    activity: { view: true, read: true, write: false, admin: false },
    users: { view: false, read: false, write: false, admin: false },
    api: { view: false, read: false, write: false, admin: false },
  },
  EC: {
    dashboard: { view: true, read: true, write: false, admin: false },
    schedule: { view: true, read: true, write: true, admin: false },
    operationals: { view: true, read: true, write: false, admin: false },
    students: { view: true, read: true, write: true, admin: false },
    'report-cards': { view: true, read: true, write: true, admin: false },
    'live-progress': { view: true, read: true, write: true, admin: false },
    instructors: { view: true, read: true, write: false, admin: false },
    workload: { view: true, read: true, write: false, admin: false },
    leave: { view: false, read: false, write: false, admin: false },
    'trial-availability': { view: true, read: true, write: true, admin: false },
    crm: { view: true, read: true, write: true, admin: false },
    meetings: { view: true, read: true, write: true, admin: false },
    activity: { view: false, read: false, write: false, admin: false },
    users: { view: false, read: false, write: false, admin: false },
    api: { view: false, read: false, write: false, admin: false },
  },
  Instructor: {
    dashboard: { view: true, read: true, write: false, admin: false },
    schedule: { view: true, read: true, write: true, admin: false },
    operationals: { view: false, read: false, write: false, admin: false },
    students: { view: true, read: true, write: false, admin: false },
    'report-cards': { view: true, read: true, write: true, admin: false },
    'live-progress': { view: true, read: true, write: true, admin: false },
    instructors: { view: true, read: true, write: false, admin: false },
    workload: { view: true, read: true, write: false, admin: false },
    leave: { view: true, read: true, write: true, admin: false },
    'trial-availability': { view: true, read: true, write: false, admin: false },
    crm: { view: false, read: false, write: false, admin: false },
    meetings: { view: true, read: true, write: true, admin: false },
    activity: { view: false, read: false, write: false, admin: false },
    users: { view: false, read: false, write: false, admin: false },
    api: { view: false, read: false, write: false, admin: false },
  },
};

/**
 * Resolve an email or user object to a role, with the fallback the sidebar and header use.
 *
 * @param {Object<string, string>|null|undefined} users - email → role map
 * @param {string|null|undefined} email - the signed-in account's email
 * @param {Object|null|undefined} [user] - optional signed-in user object
 * @returns {string} the recorded role, or `DEFAULT_ROLE` when none is recorded
 */
export function resolveUserRole(users, email, user) {
  if (user?.role) return user.role;
  if (!email && !user) return DEFAULT_ROLE;
  const identifier = String(email || user?.email || user?.username || '').toLowerCase().trim();
  if (identifier === 'admin' || identifier === 'admin@thelab.com') return ADMIN_ROLE;
  return users?.[identifier] || DEFAULT_ROLE;
}

/**
 * Whether the email or user holds the Admin role.
 *
 * @param {Object<string, string>|null|undefined} users - email → role map
 * @param {string|null|undefined} email - the signed-in account's email
 * @param {Object|null|undefined} [user] - optional signed-in user object
 * @returns {boolean} true only when a recorded role equals `ADMIN_ROLE`
 */
export function isAdmin(users, email, user) {
  return resolveUserRole(users, email, user) === ADMIN_ROLE;
}

/**
 * Map a page ID to its corresponding module ID.
 *
 * @param {string} pageId
 * @returns {string} moduleId
 */
export function pageToModuleId(pageId) {
  const p = String(pageId || '').toLowerCase().trim();
  for (const mod of APP_MODULES) {
    if (mod.pages.includes(p)) return mod.id;
  }
  return p;
}

/**
 * Get effective permissions for a given role/module with custom overrides.
 *
 * @param {string} role - Role name (e.g. 'Admin', 'Instructor')
 * @param {string} moduleId - Module ID (e.g. 'schedule', 'operationals')
 * @param {Object} [rolePermissions] - Dynamic custom permissions from DB
 * @param {Object} [userOverrides] - Specific per-user overrides
 * @param {string} [email] - User email
 * @returns {{ view: boolean, read: boolean, write: boolean, admin: boolean }}
 */
export function getEffectivePermissions(role = DEFAULT_ROLE, moduleId, rolePermissions, userOverrides, email) {
  if (role === ADMIN_ROLE) {
    return { view: true, read: true, write: true, admin: true };
  }

  const modKey = pageToModuleId(moduleId);

  // 1. Check user-level override if provided
  const emailKey = String(email || '').toLowerCase().trim();
  if (emailKey && userOverrides?.[emailKey]?.[modKey]) {
    const uPerm = userOverrides[emailKey][modKey];
    return {
      view: uPerm.view ?? true,
      read: uPerm.read ?? true,
      write: uPerm.write ?? false,
      admin: uPerm.admin ?? false,
    };
  }

  // 2. Check dynamic role permissions from DB/config
  if (rolePermissions?.[role]?.[modKey]) {
    const rPerm = rolePermissions[role][modKey];
    return {
      view: rPerm.view ?? false,
      read: rPerm.read ?? false,
      write: rPerm.write ?? false,
      admin: rPerm.admin ?? false,
    };
  }

  // 3. Fallback to default role permissions
  const defaults = DEFAULT_ROLE_PERMISSIONS[role]?.[modKey] || { view: false, read: false, write: false, admin: false };
  return { ...defaults };
}

/**
 * Check whether a user or role can access (view) a specific page.
 *
 * @param {string} role
 * @param {string} pageId
 * @param {Object} [rolePermissions]
 * @param {Object} [userOverrides]
 * @param {string} [email]
 * @returns {boolean}
 */
export function canAccessPage(role = DEFAULT_ROLE, pageId, rolePermissions, userOverrides, email) {
  if (role === ADMIN_ROLE) return true;
  const perms = getEffectivePermissions(role, pageId, rolePermissions, userOverrides, email);
  return Boolean(perms.view);
}

/**
 * Check whether a user or role can read data within a module.
 */
export function canReadModule(role = DEFAULT_ROLE, moduleId, rolePermissions, userOverrides, email) {
  if (role === ADMIN_ROLE) return true;
  const perms = getEffectivePermissions(role, moduleId, rolePermissions, userOverrides, email);
  return Boolean(perms.read);
}

/**
 * Check whether a user or role can write/edit data within a module.
 */
export function canWriteModule(role = DEFAULT_ROLE, moduleId, rolePermissions, userOverrides, email) {
  if (role === ADMIN_ROLE) return true;
  const perms = getEffectivePermissions(role, moduleId, rolePermissions, userOverrides, email);
  return Boolean(perms.write);
}

