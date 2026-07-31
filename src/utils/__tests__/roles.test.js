import { describe, it, expect } from 'vitest';
import { ADMIN_ROLE, DEFAULT_ROLE, resolveUserRole, isAdmin } from '@/utils/roles';

const users = {
  'boss@lab.com': 'Admin',
  'sales@lab.com': 'Sales',
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
