// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const authState = vi.hoisted(() => ({ user: null }));

vi.mock('../../../contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: authState.user, loading: false, login: () => {}, logout: () => {} }),
}));

vi.mock('../../../services/firebase', () => ({
  auth: {},
  db: {},
  firebaseConfigured: false,
}));

import ScheduleGrid, { resolveTeacherAssignedBranches } from '../ScheduleGrid';

const mockBranches = [
  { id: 'bekasi', name: 'Bekasi' },
  { id: 'gading-serpong', name: 'Gading Serpong' },
  { id: 'puri-indah', name: 'Puri Indah' },
  { id: 'bintaro', name: 'Bintaro' },
];

const mockInstructors = [
  { id: 101, name: 'Risafya Tabrina Aurelia', branches: ['Bekasi'], level: 'Kinder and Junior' },
  { id: 102, name: 'Felix Tio', branches: ['Gading Serpong'], level: 'Junior and Coder' },
  { id: 103, name: 'Sky', branches: ['Puri Indah'], level: 'Junior' },
];

describe('resolveTeacherAssignedBranches', () => {
  it('returns null for Admin, Supervisor, SPA, or EC (unrestricted access)', () => {
    expect(resolveTeacherAssignedBranches({ role: 'Admin' }, mockInstructors)).toBeNull();
    expect(resolveTeacherAssignedBranches({ role: 'Supervisor' }, mockInstructors)).toBeNull();
    expect(resolveTeacherAssignedBranches({ role: 'SPA' }, mockInstructors)).toBeNull();
    expect(resolveTeacherAssignedBranches({ role: 'EC' }, mockInstructors)).toBeNull();
  });

  it('resolves branch from user.location for Instructor', () => {
    const user = { role: 'Instructor', location: 'Bekasi' };
    const branches = resolveTeacherAssignedBranches(user, mockInstructors);
    expect(branches).toEqual(['Bekasi']);
  });

  it('resolves branch by matching instructorId', () => {
    const user = { role: 'Instructor', instructorId: 101 };
    const branches = resolveTeacherAssignedBranches(user, mockInstructors);
    expect(branches).toEqual(['Bekasi']);
  });

  it('resolves branch by matching user email or remarks', () => {
    const instructorsWithRemarks = [
      { id: 201, name: 'Teacher A', branches: ['Bintaro'], remarks: 'Email: teachera@thelab.id' },
    ];
    const user = { role: 'Instructor', email: 'teachera@thelab.id' };
    const branches = resolveTeacherAssignedBranches(user, instructorsWithRemarks);
    expect(branches).toEqual(['Bintaro']);
  });

  it('resolves branch by matching displayName/fullname', () => {
    const user = { role: 'Instructor', displayName: 'Felix Tio' };
    const branches = resolveTeacherAssignedBranches(user, mockInstructors);
    expect(branches).toEqual(['Gading Serpong']);
  });

  it('supports teachers assigned to multiple branches', () => {
    const multiBranchInst = [
      { id: 301, name: 'Multi Teacher', branches: ['Bekasi', 'Gading Serpong'], level: 'Kinder' },
    ];
    const user = { role: 'Instructor', displayName: 'Multi Teacher' };
    const branches = resolveTeacherAssignedBranches(user, multiBranchInst);
    expect(branches).toEqual(['Bekasi', 'Gading Serpong']);
  });

  it('falls back to classGroups if profile has no branches', () => {
    const unassignedInst = [{ id: 401, name: 'New Teacher', branches: [] }];
    const classGroups = [{ teacher: 'New Teacher', branchName: 'Puri Indah' }];
    const user = { role: 'Instructor', displayName: 'New Teacher' };
    const branches = resolveTeacherAssignedBranches(user, unassignedInst, classGroups);
    expect(branches).toEqual(['Puri Indah']);
  });
});

