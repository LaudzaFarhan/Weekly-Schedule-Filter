// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import NewUsersPage from '../NewUsersPage';

const mockShowToast = vi.fn();
const mockUpdateRolePermissions = vi.fn(async () => ({}));

const mockScheduleState = {
  rolePermissions: {},
  updateRolePermissions: mockUpdateRolePermissions,
  branches: [{ name: 'Kelapa Gading' }, { name: 'Puri Indah' }],
};

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => mockScheduleState,
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

describe('NewUsersPage Branch Scoping & Rules in User Control', () => {
  const usersData = [
    {
      id: 1,
      username: 'admin',
      email: 'admin@thelab.id',
      role: 'Admin',
      status: 'Active',
      isVerified: true,
      location: 'All Branches',
    },
    {
      id: 2,
      username: 'fikri',
      fullname: 'Kak Fikri',
      email: 'fikri@thelab.id',
      role: 'Instructor',
      status: 'Active',
      isVerified: true,
      location: 'Kelapa Gading',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url, options) => {
      if (url === '/api/new/users' && (!options || options.method === undefined)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ users: usersData, credentialKeyConfigured: true }),
        });
      }
      if (url === '/api/new/auth/session') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ user: { id: 1, role: 'Admin' } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  it('renders Branch Scope column and toggle in RBAC matrix table', async () => {
    render(<NewUsersPage />);

    // Switch to Roles tab
    const rolesTabBtn = await screen.findByRole('button', { name: /Role Access Control/i });
    fireEvent.click(rolesTabBtn);

    // Should display Branch Scope column header
    expect(screen.getAllByText(/Branch Scope/i).length).toBeGreaterThanOrEqual(1);

    // Should display the Branch Scoping Rule Card
    expect(screen.getAllByText(/Branch Scoping & Data Access Rules/i).length).toBeGreaterThanOrEqual(1);

    // Instructor role is selected by default; live-progress and students have Assigned Branch buttons
    const branchToggleBtns = screen.getAllByRole('button', { name: /Assigned Branch/i });
    expect(branchToggleBtns.length).toBeGreaterThanOrEqual(1);

    // Click first toggle to switch to All Branches
    fireEvent.click(branchToggleBtns[0]);
    expect(screen.getAllByRole('button', { name: /All Branches/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('shows branch datalist and rule banner when adding or editing an Instructor', async () => {
    render(<NewUsersPage />);

    // Click "New account"
    const addBtn = await screen.findByRole('button', { name: /New account/i });
    fireEvent.click(addBtn);

    // Location field should be present
    const locationInput = screen.getByLabelText(/Branch \/ Location/i);
    expect(locationInput).toBeInTheDocument();

    // Instructor rule banner should be visible when role is Instructor
    expect(screen.getByText(/Branch Scoping Rule:/i)).toBeInTheDocument();
  });

  it('shows assigned branch and branch scope in User Access Inspector', async () => {
    render(<NewUsersPage />);

    // Switch to Inspector tab
    const inspectorTabBtn = await screen.findByRole('button', { name: /User Access Inspector/i });
    fireEvent.click(inspectorTabBtn);

    // Inspector header should show branch information
    await waitFor(() => {
      expect(screen.getByText(/Branch:/i)).toBeInTheDocument();
    });

    // Inspector table should have Branch Scope column
    expect(screen.getAllByText(/Branch Scope/i).length).toBeGreaterThanOrEqual(1);
  });
});
