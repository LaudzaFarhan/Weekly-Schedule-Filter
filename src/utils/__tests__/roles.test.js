import { describe, it, expect } from 'vitest';
import {
  ADMIN_ROLE, DEFAULT_ROLE, resolveUserRole, isAdmin,
  SYSTEM_ROLES, APP_MODULES, DEFAULT_ROLE_PERMISSIONS,
  getEffectivePermissions, canAccessPage, canReadModule, canWriteModule, pageToModuleId
} from '@/utils/roles';

const users = {
  'boss@lab.com': 'Admin',
  'sales@lab.com': 'Sales',
  'teacher@lab.com': 'Instructor',
  'advisor@lab.com': 'EC',
};

describe('resolveUserRole', () => {
  it('returns the recorded role for a lowercase email', () => {
    expect(resolveUserRole(users, 'boss@lab.com')).toBe(ADMIN_ROLE);
    expect(resolveUserRole(users, 'sales@lab.com')).toBe('Sales');
  });

  it('folds the email case before the lookup, as the sidebar does', () => {
    expect(resolveUserRole(users, 'BOSS@Lab.com')).toBe(ADMIN_ROLE);
  });

  it('falls back to the default role when the email is missing', () => {
    for (const email of [undefined, null, '']) {
      expect(resolveUserRole(users, email)).toBe(DEFAULT_ROLE);
    }
  });

  it('falls back to the default role when no role is recorded', () => {
    expect(resolveUserRole(users, 'nobody@lab.com')).toBe(DEFAULT_ROLE);
    expect(resolveUserRole({}, 'boss@lab.com')).toBe(DEFAULT_ROLE);
    expect(resolveUserRole(null, 'boss@lab.com')).toBe(DEFAULT_ROLE);
    expect(resolveUserRole(undefined, 'boss@lab.com')).toBe(DEFAULT_ROLE);
  });

  it('treats a blank recorded role as unrecorded', () => {
    expect(resolveUserRole({ 'boss@lab.com': '' }, 'boss@lab.com')).toBe(DEFAULT_ROLE);
  });

  it('never resolves an unknown user to Admin', () => {
    expect(DEFAULT_ROLE).not.toBe(ADMIN_ROLE);
  });
});

describe('isAdmin', () => {
  it('is true only for a recorded Admin role', () => {
    expect(isAdmin(users, 'boss@lab.com')).toBe(true);
    expect(isAdmin(users, 'BOSS@LAB.COM')).toBe(true);
    expect(isAdmin(users, 'sales@lab.com')).toBe(false);
    expect(isAdmin(users, 'nobody@lab.com')).toBe(false);
    expect(isAdmin(users, undefined)).toBe(false);
    expect(isAdmin(null, null)).toBe(false);
  });

  it('is false for a case variant of the role value', () => {
    expect(isAdmin({ 'boss@lab.com': 'admin' }, 'boss@lab.com')).toBe(false);
  });
});

describe('RBAC System Modules and Permissions', () => {
  it('defines 16 core system modules', () => {
    expect(APP_MODULES.length).toBe(16);
    expect(APP_MODULES.some(m => m.id === 'qa-tracker')).toBe(true);
    expect(SYSTEM_ROLES).toEqual(['Admin', 'Supervisor', 'SPA', 'EC', 'Instructor']);
  });

  it('allows Admin full unrestricted access to any page or module', () => {
    for (const mod of APP_MODULES) {
      expect(canAccessPage('Admin', mod.pageId)).toBe(true);
      expect(canReadModule('Admin', mod.id)).toBe(true);
      expect(canWriteModule('Admin', mod.id)).toBe(true);
      const perms = getEffectivePermissions('Admin', mod.id);
      expect(perms.view).toBe(true);
      expect(perms.read).toBe(true);
      expect(perms.write).toBe(true);
    }
  });

  it('correctly maps pages to module ids', () => {
    expect(pageToModuleId('home')).toBe('dashboard');
    expect(pageToModuleId('dashboard')).toBe('dashboard');
    expect(pageToModuleId('progress-junior')).toBe('live-progress');
    expect(pageToModuleId('student-subscriptions')).toBe('students');
    expect(pageToModuleId('report-cards-rubric')).toBe('report-cards');
  });

  it('allows Instructors to view and write to their live progress and schedule by default', () => {
    expect(canAccessPage('Instructor', 'schedule')).toBe(true);
    expect(canAccessPage('Instructor', 'progress-junior')).toBe(true);
    expect(canWriteModule('Instructor', 'live-progress')).toBe(true);
    expect(canWriteModule('Instructor', 'schedule')).toBe(true);
  });

  it('restricts Instructors from modifying user accounts or viewing developer API', () => {
    expect(canAccessPage('Instructor', 'users')).toBe(false);
    expect(canAccessPage('Instructor', 'api')).toBe(false);
    expect(canWriteModule('Instructor', 'users')).toBe(false);
    expect(canWriteModule('Instructor', 'api')).toBe(false);
  });

  it('supports custom overrides in permissions matrix', () => {
    const customMatrix = {
      Instructor: {
        api: { view: true, read: true, write: false, admin: false },
      },
    };
    expect(canAccessPage('Instructor', 'api', customMatrix)).toBe(true);
    expect(canReadModule('Instructor', 'api', customMatrix)).toBe(true);
    expect(canWriteModule('Instructor', 'api', customMatrix)).toBe(false);
  });
});
