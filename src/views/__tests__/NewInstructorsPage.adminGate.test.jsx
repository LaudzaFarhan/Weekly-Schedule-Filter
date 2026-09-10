// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import NewInstructorsPage from '../NewInstructorsPage';
import NewUsersPage from '../NewUsersPage';

const mockShowToast = vi.fn();
let mockCurrentUser = null;

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockCurrentUser,
  }),
}));

const mockInstructors = [
  {
    id: 1,
    name: 'Kak Fadhil',
    level: 'Junior and Coder',
    branches: ['Bekasi'],
    contact: '0812345678',
    status: 'Active',
    employmentType: 'Full-Time',
    availableDays: [],
    aliases: ['Fadhil'],
    verifiedAliases: ['Fadhil'],
    remarks: 'Senior coder instructor',
  },
];

const mockSchedule = {
  internalInstructors: mockInstructors,
  instructorsLoading: false,
  fetchInternalInstructors: vi.fn(),
  users: {
    'admin@thelab.id': 'Admin',
    'adit@thelab.id': 'Instructor',
  },
  branches: ['Bekasi', 'Kelapa Gading'],
  rolePermissions: {},
  updateRolePermissions: vi.fn(),
};

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => mockSchedule,
}));

describe('Admin Permission Gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('NewInstructorsPage', () => {
    it('shows creation and modification controls to Admin users', async () => {
      mockCurrentUser = {
        email: 'admin@thelab.id',
        role: 'Admin',
        username: 'admin',
      };

      global.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('/api/new/instructors')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockInstructors,
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(<NewInstructorsPage onNavigate={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Kak Fadhil')).toBeInTheDocument();
      });

      // Admin sees Add Instructor, Bulk Import, and User Accounts buttons
      expect(screen.getByRole('button', { name: /Add Instructor/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Bulk Import/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /User Accounts & Verification/i })).toBeInTheDocument();

      // Admin sees Actions column header and row edit/delete buttons
      expect(screen.getByRole('columnheader', { name: /Actions/i })).toBeInTheDocument();
      expect(screen.getByTitle('Edit Instructor')).toBeInTheDocument();
      expect(screen.getByTitle('Delete Instructor')).toBeInTheDocument();
    });

    it('hides creation and modification controls from non-admin Instructor users (adit)', async () => {
      mockCurrentUser = {
        email: 'adit@thelab.id',
        role: 'Instructor',
        username: 'adit',
      };

      global.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('/api/new/instructors')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockInstructors,
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(<NewInstructorsPage onNavigate={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Kak Fadhil')).toBeInTheDocument();
      });

      // Non-admin does NOT see Add Instructor, Bulk Import, or User Accounts buttons
      expect(screen.queryByRole('button', { name: /Add Instructor/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Bulk Import/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /User Accounts & Verification/i })).not.toBeInTheDocument();

      // Non-admin does NOT see Actions column header or row edit/delete buttons
      expect(screen.queryByRole('columnheader', { name: /Actions/i })).not.toBeInTheDocument();
      expect(screen.queryByTitle('Edit Instructor')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Delete Instructor')).not.toBeInTheDocument();

      // Non-admin sees read-only directory subtitle
      expect(screen.getByText(/Directory of instructor profiles, teaching capabilities, and branch allocations \(Read-Only\)\./i)).toBeInTheDocument();
    });
  });

  describe('NewUsersPage', () => {
    it('hides creation buttons and shows read-only banner to non-admin Instructor users', async () => {
      mockCurrentUser = {
        email: 'adit@thelab.id',
        role: 'Instructor',
        username: 'adit',
      };

      const usersList = [
        {
          id: 1,
          username: 'admin',
          email: 'admin@thelab.id',
          role: 'Admin',
          status: 'Active',
          isVerified: true,
        },
        {
          id: 2,
          username: 'adit',
          email: 'adit@thelab.id',
          role: 'Instructor',
          status: 'Active',
          isVerified: true,
        },
      ];

      global.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('/api/new/users')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ users: usersList, credentialKeyConfigured: true }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(<NewUsersPage />);

      await waitFor(() => {
        expect(screen.getByText('adit')).toBeInTheDocument();
      });

      // Non-admin does NOT see New account, Accounts for instructors, or Actions column
      expect(screen.queryByRole('button', { name: /New account/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Accounts for instructors/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: /Actions/i })).not.toBeInTheDocument();

      // Non-admin sees read-only banner
      expect(screen.getByText(/You are viewing user accounts in read-only mode/i)).toBeInTheDocument();
    });
  });
});