describe('ScheduleGrid teacher branch view restrictions', () => {
  it('allows Admin to see all branches and "All Branches (view only)"', () => {
    const adminUser = { role: 'Admin', email: 'admin@thelab.id' };
    render(
      <ScheduleGrid
        user={adminUser}
        branches={mockBranches}
        instructors={mockInstructors}
      />
    );

    // Should have option for All Branches (view only)
    expect(screen.getByRole('option', { name: /All Branches \(view only\)/i })).toBeInTheDocument();

    // Should have options for each branch
    expect(screen.getByRole('option', { name: 'Bekasi' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gading Serpong' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Puri Indah' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bintaro' })).toBeInTheDocument();

    // Select should not be disabled
    const branchSelect = screen.getByDisplayValue('Bekasi');
    expect(branchSelect).not.toBeDisabled();
    expect(screen.queryByText(/Assigned/i)).not.toBeInTheDocument();
  });

  it('restricts teacher (Instructor) to ONLY their assigned branch', () => {
    const teacherUser = {
      role: 'Instructor',
      username: 'risafya.tabrina.aurelia',
      displayName: 'Risafya Tabrina Aurelia',
      location: 'Bekasi',
    };

    render(
      <ScheduleGrid
        user={teacherUser}
        branches={mockBranches}
        instructors={mockInstructors}
      />
    );

    // Option for "All Branches (view only)" must NOT exist
    expect(screen.queryByRole('option', { name: /All Branches \(view only\)/i })).not.toBeInTheDocument();

    // Option for Bekasi must exist
    expect(screen.getByRole('option', { name: 'Bekasi' })).toBeInTheDocument();

    // Other branch options must NOT exist
    expect(screen.queryByRole('option', { name: 'Gading Serpong' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Puri Indah' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Bintaro' })).not.toBeInTheDocument();

    // The branch select must be locked/disabled to their assigned branch
    const branchSelect = screen.getByDisplayValue('Bekasi');
    expect(branchSelect).toBeDisabled();

    // "Assigned" indicator badge must be visible
    expect(screen.getByText(/^Assigned$/)).toBeInTheDocument();

    // Right-side "You are assigned to this branch" badge must be visible
    expect(screen.getByText(/You are assigned to this branch/i)).toBeInTheDocument();
  });

  it('allows teacher assigned to multiple branches to switch between assigned branches only', () => {
    const multiBranchUser = {
      role: 'Instructor',
      displayName: 'Multi Teacher',
      branches: ['Bekasi', 'Gading Serpong'],
    };

    render(
      <ScheduleGrid
        user={multiBranchUser}
        branches={mockBranches}
        instructors={mockInstructors}
      />
    );

    // Should include both assigned branches
    expect(screen.getByRole('option', { name: 'Bekasi' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gading Serpong' })).toBeInTheDocument();

    // Non-assigned branches must NOT exist
    expect(screen.queryByRole('option', { name: 'Puri Indah' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Bintaro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /All Branches/i })).not.toBeInTheDocument();

    // Because there are multiple assigned branches, select is enabled for switching between them
    const branchSelect = screen.getByDisplayValue('Bekasi');
    expect(branchSelect).not.toBeDisabled();
  });

  it('reads user from useAuth() when user prop is omitted and applies restrictions', () => {
    authState.user = {
      role: 'Instructor',
      location: 'Bintaro',
    };

    render(
      <ScheduleGrid
        branches={mockBranches}
        instructors={mockInstructors}
      />
    );

    expect(screen.getByRole('option', { name: 'Bintaro' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Bekasi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /All Branches/i })).not.toBeInTheDocument();
    const branchSelect = screen.getByDisplayValue('Bintaro');
    expect(branchSelect).toBeDisabled();
    expect(screen.getByText(/^Assigned$/)).toBeInTheDocument();
    expect(screen.getByText(/You are assigned to this branch/i)).toBeInTheDocument();
  });

  it('displays full student name, attendance count, and continuation badge on class card', () => {
    const mockClassGroups = [
      {
        id: 'cls-1',
        key: 'cls-1',
        branchName: 'Bekasi',
        day: 'Monday',
        teacher: 'Risafya Tabrina Aurelia',
        startMin: 900,
        endMin: 990,
        programs: ['K1.8', 'K1.3'],
        members: [
          { student: 'Beatrice Eunice Wijaya', program: 'K1.8' },
        ],
      },
    ];

    const mockLiveProgress = [
      {
        studentName: 'Beatrice Eunice Wijaya',
        category: 'Kinder',
        attendance: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} },
        progressUpdateStatus: 'Update Scheduled',
        progressUpdateDate: '2026-09-12',
        continuation: 'Continue',
      },
    ];

    render(
      <ScheduleGrid
        user={{ role: 'Admin' }}
        branches={mockBranches}
        instructors={mockInstructors}
        classGroups={mockClassGroups}
        liveProgress={mockLiveProgress}
      />
    );

    // Full student name should be visible on the card without being cut off
    expect(screen.getAllByText(/Beatrice Eunice Wijaya/i).length).toBeGreaterThanOrEqual(1);

    // Attendance count pill should be visible
    expect(screen.getByText(/7\/10 mtgs/i)).toBeInTheDocument();

    // Continuation pill should be visible
    expect(screen.getByText(/^Continue$/)).toBeInTheDocument();
  });
});

