import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  getEffectivePermissions,
  resolveUserRole,
  isAdmin,
} from '../roles';
import {
  resolveTeacherAssignedBranches,
  resolveMatchedInstructor,
} from '../instructorUtils';

describe('Branch Restriction & Scoping for Live Progress & User Control', () => {
  describe('DEFAULT_ROLE_PERMISSIONS', () => {
    it('has restrictBranch: true for Instructor on live-progress and students modules', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.Instructor['live-progress'].restrictBranch).toBe(true);
      expect(DEFAULT_ROLE_PERMISSIONS.Instructor['students'].restrictBranch).toBe(true);
    });

    it('has restrictBranch: false or undefined for Admin on live-progress and students', () => {
      expect(Boolean(DEFAULT_ROLE_PERMISSIONS.Admin['live-progress']?.restrictBranch)).toBe(false);
      expect(Boolean(DEFAULT_ROLE_PERMISSIONS.Admin['students']?.restrictBranch)).toBe(false);
    });

    it('has restrictBranch: false or undefined for Supervisor, SPA, and EC', () => {
      expect(Boolean(DEFAULT_ROLE_PERMISSIONS.Supervisor['live-progress']?.restrictBranch)).toBe(false);
      expect(Boolean(DEFAULT_ROLE_PERMISSIONS.Supervisor['students']?.restrictBranch)).toBe(false);
      expect(Boolean(DEFAULT_ROLE_PERMISSIONS.SPA['live-progress']?.restrictBranch)).toBe(false);
      expect(Boolean(DEFAULT_ROLE_PERMISSIONS.SPA['students']?.restrictBranch)).toBe(false);
      expect(Boolean(DEFAULT_ROLE_PERMISSIONS.EC['live-progress']?.restrictBranch)).toBe(false);
      expect(Boolean(DEFAULT_ROLE_PERMISSIONS.EC['students']?.restrictBranch)).toBe(false);
    });
  });

  describe('getEffectivePermissions', () => {
    it('returns restrictBranch: true by default for Instructor on live-progress and students', () => {
      const permsLP = getEffectivePermissions('Instructor', 'live-progress');
      expect(permsLP.view).toBe(true);
      expect(permsLP.read).toBe(true);
      expect(permsLP.restrictBranch).toBe(true);

      const permsST = getEffectivePermissions('Instructor', 'students');
      expect(permsST.view).toBe(true);
      expect(permsST.read).toBe(true);
      expect(permsST.restrictBranch).toBe(true);
    });

    it('returns restrictBranch: false for Admin even if requested', () => {
      const perms = getEffectivePermissions('Admin', 'live-progress');
      expect(perms.restrictBranch).toBe(false);
      expect(perms.admin).toBe(true);

      const permsST = getEffectivePermissions('Admin', 'students');
      expect(permsST.restrictBranch).toBe(false);
      expect(permsST.admin).toBe(true);
    });

    it('respects custom DB rolePermissions overrides', () => {
      // Admin changed Instructor's live-progress to unrestricted in User Control
      const customRolePermissions = {
        Instructor: {
          'live-progress': { view: true, read: true, write: true, admin: false, restrictBranch: false },
        },
      };
      const perms = getEffectivePermissions('Instructor', 'live-progress', customRolePermissions);
      expect(perms.restrictBranch).toBe(false);
    });

    it('respects user-level overrides', () => {
      const userOverrides = {
        'special-teacher@thelab.id': {
          'live-progress': { view: true, read: true, write: true, restrictBranch: false },
        },
      };
      const perms = getEffectivePermissions(
        'Instructor',
        'live-progress',
        null,
        userOverrides,
        'special-teacher@thelab.id'
      );
      expect(perms.restrictBranch).toBe(false);
    });
  });

  describe('resolveTeacherAssignedBranches', () => {
    const mockInstructors = [
      {
        id: 'inst-1',
        name: 'Kak Fikri',
        email: 'fikri@thelab.id',
        location: 'Kelapa Gading',
        branches: ['Kelapa Gading'],
      },
      {
        id: 'inst-2',
        name: 'Kak Ziyah',
        email: 'ziyah@thelab.id',
        location: 'Puri Indah',
        branches: ['Puri Indah'],
      },
    ];

    it('returns null for Admin (unrestricted)', () => {
      const adminUser = {
        id: 'u-admin',
        username: 'admin',
        role: 'Admin',
        email: 'admin@thelab.id',
        location: 'Kelapa Gading',
      };
      expect(resolveTeacherAssignedBranches(adminUser, mockInstructors)).toBeNull();
    });

    it('returns null for Supervisor or EC (unrestricted)', () => {
      const supervisorUser = {
        id: 'u-sup',
        role: 'Supervisor',
        email: 'sup@thelab.id',
        location: 'Kelapa Gading',
      };
      expect(resolveTeacherAssignedBranches(supervisorUser, mockInstructors)).toBeNull();
    });

    it('resolves assigned branch from user.location for Instructor', () => {
      const instructorUser = {
        id: 'u-inst-1',
        role: 'Instructor',
        username: 'fikri',
        email: 'fikri@thelab.id',
        location: 'Kelapa Gading',
      };
      const branches = resolveTeacherAssignedBranches(instructorUser, mockInstructors);
      expect(branches).toEqual(['Kelapa Gading']);
    });

    it('resolves comma-separated locations into an array', () => {
      const multiBranchInstructor = {
        id: 'u-inst-multi',
        role: 'Instructor',
        username: 'multi',
        email: 'multi@thelab.id',
        location: 'Kelapa Gading, Puri Indah',
      };
      const branches = resolveTeacherAssignedBranches(multiBranchInstructor, mockInstructors);
      expect(branches).toEqual(['Kelapa Gading', 'Puri Indah']);
    });

    it('resolves matched instructor profile if user.location is missing', () => {
      const instructorWithoutLocation = {
        id: 'u-inst-2',
        role: 'Instructor',
        username: 'ziyah',
        email: 'ziyah@thelab.id',
      };
      const branches = resolveTeacherAssignedBranches(instructorWithoutLocation, mockInstructors);
      expect(branches).toEqual(['Puri Indah']);
    });

    it('resolves from taught classGroups if profile has no location', () => {
      const instructorFromClasses = {
        id: 'u-inst-3',
        role: 'Instructor',
        username: 'budi',
        displayName: 'Kak Budi',
        email: 'budi@thelab.id',
      };
      const classGroups = [
        { teacher: 'Kak Budi', branchName: 'Bekasi' },
        { teacher: 'Kak Budi', branchName: 'Bekasi' },
      ];
      const branches = resolveTeacherAssignedBranches(instructorFromClasses, [], classGroups);
      expect(branches).toEqual(['Bekasi']);
    });

    it('respects isBranchRestricted parameter override', () => {
      const instructorUser = {
        id: 'u-inst-1',
        role: 'Instructor',
        username: 'fikri',
        email: 'fikri@thelab.id',
        location: 'Kelapa Gading',
      };
      // When explicitly unrestricted via User Control
      expect(resolveTeacherAssignedBranches(instructorUser, mockInstructors, [], false)).toBeNull();
      // When restricted
      expect(resolveTeacherAssignedBranches(instructorUser, mockInstructors, [], true)).toEqual(['Kelapa Gading']);
    });
  });

  describe('resolveMatchedInstructor', () => {
    const mockInstructors = [
      { id: '101', name: 'FAUZIYAH AMIRA ZAHRA', email: 'fauziyah@thelab.id' },
      { id: '102', name: 'FELIX PRATAMA', email: 'felix@thelab.id' },
    ];

    it('matches instructor by nickname alias (Ziyah -> FAUZIYAH)', () => {
      const user = { username: 'ziyah', displayName: 'Kak Ziyah', email: 'ziyah@thelab.id' };
      const matched = resolveMatchedInstructor(user, mockInstructors);
      expect(matched).not.toBeNull();
      expect(matched.id).toBe('101');
    });

    it('matches instructor by email', () => {
      const user = { username: 'felixp', email: 'felix@thelab.id' };
      const matched = resolveMatchedInstructor(user, mockInstructors);
      expect(matched).not.toBeNull();
      expect(matched.id).toBe('102');
    });
  });
});
